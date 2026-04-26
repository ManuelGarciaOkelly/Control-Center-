// /api/control/{up,down,restart,status} — broker-side wrapper around ccctl.
//
// Localhost-only (rejects requests whose Origin or Host isn't 127.0.0.1 /
// localhost) so a stray browser tab from elsewhere can't bounce the stack.
//
// up/down/restart spawn ccctl detached and return 202 immediately. status
// derives from /api/agents staleness (agentHealth is the source of truth).

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { send, sendError } from '../http-utils.js';
import { agentHealth, state } from '../state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/server/src/routes -> repo root -> bin/ccctl
const CCCTL = resolve(__dirname, '../../../../bin/ccctl');

function localOnly(req) {
  const host = (req.headers.host || '').split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const u = new URL(origin);
      if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return false;
    } catch { return false; }
  }
  return true;
}

function runCcctl(verb) {
  // Detach so we don't get killed when the broker restarts itself.
  const child = spawn(CCCTL, [verb], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, CC2_NO_REBOOT_SELF: verb === 'down' ? '0' : '1' },
  });
  child.unref();
}

export async function handleControl(req, res, url) {
  if (!localOnly(req)) return sendError(res, 403, 'localhost only');

  if (req.method === 'GET' && url.pathname === '/api/control/status') {
    const now = Date.now();
    const stale = state.STALE_THRESHOLD_MS;
    const agents = {};
    for (const [key, h] of agentHealth) {
      const isStale = (now - (h.lastSeen || 0)) > stale;
      agents[h.agent] = isStale ? 'stale' : (h.status || 'unknown');
    }
    return send(res, 200, { broker: 'up', agents, ts: new Date().toISOString() });
  }

  if (req.method !== 'POST') return sendError(res, 405, 'method not allowed');

  const verb = url.pathname.split('/').pop();
  if (!['up', 'down', 'restart'].includes(verb)) return sendError(res, 404, 'unknown control verb');

  try {
    runCcctl(verb === 'restart' ? 'toggle' : verb);
    return send(res, 202, { accepted: verb });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
}
