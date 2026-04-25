// Render the protocol template for a specific agent given a CC config.
// Source of truth for placeholder list lives in protocol.md.tmpl.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE_PATH = join(__dirname, 'protocol.md.tmpl');

const DEFAULT_GUIDELINES = `- Keep changes scoped to what the task asks for. Don't refactor unrelated code.
- Prefer Node built-ins over npm deps.
- Tests live next to source as \`*.test.js\` and run via \`node --test\`.
- ES modules only. \`type: module\` in every package.json.`;

export async function renderProtocol({ agent, config, templatePath } = {}) {
  if (!agent) throw new Error('renderProtocol: missing agent');
  if (!config) throw new Error('renderProtocol: missing config');

  const team = config.team || 'factory-v3';
  const peers = (config.agents || [])
    .map(a => typeof a === 'string' ? { name: a } : a)
    .filter(a => a.name && a.name !== agent);

  if (peers.length === 0 && (config.agents || []).every(a => (typeof a === 'string' ? a : a.name) !== agent)) {
    // Renderer is asked for an agent not in the config — that's a config bug, surface it.
    throw new Error(`renderProtocol: agent "${agent}" not found in config.agents`);
  }

  const peerList = peers.length
    ? peers.map(p => `- **@${p.name}**${p.role ? ` — ${p.role}` : ''}`).join('\n')
    : '_(no peers configured — single-agent setup)_';

  const tmuxTarget = config.tmux?.[agent]?.target || `${agent}-cc:0.0`;
  const ccUrl = config.ccUrl || 'http://localhost:3002';

  const tmpl = await readFile(templatePath || DEFAULT_TEMPLATE_PATH, 'utf8');

  const rendered = tmpl
    .replaceAll('{{AGENT_NAME}}', agent)
    .replaceAll('{{TEAM}}', team)
    .replaceAll('{{PEER_LIST}}', peerList)
    .replaceAll('{{CODE_GUIDELINES}}', config.codeGuidelines || DEFAULT_GUIDELINES)
    .replaceAll('{{TMUX_TARGET}}', tmuxTarget)
    .replaceAll('{{CC_URL}}', ccUrl);

  if (rendered.includes('{{')) {
    const stray = rendered.match(/\{\{[^}]+\}\}/g);
    throw new Error(`renderProtocol: unsubstituted placeholders: ${stray.join(', ')}`);
  }

  return rendered;
}
