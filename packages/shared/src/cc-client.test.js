import { test, beforeEach, afterEach } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { createServer } from 'node:http';
import { CCClient } from './cc-client.js';

let server;
let client;
let requests = []; // To capture incoming requests for each test
let currentHandler; // This will hold the test-specific request handler

// Universal request handler for the test server
const universalRequestHandler = (req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  req.on('end', () => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: body ? JSON.parse(body) : null,
    });
    // Call the test-specific handler
    if (currentHandler) {
      currentHandler(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No handler defined for this test' }));
    }
  });
};

beforeEach(async () => {
  requests = []; // Clear requests before each test
  currentHandler = null; // Reset handler for each test

  await new Promise(resolve => {
    server = createServer(universalRequestHandler);
    server.listen(0, () => {
      const port = server.address().port;
      client = new CCClient({ url: `http://localhost:${port}`, team: 'test-team' });
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise((resolve, reject) => {
    if (server) {
      server.close(err => {
        if (err) reject(err);
        else resolve();
      });
      server = null;
    } else {
      resolve();
    }
  });
});


test('sendMessage hits /api/messages with correct body including team', async () => {
  currentHandler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  };

  const message = { from: 'agent1', to: 'agent2', text: 'hello' };
  await client.sendMessage(message);

  strictEqual(requests.length, 1);
  strictEqual(requests[0].method, 'POST');
  strictEqual(requests[0].url, '/api/messages');
  deepStrictEqual(requests[0].body, { team: 'test-team', ...message }); // Assert team in body
});

test('createTask hits /api/tasks with correct body including team and returns parsed JSON', async () => {
  const mockResponse = { taskId: '123', status: 'created' };
  currentHandler = (req, res) => {
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockResponse));
  };

  const task = { assignTo: 'claude', type: 'review', payload: {}, priority: 1 };
  const response = await client.createTask(task);

  strictEqual(requests.length, 1);
  strictEqual(requests[0].method, 'POST');
  strictEqual(requests[0].url, '/api/tasks');
  deepStrictEqual(requests[0].body, { team: 'test-team', ...task }); // Assert team in body
  deepStrictEqual(response, mockResponse);
});

test('listAgents returns parsed JSON', async () => {
  const mockResponse = { agents: [{ name: 'agent1', health: 'healthy' }] };
  currentHandler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockResponse));
  };

  const response = await client.listAgents();
  strictEqual(requests.length, 1);
  strictEqual(requests[0].method, 'GET');
  strictEqual(requests[0].url, '/api/agents/health');
  deepStrictEqual(response, mockResponse);
});

test('updateTaskStatus hits /api/tasks/:id with correct body', async () => {
  const taskId = 'task-456';
  const update = { status: 'completed', result: { output: 'done' } };
  const mockResponse = { success: true };

  currentHandler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockResponse));
  };

  await client.updateTaskStatus(taskId, update);

  strictEqual(requests.length, 1);
  strictEqual(requests[0].method, 'PATCH');
  strictEqual(requests[0].url, `/api/tasks/${taskId}`);
  deepStrictEqual(requests[0].body, update);
});


test('non-2xx throws with helpful message containing status', async () => {
  const errorBody = { error: 'Not authorized' };
  currentHandler = (req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorBody));
  };

  const message = { from: 'a', to: 'b', text: 'c' };
  let thrownError = null;
  try {
    await client.sendMessage(message);
  } catch (error) {
    thrownError = error;
  }

  strictEqual(thrownError instanceof Error, true, 'An error should have been thrown');
  // New error message format: `CC ${status}: ${body}`
  strictEqual(thrownError.message, `CC 401: ${JSON.stringify(errorBody)}`, 'Error message should match expected CC error format');

  strictEqual(requests.length, 1);
  strictEqual(requests[0].method, 'POST');
  strictEqual(requests[0].url, '/api/messages');
  deepStrictEqual(requests[0].body, { team: 'test-team', ...message });
});

test('CCClient constructor throws if url is missing', () => {
  let thrownError = null;
  try {
    new CCClient({ team: 'test-team' });
  } catch (error) {
    thrownError = error;
  }
  strictEqual(thrownError instanceof Error, true, 'An error should have been thrown');
  strictEqual(thrownError.message, 'CCClient requires a URL.', 'Should throw error if url is missing');
});

test('CCClient constructor throws if team is missing', () => {
  let thrownError = null;
  try {
    new CCClient({ url: 'http://localhost:8080' });
  } catch (error) {
    thrownError = error;
  }
  strictEqual(thrownError instanceof Error, true, 'An error should have been thrown');
  strictEqual(thrownError.message, 'CCClient requires a team.', 'Should throw error if team is missing');
});
