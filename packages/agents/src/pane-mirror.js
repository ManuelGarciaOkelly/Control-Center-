#!/usr/bin/env node
// Pane-mirror — tails worker tmux panes every N seconds, posts new non-chrome
// lines to /api/messages as `from: <agent>`. Replaces cc_send_message MCP for
// the worker → channel path.
//
// Env:
//   CC_URL              default http://localhost:3000
//   CC_TEAM             default factory-v3
//   MIRROR_INTERVAL_MS  default 4000
//   MIRROR_HISTORY      default 500
//   MIRROR_MIN_CHARS    default 8
//   MIRROR_AGENTS       JSON array, default [{"session":"claude-cc","agent":"claude"},
//                                              {"session":"gemini-cc","agent":"gemini"}]

import { spawnSync } from 'node:child_process';

const URL = process.env.CC_URL || 'http://localhost:3000';
const TEAM = process.env.CC_TEAM || 'factory-v3';
const INTERVAL = parseInt(process.env.MIRROR_INTERVAL_MS || '4000', 10);
const HISTORY = parseInt(process.env.MIRROR_HISTORY || '500', 10);
const MIN_CHARS = parseInt(process.env.MIRROR_MIN_CHARS || '8', 10);

const DEFAULT_WATCH = [
  { session: 'claude-cc', agent: 'claude' },
  { session: 'gemini-cc', agent: 'gemini' },
];
const WATCH = (() => {
  if (!process.env.MIRROR_AGENTS) return DEFAULT_WATCH;
  try { return JSON.parse(process.env.MIRROR_AGENTS); }
  catch { console.error('[pane-mirror] MIRROR_AGENTS invalid json, using default'); return DEFAULT_WATCH; }
})();

const CHROME = [
  /^[\s│║─━═╔╗╚╝╭╮╰╯┌┐└┘├┤┬┴┼▀▄▌▐█·•]+$/,
  /^\s*$/,
  /^\s*\?\s*for shortcuts\s*$/i,
  /^\s*shell mode enabled/i,
  /^\s*esc to (cancel|disable|interrupt)/i,
  /^\s*(workspace|sandbox|model|YOLO|tokens used|context left)/i,
  /^\s*\d+\s+(GEMINI\.md|MCP server|files|tokens)/i,
  /^\s*Type your (message|shell command)/i,
  /^\s*[│]\s*[!*>]\s+$/,
  /^\s*~\/[\w./-]+\s*$/,
  /^\s*\(.+\)\s*\d+\s*(window|attached)/,
  // Spinner + "Thinking..." status line (braille spinner glyphs ⠁-⣿).
  /[\u2800-\u28FF].*Thinking\.\.\./,
  /Thinking\.\.\.\s*\(esc to cancel/,
  // gemini-cli MCP tool-call echo lines (we no longer want to mirror these
  // since v2 protocol forbids cc_send_message). Match the box-edge + "✓ tool"
  // form and the "Message sent (id: ...)" confirmation.
  /^\s*│\s*[✓✗]\s+\w+.*\(.*MCP/,
  /Message sent \(id:\s*\d+\)/,
  // gemini-cli startup banner & footer status bar.
  /Gemini CLI v\d/,
  /Signed in with Google/,
  /Plan:\s*Gemini Code Assist/,
  /no sandbox\s+gemini-/,
  // "potential loop detected" advisory (we'd rather see a real recovery msg)
  /A potential loop was detected/,
];

const isChrome = line => CHROME.some(re => re.test(line));

function capture(session) {
  const r = spawnSync('tmux', ['capture-pane', '-t', `${session}:0`, '-p', '-S', `-${HISTORY}`], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '') : null;
}

function newLines(now, prev) {
  const prevSet = new Set((prev || '').split('\n').map(s => s.replace(/\s+$/, '')));
  const out = [];
  for (const raw of now.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || prevSet.has(line) || isChrome(line)) continue;
    out.push(line);
  }
  return out;
}

async function post(agent, text) {
  try {
    await fetch(`${URL}/api/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ team: TEAM, from: agent, text }),
    });
  } catch (e) {
    console.error(`[pane-mirror] post failed (${agent}): ${e.message}`);
  }
}

async function heartbeat() {
  try {
    await fetch(`${URL}/api/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: 'pane-mirror', team: TEAM, status: 'online', capacity: 0,
        meta: { mirroring: WATCH.map(w => w.agent), interval_ms: INTERVAL },
      }),
    });
  } catch {}
}

const last = new Map();

async function tick() {
  for (const { session, agent } of WATCH) {
    const pane = capture(session);
    if (pane == null) continue;
    const prev = last.get(session);
    if (prev === undefined) { last.set(session, pane); continue; } // seed
    if (pane === prev) continue;
    const fresh = newLines(pane, prev);
    last.set(session, pane);
    if (!fresh.length) continue;
    const text = fresh.join('\n').trim();
    if (text.length < MIN_CHARS) continue;
    await post(agent, text);
  }
}

console.log(`[pane-mirror] interval=${INTERVAL}ms history=${HISTORY} team=${TEAM} agents=${WATCH.map(w=>w.agent).join(',')}`);
await heartbeat();
await tick().catch(e => console.error('[pane-mirror] tick:', e));
setInterval(async () => {
  await heartbeat();
  await tick().catch(e => console.error('[pane-mirror] tick:', e));
}, INTERVAL);
