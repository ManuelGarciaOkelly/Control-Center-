#!/usr/bin/env node
// CLI: render the v1.4 protocol for an agent and print to stdout.
//
// Usage:
//   render-protocol-cli.js --agent gemini [--team factory-v3] [--cc-url http://localhost:3002]
//                          [--peer claude:reviewer] [--peer gemini:worker]
//                          [--tmux-target gemini-cc:0.0]
//
// Used by ccctl on `up` to install workspace operator manuals.

import { renderProtocol } from './protocol-renderer.js';

function parseArgs(argv) {
  const out = { agent: null, team: 'factory-v3', ccUrl: 'http://localhost:3002', peers: [], tmux: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--agent') out.agent = argv[++i];
    else if (a === '--team') out.team = argv[++i];
    else if (a === '--cc-url') out.ccUrl = argv[++i];
    else if (a === '--peer') {
      const [name, role] = argv[++i].split(':');
      out.peers.push({ name, role: role || undefined });
    } else if (a === '--tmux-target') {
      const v = argv[++i];
      // Encode as `<agent>=<target>` or assume self if no `=`.
      if (v.includes('=')) {
        const [n, t] = v.split('=');
        out.tmux[n] = { target: t };
      } else {
        out.tmux.__self = { target: v };
      }
    }
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.agent) {
  console.error('render-protocol-cli: --agent is required');
  process.exit(2);
}

// Self-target normalisation so the renderer's config.tmux[agent] lookup hits.
if (opts.tmux.__self) {
  opts.tmux[opts.agent] = opts.tmux.__self;
  delete opts.tmux.__self;
}

const config = {
  team: opts.team,
  ccUrl: opts.ccUrl,
  agents: [{ name: opts.agent }, ...opts.peers],
  tmux: opts.tmux,
};

const md = await renderProtocol({ agent: opts.agent, config });
process.stdout.write(md);
