#!/usr/bin/env node
// Control Center v2 MCP — chat-side observer + dispatcher.
//
// Exposes a small set of tools the orchestrator (claude in chat) needs:
//   cc2_read_messages   — read channel messages, optional `since` cursor
//   cc2_list_tasks      — filter by team/status/assignTo
//   cc2_get_task        — single task by id
//   cc2_list_agents     — agent health snapshot
//   cc2_create_task     — dispatch new task to a worker
//   cc2_approve_task    — promote awaiting-approval -> queued (gated tasks)
//
// Workers do NOT use this MCP — they reply via tmux pane + PATCH HTTP per
// Protocol v1.4. This is an orchestrator/observer tool only.
//
// JSON-RPC 2.0 over stdio. No hub auto-spawn — assumes ccctl is responsible
// for bringing the broker up.
//
// Env:
//   CC2_URL  default http://localhost:3002

import http from 'node:http';
import { createInterface } from 'node:readline';

const CC_URL = new URL(process.env.CC2_URL || 'http://localhost:3002');

function hubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: CC_URL.hostname,
      port: CC_URL.port,
      path,
      method,
      headers: { 'content-type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const TOOLS = [
  {
    name: 'cc2_read_messages',
    description: 'Read channel messages from Control Center v2. Use `since` to fetch only messages newer than the last id you saw.',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Filter by team (optional)' },
        since: { type: 'integer', description: 'Return only messages with id > since' },
        limit: { type: 'integer', description: 'Max messages (default 100, max 1000)' },
      },
    },
  },
  {
    name: 'cc2_list_tasks',
    description: 'List tasks, optionally filtered by team/status/assignTo.',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string' },
        status: { type: 'string', enum: ['queued', 'awaiting-approval', 'dispatched', 'acknowledged', 'completed', 'failed', 'cancelled'] },
        assignTo: { type: 'string' },
      },
    },
  },
  {
    name: 'cc2_get_task',
    description: 'Get a single task by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
  },
  {
    name: 'cc2_list_agents',
    description: 'Snapshot of agent health (lastSeen, stale, status).',
    inputSchema: {
      type: 'object',
      properties: { team: { type: 'string' } },
    },
  },
  {
    name: 'cc2_create_task',
    description: 'Dispatch a new task to a worker. Goes immediately into the queue (or awaiting-approval if gated).',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string' },
        assignTo: { type: 'string', description: 'Worker name, e.g. "gemini" or "claude"' },
        type: { type: 'string', description: 'e.g. "message" | "code" | "review"' },
        payload: { type: 'object', description: 'Type-specific payload. For type="message", include {message: "..."}.' },
        priority: { type: 'integer' },
        gated: { type: 'boolean', description: 'If true, task starts in awaiting-approval (CEO must approve via cc2_approve_task)' },
      },
      required: ['team', 'assignTo', 'type', 'payload'],
    },
  },
  {
    name: 'cc2_approve_task',
    description: 'Approve a gated task (awaiting-approval -> queued). Triggers immediate dispatch.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
  },
];

async function handleToolCall(name, args) {
  switch (name) {
    case 'cc2_read_messages': {
      const qp = [];
      if (args.team) qp.push(`team=${encodeURIComponent(args.team)}`);
      if (args.since != null) qp.push(`since=${args.since}`);
      if (args.limit != null) qp.push(`limit=${args.limit}`);
      const path = '/api/messages' + (qp.length ? `?${qp.join('&')}` : '');
      const res = await hubRequest('GET', path);
      return JSON.stringify(res.body, null, 2);
    }
    case 'cc2_list_tasks': {
      const qp = [];
      if (args.team) qp.push(`team=${encodeURIComponent(args.team)}`);
      if (args.status) qp.push(`status=${encodeURIComponent(args.status)}`);
      if (args.assignTo) qp.push(`assignTo=${encodeURIComponent(args.assignTo)}`);
      const path = '/api/tasks' + (qp.length ? `?${qp.join('&')}` : '');
      const res = await hubRequest('GET', path);
      return JSON.stringify(res.body, null, 2);
    }
    case 'cc2_get_task': {
      const res = await hubRequest('GET', `/api/tasks/${args.id}`);
      if (res.status === 404) return `Task ${args.id} not found`;
      return JSON.stringify(res.body, null, 2);
    }
    case 'cc2_list_agents': {
      const qp = args.team ? `?team=${encodeURIComponent(args.team)}` : '';
      const res = await hubRequest('GET', `/api/agents${qp}`);
      return JSON.stringify(res.body, null, 2);
    }
    case 'cc2_create_task': {
      const res = await hubRequest('POST', '/api/tasks', args);
      if (res.status >= 400) return `Error (${res.status}): ${JSON.stringify(res.body)}`;
      return JSON.stringify(res.body, null, 2);
    }
    case 'cc2_approve_task': {
      const res = await hubRequest('POST', `/api/tasks/${args.id}/approve`);
      if (res.status === 404) return `Task ${args.id} not found`;
      if (res.status === 409) return `Cannot approve: ${JSON.stringify(res.body)}`;
      return JSON.stringify(res.body, null, 2);
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── JSON-RPC over stdio ──

const rl = createInterface({ input: process.stdin, terminal: false });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (req.id == null && req.method !== 'notifications/initialized') return;

  const { id, method, params } = req;

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'control-center-v2', version: '0.1.0' },
        },
      });
      break;

    case 'notifications/initialized':
      break;

    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      break;

    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const result = await handleToolCall(name, args || {});
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result }] } });
      } catch (err) {
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true } });
      }
      break;
    }

    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});

process.stdout.on('error', () => {});
process.stdin.on('error', () => {});

process.stderr.write(`[cc2-mcp] ready (broker: ${CC_URL.href})\n`);
