// Shared in-memory state used by all routes. Singleton pattern — server boots,
// loads from persistence into this module, routes mutate via helpers, and
// `persist()` debounces writes back. Tests can call `resetState()`.

import { TaskStore } from './task-store.js';
import { schedulePersist, flushPersist, loadState } from './persistence.js';

export const teams = new Map();           // name -> { name, description?, agents: [{name, joinedAt?, role?}], createdAt }
export const messages = [];               // { id, team, from, text, timestamp, type?, data? }
export const agentHealth = new Map();     // "team/agent" -> { agent, team, status, capacity, uptime, meta, lastSeen, stale }
export const taskStore = new TaskStore();

export const sseClients = [];             // dashboard SSE: { res, team? }
export const agentEventClients = [];      // bridge SSE: { res, agent, team? }

export const state = {
  messageId: 0,
  MAX_MESSAGES: 10_000,
  STALE_THRESHOLD_MS: 90_000,
  TASK_DISPATCH_TIMEOUT_MS: 5 * 60_000,
};

export function persist() {
  schedulePersist({
    state: {
      tasks: taskStore._exportMap(),
      messages,
      teams,
      agentHealth,
      taskId: taskStore._exportNextId() - 1,
      messageId: state.messageId,
    },
  });
}

export async function flush() {
  await flushPersist({
    state: {
      tasks: taskStore._exportMap(),
      messages,
      teams,
      agentHealth,
      taskId: taskStore._exportNextId() - 1,
      messageId: state.messageId,
    },
  });
}

export async function bootstrap() {
  const result = await loadState();
  if (!result.success) {
    console.warn('[state] loadState failed, starting fresh:', result.error);
    return;
  }
  const d = result.data;
  for (const [k, v] of d.tasks) taskStore._importTask(v);
  for (const [k, v] of d.teams) teams.set(k, v);
  for (const [k, v] of d.agentHealth) agentHealth.set(k, v);
  messages.push(...d.messages);
  state.messageId = d.messageId;
  taskStore._setNextId((d.taskId || 0) + 1);
  console.log(`[state] loaded tasks=${d.tasks.size} messages=${d.messages.length} teams=${d.teams.size} agents=${d.agentHealth.size}`);
}

export function resetState() {
  teams.clear();
  messages.length = 0;
  agentHealth.clear();
  taskStore._reset();
  for (const c of sseClients) try { c.res.end(); } catch {}
  sseClients.length = 0;
  for (const c of agentEventClients) try { c.res.end(); } catch {}
  agentEventClients.length = 0;
  state.messageId = 0;
}
