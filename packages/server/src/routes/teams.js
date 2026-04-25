// /api/teams — minimal CRUD over team registry.

import { teams, persist } from '../state.js';
import { send, sendError, readJson } from '../http-utils.js';

export async function handleTeams(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/teams') {
    return send(res, 200, { teams: [...teams.values()] });
  }

  if (req.method === 'POST' && url.pathname === '/api/teams') {
    let body;
    try { body = await readJson(req); }
    catch (e) { return sendError(res, 400, e.message); }
    if (!body.name) return sendError(res, 400, 'team name required');
    if (teams.has(body.name)) return sendError(res, 409, 'team already exists');
    const team = {
      name: body.name,
      description: body.description || '',
      agents: body.agents || [],
      createdAt: new Date().toISOString(),
    };
    teams.set(team.name, team);
    persist();
    return send(res, 201, { team });
  }

  const m = url.pathname.match(/^\/api\/teams\/([^/]+)$/);
  if (m) {
    const name = decodeURIComponent(m[1]);
    const team = teams.get(name);
    if (!team) return sendError(res, 404, 'team not found');
    if (req.method === 'GET') return send(res, 200, { team });
    if (req.method === 'DELETE') {
      teams.delete(name);
      persist();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'PATCH') {
      let body;
      try { body = await readJson(req); }
      catch (e) { return sendError(res, 400, e.message); }
      Object.assign(team, body, { name });
      persist();
      return send(res, 200, { team });
    }
  }

  return sendError(res, 405, 'method not allowed');
}
