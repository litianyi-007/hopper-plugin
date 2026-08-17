# Hopper Dashboard

A local, read-mostly web dashboard for visualizing the `hopper-plugin` agent
dispatch lifecycle: task queue, vendor inventory, live log streams, and cost
totals. Built as a sidequest; ships as a real product. Binds `127.0.0.1` only.

> Architectural background and full design contract: [`docs/sidequests/web-dashboard/SPEC.md`](../docs/sidequests/web-dashboard/SPEC.md)
> Build retrospective: [`docs/sidequests/web-dashboard/SIDEQUEST-COMPLETE.md`](../docs/sidequests/web-dashboard/SIDEQUEST-COMPLETE.md)

---

## Quick start

```bash
npm install
npm run dashboard:build
npm run dashboard:start
```

Open `http://127.0.0.1:7777` in a browser. The dashboard reads from the
project's `.hopper/` directory and reflects live state via Server-Sent Events.

For development with HMR:

```bash
npm run dashboard:dev
```

Dev mode runs Vite (HMR) on `127.0.0.1:5173` with a proxy to the API server
on `127.0.0.1:7777`. Open the Vite URL for the live-editing experience.

---

## Routes

The dashboard has four routes, navigable via the top-right nav or keyboard
shortcuts (see below).

### `/` — Queue View

Renders `.hopper/queue.md` as a sortable, filterable table grouped by status.
Updates in real time via the `/events/queue` SSE channel when the file changes.

- 5 columns: ID, Type, Status, Vendor, Brief
- 5 status states with color + glyph dual encoding: `pending` (gray circle),
  `in-progress` (mint filled), `done` (mint outline), `failed` (coral X),
  `removed` (gray with strikethrough)
- Click a row to open the task detail drawer
- Search input (top-right) filters by ID or brief substring; press `/` to
  focus from anywhere

### `/task/:id` — Task Detail Drawer

Opens as a right-side drawer (760px wide, no overlay — queue stays visible
behind). Reads `.hopper/handoffs/<task-id>-output.md`.

- **Frontmatter tab**: parsed YAML key-value table; missing fields show `—`
- **Output tab**: markdown body rendered (tables, lists, code blocks with
  line numbers, ANSI-colored quotes)
- **Progress tab**: recent progress JSONL events with pinned terminal event

Raw vendor logs are not exposed through the dashboard. Use the local CLI's
explicit `hopper-dispatch --result <task-id> --full` boundary when raw output
is needed by an authorized local operator.

Direct-link URLs work: `http://127.0.0.1:7777/task/T-WEB-04` opens the drawer
on page load. Press `Esc` to close (URL returns to `/`).

### `/vendors` — Vendor Inventory

5-card grid showing each vendor adapter's state:

- `codex`, `kimi`, `opencode`, `copilot`, `agy`
- Install status, cached models, staleness marker (`[STALE]` matches
  `hopper-dispatch --models <vendor>` CLI output)
- "Probe" button on each card — see _Probe action_ below

### `/cost` — Cost Log View

Renders `.hopper/COST-LOG.md` as:

- Three stat cards: row count, total tokens, approximate total $
- Cost-by-vendor horizontal bars (pure CSS — no chart library)
- Detail table of all entries with date / task / vendor / tokens / $ / notes

Vendor cells in the detail table show full model name on hover (e.g.,
`codex` cell tooltips `codex-gpt-5.5`).

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `j` / `k` | Move queue row selection down / up |
| `Enter` | Open selected task drawer |
| `Esc` | Close task drawer (returns to `/`) |
| `/` | Focus queue search input (navigates to `/` first if elsewhere) |
| `g q` | Go to Queue (`/`) |
| `g v` | Go to Vendors (`/vendors`) |
| `g c` | Go to Cost (`/cost`) |

The `g`-chord has a 1.5-second timeout; press `g` then the destination key
within that window.

Shortcuts are disabled when typing in inputs, textareas, selects, or
`contenteditable` regions.

---

## Probe action (the only write surface)

The "Probe" button on each vendor card triggers
`hopper-dispatch --probe <vendor>` via a confirmation dialog. This is the
**only** mutation the dashboard makes — it refreshes the per-vendor
capability cache (`cli/src/cache.js`).

Safety:

- Vendor name allowlist (`codex` / `kimi` / `opencode` / `copilot` / `agy`)
  enforced server-side; command injection via vendor name is impossible
- Only `--probe <vendor>` args are ever passed to `hopper-dispatch`
- No `--background` or `--dispatch` flags are accepted; writes to
  `.hopper/queue.md` always go through ping protocol, never the dashboard
- 60-second timeout with `child.kill()` if the probe hangs
- Per-vendor concurrency lock: 409 if the same probe is already running
- On failure, a toast surfaces the error (sonner)

The probe writes only to `cli/src/cache.js`'s cache file (not under
`.hopper/`), so it never collides with concurrent ping sessions.

## Progress data consistency

Task progress uses a best-effort snapshot plus live SSE tail. Around log
rotation, `/api/task/:id/progress` may briefly under-deliver history while
`/events/progress/:id` continues from the current file. Treat snapshots as
best-effort context, not an authoritative event count.

### OpenCode operator-evidence boundary

The dashboard only reads repo-owned queue, handoff, cache, and progress data.
An external OpenCode user-level snapshot side effect is not attestation status
or model evidence, and the dashboard does not infer either from observed
external writes. See the cookbook's OpenCode execution boundary for the
operator record required when external OpenCode is invoked.

---

## Configuration

| Flag / env | Default | Effect |
|---|---|---|
| `--port <n>` | `7777` | Bind to a different port. Must be in 1-65535. |
| `--dev` | off | Run Vite + API server concurrently for HMR development. |
| `--host <ip>` | `127.0.0.1` | **Locked** to `127.0.0.1`. Any other value throws. |
| `--help` / `-h` | — | Print usage. |
| `HOPPER_DIR` (env) | auto-discover | Override `.hopper/` location. Auto-discovery walks up 8 parent levels from CWD. |

The dashboard never exposes itself on `0.0.0.0`, `::`, or `*`. This is
enforced at three layers: CLI arg parser, server config, server listen
callback.

---

## Architecture

```
filesystem            chokidar          SSE broker          EventSource
.hopper/*.md   ──▶   server/events  ──▶  /events/*    ──▶  useSSE hook ──▶ Query cache
                          │
                          └─ liveness tick (5s) ──▶ /events/liveness

client action  ──▶ POST /api/action/probe ──▶ spawn(hopper-dispatch --probe ...)
```

- **Backend**: Node ESM + Express + chokidar. Reads `cli/src/*.js` pure
  functions (whitelisted; see [SPEC §B.1](../docs/sidequests/web-dashboard/SPEC.md))
- **Frontend**: React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Radix
  primitives (4 packages, all whitelisted)
- **Data**: 6 SSE channels (queue / task / progress / cost / agents / liveness)
  backed by file watchers; Tanstack Query for cache invalidation
- **Bundle**: code-split into main chunk (always loaded; 119 KB gzipped) +
  TaskDetailRoute lazy chunk (loaded on first drawer open; 65 KB gzipped)
- **Loopback-only**: hard-enforced at three layers; never opens to network

Watched files (read-only):

```
.hopper/queue.md              → /events/queue
.hopper/handoffs/*.md         → /events/task/:id
.hopper/handoffs/*-progress.log → /events/progress/:id
.hopper/COST-LOG.md           → /events/cost
.hopper/AGENTS.md             → /events/agents
(internal 5s tick)            → /events/liveness
```

---

## Limitations / not supported

- **Remote access** — by design. If you need to view the dashboard from
  another machine, set up an SSH tunnel; the dashboard will not change to
  accommodate this.
- **Authentication / multi-user** — none. The cost log shows token and $
  data; if anyone other than you has filesystem access to this machine,
  they can also read it directly.
- **Server-side persistence** — none. Files are the source of truth;
  closing the dashboard leaves zero residual state.
- **Queue mutation from dashboard** — not allowed. Queue writes are ping
  protocol's territory (see `.hopper/PING.md`); only `--probe` writes to
  the vendor cache.
- **`hopper-dispatch --dispatch` from dashboard** — not allowed.
- **Cross-platform** — Windows 11 is the verified baseline. macOS and
  Linux should work (no platform-specific code) but haven't been formally
  tested.

---

## Troubleshooting

### Build / install issues

**`npm install` shows audit warnings about Vite 5 / esbuild**: these are
moderate-severity advisories under the §B.3-mandated Vite 5 range. Vite 6+
upgrade is out of sidequest scope.

**`npm test` shows 2 failures on `commands/*.md` frontmatter**: this is
known CRLF test fragility — `git`'s default `core.autocrlf=true` on
Windows can rewrite LF to CRLF in fresh checkouts, and the test uses
strict `^---\n` matching. Workaround: `git config core.autocrlf false`
before checking out, or run tests in a worktree with that config.

### Runtime issues

**Port 7777 is already in use**: pass `--port <other>`. Default is 7777
because the CLI also defaults there.

**Dashboard shows "task output not found" for a known task**: the dashboard
reads from `.hopper/handoffs/<task-id>-output.md`; if `hopper-dispatch`
hasn't written there yet (or used a different path), the API returns 404.
This is correct — there's nothing to display.

**Live log stops updating mid-stream**: the SSE client uses exponential
backoff (500ms → 30s, max 10 attempts). After 10 failed reconnects it
shows "lost connection — reload page". Reload to recover.

**Probe button stuck in loading**: per-vendor concurrency lock. Another
probe of the same vendor is in flight; wait for it (or check server logs).
60-second hard timeout kills hung child processes.

**Cost view shows `vendor: "unknown"` rows**: parser couldn't infer the
vendor from the model column. Use `model: "codex-gpt-5.5"` style (known
prefix), `model: "claude-opus-4-7 via codex"` (explicit override), or
ensure model strings are at least 3 chars after sanitization.

### Server lifecycle

**`Ctrl+C` doesn't shut down cleanly on Windows**: the dashboard installs
SIGINT/SIGTERM handlers that close server + watcher + SSE hub in order.
Force-kill with `taskkill /F /PID <pid>` if needed.

---

## Tests

```bash
npm test               # full suite (376 tests, 15 Windows-skipped by design)
```

Dashboard-specific test files:

```
tests/unit/dashboard-server.test.js     # express stub + flag parsing
tests/unit/dashboard-queue.test.js      # queue route + table render + status pill
tests/unit/dashboard-sse.test.js        # SSE hub + watcher event mapping
tests/unit/dashboard-task.test.js       # task route + frontmatter render + markdown
tests/unit/dashboard-log.test.js        # log tail + offset semantics + ANSI parser
tests/unit/dashboard-vendors.test.js    # inventory + spawn allowlist + 409 lock
tests/unit/dashboard-cost.test.js       # cost parser + aggregation + route
```

---

## Files & directories

| Path | Role |
|---|---|
| `dashboard/server/` | Node ESM JS backend |
| `dashboard/client/` | Vite + React TS frontend |
| `cli/bin/hopper-dashboard` | POSIX entry script |
| `cli/bin/hopper-dashboard.cmd` | Windows entry script |
| `docs/sidequests/web-dashboard/SPEC.md` | Full design contract |
| `docs/sidequests/web-dashboard/SIDEQUEST-COMPLETE.md` | Build retrospective |
| `docs/sidequests/web-dashboard/handoffs/` | Per-phase handoff artifacts + reviews |

---

## License

Inherits `LICENSE` from the project root (MIT).
