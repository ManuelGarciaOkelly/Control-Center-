import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { TaskStore } from './task-store.js';

test('TaskStore - create happy path', () => {
  const store = new TaskStore();
  const task = store.create({
    team: 'factory-v3',
    assignTo: 'gemini',
    type: 'message',
    payload: { message: 'hello' }
  });

  assert.ok(task.id, 'Task should have an ID');
  assert.equal(task.team, 'factory-v3', 'Team should match');
  assert.equal(task.assignTo, 'gemini', 'AssignTo should match');
  assert.equal(task.type, 'message', 'Type should match');
  assert.deepEqual(task.payload, { message: 'hello' }, 'Payload should match');
  assert.equal(task.priority, 0, 'Priority should default to 0');
  assert.equal(task.gated, false, 'Gated should default to false');
  assert.equal(task.status, 'queued', 'Status should be queued');
  assert.ok(task.createdAt, 'createdAt should be set');
  assert.ok(task.updatedAt, 'updatedAt should be set');
  assert.equal(task.createdAt, task.updatedAt, 'createdAt and updatedAt should be equal on creation');
});

test('TaskStore - create throws on missing team', () => {
  const store = new TaskStore();
  assert.throws(() => {
    store.create({ assignTo: 'gemini', type: 'message', payload: { message: 'hello' } });
  }, { message: 'Missing team for task creation' }, 'Should throw for missing team');
});

test('TaskStore - create throws on missing assignTo', () => {
  const store = new TaskStore();
  assert.throws(() => {
    store.create({ team: 'factory-v3', type: 'message', payload: { message: 'hello' } });
  });
  assert.throws(() => {
    store.create({ team: 'factory-v3', type: 'message', payload: { message: 'hello' } });
  }, { message: 'Missing assignTo for task creation' }, 'Should throw for missing assignTo');
});

test('TaskStore - create throws on missing type', () => {
  const store = new TaskStore();
  assert.throws(() => {
    store.create({ team: 'factory-v3', assignTo: 'gemini', payload: { message: 'hello' } });
  }, { message: 'Missing type for task creation' }, 'Should throw for missing type');
});

test('TaskStore - create throws on type="message" with no payload.message', () => {
  const store = new TaskStore();
  assert.throws(() => {
    store.create({ team: 'factory-v3', assignTo: 'gemini', type: 'message', payload: {} });
  }, { message: 'Message type task requires payload.message' }, 'Should throw for message type without payload.message');
});

test('TaskStore - get hit and miss', () => {
  const store = new TaskStore();
  const task1 = store.create({ team: 't1', assignTo: 'a1', type: 'm1' });
  const task2 = store.create({ team: 't2', assignTo: 'a2', type: 'm2' });

  assert.deepEqual(store.get(task1.id), task1, 'Should retrieve task1 by ID');
  assert.deepEqual(store.get(task2.id), task2, 'Should retrieve task2 by ID');
  assert.equal(store.get(999), undefined, 'Should return undefined for non-existent ID');
});

test('TaskStore - list no-filter', () => {
  const store = new TaskStore();
  const task1 = store.create({ team: 't1', assignTo: 'a1', type: 'm1' });
  const task2 = store.create({ team: 't2', assignTo: 'a2', type: 'm2' });

  const allTasks = store.list();
  assert.equal(allTasks.length, 2, 'Should return all tasks');
  assert.ok(allTasks.some(t => t.id === task1.id), 'Should contain task1');
  assert.ok(allTasks.some(t => t.id === task2.id), 'Should contain task2');
});

test('TaskStore - list filter by team/status/assignTo combined', () => {
  const store = new TaskStore();
  const task1 = store.create({ team: 'teamA', assignTo: 'agentX', type: 'msg', status: 'queued' });
  const task2 = store.create({ team: 'teamA', assignTo: 'agentY', type: 'msg', status: 'dispatched' });
  const task3 = store.create({ team: 'teamB', assignTo: 'agentX', type: 'msg', status: 'queued' });

  store.updateStatus(task2.id, 'dispatched');

  let filtered = store.list({ team: 'teamA', status: 'queued' });
  assert.equal(filtered.length, 1, 'Should find 1 task for teamA, queued');
  assert.equal(filtered[0].id, task1.id);

  filtered = store.list({ assignTo: 'agentX', status: 'queued' });
  assert.equal(filtered.length, 2, 'Should find 2 tasks for agentX, queued');
  assert.ok(filtered.some(t => t.id === task1.id));
  assert.ok(filtered.some(t => t.id === task3.id));

  filtered = store.list({ team: 'teamA', assignTo: 'agentY', status: 'dispatched' });
  assert.equal(filtered.length, 1, 'Should find 1 task for teamA, agentY, dispatched');
  assert.equal(filtered[0].id, task2.id);

  filtered = store.list({ team: 'nonExistent', status: 'queued' });
  assert.equal(filtered.length, 0, 'Should return 0 tasks for non-existent team');
});

test('TaskStore - updateStatus legal queued->dispatched bumps updatedAt', async () => {
  const store = new TaskStore();
  const task = store.create({ team: 't1', assignTo: 'a1', type: 'm1' });
  const originalUpdatedAt = task.updatedAt;

  await new Promise(resolve => setTimeout(resolve, 10)); // Ensure time difference

  const updatedTask = store.updateStatus(task.id, 'dispatched');

  assert.equal(updatedTask.status, 'dispatched', 'Status should be updated to dispatched');
  assert.notEqual(updatedTask.updatedAt, originalUpdatedAt, 'updatedAt should be updated');
  assert.ok(updatedTask.updatedAt > originalUpdatedAt, 'updatedAt should be a later timestamp');
});

test('TaskStore - updateStatus throws on queued->acknowledged (illegal)', () => {
  const store = new TaskStore();
  const task = store.create({ team: 't1', assignTo: 'a1', type: 'm1' });

  assert.throws(() => {
    store.updateStatus(task.id, 'acknowledged');
  }, { message: 'Illegal state transition from queued to acknowledged' }, 'Should throw for illegal transition queued -> acknowledged');
});

test('TaskStore - updateStatus throws on completed->dispatched (illegal)', () => {
  const store = new TaskStore();
  const task = store.create({ team: 't1', assignTo: 'a1', type: 'm1' });
  store.updateStatus(task.id, 'dispatched');
  store.updateStatus(task.id, 'acknowledged');
  store.updateStatus(task.id, 'completed'); // Move to a terminal state

  assert.throws(() => {
    store.updateStatus(task.id, 'dispatched');
  }, { message: 'Illegal state transition from completed to dispatched' }, 'Should throw for illegal transition completed -> dispatched');
});

test('TaskStore - updateStatus attaches result', () => {
  const store = new TaskStore();
  const task = store.create({ team: 't1', assignTo: 'a1', type: 'm1' });

  store.updateStatus(task.id, 'dispatched');
  store.updateStatus(task.id, 'acknowledged');

  const result = { success: true, output: 'task completed' };
  const updatedTask = store.updateStatus(task.id, 'completed', result);

  assert.equal(updatedTask.status, 'completed', 'Status should be completed');
  assert.deepEqual(updatedTask.result, result, 'Result should be attached to the task');
});

test('TaskStore - delete hit and miss', () => {
  const store = new TaskStore();
  const task1 = store.create({ team: 't1', assignTo: 'a1', type: 'm1' });
  const task2 = store.create({ team: 't2', assignTo: 'a2', type: 'm2' });

  assert.equal(store.delete(task1.id), true, 'Should return true for successful deletion');
  assert.equal(store.get(task1.id), undefined, 'Task1 should no longer exist');

  assert.equal(store.delete(999), false, 'Should return false for deleting non-existent ID');
  assert.ok(store.get(task2.id), 'Task2 should still exist');
});

test('TaskStore - create gated task yields awaiting-approval status', () => {
  const store = new TaskStore();
  const gatedTask = store.create({
    team: 't1', assignTo: 'a1', type: 'm1', payload: { message: 'x' }, gated: true
  });
  assert.equal(gatedTask.status, 'awaiting-approval', 'Gated task should be awaiting-approval');

  const nonGatedTask = store.create({
    team: 't2', assignTo: 'a2', type: 'm2', payload: { message: 'y' }
  });
  assert.equal(nonGatedTask.status, 'queued', 'Non-gated task should be queued');
});

test('TaskStore - nextId is instance isolated', () => {
  const store1 = new TaskStore();
  const task1_1 = store1.create({ team: 't1', assignTo: 'a1', type: 'm1' });
  const task1_2 = store1.create({ team: 't1', assignTo: 'a1', type: 'm1' });

  const store2 = new TaskStore();
  const task2_1 = store2.create({ team: 't2', assignTo: 'a2', type: 'm2' });
  const task2_2 = store2.create({ team: 't2', assignTo: 'a2', type: 'm2' });

  assert.equal(task1_1.id, 1, 'First task in store1 should have id 1');
  assert.equal(task1_2.id, 2, 'Second task in store1 should have id 2');
  assert.equal(task2_1.id, 1, 'First task in store2 should have id 1');
  assert.equal(task2_2.id, 2, 'Second task in store2 should have id 2');
});
