// SSE endpoints.
//
// /api/events  — dashboard stream. Receives all message broadcasts (filterable by ?team=).
// /api/agent-events?agent=<name>&team=<team>  — bridge stream. Receives `wake` for tasks
//                                                assigned to that agent. Single-recipient:
//                                                newest connection wins; older sockets get closed.

import { sseClients, agentEventClients } from './state.js';

function openStream(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    'access-control-allow-origin': '*',
  });
  res.write(': connected\n\n');
}

export function handleEvents(req, res, url) {
  openStream(res);
  const team = url.searchParams.get('team') || null;
  const client = { res, team };
  sseClients.push(client);
  const heartbeat = setInterval(() => { try { res.write(': hb\n\n'); } catch {} }, 30_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    const i = sseClients.indexOf(client);
    if (i >= 0) sseClients.splice(i, 1);
  });
}

export function handleAgentEvents(req, res, url) {
  const agent = url.searchParams.get('agent');
  const team = url.searchParams.get('team') || null;
  if (!agent) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'agent required' }));
    return;
  }
  // Newest-wins: close any existing client for the same agent.
  for (let i = agentEventClients.length - 1; i >= 0; i--) {
    const c = agentEventClients[i];
    if (c.agent === agent && (c.team === team || !team || !c.team)) {
      try { c.res.end(); } catch {}
      agentEventClients.splice(i, 1);
    }
  }
  openStream(res);
  const client = { res, agent, team };
  agentEventClients.push(client);
  const heartbeat = setInterval(() => { try { res.write(': hb\n\n'); } catch {} }, 30_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    const i = agentEventClients.indexOf(client);
    if (i >= 0) agentEventClients.splice(i, 1);
  });
}

// Push a `wake` event to a specific agent's bridge. Returns true if delivered.
export function pushWake({ agent, team, task }) {
  const client = agentEventClients.find(c => c.agent === agent && (!c.team || !team || c.team === team));
  if (!client) return false;
  const payload = `event: wake\ndata: ${JSON.stringify({ task })}\n\n`;
  try { client.res.write(payload); return true; }
  catch { return false; }
}
