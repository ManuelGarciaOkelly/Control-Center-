// /api/messages — append-only chat log per team. Bounded by MAX_MESSAGES.

import { messages, state, sseClients, persist } from '../state.js';
import { send, sendError, readJson } from '../http-utils.js';

function broadcast(msg) {
  const payload = `data: ${JSON.stringify({ type: 'message', message: msg })}\n\n`;
  for (const c of sseClients) {
    if (c.team && c.team !== msg.team) continue;
    try { c.res.write(payload); } catch {}
  }
}

export function appendMessage({ team, from, text, type = 'chat', data = null }) {
  if (!team || !from || (text == null && data == null)) {
    throw new Error('message requires team, from, and text or data');
  }
  const msg = {
    id: ++state.messageId,
    team,
    from,
    text: text ?? '',
    type,
    timestamp: new Date().toISOString(),
  };
  if (data) msg.data = data;
  messages.push(msg);
  if (messages.length > state.MAX_MESSAGES) {
    messages.splice(0, messages.length - state.MAX_MESSAGES);
  }
  broadcast(msg);
  persist();
  return msg;
}

export async function handleMessages(req, res, url) {
  if (req.method === 'GET') {
    const team = url.searchParams.get('team');
    const since = Number(url.searchParams.get('since') || 0);
    const limit = Math.min(Number(url.searchParams.get('limit') || 200), 1000);
    let out = messages;
    if (team) out = out.filter(m => m.team === team);
    if (since) out = out.filter(m => m.id > since);
    if (out.length > limit) out = out.slice(-limit);
    return send(res, 200, { messages: out });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await readJson(req); }
    catch (e) { return sendError(res, 400, e.message); }
    try {
      const msg = appendMessage(body);
      return send(res, 201, { message: msg });
    } catch (e) {
      return sendError(res, 400, e.message);
    }
  }

  return sendError(res, 405, 'method not allowed');
}
