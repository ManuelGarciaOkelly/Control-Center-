// Debounced JSON persistence. SQLite migration is a future change behind
// the same loadState/saveState/schedulePersist interface.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_PATH = process.env.CC_STATE_PATH || join(homedir(), '.cc', 'state.json');
const DEBOUNCE_MS = 500;

let pending = null;
let timer = null;

function ensureDir(path) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function loadState({ path = DEFAULT_PATH } = {}) {
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw);
    return {
      success: true,
      data: {
        tasks: new Map(data.tasks || []),
        messages: data.messages || [],
        teams: new Map(data.teams || []),
        agentHealth: new Map(data.agentHealth || []),
        taskId: data.taskId || 0,
        messageId: data.messageId || 0,
      },
    };
  } catch (e) {
    if (e.code === 'ENOENT') {
      return {
        success: true,
        data: {
          tasks: new Map(), messages: [], teams: new Map(), agentHealth: new Map(),
          taskId: 0, messageId: 0,
        },
      };
    }
    return { success: false, error: e.message };
  }
}

export async function saveState({ state, path = DEFAULT_PATH }) {
  ensureDir(path);
  const tmp = path + '.tmp';
  // Inputs may already be arrays of [k,v] pairs (from _exportMap-style helpers)
  // or live Maps. Normalise once so we never double-wrap on round-trip.
  const toEntries = (v) => Array.isArray(v) ? v : (v && typeof v.entries === 'function' ? [...v.entries()] : []);
  const payload = {
    tasks: toEntries(state.tasks),
    messages: state.messages,
    teams: toEntries(state.teams),
    agentHealth: toEntries(state.agentHealth),
    taskId: state.taskId || 0,
    messageId: state.messageId || 0,
    savedAt: new Date().toISOString(),
  };
  await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  await rename(tmp, path);
}

export function schedulePersist({ state, path = DEFAULT_PATH }) {
  pending = { state, path };
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    const job = pending;
    pending = null;
    if (!job) return;
    try { await saveState(job); }
    catch (e) { console.error('[persistence] save failed:', e.message); }
  }, DEBOUNCE_MS);
}

// Used on shutdown — bypass debounce, write immediately.
export async function flushPersist({ state, path = DEFAULT_PATH }) {
  if (timer) { clearTimeout(timer); timer = null; pending = null; }
  await saveState({ state, path });
}
