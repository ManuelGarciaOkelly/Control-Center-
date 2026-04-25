import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import http from 'node:http';
import { SSEClient, DEFAULT_RECONNECT_INTERVAL_MS } from './sse-client.js';

test('SSEClient connects, receives events, and closes cleanly', async (t) => {
  let sseServer;
  let ssePort;

  // Setup a mock SSE server
  await new Promise((resolve) => {
    sseServer = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Send first event
      res.write('event: testEvent1\\n');
      res.write('data: {"message": "Hello"}\\n\\n');

      // Send second event after a short delay
      setTimeout(() => {
        res.write('event: testEvent2\\n');
        res.write('data: {"count": 123}\\n\\n');
        res.end(); // Close connection after sending events
      }, 100);
    });

    sseServer.listen(0, () => {
      ssePort = sseServer.address().port;
      resolve();
    });
  });

  const client = new SSEClient({
    url: `http://localhost:${ssePort}`,
    team: 'test-team',
    agent: 'test-agent',
  });

  const receivedEvents = [];
  const wildcardEvents = [];

  client.on('testEvent1', (data) => {
    receivedEvents.push({ name: 'testEvent1', data });
  });

  client.on('testEvent2', (data) => {
    receivedEvents.push({ name: 'testEvent2', data });
  });

  client.on('*', (eventName, data) => {
    wildcardEvents.push({ name: eventName, data });
  });

  const openPromise = new Promise(resolve => client.on('open', resolve));
  const closePromise = new Promise(resolve => client.on('close', resolve));

  await client.connect();
  await openPromise; // Wait for 'open' event

  // Give some time for events to be received
  await new Promise(resolve => setTimeout(resolve, 500));

  assert.equal(receivedEvents.length, 2, 'Should receive 2 specific events');
  assert.deepStrictEqual(receivedEvents[0], { name: 'testEvent1', data: { message: 'Hello' } });
  assert.deepStrictEqual(receivedEvents[1], { name: 'testEvent2', data: { count: 123 } });

  assert.equal(wildcardEvents.length, 2, 'Wildcard handler should receive 2 events');
  assert.deepStrictEqual(wildcardEvents[0], { name: 'testEvent1', data: { message: 'Hello' } });
  assert.deepStrictEqual(wildcardEvents[1], { name: 'testEvent2', data: { count: 123 } });

  client.close(); // Explicitly close the client
  await closePromise; // Wait for 'close' event

  assert.equal(client.isConnected, false, 'Client should not be connected after close');

  // Ensure no unhandled rejections or lingering connections
  sseServer.close();
});

test('SSEClient handles reconnection on server-side drop using event-driven waits', async (t) => {
  let sseServer;
  let ssePort;
  let connectionAttempts = 0;
  let serverActivatedForReconnect = false; // Flag to control server behavior

  // This promise will resolve when the client receives the 'reconnectEvent'.
  let reconnectEventReceivedResolve;
  const reconnectEventReceived = new Promise(resolve => reconnectEventReceivedResolve = resolve);

  await new Promise((resolve) => {
    sseServer = http.createServer((req, res) => {
      connectionAttempts++;
      if (connectionAttempts === 1) {
        // First attempt, simulate server dropping connection immediately
        res.destroy();
      } else if (serverActivatedForReconnect) {
        // Subsequent attempts, only send data if serverActivatedForReconnect is true
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.write('event: reconnectEvent\\n');
        res.write('data: {"status": "reconnected"}\\n\\n');
        res.end(); // Close after sending event
      } else {
        // If server not activated for reconnect yet, just close connection (e.g. during backoff)
        res.end();
      }
    });

    sseServer.listen(0, () => {
      ssePort = sseServer.address().port;
      resolve();
    });
  });
  t.after(() => sseServer.close()); // Ensure server is closed after test

  const client = new SSEClient({
    url: `http://localhost:${ssePort}`,
    team: 'test-team',
    agent: 'test-agent',
  });

  let openCount = 0;
  let secondOpenResolve;
  const secondOpenPromise = new Promise(resolve => { secondOpenResolve = resolve; });
  client.on('open', () => {
    openCount++;
    if (openCount === 2) {
      secondOpenResolve();
    }
  });
  let closeCount = 0;
  let firstCloseResolve;
  const firstClosePromise = new Promise(resolve => { firstCloseResolve = resolve; });
  client.on('close', () => {
    closeCount++;
    // Resolve firstClosePromise only for the first close event
    if (closeCount === 1) {
      firstCloseResolve();
    }
  });

  // Initiate connection. First will fail, trigger reconnect.
  client.connect();

  // Wait for the first connection to fail and the client to attempt reconnect.
  await firstClosePromise;
  serverActivatedForReconnect = true; // Allow server to respond successfully on next attempt

  // Wait for the second successful 'open' event, indicating reconnection
  await secondOpenPromise;

  // Force reconnectAttempts to max to ensure SSEClient gives up gracefully.
  // This is a workaround for potential lingering reconnect attempts.
  client.reconnectAttempts = client.maxReconnectAttempts;

  // No longer needed, as we rely on the test returning after the second open event.
  // await new Promise(resolve => setTimeout(resolve, 50));

  assert.equal(connectionAttempts >= 2, true, 'Server should have received at least 2 connection attempts (initial + reconnect)');
  assert.equal(openCount, 2, 'Should have received exactly two open events (initial connect and reconnect)');
  assert.equal(closeCount >= 1, true, 'Should have received at least one close event for the initial failed connection');
  assert.equal(receivedReconnectEvents.length, 1, 'Should receive exactly one reconnect event');
  assert.deepStrictEqual(receivedReconnectEvents[0], { status: 'reconnected' });

  // client.close() is now handled by t.after()
  // sseServer.close(); // Moved to t.after()

});


test('SSEClient emits "close" reliably even if connect() was never called', async (t) => {
  const client = new SSEClient({
    url: `http://localhost:${ssePort}`,
    team: 'test-team',
    agent: 'test-agent',
  });

  let closeEmitted = false;
  client.on('close', () => {
    closeEmitted = true;
  });

  client.close(); // Call close without calling connect

  assert.equal(closeEmitted, true, 'The "close" event should be emitted');
  assert.equal(client.isConnected, false, 'Client should not be connected');
  assert.equal(client.controller, null, 'Controller should be null');
  assert.equal(client.reconnectTimeout, null, 'Reconnect timeout should be null');
});
