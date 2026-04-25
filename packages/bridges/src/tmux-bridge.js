#!/usr/bin/env node
// Tmux bridge — subscribes to /api/agent-events for one agent and injects
// the task prompt into a tmux pane. Inject-only: the worker types its reply
// in the same pane; pane-mirror forwards it to /api/messages.
//
// On successful injection: PATCH the task to "acknowledged". The worker is
// responsible for the final completed/failed PATCH per Protocol v1.4.
//
// Env:
//   CC_URL          default http://localhost:3000
//   CC_TEAM         default factory-v3
//   AGENT_NAME      required
//   TMUX_TARGET     required, e.g. "claude-cc:0.0"

import { spawn } from 'node:child_process';

const CC_URL = process.env.CC_URL || 'http://localhost:3000';
const TEAM = process.env.CC_TEAM || 'factory-v3';
const AGENT = process.env.AGENT_NAME;
const TARGET = process.env.TMUX_TARGET;

if (!AGENT || !TARGET) {
  console.error('[tmux-bridge] AGENT_NAME and TMUX_TARGET are required');
  process.exit(1);
}

function tmux(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('tmux', args);
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`tmux ${args.join(' ')} exit ${code}`)));
  });
}

const sendLiteral = text => tmux(['send-keys', '-t', TARGET, '-l', text]);
const sendKey = key => tmux(['send-keys', '-t', TARGET, key]);

async function ccRequest(method, path, body) {
  try {
    const res = await fetch(`${CC_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    return await res.json().catch(() => ({}));
  } catch (e) {
    console.error(`[tmux-bridge] ${method} ${path}: ${e.message}`);
    return {};
  }
}

const heartbeat = (status = 'idle', meta = {}) =>
  ccRequest('POST', '/api/heartbeat', {
    agent: AGENT, team: TEAM, status, capacity: 1,
    meta: { bridge: 'tmux', target: TARGET, ...meta },
  });

function buildPrompt(task) {
  const spec = task.payload?.spec || task.payload?.message || '';
  return `[via Control Center → ${AGENT} task #${task.id}] ${spec}`;
}

async function handleTask(task) {
  console.error(`[tmux-bridge] task #${task.id} → ${TARGET}`);
  await heartbeat('busy', { currentTaskId: task.id });

  const text = buildPrompt(task);
  try {
    // Escape preamble: break out of any modal/shell state the CLI might be in.
    await sendKey('Escape');
    await new Promise(r => setTimeout(r, 100));

    await sendLiteral(text);
    // Pause scales with payload length so TUIs finish rendering before Enter.
    const renderMs = Math.min(2500, 300 + Math.floor(text.length / 4));
    await new Promise(r => setTimeout(r, renderMs));
    await sendKey('Enter');
    await new Promise(r => setTimeout(r, 200));
    await sendKey('Enter'); // belt-and-suspenders for TUIs that drop the first

    await ccRequest('PATCH', `/api/tasks/${task.id}`, {
      status: 'acknowledged',
      result: `delivered to ${TARGET}`,
    });
  } catch (e) {
    console.error(`[tmux-bridge] inject failed: ${e.message}`);
    await ccRequest('PATCH', `/api/tasks/${task.id}`, {
      status: 'failed',
      result: `tmux injection failed: ${e.message}`,
    });
  }
  await heartbeat('idle');
}

async function connectSSE() {
  const url = `${CC_URL}/api/agent-events?agent=${encodeURIComponent(AGENT)}&team=${encodeURIComponent(TEAM)}`;
  const loop = async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.error(`[tmux-bridge] connected as ${AGENT}/${TEAM} → ${TARGET}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let evt = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('event:')) evt = line.slice(6).trim();
          else if (line.startsWith('data:') && evt === 'wake') {
            try {
              const { task } = JSON.parse(line.slice(5).trim());
              if (task) handleTask(task).catch(e => console.error('[tmux-bridge]', e));
            } catch {}
            evt = null;
          } else if (line === '') evt = null;
        }
      }
    } catch (e) {
      console.error(`[tmux-bridge] sse: ${e.message} — retry in 5s`);
    }
    setTimeout(loop, 5000);
  };
  loop();
}

async function main() {
  await heartbeat('idle');
  connectSSE();
  setInterval(() => heartbeat('idle'), 30_000);
  console.error(`[tmux-bridge] started agent=${AGENT} team=${TEAM} target=${TARGET}`);
}

main().catch(e => { console.error(e); process.exit(1); });
