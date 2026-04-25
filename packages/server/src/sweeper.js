// Periodic background tasks:
//   - Mark stale agents (lastSeen > STALE_THRESHOLD_MS).
//   - Reap dispatched tasks not acknowledged within TASK_DISPATCH_TIMEOUT_MS.
//   - Retry queued tasks (bridge may have reconnected).

import { taskStore, state, persist } from './state.js';
import { markStale } from './routes/heartbeat.js';
import { dispatchPending } from './dispatcher.js';

let timer = null;

export function startSweeper({ intervalMs = 15_000 } = {}) {
  if (timer) return;
  timer = setInterval(tick, intervalMs);
}

export function stopSweeper() {
  if (timer) { clearInterval(timer); timer = null; }
}

async function tick() {
  try {
    markStale();
    reapDispatched();
    await dispatchPending();
  } catch (e) {
    console.error('[sweeper] tick error:', e.message);
  }
}

function reapDispatched() {
  const now = Date.now();
  const stuck = taskStore.list({ status: 'dispatched' });
  let reaped = 0;
  for (const t of stuck) {
    const dispatchedAt = t.dispatchedAt ? Date.parse(t.dispatchedAt) : Date.parse(t.updatedAt);
    if (now - dispatchedAt > state.TASK_DISPATCH_TIMEOUT_MS) {
      try {
        taskStore.updateStatus(t.id, 'failed', 'dispatch timeout — no acknowledgement');
        reaped++;
      } catch {}
    }
  }
  if (reaped) persist();
  return reaped;
}
