// Independent smoke test for SSEClient reconnect behavior.
// Runs against a real HTTP server (no mocks) — exercises the actual fetch
// + AbortController + reader loop path. Validates what the unit test's
// flaky fake timers could not.
//
// Scenarios:
//   1. connect → server sends event → client emits parsed event
//   2. server closes connection mid-stream → client auto-reconnects
//   3. client.close() → no further reconnect attempts, no hanging timers
//
// Each test owns its server + client and tears both down in finally{}
// so a failed assertion never leaves a leaking reconnect loop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { SSEClient, DEFAULT_RECONNECT_INTERVAL_MS } from './sse-client.js';

// Spin up an SSE-emitting HTTP server on a random port.
// Returns { server, url, push, dropAllClients }.
function startSSEServer() {
  const clients = new Set();
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        push(eventName, dataObj) {
          const payload = `event: ${eventName}\ndata: ${JSON.stringify(dataObj)}\n\n`;
          for (const r of clients) r.write(payload);
        },
        dropAllClients() {
          for (const r of clients) r.destroy();
          clients.clear();
        },
        clientCount: () => clients.size,
      });
    });
  });
}

async function stopServer(server) {
  server.closeAllConnections?.();
  await new Promise(r => server.close(r));
}

// Helper: wait for an event or reject after timeoutMs.
function waitFor(emitter, eventName, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for '${eventName}'`)), timeoutMs);
    emitter.once(eventName, (payload) => { clearTimeout(t); resolve(payload); });
  });
}

test('SSEClient: connects and receives a real SSE event', async () => {
  const svc = await startSSEServer();
  const client = new SSEClient({ url: svc.url, team: 'smoke', agent: 'tester' });
  try {
    const openP = waitFor(client, 'open');
    client.connect();
    await openP;

    // Give the server a tick to register the client before pushing.
    await new Promise(r => setTimeout(r, 50));
    const pingP = waitFor(client, 'ping');
    svc.push('ping', { n: 1 });
    const data = await pingP;
    assert.deepEqual(data, { n: 1 });
  } finally {
    client.close();
    await stopServer(svc.server);
  }
});

test('SSEClient: auto-reconnects after server drops the connection', async () => {
  const svc = await startSSEServer();
  const client = new SSEClient({ url: svc.url, team: 'smoke', agent: 'tester' });
  try {
    await waitFor(client, 'open', 3000).catch(() => {});
    client.connect();
    await waitFor(client, 'open');

    // First event to confirm the pipe works.
    await new Promise(r => setTimeout(r, 50));
    const firstP = waitFor(client, 'ping');
    svc.push('ping', { phase: 'before' });
    await firstP;

    // Drop all active connections. Client should retry per its backoff.
    svc.dropAllClients();

    // Wait for client to reopen (default backoff is 1000ms; allow slack).
    await waitFor(client, 'open', DEFAULT_RECONNECT_INTERVAL_MS * 5);

    // Confirm post-reconnect event delivery.
    await new Promise(r => setTimeout(r, 50));
    const secondP = waitFor(client, 'ping');
    svc.push('ping', { phase: 'after' });
    const data = await secondP;
    assert.deepEqual(data, { phase: 'after' });
  } finally {
    client.close();
    await stopServer(svc.server);
  }
});

test('SSEClient: close() stops reconnect loop (no dangling timers)', async () => {
  const svc = await startSSEServer();
  const client = new SSEClient({ url: svc.url, team: 'smoke', agent: 'tester' });
  try {
    client.connect();
    await waitFor(client, 'open');

    // Shut the server down to trigger reconnect scheduling.
    await stopServer(svc.server);

    // Let the client schedule a reconnect, then call close().
    await new Promise(r => setTimeout(r, 100));
    client.close();

    // If close() worked, nothing keeps the event loop alive.
    // Assert: reconnectTimeout is cleared, controller is nulled.
    assert.equal(client.reconnectTimeout, null, 'reconnectTimeout should be cleared');
    assert.equal(client.controller, null, 'controller should be nulled');
    assert.equal(client.isConnected, false, 'isConnected should be false');

    // Wait past the backoff window; no reconnect attempt should fire.
    // (If it did, fetch to a dead port would throw and emit to stderr, but
    // the critical invariant is the timer is cleared — checked above.)
    await new Promise(r => setTimeout(r, DEFAULT_RECONNECT_INTERVAL_MS + 200));
    assert.equal(client.reconnectTimeout, null, 'no new reconnectTimeout should be scheduled');
  } finally {
    // svc.server already stopped; client already closed. No-op safety.
    try { client.close(); } catch { /* idempotent */ }
  }
});
