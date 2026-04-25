// Control Center v2 HTTP broker.
//
// Single Node http server. Routes are dispatched by URL prefix; SSE endpoints
// live in sse.js. State is in-memory + JSON-persisted (see state.js / persistence.js).

import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { bootstrap, flush } from './state.js';
import { send, sendError } from './http-utils.js';
import { handleMessages } from './routes/messages.js';
import { handleTasks } from './routes/tasks.js';
import { handleHeartbeat } from './routes/heartbeat.js';
import { handleAgents } from './routes/agents.js';
import { handleTeams } from './routes/teams.js';
import { handleEvents, handleAgentEvents } from './sse.js';
import { startSweeper, stopSweeper } from './sweeper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CC_PORT || 3000);
const DASHBOARD_DIR = resolve(__dirname, '../../dashboard/src');

async function serveDashboard(req, res, url) {
  // Map / -> /index.html, otherwise serve file by name (no traversal).
  const safe = url.pathname === '/' ? '/index.html' : url.pathname;
  if (safe.includes('..')) return sendError(res, 400, 'bad path');
  const file = join(DASHBOARD_DIR, safe);
  if (!file.startsWith(DASHBOARD_DIR) || !existsSync(file)) return sendError(res, 404, 'not found');
  const ext = file.slice(file.lastIndexOf('.'));
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
  const buf = await readFile(file);
  res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
  res.end(buf);
}

async function router(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  try {
    if (p === '/api/health') return send(res, 200, { ok: true, version: 'v2' });
    if (p === '/api/messages') return await handleMessages(req, res, url);
    if (p.startsWith('/api/tasks')) return await handleTasks(req, res, url);
    if (p === '/api/heartbeat') return await handleHeartbeat(req, res);
    if (p === '/api/agents') return handleAgents(req, res, url);
    if (p.startsWith('/api/teams')) return await handleTeams(req, res, url);
    if (p === '/api/events') return handleEvents(req, res, url);
    if (p === '/api/agent-events') return handleAgentEvents(req, res, url);

    // Dashboard static
    if (req.method === 'GET' && !p.startsWith('/api/')) {
      return await serveDashboard(req, res, url);
    }

    return sendError(res, 404, 'not found');
  } catch (e) {
    console.error('[router] unhandled:', e);
    return sendError(res, 500, 'internal error');
  }
}

export async function startServer({ port = PORT } = {}) {
  await bootstrap();
  const server = createServer(router);
  await new Promise(r => server.listen(port, r));
  startSweeper();
  console.log(`[server] listening on :${port}`);

  const shutdown = async (sig) => {
    console.log(`[server] ${sig} — shutting down`);
    stopSweeper();
    server.close();
    try { await flush(); } catch (e) { console.error('[server] flush failed:', e.message); }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// Boot when run directly. Resolve symlinks on both sides — the repo path may
// be a symlink (e.g. ~/git/control-center-v2 -> ~/.config/.../control-center-v2),
// in which case import.meta.url and argv[1] disagree without realpath.
if (process.argv[1]) {
  try {
    const argvUrl = pathToFileURL(await realpath(process.argv[1])).href;
    if (import.meta.url === argvUrl) {
      startServer().catch(e => { console.error('[server] boot failed:', e); process.exit(1); });
    }
  } catch (e) {
    // Fall back to naive comparison if realpath fails.
    if (import.meta.url === pathToFileURL(process.argv[1]).href) {
      startServer().catch(e => { console.error('[server] boot failed:', e); process.exit(1); });
    }
  }
}
