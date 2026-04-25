// /api/tasks — task lifecycle. Creation triggers dispatch via dispatcher.

import { taskStore, persist } from '../state.js';
import { send, sendError, readJson, matchId } from '../http-utils.js';
import { dispatch } from '../dispatcher.js';
import { appendMessage } from './messages.js';

export async function handleTasks(req, res, url) {
  // POST /api/tasks  — create
  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    let body;
    try { body = await readJson(req); }
    catch (e) { return sendError(res, 400, e.message); }
    try {
      const task = taskStore.create(body);
      persist();
      // Best-effort dispatch (non-blocking). Gated tasks wait for approval.
      if (task.status === 'queued') dispatch(task).catch(e => console.error('[tasks] dispatch:', e.message));
      return send(res, 201, { task });
    } catch (e) {
      return sendError(res, 400, e.message);
    }
  }

  // GET /api/tasks
  if (req.method === 'GET' && url.pathname === '/api/tasks') {
    const filter = {
      team: url.searchParams.get('team') || undefined,
      status: url.searchParams.get('status') || undefined,
      assignTo: url.searchParams.get('assignTo') || undefined,
    };
    return send(res, 200, { tasks: taskStore.list(filter) });
  }

  const id = matchId(url.pathname, '/api/tasks');
  if (id == null) {
    // /api/tasks/:id/approve
    const m = url.pathname.match(/^\/api\/tasks\/(\d+)\/approve$/);
    if (m && req.method === 'POST') {
      const tid = Number(m[1]);
      const task = taskStore.get(tid);
      if (!task) return sendError(res, 404, 'task not found');
      if (task.status !== 'awaiting-approval') return sendError(res, 409, `cannot approve from ${task.status}`);
      // Move to queued so dispatcher can pick it up.
      task.status = 'queued';
      task.updatedAt = new Date().toISOString();
      persist();
      dispatch(task).catch(e => console.error('[tasks] dispatch:', e.message));
      return send(res, 200, { task });
    }
    return sendError(res, 404, 'not found');
  }

  const task = taskStore.get(id);
  if (!task) return sendError(res, 404, 'task not found');

  if (req.method === 'GET') return send(res, 200, { task });

  if (req.method === 'PATCH') {
    let body;
    try { body = await readJson(req); }
    catch (e) { return sendError(res, 400, e.message); }
    try {
      const next = body.status;
      if (!next) return sendError(res, 400, 'status required');
      const updated = taskStore.updateStatus(id, next, body.result ?? null);
      persist();
      // Mirror terminal status to channel for visibility.
      if (next === 'completed' || next === 'failed') {
        try {
          appendMessage({
            team: updated.team,
            from: updated.assignTo,
            text: `task ${id} ${next}: ${body.result || ''}`.trim(),
            type: 'task-update',
            data: { taskId: id, status: next, result: body.result || null },
          });
        } catch {}
      }
      return send(res, 200, { task: updated });
    } catch (e) {
      return sendError(res, 400, e.message);
    }
  }

  if (req.method === 'DELETE') {
    taskStore.delete(id);
    persist();
    return send(res, 200, { ok: true });
  }

  return sendError(res, 405, 'method not allowed');
}
