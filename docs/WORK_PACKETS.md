# v2 Work Packets — v1.4 (2026-04-24)

Re-baselined after the qwen / MCP / REST-agent / aider scope cuts. See
`docs/PLAN.md` for the architecture and rationale.

Each packet is dispatchable to @gemini via the v1 dashboard (during the
build) or via `cc send @gemini` (once v2 is up). Reviewed by @claude
(tmux Claude Code) per Protocol v1.4.

**Conventions:**
- Paths are relative to `~/git/control-center-v2/`.
- Each packet has **inputs**, **deliverables**, **acceptance criteria** (numbered AC1..ACn — reviewer quotes these verbatim).
- Worker prompt MUST include explicit `cd /Users/playground/git/control-center-v2` step before file ops (gemini cwd-relative resolution bit us on P3.1).
- Worker reply via tmux pane only — **no `cc_send_message`** in worker prompts.
- Worker close-out = HTTP `PATCH /api/tasks/<id>` (status=completed, result=1-line). This is server-side state, not MCP.

---

## Already shipped (carry-over from v1.0–v1.3 plan)

- ✅ **P1.1** monorepo scaffold (gemini #27, claude #33)
- ✅ **P2.1** `shared/config.js` (5 tests green)
- ✅ **P2.2** `shared/cc-client.js` (7 tests green)
- ✅ **P2.3** `shared/sse-client.js` (smoke + unit tests green)
- ✅ **P3.1-prelude** `server/task-store.js` (in-memory store, 15 tests green) — note: NOT the original P3.1 packet, this is a precursor module that R3 will integrate.

## Dropped from earlier plans (do not implement)

- ❌ P5.1 `agents/gemini-rest` — REST agents replaced by tmux-only workers
- ❌ P5.2 `agents/claude-api` — same
- ❌ P6.1 `mcp/cc-mcp-server` — MCP no longer in the control loop
- ❌ Anything mentioning `@qwen` or `spice-harvester` as a worker

---

## R2 — `shared/protocol-renderer.js` + template

**Inputs:**
- Single template at `packages/shared/src/protocol.md.tmpl` with placeholders `{{AGENT_NAME}}`, `{{TEAM}}`, `{{PEER_LIST}}`, `{{CODE_GUIDELINES}}`, `{{TMUX_TARGET}}`.
- Render for a given agent, peers from config, never including the agent itself in the peer list.
- The template content is the v1.4 protocol: tmux-only comms, no MCP, ACK via HTTP `PATCH /api/tasks/<id>`, file-op `cd` step required.

**Deliverables:**
- `packages/shared/src/protocol.md.tmpl`
- `packages/shared/src/protocol-renderer.js` exporting `renderProtocol({ agent, config }) → string`
- `packages/shared/src/protocol-renderer.test.js`

**AC1:** Rendering for `claude` produces a doc that lists `gemini` as a peer and excludes `claude`.
**AC2:** Rendering for an unknown agent name throws.
**AC3:** Template substitutes all four placeholders; `grep '{{' rendered_output` returns zero matches.
**AC4:** Template contains the literal string "no MCP" and does NOT contain the literal string "cc_send_message".
**AC5:** Tests pass via `cd packages/shared && node --test src/protocol-renderer.test.js`.

---

## R3 — `server/` routes + dispatcher + index

Split into 3 sub-packets so each fits one Flash response.

### R3a — `server/routes/`

**Deliverables:**
- `packages/server/src/routes/messages.js` — POST/GET /api/messages, DELETE /api/messages/:team
- `packages/server/src/routes/tasks.js` — POST/GET /api/tasks/:team, GET /api/tasks/:id, PATCH /api/tasks/:id, DELETE /api/tasks/:team (with `?assignTo=` filter)
- `packages/server/src/routes/agents.js` — GET /api/agents/health, DELETE /api/agents/:name
- `packages/server/src/routes/heartbeat.js` — POST /api/heartbeat
- `packages/server/src/routes/teams.js` — GET/POST/DELETE /api/teams + agent-roster sub-routes

Each exports `{ handle(req, res, ctx) }` where `ctx = { taskStore, messageStore, agentHealth, persist }`.

**AC1:** Each file is < 200 lines.
**AC2:** Each handler is pure-ish — no global state mutation outside `ctx`.
**AC3:** All v1 endpoint paths preserved exactly.
**AC4:** Tests under `packages/server/src/routes/*.test.js` cover happy + 400 + 404 paths for each handler. Run with `cd packages/server && node --test src/routes/`.

### R3b — `server/dispatcher.js` + `server/index.js`

**Deliverables:**
- `packages/server/src/dispatcher.js` — maps `(method, urlPath)` to a handler. Pure function. Returns 404 handler if no match.
- `packages/server/src/index.js` — `http.createServer`, parses JSON bodies, calls dispatcher, mounts SSE (placeholder until R4).
- Reads `CC_V2_PORT` env, defaults to `3000`. Reads `CC_V2_TEAM` env, defaults to `factory-v3`.

**AC1:** `node packages/server/src/index.js` listens on port and `curl /api/agents/health` returns `[]` (empty array, server fresh).
**AC2:** `curl -X POST /api/messages -d '{"team":"t","from":"x","text":"hi"}'` returns 200 and the message persists in memory for the session.
**AC3:** Server logs each request as `<method> <path> <status>` to stdout (one line, no JSON pollution).

### R3c — wire `task-store.js` into `routes/tasks.js`

**Deliverables:**
- Update `packages/server/src/routes/tasks.js` to use the existing `TaskStore` instance from `task-store.js` instead of an internal Map.
- Add `task-store` to `ctx` in the dispatcher.

**AC1:** All R3a tests still pass.
**AC2:** Creating a task via POST returns the same shape as `TaskStore.create()` returns.
**AC3:** Illegal status transitions returned by `TaskStore.updateStatus` surface as HTTP 409 with `{ error: "<message>" }`.

---

## R4 — `server/sse.js` + task-lifecycle wiring

**Inputs:**
- SSE wake dispatch with 20s keepalive comment frames.
- Single-recipient: when a task is dispatched, the wake event goes to **exactly one** SSE client per (agent, team) — the most recently registered. (v1 fix already validated.)
- On client reconnect with `?since=<id>`: re-push any `dispatched` tasks for that agent with id > since.
- On client reconnect WITHOUT `?since`: do not auto-replay.
- Sweeper every 30s: tasks stuck in `dispatched` for >5min flip to `failed` with `result="timeout"`.

**Deliverables:**
- `packages/server/src/sse.js` — `mountSSE(server, ctx)` and `dispatchWake(taskStore, agent, team)`.
- `packages/server/src/sweeper.js` — interval-based stale-task reaper.
- Update `index.js` to mount SSE and start sweeper.
- Tests under `packages/server/src/sse.test.js` (port the v1 `/tmp/test-cc-patches.mjs` 3 cases as proper unit tests).

**AC1:** Two SSE clients connect; task dispatched; only the newer client receives the wake event.
**AC2:** Client connects without `?since`; task in `dispatched` state is NOT replayed.
**AC3:** Client connects with `?since=0`; all tasks with id>0 in `dispatched` state are replayed.
**AC4:** Task in `dispatched` for >5min flips to `failed` with `result="timeout"` after the next sweeper tick.
**AC5:** Tests pass via `cd packages/server && node --test src/sse.test.js`.

---

## R5 — `server/persistence-sqlite.js` + v1 migration

**Inputs:**
- `better-sqlite3` (synchronous, embedded). Schema: `tasks`, `messages`, `teams`, `agent_health`.
- DB path: `~/.cc/state.db` by default (env override `CC_DB_PATH`).
- Keep the same `loadState() / saveState() / schedulePersist()` interface so routes don't change.
- One-time migration: on first boot, if `~/.control-center-state.json` exists and the DB is empty, import everything and rename the JSON file to `<orig>.imported`.

**Deliverables:**
- `packages/server/src/persistence.js`
- `packages/server/src/schema.sql`
- `packages/server/src/migrate-from-v1.js`
- Tests covering: insert/read round-trip, 10k tasks performance (<100ms), v1 JSON import.

**AC1:** 10000 tasks inserted; server restarts; all 10000 readable in <100ms.
**AC2:** v1 state file present + DB empty → first boot imports all tasks/messages/teams/agent_health, then renames JSON to `*.imported`.
**AC3:** v1 state file absent → server starts cleanly with empty DB.
**AC4:** Subsequent boots do NOT re-import (idempotent).

---

## R6 — `bridges/tmux-bridge.js`

**Inputs:**
- Port `~/.config/control-center/agents/claude-tmux-bridge.mjs` to `packages/bridges/src/tmux-bridge.js`.
- CLI flags replace env: `--agent <name> --target <session:0.0> --team <name> --url <cc-url>`.
- Keep the rendering pause + double Enter (already validated).
- **NEW:** Add an Escape preamble before injecting — sends `tmux send-keys Escape` once before the prompt to defuse stuck shell-mode states (gemini-cli `!`-prefix bug bit us on P3.1 dispatch).
- **NEW:** Bridge does NOT read pane output. Replies are handled by pane-mirror (R8). Bridge is inject-only.

**Deliverables:**
- `packages/bridges/src/tmux-bridge.js`
- `packages/bridges/src/tmux-bridge.test.js` — mock tmux via spawn-stub.
- `packages/bridges/src/bridge-interface.md` — short interface doc for future bridges.

**AC1:** `node packages/bridges/src/tmux-bridge.js --agent claude --target claude-cc:0.0 --team factory-v3 --url http://localhost:3000` registers via heartbeat and listens on SSE.
**AC2:** Receives wake → injects framed prompt → posts `PATCH /api/tasks/<id>` with status=completed.
**AC3:** Bridge sends `Escape` immediately before the framed prompt is typed.
**AC4:** Bridge does NOT read pane output anywhere in the source (`grep capture-pane src/tmux-bridge.js` returns zero).

---

## R7 — `agents/watchdog.mjs` (port)

**Inputs:**
- Port `~/.config/control-center/agents/watchdog.mjs` as-is into `packages/agents/src/watchdog.js`.
- Replace direct `fetch(URL)` with `@cc/shared/cc-client`.
- Watch list comes from config, not hardcoded.

**Deliverables:**
- `packages/agents/src/watchdog.js`
- `packages/agents/src/watchdog.test.js` — pattern-match coverage.

**AC1:** All 17 v1 fault patterns preserved (16 existing + semantic-loop).
**AC2:** Watch list read from `config.bridges` rather than hardcoded.
**AC3:** Posts via cc-client, not raw fetch.
**AC4:** Tests pass.

---

## R8 — `agents/pane-mirror.mjs` (port)

**Inputs:**
- Port `~/.config/control-center/agents/pane-mirror.mjs` into `packages/agents/src/pane-mirror.js`.
- Use `@cc/shared/cc-client` for posting.
- Watch list from config (same source as watchdog).
- Chrome regex list externalized to a separate `chrome-patterns.js` for ease of tuning.

**Deliverables:**
- `packages/agents/src/pane-mirror.js`
- `packages/agents/src/chrome-patterns.js`
- `packages/agents/src/pane-mirror.test.js` — golden-file test: feed a captured pane snapshot, assert filtered output.

**AC1:** Module exits cleanly on SIGTERM (no orphaned timers).
**AC2:** Given a sample claude-cc pane snapshot, filters out ≥95% of chrome lines.
**AC3:** Given a sample gemini-cc pane snapshot with a 4-line agent reply, output contains those 4 lines and nothing else.
**AC4:** Tests pass.

---

## R9 — `tools/git-helper`

**Inputs:**
- A small Node CLI replacing aider for git ops, intended to be called by tmux workers (worker types `cc git commit -m "..."` → mirror sees command → server runs git-helper → posts result).
- Non-interactive enforcement: `GIT_TERMINAL_PROMPT=0`, `--no-pager`, hard 10s timeout per op.
- Subcommands: `status`, `diff [path]`, `add <path...>`, `commit -m <msg>`, `branch <name>`, `checkout <ref>`, `log -n <N>`, `push --dry-run`. **No `push` for real**, no `pull`, no `merge`, no `rebase` (those need human judgment).
- Output: structured JSON to stdout, one line — `{ ok: bool, exitCode: number, stdout: "...", stderr: "..." }`.

**Deliverables:**
- `packages/tools/src/git-helper.js`
- `packages/tools/src/git-helper.test.js` — runs against a tempdir git repo.
- `packages/tools/README.md` — usage examples for worker prompts.

**AC1:** Each subcommand timeouts at 10s and returns `ok:false, exitCode:124`.
**AC2:** `commit -m "msg"` works in a clean tempdir repo (creates the commit).
**AC3:** `push` (without `--dry-run`) is rejected with exit code 2 and a message naming the disallowed verb.
**AC4:** All git invocations run with `GIT_TERMINAL_PROMPT=0` and `--no-pager` (verify by stub assertion).
**AC5:** Tests pass.

---

## R10 — `dashboard/` (Alpine rewrite)

**Inputs:**
- Rewrite v1's `dashboard.html` using Alpine.js + Tailwind via CDN (no bundler).
- Feature parity minus removed scope: compose bar, @-autocomplete (qwen REMOVED from dropdown), agent health cards, task list, clear pipeline, collapsible long messages, team switcher.
- ⚡ Code button: dispatches `type:"code"` task to selected agent (gemini default).
- **Drop the "send via MCP" code paths.** Dashboard talks to server only via HTTP `/api/messages` and `/api/tasks`.
- Served statically by `@cc/server` at `/`.

**Deliverables:**
- `packages/dashboard/src/index.html`
- `packages/dashboard/src/app.js`
- `packages/dashboard/src/styles.css` (minimal overrides)

**AC1:** `curl localhost:3000/` returns the HTML.
**AC2:** Compose bar @-autocomplete shows only agents present in `/api/agents/health` (qwen will be absent).
**AC3:** No `cc_send_message` or other MCP-tool reference anywhere in the JS.
**AC4:** Side-by-side parity check vs v1 dashboard for each surviving feature.

---

## R11 — `cli/cc` (proper Node CLI)

**Inputs:**
- Replace `bin/ccctl` (bash) with `packages/cli/src/cc.js` (Node).
- `bin/cc` becomes a 1-line shim that execs `node packages/cli/src/cc.js "$@"`.
- Subcommands: `up`, `down`, `toggle`, `restart`, `nuke`, `status`, `logs [name]`, `attach <session>`, `send <@agent> <msg>`, `doctor`, `init`.
- `up` spawns: server, claude-bridge, gemini-bridge, watchdog, pane-mirror, plus tmux sessions for `claude-cc` and `gemini-cc`. Optionally pops Terminal windows (`NO_TERMINAL=1` to skip).
- `doctor` checks: node ≥22, tmux installed, `~/.cc/config.toml` valid, port free, claude/gemini binaries on PATH, pidfiles consistent with running processes.
- Pidfiles in `~/.cc/run/`. Logs in `~/.cc/logs/`.

**Deliverables:**
- `packages/cli/src/cc.js`
- `packages/cli/src/commands/*.js` (one per subcommand)
- `packages/cli/src/cc.test.js`

**AC1:** `cc up` from cold → all 5 processes alive within 5s; dashboard reachable.
**AC2:** `cc down` → all 5 processes gone; tmux sessions intact.
**AC3:** `cc nuke` → all 5 processes gone AND tmux sessions gone.
**AC4:** `cc toggle` flips state correctly (covers both directions).
**AC5:** `cc doctor` on a fresh machine without tmux installed prints the exact remediation step and exits 1.
**AC6:** `cc status` lists each component as UP/DOWN with PID.
**AC7:** Every component started by `cc up` is killed by `cc down`. No "manual on the side."

---

## R12 — Smoke test + v1 retirement playbook

**Inputs:**
- End-to-end script `scripts/smoke.sh` that runs: `cc down` (idempotent) → `cc up` → wait health → `cc send @gemini "ping"` → assert reply within 10s → `cc down`.
- Cutover doc in `docs/CUTOVER.md`: archive v1 dir, rename, run `cc init`, run `cc up`. Includes rollback (`mv` back).

**Deliverables:**
- `scripts/smoke.sh`
- `docs/CUTOVER.md`

**AC1:** Smoke passes on a non-3000 port (coexists with v1 during build).
**AC2:** Cutover playbook tested in dry-run (with v1 still live, run cutover steps in a copy, verify nothing reaches v1).

---

## R13 — `CLAUDE.md` at v2 root (CEO orientation)

**Inputs:**
- A single doc that any fresh CEO Claude reads first.
- Covers: where this repo sits in the bigger picture, what's inside vs outside the repo (CEO_LOG, memory, v1 archive), how to bring the stack up (`cc up`), how the protocol works at a glance (v1.4), where to find detailed docs.
- One paragraph each, link-out to deeper docs. Goal: orient in <2 minutes.

**Deliverables:**
- `CLAUDE.md` at v2 root.

**AC1:** Mentions `bin/cc up` as THE switch.
**AC2:** Links to `docs/PLAN.md`, `docs/WORK_PACKETS.md`, `~/CEO_LOG.md`, `~/.claude/projects/-Users-playground-git-spice-harvester/memory/`.
**AC3:** Documents the tmux-only / no-MCP / no-qwen / git-helper-not-aider scope decisions inline so a CEO doesn't need to dig.
**AC4:** No more than 200 lines.

---

## Review gate (Protocol v1.4)

After each packet lands, dispatch a review task to `@claude` (tmux). Format:

```
@claude Review R<N> at control-center-v2/<paths>.
ACCEPTANCE CRITERIA — quote each verbatim and state PASS/FAIL per criterion:
AC1: ...
AC2: ...
...
Final verdict: PASS or FAIL (binary). If FAIL, 1-bullet fix list.
```

Reviewer rules (v1.4 enforcement):
- The AC block above is the single source of truth. Do NOT consult WORK_PACKETS.md or any other doc — the criteria are right here.
- Verdict is binary. "CONDITIONAL PASS" is banned. If fixes are needed, verdict = FAIL with the fix list, full stop.
- Worker close-out (whether PASS or FAIL) goes through HTTP `PATCH /api/tasks/<id>`, not MCP.

---

## Shepherd cheat sheet (CEO workflow)

For each packet:
1. Open dashboard, select `@gemini`, paste the packet body (or `cc send @gemini <body>`).
2. Click ⚡ Generate Code (during v1) or just Send (post-cutover).
3. Worker writes files, runs tests, types reply in their pane → mirror posts → CEO sees.
4. Dispatch review packet to `@claude`. Wait for binary verdict.
5. On PASS: mark packet ✅ in this doc, dispatch next.
6. On FAIL: dispatch fix packet to @gemini with the reviewer's fix list verbatim. Cycle cap = 3. After 3 cycles → STUCK → CEO decides.

Never dispatch two packets in parallel until their phase predecessors are ✅.
