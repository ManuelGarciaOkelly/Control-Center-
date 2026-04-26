

const legalTransitions = {
  queued: ['dispatched', 'cancelled'],
  'awaiting-approval': ['queued', 'dispatched', 'cancelled'],
  'pending-seq': ['queued', 'cancelled'],
  dispatched: ['acknowledged', 'completed', 'failed', 'cancelled'],
  acknowledged: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
};

export class TaskStore {
  constructor() {
    this.tasks = new Map();
    this._nextId = 1;
  }

  create({ team, assignTo, type, payload = {}, priority = 0, gated = false, seqId = null, seqIndex = null, seqTotal = null, continueOnFailure = false, status = null }) {
    if (!team) throw new Error('Missing team for task creation');
    if (!assignTo) throw new Error('Missing assignTo for task creation');
    if (!type) throw new Error('Missing type for task creation');
    if (type === 'message' && !payload.message) {
      throw new Error('Message type task requires payload.message');
    }

    const now = new Date().toISOString();
    const task = {
      id: this._nextId++,
      team,
      assignTo,
      type,
      payload,
      priority,
      gated,
      status: status || (gated ? 'awaiting-approval' : 'queued'),
      createdAt: now,
      updatedAt: now
    };
    if (seqId) {
      task.seqId = seqId;
      task.seqIndex = seqIndex;
      task.seqTotal = seqTotal;
      task.continueOnFailure = !!continueOnFailure;
    }
    this.tasks.set(task.id, task);
    return task;
  }

  // Find sibling tasks in the same sequence, sorted by seqIndex.
  listSequence(seqId) {
    return Array.from(this.tasks.values())
      .filter(t => t.seqId === seqId)
      .sort((a, b) => a.seqIndex - b.seqIndex);
  }

  get(id) {
    return this.tasks.get(id);
  }

  list({ team, status, assignTo } = {}) {
    let result = Array.from(this.tasks.values());

    if (team) {
      result = result.filter(task => task.team === team);
    }
    if (status) {
      result = result.filter(task => task.status === status);
    }
    if (assignTo) {
      result = result.filter(task => task.assignTo === assignTo);
    }

    return result;
  }

  updateStatus(id, newStatus, result = null) {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task with id ${id} not found`);
    }

    const currentStatus = task.status;
    const allowedTransitions = legalTransitions[currentStatus];

    if (!allowedTransitions || !allowedTransitions.includes(newStatus)) {
      throw new Error(`Illegal state transition from ${currentStatus} to ${newStatus}`);
    }

    task.status = newStatus;
    task.updatedAt = new Date().toISOString();
    if (result !== null) {
      task.result = result;
    }

    return task;
  }

  delete(id) {
    return this.tasks.delete(id);
  }

  // Persistence helpers — used by state.js to snapshot/restore.
  _exportMap() {
    return [...this.tasks.entries()];
  }

  _exportNextId() {
    return this._nextId;
  }

  _importTask(task) {
    this.tasks.set(task.id, task);
  }

  _setNextId(n) {
    this._nextId = n;
  }

  _reset() {
    this.tasks.clear();
    this._nextId = 1;
  }
}
