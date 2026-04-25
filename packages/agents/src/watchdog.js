#!/usr/bin/env node
// Watchdog — tails worker tmux panes, classifies fault states, broadcasts alerts.
// Detection only: never modifies state, never dispatches, never restarts.
//
// Env:
//   CC_URL                default http://localhost:3000
//   CC_TEAM               default factory-v3
//   WATCHDOG_INTERVAL_MS  default 15000
//   WATCHDOG_SILENT_MS    pane-unchanged threshold (default 180000 = 3min)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const URL = process.env.CC_URL || 'http://localhost:3000';
const TEAM = process.env.CC_TEAM || 'factory-v3';
const INTERVAL = parseInt(process.env.WATCHDOG_INTERVAL_MS || '15000', 10);
const SILENT_MS = parseInt(process.env.WATCHDOG_SILENT_MS || '180000', 10);

const WATCH = [
  { session: 'claude-cc', agent: 'claude' },
  { session: 'gemini-cc', agent: 'gemini' },
];

const PATTERNS = [
  [/Please run \/login|authentication_error|API Error: 401|invalid_api_key/i, 'auth-error'],
  [/rate_limit_error|429|quota exceeded|RESOURCE_EXHAUSTED|Too Many Requests/i, 'rate-limited'],
  [/overloaded_error|Model is overloaded|503 Service Unavailable/i,            'overloaded'],
  [/context_length_exceeded|maximum context length|context window (full|exceeded)/i, 'context-full'],
  [/API Error: 4\d\d/,                                                         'api-error'],
  [/API Error: 5\d\d|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|fetch failed/i, 'network-error'],
  [/Response stopped due to unexpected tool call/i,                            'tool-call-error'],
  [/INVALID_ARGUMENT|function response parts/i,                                'protocol-error'],
  [/MCP error|MCP server disconnected|Server disconnected/i,                   'mcp-disconnected'],
  [/Loop detected|Potential loop detected/i,                                   'loop-detected'],
  [/repeatedly executing|I will stop now|despite the task being marked/i,      'semantic-loop'],
  [/Do you want to (allow|proceed|continue)\?/i,                               'permission-prompt'],
  [/Bypass Permissions mode/i,                                                 'permission-prompt'],
  [/Shell awaiting input/i,                                                    'shell-hung'],
  [/can't find session/,                                                       'session-gone'],
  [/Killed: 9|Out of memory|ENOSPC|No space left/i,                            'system-error'],
  [/esc to cancel,\s*(?:[3-9]|\d{2,})m\s*\d+s/i,                               'api-slow'],
];

const CONFIRM_SAMPLES = 2;
const state = new Map();

function capture(session) {
  const r = spawnSync('tmux', ['capture-pane', '-t', `${session}:0`, '-p', '-S', '-30'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '') : null;
}

const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 12);

function classify(pane) {
  if (pane == null) return 'session-gone';
  for (const [re, label] of PATTERNS) if (re.test(pane)) return label;
  return 'healthy';
}

async function hasDispatchedTask(agent) {
  try {
    const r = await fetch(`${URL}/api/tasks?team=${encodeURIComponent(TEAM)}&assignTo=${encodeURIComponent(agent)}&status=dispatched`);
    if (!r.ok) return false;
    const { tasks = [] } = await r.json();
    return tasks.length > 0;
  } catch { return false; }
}

async function heartbeat() {
  try {
    await fetch(`${URL}/api/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: 'watchdog', team: TEAM, status: 'online', capacity: 0,
        meta: { watching: WATCH.map(w => w.agent), interval_ms: INTERVAL },
      }),
    });
  } catch {}
}

async function post(text) {
  try {
    await fetch(`${URL}/api/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ team: TEAM, from: 'watchdog', text }),
    });
  } catch (e) {
    console.error('[watchdog] post failed:', e.message);
  }
}

async function tick() {
  for (const { session, agent } of WATCH) {
    const pane = capture(session);
    let label = classify(pane);
    const prev = state.get(session) || {
      confirmed: 'healthy', candidate: 'healthy', candidateStreak: 1,
      paneHash: null, paneHashAt: Date.now(),
    };
    const paneHash = pane ? hash(pane) : null;

    if (label === 'healthy' && paneHash === prev.paneHash) {
      const silent = Date.now() - prev.paneHashAt;
      if (silent > SILENT_MS && await hasDispatchedTask(agent)) label = 'silent-stall';
    }

    const candidate = label;
    const candidateStreak = candidate === prev.candidate ? prev.candidateStreak + 1 : 1;
    let confirmed = prev.confirmed;

    if (candidate === 'healthy' && confirmed !== 'healthy') {
      confirmed = 'healthy';
      await post(`OK ${agent} recovered (was ${prev.confirmed})`);
    } else if (candidate !== 'healthy' && candidate !== confirmed && candidateStreak >= CONFIRM_SAMPLES) {
      confirmed = candidate;
      await post(`[ALERT] ${agent} ${confirmed} — check tmux attach -t ${session}`);
    }

    state.set(session, {
      confirmed, candidate, candidateStreak,
      paneHash,
      paneHashAt: paneHash !== prev.paneHash ? Date.now() : prev.paneHashAt,
    });
  }
}

console.log(`[watchdog] interval=${INTERVAL}ms silent=${SILENT_MS}ms team=${TEAM}`);
await heartbeat();
await tick().catch(e => console.error('[watchdog] tick:', e));
setInterval(async () => {
  await heartbeat();
  await tick().catch(e => console.error('[watchdog] tick:', e));
}, INTERVAL);
