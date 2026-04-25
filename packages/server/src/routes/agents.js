// /api/agents — read-only view of agent health (writes go via /api/heartbeat).

import { agentHealth } from '../state.js';
import { send, sendError } from '../http-utils.js';
import { markStale } from './heartbeat.js';

export function handleAgents(req, res, url) {
  if (req.method !== 'GET') return sendError(res, 405, 'method not allowed');
  markStale();
  const team = url.searchParams.get('team');
  let agents = [...agentHealth.values()];
  if (team) agents = agents.filter(a => a.team === team);
  return send(res, 200, { agents });
}
