import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import toml from 'smol-toml';

const DEFAULTS = {
  server: { url: 'http://localhost:3000', team: 'default', port: 3000 },
  agents: {},
  bridges: {}
};

// Simple deep merge function
function deepMerge(target, source) {
  const output = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
        // Ensure the target property is an object before attempting to merge deeply
        if (typeof output[key] === 'object' && output[key] !== null && !Array.isArray(output[key])) {
          output[key] = deepMerge(output[key], source[key]);
        } else {
          // If target property is not an object, or is null/array, replace it
          output[key] = source[key];
        }
      } else {
        output[key] = source[key];
      }
    }
  }
  return output;
}

export function loadConfig(configPath) {
  let config = deepMerge({}, DEFAULTS);

  let resolvedConfigPath;
  if (configPath) {
    resolvedConfigPath = path.resolve(configPath);
  } else {
    resolvedConfigPath = path.join(os.homedir(), '.cc', 'config.toml');
  }

  try {
    const fileContent = fs.readFileSync(resolvedConfigPath, 'utf8');
    const parsedConfig = toml.parse(fileContent);
    config = deepMerge(config, parsedConfig);
  } catch (error) {
    if (error.code !== 'ENOENT') { // Ignore file not found errors
      throw new Error(`Failed to parse config file ${resolvedConfigPath}: ${error.message}`);
    }
  }

  // Apply environment variable overrides
  if (process.env.CC_URL) {
    config.server.url = process.env.CC_URL;
  }
  if (process.env.CC_TEAM) {
    config.server.team = process.env.CC_TEAM;
  }
  if (process.env.CC_PORT) {
    const port = parseInt(process.env.CC_PORT, 10);
    if (isNaN(port)) {
        throw new Error(`Invalid CC_PORT environment variable. Must be a number.`);
    }
    config.server.port = port;
  }

  return config;
}
