![hopper-plugin banner](docs/assets/banner.png)

# hopper-plugin

> Vendor-neutral background dispatch for AI agents

![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Version](https://img.shields.io/badge/version-0.41.1-3DDC97)
![Tests](https://img.shields.io/badge/tests-1024%20total-3DDC97)
![Hosts](https://img.shields.io/badge/hosts-Claude%20Code%20%7C%20Codex%20CLI%20%7C%20OpenCode%20%7C%20Standalone-111827)

## What

hopper-plugin is a thin plugin layer over the llm-hopper file protocol. It lets Claude Code, Codex CLI, OpenCode, Copilot CLI, Grok Build, Cursor CLI, or a standalone shell dispatch task-typed work to vendor CLIs such as codex, kimi, opencode, copilot, agy, grok, mimo, and claude. State stays in `.hopper/` markdown and JSONL files: no hidden database, no harness reaction core, and no automatic vendor retry or fallback.

## Architecture

![hopper-plugin architecture](docs/assets/architecture.svg)

Seven host routes converge on `hopper-dispatch`. The dispatcher reads `.hopper/queue.md` and `.hopper/AGENTS.md`, resolves the vendor, enforces `host != vendor`, and starts `hopper-runner` for background jobs. Vendor model catalogs remain owned by each vendor account. The dashboard is a read-only consumer of the same `.hopper/` state, while `monitors/monitors.json` bridges terminal events into Claude Code native session wake.

## Data Flow

![hopper-plugin background dispatch data flow](docs/assets/data-flow.svg)

A background dispatch writes `output.md`, `output.log`, and `progress.log`. The runner appends progress JSONL events during execution and exactly one terminal event when the vendor exits. `--progress`, `--watch-events`, the Claude monitor, OS toast, and dashboard SSE all read from that same file-backed state.

## Quick Start

### Scenario 1: Pick the vendor's model & reasoning effort

`--model` and `--reasoning` are **two separate knobs** — never mash them into one
string. `gpt-5.5-xhigh` is wrong: that glues a model (`gpt-5.5`) to an effort
(`xhigh`), and the vendor rejects it as an unknown model. Set them independently:

Not sure a model name is real before you spend a dispatch on it? `--check-model` is a
zero-spawn assertion: `hopper-dispatch --check-model codex gpt-5.5-xhigh` catches the
glued-together mistake above by name (dedicated `effort-spliced` verdict, exit 1) instead
of letting it reach the vendor as a 400.

```bash
# effort only — model stays the vendor's account default
hopper-dispatch T-PROG-AUDIT --background --reasoning xhigh

# model AND effort, set independently
hopper-dispatch T-PROG-AUDIT --background --model gpt-5.4-mini --reasoning high

hopper-dispatch --progress T-PROG-AUDIT
hopper-dispatch --result   T-PROG-AUDIT

# identical flags in Claude Code:
# /hopper:dispatch T-PROG-AUDIT --model gpt-5.4-mini --reasoning high
```

- `--model <name>` — the vendor's own model id. **Omit to use the account default.**
- `--reasoning <minimal|low|medium|high|xhigh>` — thinking effort. **Defaults to `xhigh`**;
  change the global default with `HOPPER_DEFAULT_REASONING`.

Not every CLI exposes both knobs. What each vendor honors:

| vendor | `--model` | effort (`--reasoning`) | notes |
|---|---|---|---|
| codex | `-m` | ✓ | **bare names only**: `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.3-codex-spark`. Provider-prefixed ids (`openai-codex/…`) are rejected on ChatGPT accounts. |
| grok | `-m` | ✓ | enum low/med/high; `xhigh` clamps to `high`. |
| mimo | `--model` | ✓ | `xhigh` → `--variant max`. **Not supported** (product decision, 2026-07-31) — see below. |
| copilot | `--model` | ✓ | enum low/med/high; `xhigh` clamps to `high`. Raw override: `HOPPER_COPILOT_EFFORT`. **Not supported** (product decision, 2026-07-31) — see below. |
| opencode | `--model <provider/model>` | explicit only | a caller-supplied `--reasoning high` becomes `--variant high`; Hopper omits policy/default `xhigh` for provider compatibility. `HOPPER_OPENCODE_VARIANT=<v>` overrides it verbatim. **Not supported** (product decision, 2026-07-31) — see below. |
| kimi | `-m` | — | `kimi -p` has no per-call effort flag. |
| claude | `--model` | — | `claude -p` has no effort flag. |
| agy | — | — | ⚠️ **DISABLED by default** (technical) AND **not supported** (product decision, 2026-07-31) — see below. |

> **Product-supported vendor set (2026-07-31 decision): `codex` / `grok` / `claude` / `kimi`.**
> `agy` / `copilot` / `mimo` / `opencode` are **not supported** — a product decision to narrow the
> actively-supported set, not a code-level restriction. Their adapters are NOT deleted (that would
> break existing tests and history); they remain registered, `--vendors` still lists all 8, and
> nothing in the code hardcodes "only these 4" (that would duplicate, and could conflict with, the
> actual enforcement point). The enforcement point for what a given **project** may dispatch to is
> that project's `.hopper/AGENTS.md` **"Approved Vendors"** table — fail-closed: a missing section,
> or a vendor absent/not-`yes` there, refuses dispatch, including an explicit `--vendor` override.
>
> **agy is additionally, separately, technically disabled (2026-06-26).** agy 1.0.12 `--print` renders
> the model's answer only in its interactive TUI; under a non-TTY stdout (every hopper dispatch) it
> emits nothing capturable, so a dispatch can never return an answer. hopper therefore **refuses to
> dispatch to agy** with a clear error regardless of any project's Approved Vendors table. A real fix
> needs a PTY, which is excluded for agy (it hangs on an open stdin pipe). If you understand the
> limitation and still want to try, set `HOPPER_ENABLE_AGY=1`. This note will be removed once an
> upstream fix or a sanctioned capture path lands — see
> `docs/specs/vendor-io-protocol-current-vs-target.md`.

That table is a snapshot. The **authoritative, never-drifts** version is generated from
the adapters themselves — use these to check the live truth for your machine/account:

```bash
hopper-dispatch --rules                 # full matrix (also written to .hopper/DISPATCH.md)
hopper-dispatch --capabilities codex    # one vendor's model/effort/perms contract
hopper-dispatch --probe codex           # your account's live model catalog
hopper-dispatch --check-model codex gpt-5.5   # assert one model before dispatch: verified (0) | catalog-only (2) | not-found (1)
```

Tuning via environment variables:

| var | effect |
|---|---|
| `HOPPER_DEFAULT_REASONING` | global effort default (else `xhigh`). |
| `HOPPER_COPILOT_EFFORT` | raw copilot `--effort` value (e.g. `max`); `""` omits it. |
| `HOPPER_OPENCODE_VARIANT` | highest-precedence raw OpenCode `--variant` override; provider/model validates the value. |
| `HOPPER_GROK_EFFORT` | raw grok `--effort` value; `""` omits it. |

For OpenCode, specify a variant only when the selected provider/model documents it:

```bash
# OpenCode receives: opencode run ... --variant high
hopper-dispatch T-PROG-AUDIT --background --vendor opencode --reasoning high
```

When `--reasoning` is omitted, Hopper retains its general effective default for
other adapters but intentionally sends **no** OpenCode `--variant`; custom
providers such as tokenbox/DeepSeek have no Hopper-verified variant contract.

Dispatch permissions default to `danger-full-access` so implementation tasks can edit
files. If a task brief/spec says `read-only` / `只读`, hopper auto-downgrades the vendor
sandbox to `read-only`; override with `--sandbox <read-only|workspace-write|danger-full-access>`.
That downgrade is a **request** carried by the executor prompt frame; whether it becomes a
real OS boundary is vendor- and platform-dependent. **grok** always runs with
`bypassPermissions` regardless of platform or requested mode. **codex is platform-split
(2026-07-31):** on macOS/Linux it honors its own `-s <mode>` sandbox — a read-only request
is genuinely enforced (verified: a write attempt fails with `operation not permitted`); on
**Windows** codex's `-s` sandbox cannot spawn child processes at all, so it always runs
full-access there via `--dangerously-bypass-approvals-and-sandbox` (a deliberate workaround),
regardless of the requested mode. `HOPPER_CODEX_SANDBOX_BYPASS` overrides the default, with
**opposite polarity per platform** (`=0` disables bypass on Windows; `=1` enables it on
macOS/Linux — see `.hopper/DISPATCH.md`). Check `hopper-dispatch --rules` (or
`.hopper/DISPATCH.md`) for which vendors can actually enforce it on your platform, and
`--subject-root` for a genuine opt-in per-process guard (macOS only, with its own documented
limits — it now composes with codex's own read-only sandbox there rather than being the only
guard).

### Scenario 2: Background dispatch + watch via dashboard

```bash
hopper-dispatch T-PROG-REVIEW --background
npm run dashboard:build
npm run dashboard:start
# open http://127.0.0.1:7777 and select the task's Progress tab
```

Claude Code users also get terminal events through the plugin monitor. Standalone and Codex CLI users can keep a watcher running:

```bash
hopper-dispatch --watch-events
```

### Scenario 3: Cross-host equivalence

The same task ID resolves through the same `.hopper/` routing tables regardless of host:

```bash
hopper-dispatch --resolve T-PROG-REVIEW
# Claude Code: /hopper:dispatch T-PROG-REVIEW --background
hopper-codex T-PROG-REVIEW --background
hopper-opencode T-PROG-REVIEW --background
```

## Core Skills

| Command | Purpose |
|---|---|
| `/hopper:dispatch` | Dispatch a task to its preferred vendor (`--vendor` overrides routing; `--result <id> --full` for long output). |
| `/hopper:review` | One-shot read-only\* code review of a diff/path/PR (ad-hoc, no queue.md row). |
| `/hopper:research` | One-shot web-search-backed product/feature research (ad-hoc, read-only\*). |
| `/hopper:market` | One-shot web-search-backed market/competitor research (ad-hoc, read-only\*). |
| `/hopper:swarm` | Fan a qualitative task out to a panel of N vendors (confirm → parallel → synthesize). |
| `/hopper:setup` | Vendor readiness: installed/auth/models/sandbox/web-search. |
| `/hopper:status` | Show queue summary. |
| `/hopper:result` | Fetch a completed task verdict and log tail (`--full` for the complete text). |
| `/hopper:models` | List cached vendor models. |
| `/hopper:probe` | Refresh vendor capability cache. |
| `/hopper:vendors` | List registered vendor adapters. |
| `/hopper:smoke` | Run the installation smoke test. |
| `hopper-watch-events` | Claude monitor that delivers terminal events. |

\* "read-only" is the task-type's *requested* sandbox — an instruction carried by the
executor prompt frame; whether it is enforced depends on the vendor and (for codex) the
platform. **grok** always runs full-access regardless of the request; **codex** does too
on Windows, but honors a real read-only sandbox on macOS/Linux (see the caveat under
Scenario 1 above). Check `/hopper:review` and `hopper-dispatch --rules` for which vendors
can actually enforce it on your platform.

## Governance overlay (opt-in)

By default hopper dispatches a task-shape frame + spec and isolates the vendor
from host config. If you also want every dispatched vendor to follow a shared
behavioral constitution (e.g. fable's portable core), opt in:

```bash
hopper-dispatch --init-governance --from /path/to/fable/prompts/portable-agent-core.md
```

This writes `.hopper/GOVERNANCE.md` (a constitution pointer + a per-vendor overlay
table) and vendors a stamped copy of the constitution under `.hopper/governance/`.
From then on, `hopper-dispatch` prepends `constitution + per-vendor overlay` onto
the composed prompt — keyed on the same vendor the router already resolves.

- Disable globally: delete `.hopper/GOVERNANCE.md`.
- Disable per task: add a `Govern` column to `queue.md` and set it to `off`.
- The constitution stays owned upstream (fable); hopper carries a stamped copy.

This is a prompt-level behavioral contract; it does not change sandbox,
timeout, routing, or the one-spawn-no-retry guarantee.

See [docs/cookbook.md](docs/cookbook.md) for complete workflows.

## Install

Detailed host-by-host installation is in [docs/release/INSTALL-MATRIX.md](docs/release/INSTALL-MATRIX.md).

Claude Code users:

```bash
mkdir -p ~/.claude/plugins
ln -s "$(pwd)" ~/.claude/plugins/hopper
```

Windows PowerShell:

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$HOME\.claude\plugins\hopper" `
  -Target "F:\absolute\path\to\hopper-plugin"
```

Codex CLI users:

```bash
chmod +x /absolute/path/to/hopper-plugin/hosts/codex-cli/bin/hopper-codex
ln -s /absolute/path/to/hopper-plugin/hosts/codex-cli/bin/hopper-codex ~/.local/bin/hopper-codex
```

Standalone:

```bash
npm link
hopper-dispatch --smoke
hopper-dispatch --vendors
```

Kimi Work users: install `plugins/hopper/` as a managed plugin. The directory
carries `kimi.plugin.json` (Kimi plugin manifest) plus the skills under
`plugins/hopper/skills/` and the CLI under `plugins/hopper/cli/` — point Kimi
Work's plugin management at that directory (or a copy of it) and it registers
the hopper skills and interface metadata from `kimi.plugin.json`.

## Cookbook

Start with [docs/cookbook.md](docs/cookbook.md) for dispatch, progress, notification, dashboard, probe, stale-job cleanup, and multi-vendor review recipes.

## Documentation

- PRD: [docs/specs/background-progress-notification-prd-trd.md](docs/specs/background-progress-notification-prd-trd.md)
- Install matrix: [docs/release/INSTALL-MATRIX.md](docs/release/INSTALL-MATRIX.md)
- Dashboard: [dashboard/README.md](dashboard/README.md)
- Telemetry manual: [docs/specs/background-progress-notification-dogfood-telemetry-MANUAL.md](docs/specs/background-progress-notification-dogfood-telemetry-MANUAL.md)

## Status

- v1.0 (progress + terminal notifications): GA
- v1.1 (dashboard integration + OS toast + docs): GA
- v1.2 (pipe+tee + stream-parser + advanced providers): planned

## License

Apache-2.0. See [LICENSE](LICENSE).
