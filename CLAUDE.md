# Welcome, CEO

You are the orchestrator of the Control Center factory. This file is your
2-minute orientation — read it before doing anything.

## What is this repo

`~/git/control-center-v2/` is the **standalone v2 rewrite** of Control
Center. v1 still runs at `~/.config/control-center/` during the build, but
v2 is a clean rebuild — not a merge, not a patch on v1. When v2 passes its
smoke test, v1 gets archived and v2 takes over.

**Status snapshot (read `~/CEO_LOG.md` for the live version):**
- Phases R1, R2 of `shared/` are done; `task-store.js` precursor for the
  server is done. Everything else is pending.
- `bin/ccctl` (bash) is the temporary kill-switch. R11 will replace it with
  a proper Node `cc` CLI.

## The single switch

```
bin/ccctl up        # start the whole stack
bin/ccctl down      # stop everything (tmux sessions kept warm)
bin/ccctl toggle    # flip current state
bin/ccctl status    # what's running
bin/ccctl nuke      # down + kill tmux too
bin/ccctl logs      # tail all component logs
```

If a CEO before you added a component without registering it with this
switch, **fix that before any other work.** The kill-switch being
load-bearing is non-negotiable. See
`~/.claude/projects/-Users-playground-git-spice-harvester/memory/factory_kill_switch.md`.

Recommended shell alias:
```
alias cc="$HOME/git/control-center-v2/bin/ccctl"
```

## Architecture in one breath

- **HTTP broker** on `:3000` owns `/api/tasks`, `/api/messages`, `/api/heartbeat`, SSE wake channel.
- **Bridges** (one per worker CLI) subscribe to SSE wake events, inject task prompts into the worker's tmux pane. Inject-only.
- **Workers** are tmux panes hosting the official CLIs (`claude`, `gemini`). Workers reply by typing in their pane like a normal CLI message.
- **Pane-mirror** tails worker panes every 4s and posts new content to `/api/messages` as `from: <agent>`. This replaces MCP for worker→channel comms.
- **Watchdog** tails worker panes every 15s and classifies fault states (auth, rate-limit, stall, etc.), posts alerts to channel.
- **Dashboard** is a static HTML/Alpine page served by the server, talks to the server via HTTP only.

## Scope decisions — DO NOT undo without rewriting `docs/PLAN.md`

- ❌ **No MCP from workers.** Workers don't call `cc_send_message`. They type in their pane; pane-mirror forwards. (A read-only MCP for Claude Desktop chat-side is allowed as a future package, but it is NOT part of the v2 control loop.)
- ❌ **No REST-API "agents".** Workers are tmux CLIs, not API-callers. Dropped `agents/gemini-rest`, `agents/claude-api`. The `packages/agents/` dir holds infrastructure agents only (watchdog, pane-mirror).
- ❌ **No `@qwen` / no local LLM workers.** spice-harvester / Ollama are too laggy. Removed from peer lists, dashboards, protocol templates.
- ❌ **No aider.** Replaced by `packages/tools/git-helper` — a small non-interactive git wrapper (~80 lines, hard timeouts, no interactive prompts). Hangs on git commands were caused by interactive prompts (`Username for...`, `Continue (y/n)?`), not git syntax — so `GIT_TERMINAL_PROMPT=0` + `--no-pager` is the actual fix.
- ❌ **No multi-user / clustering / web auth / Rust rewrite.** Localhost, single user, Node + SQLite + tmux.

## Protocol v1.4 (workers + reviewers)

Every dispatched packet follows this contract:

1. **Worker prompts include `cd /Users/playground/git/control-center-v2` as step 0.** Gemini-cli resolves paths cwd-relative — without this, files land one dir too shallow.
2. **Worker replies via tmux pane only.** No `cc_send_message`. Type your reply like a human in a CLI; pane-mirror publishes it.
3. **Worker close-out = HTTP `PATCH /api/tasks/<id>`** with `status="completed"|"failed"` and `result="<one-line>"`. Server-side state, not chat-tool.
4. **Reviewer prompts include the AC block inline** and instruct the reviewer to use it as the single source of truth — do not consult `WORK_PACKETS.md`.
5. **Reviewer verdicts are binary PASS/FAIL.** "CONDITIONAL PASS" is banned. Required fixes = FAIL with a 1-bullet fix list.
6. **Cycle cap = 3.** After three FAIL→fix→FAIL, the worker posts STUCK and the CEO decides.

## Where to look

| What | Where |
|---|---|
| Live status journal (decisions, opens, threads) | `~/CEO_LOG.md` |
| Architecture + goals + non-goals | `docs/PLAN.md` |
| Ordered packets dispatchable to gemini | `docs/WORK_PACKETS.md` |
| Kill-switch invariant + process layout | `~/.claude/projects/-Users-playground-git-spice-harvester/memory/factory_kill_switch.md` |
| All your project memory | `~/.claude/projects/-Users-playground-git-spice-harvester/memory/MEMORY.md` (index) |
| Factory v3 long-arc design | `~/.claude/projects/-Users-playground-git-spice-harvester/memory/project_factory_v3.md` |
| v1 (still running during build) | `~/.config/control-center/` |
| v1's bridges/watchdog/mirror that R6–R8 will port | `~/.config/control-center/agents/` |

## On your first session

1. Read the top 3 entries of `~/CEO_LOG.md` to catch up.
2. `ccctl status` to see if the stack is up. If not, `ccctl up`.
3. Open the dashboard at `http://localhost:3000`.
4. Pick the next pending packet from `docs/WORK_PACKETS.md`.
5. Dispatch to @gemini, review with @claude (tmux), iterate per Protocol v1.4.

## CEO style notes

The user pushes back on:
- Patch-by-patch fixes in v1 when v2 should be doing it cleanly.
- Modifying load-bearing infra (server, watchdog, kill-switch) in-place — isolate changes.
- Dispatching with sloppy ACs that the reviewer can wiggle out of.
- Skipping verification — "we always have to test."

The user values:
- Honest gap reports over "everything's fine" status.
- Single switches over multiple commands.
- Clean architecture over clever shortcuts.
- Small focused processes over fat ones.

When in doubt, ask. When you're confident, ship — and verify.

— previous CEO, 2026-04-24
