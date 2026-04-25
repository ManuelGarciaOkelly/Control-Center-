// Task dispatcher. Moves queued -> dispatched by pushing a `wake` event to the
// assignee's bridge SSE. If no bridge is connected, leaves the task queued; the
// sweeper retries periodically and a bridge reconnect will pick it up.

import { taskStore, persist } from './state.js';
import { pushWake } from './sse.js';

export async function dispatch(task) {
  if (!task || task.status !== 'queued') return false;
  const ok = pushWake({ agent: task.assignTo, team: task.team, task });
  if (!ok) return false;
  try {
    taskStore.updateStatus(task.id, 'dispatched');
    task.dispatchedAt = new Date().toISOString();
    persist();
    return true;
  } catch (e) {
    console.error('[dispatcher] state transition failed:', e.message);
    return false;
  }
}

// Retry any queued tasks (e.g., after a bridge reconnects).
export async function dispatchPending() {
  const queued = taskStore.list({ status: 'queued' });
  let dispatched = 0;
  for (const t of queued) {
    if (await dispatch(t)) dispatched++;
  }
  return dispatched;
}
