// /api/heartbeat — bridges/agents POST status; we track lastSeen for staleness.

import { agentHealth, state, persist } from '../state.js';
import { send, sendError, readJson } from '../http-utils.js';

export function recordHeartbeat({ agent, team, status = 'online', capacity = 1, uptime = 0, meta = {} }) {
  if (!agent || !team) throw new Error('heartbeat requires agent and team');
  const key = `${team}/${agent}`;
  const now = Date.now();
  agentHealth.set(key, {
    agent, team, status, capacity, uptime, meta,
    lastSeen: now,
    stale: false,
  });
  return agentHealth.get(key);
}

export function markStale() {
  const now = Date.now();
  let changed = 0;
  for (const [k, h] of agentHealth) {
    const stale = (now - h.lastSeen) > state.STALE_THRESHOLD_MS;
    if (stale !== h.stale) { h.stale = stale; changed++; }
  }
  return changed;
}

export async function handleHeartbeat(req, res) {
  if (req.method !== 'POST') return sendError(res, 405, 'method not allowed');
  let body;
  try { body = await readJson(req); }
  catch (e) { return sendError(res, 400, e.message); }
  try {
    const h = recordHeartbeat(body);
    persist();
    return send(res, 200, { ok: true, health: h });
  } catch (e) {
    return sendError(res, 400, e.message);
  }
}
