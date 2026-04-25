#!/usr/bin/env node
// git-helper — non-interactive git wrapper. Replaces aider for routine git ops.
//
// What it solves: agents (gemini-cli especially) hang when git prompts for
// "Username for ...", "Continue (y/n)?", or pages output through `less`. The
// fix is GIT_TERMINAL_PROMPT=0 + --no-pager + a hard timeout. Not git syntax.
//
// Usage:
//   git-helper <subcommand> [args...]
//
// Subcommands are 1:1 with git, with safe defaults injected. Examples:
//   git-helper status
//   git-helper diff --stat HEAD~1
//   git-helper commit -m "msg"
//   git-helper push origin HEAD
//
// Env:
//   GIT_HELPER_TIMEOUT_MS  default 10000
//   GIT_HELPER_CWD         default process.cwd()

import { spawn } from 'node:child_process';

const TIMEOUT_MS = parseInt(process.env.GIT_HELPER_TIMEOUT_MS || '10000', 10);
const CWD = process.env.GIT_HELPER_CWD || process.cwd();

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('git-helper: no subcommand. Usage: git-helper <subcommand> [args...]');
  process.exit(2);
}

// Inject --no-pager before subcommand so all output is non-interactive.
const gitArgs = ['--no-pager', ...args];

const env = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'echo',  // any prompt that slips through gets an empty line, fails fast
  GIT_PAGER: 'cat',
};

const child = spawn('git', gitArgs, { cwd: CWD, env, stdio: 'inherit' });

const killer = setTimeout(() => {
  console.error(`git-helper: timed out after ${TIMEOUT_MS}ms — killing`);
  child.kill('SIGKILL');
  process.exit(124);
}, TIMEOUT_MS);

child.on('exit', (code, signal) => {
  clearTimeout(killer);
  if (signal) {
    console.error(`git-helper: killed by signal ${signal}`);
    process.exit(128);
  }
  process.exit(code ?? 0);
});

child.on('error', e => {
  clearTimeout(killer);
  console.error(`git-helper: spawn error: ${e.message}`);
  process.exit(127);
});
