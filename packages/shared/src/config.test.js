import { test } from 'node:test';
import { strictEqual, deepStrictEqual, throws } from 'node:assert';
import { loadConfig } from './config.js';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULTS = {
  server: { url: 'http://localhost:3000', team: 'default', port: 3000 },
  agents: {},
  bridges: {}
};

test('loadConfig returns DEFAULTS when file missing', () => {
  const nonExistentPath = join(tmpdir(), 'non-existent-config.toml');
  const config = loadConfig(nonExistentPath);
  deepStrictEqual(config, DEFAULTS);
});

test('loadConfig parses a tmp toml file and merges', () => {
  const tempConfigFile = join(tmpdir(), 'test-config-merge.toml');
  const customConfig = `
server.url = "http://localhost:8080"
server.team = "test-team"
[agents]
agent1 = { url = "http://localhost:1000" }
`;
  writeFileSync(tempConfigFile, customConfig);

  const config = loadConfig(tempConfigFile);
  const expected = {
    server: { url: 'http://localhost:8080', team: 'test-team', port: 3000 },
    agents: { agent1: { url: 'http://localhost:1000' } },
    bridges: {}
  };
  deepStrictEqual(config, expected);
  unlinkSync(tempConfigFile);
});

test('loadConfig env var overrides file value', () => {
  const tempConfigFile = join(tmpdir(), 'test-config-env.toml');
  const fileConfig = `
server.url = "http://localhost:8080"
server.port = 4000
`;
  writeFileSync(tempConfigFile, fileConfig);

  process.env.CC_URL = 'http://localhost:9000';
  process.env.CC_TEAM = 'env-team';
  process.env.CC_PORT = '5000';

  const config = loadConfig(tempConfigFile);
  const expected = {
    server: { url: 'http://localhost:9000', team: 'env-team', port: 5000 },
    agents: {},
    bridges: {}
  };
  deepStrictEqual(config, expected);

  delete process.env.CC_URL;
  delete process.env.CC_TEAM;
  delete process.env.CC_PORT;
  unlinkSync(tempConfigFile);
});

test('loadConfig throws on invalid toml', () => {
  const tempConfigFile = join(tmpdir(), 'test-config-invalid.toml');
  const invalidConfig = `server.url = "http://localhost:8080"
  server.port =
`;
  writeFileSync(tempConfigFile, invalidConfig);

  throws(() => loadConfig(tempConfigFile), (err) => {
    strictEqual(err.message.includes(tempConfigFile), true);
    return true;
  }, 'Should throw an error for invalid TOML');

  unlinkSync(tempConfigFile);
});

test('loadConfig handles invalid CC_PORT env var', () => {
  const tempConfigFile = join(tmpdir(), 'test-config-invalid-port.toml');
  writeFileSync(tempConfigFile, '');

  process.env.CC_PORT = 'not-a-number';

  throws(() => loadConfig(tempConfigFile), (err) => {
    strictEqual(err.message, 'Invalid CC_PORT environment variable. Must be a number.');
    return true;
  }, 'Should throw an error for invalid CC_PORT');

  delete process.env.CC_PORT;
  unlinkSync(tempConfigFile);
});

