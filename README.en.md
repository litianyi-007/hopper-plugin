![hopper-plugin banner](docs/assets/banner.png)

# hopper-plugin

> Vendor-neutral background dispatch for AI agents

![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Version](https://img.shields.io/badge/version-0.42.0-3DDC97)
![Tests](https://img.shields.io/badge/tests-1125%20total-3DDC97)
![Hosts](https://img.shields.io/badge/hosts-7-111827)

> 🇨🇳 [中文](README.md) (default) · 🇯🇵 [日本語](README.ja.md)

## What it is

Every vendor CLI brings its own account, auth flow, sandbox behavior, and output
format. Hand-rolling the command line means you re-derive, for every background
job, whether it finished, where the output landed, and whether a failure needs a
human to look — and none of that carries **across hosts**.

hopper-plugin is a thin plugin layer over the llm-hopper file protocol. It lets
Claude Code, Codex CLI, OpenCode, Copilot CLI, Grok Build, Cursor CLI, or a
standalone shell (7 host classes in total) dispatch task-typed work to vendor
CLIs such as codex, kimi, opencode, copilot, agy, grok, mimo, and claude. State
stays in `.hopper/` markdown and JSONL files — no hidden database, no harness
reaction core, and no automatic vendor retry or fallback.

**Only four vendors are actually product-supported: `codex` / `grok` / `claude`
/ `kimi`** (2026-07-31 product decision). The other four registered adapters
(`agy` / `copilot` / `mimo` / `opencode`) are still in the code — `--vendors`
still lists all 8 — but they fall outside the currently recommended usage
range. See "Two layers of vendor control" and "Hosts and vendor support
matrix" below for exactly where that's enforced.

![hopper-plugin architecture](docs/assets/architecture.svg)

Calls from all 7 host classes converge on `hopper-dispatch`. The dispatcher
reads `.hopper/queue.md` and `.hopper/AGENTS.md`, resolves the vendor, and
enforces one **same-family isolation** rule — the check compares
`VENDOR_FAMILY` ("family," in `cli/src/validation.js`): `claude` /
`claude-code` → anthropic, `codex` → openai, `grok` → xai, `kimi` → moonshot;
`copilot` / `opencode` / `mimo` / `agy` are multi-backend routers and are
deliberately left unfamilied. Same family means dispatch is refused, so a host
can't route a task back into its own account family. Background jobs are
started by `hopper-runner`; the dashboard is a read-only consumer of that same
`.hopper/` state.

## Two layers of vendor control

Whether a dispatch can go out at all has to clear two independent gates — both
have to pass:

**Lower layer: what's installed on this machine, and is it authenticated.**
`hopper-dispatch --setup` (doctor) scans this machine for installed,
authenticated vendor CLIs and reports Installed / Auth / Sandbox / WebSrch /
Models, etc. (`/hopper:setup`). This is the capability layer — it answers "can
this vendor be used on this machine at all."

**Upper layer: which vendors this project has approved dispatching to.** The
`## Approved Vendors` table in `.hopper/AGENTS.md` decides which vendors
**this project** allows dispatch to. **Fail-closed**: if that section is
missing, or a vendor isn't in the table / its status isn't `yes`, dispatch is
refused — **including an explicit `--vendor` override** — with error codes
`E_APPROVED_VENDORS_SECTION_MISSING` (the whole section is missing) and
`E_VENDOR_NOT_APPROVED` (the section exists but this vendor isn't approved in
it).

This is the project-level allowlist added in v0.40.0. Before that, the
"in-scope / not in-scope" annotation in the `Notes` column was just prose —
the code never read it. Passing `--vendor` with any registered vendor was
enough to dispatch, regardless of whether the project had actually approved
it.

The two layers currently **don't reference each other**: the
`hopper-dispatch --setup` report shows no Approved Vendors status, and neither
`commands/setup.md` nor `skills/hopper-setup/SKILL.md` even uses the word
"Approved"; the Approved Vendors table, in turn, shows nothing about what's
installed on the machine. The lower layer answers "can it," the upper layer
answers "may it" — and they read two different files.

## What it cannot do / the real security boundaries

This section isn't a disclaimer. Every item below exists so this README's
credibility doesn't rest on overselling.

- `read-only` is a **request** carried by the task type — an instruction
  passed along by the executor prompt frame; whether it becomes a real
  operating-system boundary **depends on the vendor and platform**.
- **grok is always `bypassPermissions`, regardless of platform**
  (`cli/src/vendors/grok.js`; the whole file has no platform branch).
- **codex is platform-split**: on macOS/Linux, codex's own `-s <mode>` sandbox
  is real — a write attempt genuinely fails, returning `operation not
  permitted`. **On Windows, codex's `-s` sandbox can't spawn child processes
  at all**, so it always runs full-access there via
  `--dangerously-bypass-approvals-and-sandbox`, regardless of the requested
  mode. `HOPPER_CODEX_SANDBOX_BYPASS` has **opposite polarity per platform**:
  `=0` disables bypass on Windows, `=1` enables it on macOS/Linux — the
  defaults are already opposite on the two platforms, and this variable
  simply gives each one a switch.
- Beyond "Two layers of vendor control" above, there's a separate
  **same-family isolation** guard (older docs and `--help` describe it as
  `host != vendor`, and **that phrasing is itself misleading**: read
  literally, `'claude-code'` and `'claude'` are never equal, which leads to
  the opposite conclusion — that this guard always holds and is therefore a
  no-op — when that pair is exactly what it's meant to catch). Under Claude
  Code it **sat dormant for roughly two months** (introduced 2026-06-03,
  fixed 2026-07-31 — see v0.39.0): the `HOPPER_HOST_VENDOR` env var was only
  ever set by the 5 Tier-C bash host wrappers, and was never set inside a
  Claude Code session, so the guard's own "skip if there's no hostVendor"
  branch silently swallowed the check; even once that value is supplied, the
  comparison at the time was still bare string equality, and
  `'claude-code' === 'claude'` is always false, so it never caught the case
  it was meant to catch. Since v0.39.0 it compares by `VENDOR_FAMILY` family
  instead, and **only now does it actually hold** — don't read this as "this
  guard has always been in effect."
- No automatic retry, no automatic vendor switching, no fallback — one spawn
  is one spawn.
- The authoritative source is `hopper-dispatch --rules` (also written to
  `.hopper/DISPATCH.md`). **The tables and descriptions in this README are
  snapshots, and they drift** — before you actually rely on one, run
  `--rules` live and use what it prints.

## Quick start

For a new project or a new agent's first integration, the full chain looks
like this — skip any step and you'll hit a wall on the next one:

```bash
# 0. Once the plugin is installed, check what vendor CLIs are on this machine,
#    whether they're installed, and whether they're authenticated (doctor)
hopper-dispatch --setup

# 1. Build the .hopper/ workspace in the project — queue.md / AGENTS.md /
#    COST-LOG.md / DISPATCH.md / handoffs/leader-tasklist.md, plus 8
#    tasks/*.md task-type templates, 13 files total
hopper-dispatch --init-tasks

# 2. Open .hopper/AGENTS.md and fill the vendors you want into the
#    `## Approved Vendors` table, marked yes — skip this step and every
#    dispatch after it gets fail-closed rejected, see "Two layers of
#    vendor control" above

# 3. Write a task line in .hopper/queue.md, then dispatch
hopper-dispatch T-PROG-AUDIT --background

# check progress / fetch the result
hopper-dispatch --progress T-PROG-AUDIT
hopper-dispatch --result   T-PROG-AUDIT
```

In Claude Code, use the equivalent slash command:

```text
/hopper:dispatch T-PROG-AUDIT --background
```

## Choosing model and reasoning effort

`--model` and `--reasoning` are **two separate knobs** — never mash them into
one string. `gpt-5.5-xhigh` is wrong: that glues a model (`gpt-5.5`) to an
effort (`xhigh`), and the vendor rejects it as an unknown model. Set them
independently:

Not sure a model name is real before you spend a dispatch on it?
`--check-model` is a zero-spawn assertion: `hopper-dispatch --check-model
codex gpt-5.5-xhigh` catches the glued-together mistake above by name
(dedicated `effort-spliced` verdict, exit 1) instead of letting it reach the
vendor as a 400.

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

- `--model <name>` — the vendor's own model id. **Omit to use the account
  default.**
- `--reasoning <minimal|low|medium|high|xhigh>` — thinking effort. **Defaults
  to `xhigh`**; change the global default with `HOPPER_DEFAULT_REASONING`.

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

That table is a snapshot. The **authoritative, never-drifts** version is
generated from the adapters themselves — use these to check the live truth
for your machine/account:

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

For OpenCode, specify a variant only when the selected provider/model
documents it:

```bash
# OpenCode receives: opencode run ... --variant high
hopper-dispatch T-PROG-AUDIT --background --vendor opencode --reasoning high
```

When `--reasoning` is omitted, Hopper retains its general effective default
for other adapters but intentionally sends **no** OpenCode `--variant`;
custom providers such as tokenbox/DeepSeek have no Hopper-verified variant
contract.

Dispatch permissions default to `danger-full-access`, so implementation tasks
can edit files. If a task brief/spec says `read-only` / `只读`, hopper
automatically downgrades the vendor sandbox to `read-only`; override with
`--sandbox <read-only|workspace-write|danger-full-access>`. That downgrade is
only a **request** — whether it becomes a real operating-system boundary
depends on the vendor and platform. See "What it cannot do / the real
security boundaries" above for the full, honest version.

## Background dispatch and observation

```bash
hopper-dispatch T-PROG-REVIEW --background
npm run dashboard:build
npm run dashboard:start
# open http://127.0.0.1:7777 and select the task's Progress tab
```

![hopper-plugin background dispatch data flow](docs/assets/data-flow.svg)

A background dispatch writes `output.md`, `output.log`, and `progress.log`.
The runner appends progress JSONL events during execution and exactly one
terminal event when the vendor exits. `--progress`, `--watch-events`, the
Claude monitor, OS toast, and dashboard SSE all read from that same
file-backed state.

Claude Code users also get terminal events through the plugin monitor.
Standalone and Codex CLI users can keep a watcher running:

```bash
hopper-dispatch --watch-events
```

**Cross-host equivalence**: the same task ID resolves through the same
`.hopper/` routing tables no matter which host it's dispatched from:

```bash
hopper-dispatch --resolve T-PROG-REVIEW
# Claude Code: /hopper:dispatch T-PROG-REVIEW --background
hopper-codex T-PROG-REVIEW --background
hopper-opencode T-PROG-REVIEW --background
```

## Commands and skills

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

\* "read-only" is the task-type's *requested* sandbox — an instruction carried
by the executor prompt frame; whether it is actually enforced depends on the
vendor, and (for codex) the platform. **grok** always runs full-access
regardless of the request; **codex** does too on Windows, but honors a real
read-only sandbox on macOS/Linux (see "What it cannot do" above for the full
version). Check `/hopper:review` and `hopper-dispatch --rules` for what's
true on your machine.

## Hosts and vendor support matrix

**7 host classes** can initiate dispatch: Claude Code, Codex CLI, OpenCode,
Copilot CLI, Grok Build, Cursor CLI, and a standalone shell.

**8 vendor adapters** are registered, but only 4 of them are actually
product-recommended:

> **Product-supported vendor set (2026-07-31 decision): `codex` / `grok` /
> `claude` / `kimi`.** `agy` / `copilot` / `mimo` / `opencode` are **not
> supported** — a product decision to narrow the actively-supported set, not
> a code-level restriction. Their adapter files are NOT deleted (deleting
> them would break existing tests and history); they remain registered,
> `--vendors` still lists all 8, and nothing in the code hardcodes "only
> these 4" (that would duplicate, and could conflict with, the actual
> enforcement point). The enforcement point for what a given **project** may
> dispatch to is that project's `.hopper/AGENTS.md` **`Approved Vendors`**
> table — fail-closed: a missing section, or a vendor absent/not-`yes`
> there, refuses dispatch, including an explicit `--vendor` override.
>
> **agy is additionally, separately, technically disabled (2026-06-26).** agy
> 1.0.12's `--print` renders the model's answer only in its interactive TUI;
> under a non-TTY stdout (every hopper dispatch is one), it emits nothing
> capturable, so a dispatch can never return an answer. hopper therefore
> **refuses to dispatch to agy**, with a clear error, regardless of what any
> project's Approved Vendors table says. A real fix needs a PTY, and agy is
> excluded from the PTY approach (it hangs on an open stdin pipe). If you
> understand the limitation and still want to try, set
> `HOPPER_ENABLE_AGY=1`. This note will be removed once an upstream fix or a
> sanctioned capture path lands — see
> `docs/specs/vendor-io-protocol-current-vs-target.md`.

## Governance overlay (opt-in)

By default hopper dispatches a task-shape frame + spec and isolates the
vendor from host config. If you also want every dispatched vendor to follow a
shared behavioral constitution (e.g. fable's portable core), opt in:

```bash
hopper-dispatch --init-governance --from /path/to/fable/prompts/portable-agent-core.md
```

This writes `.hopper/GOVERNANCE.md` (a constitution pointer + a per-vendor
overlay table) and vendors a stamped copy of the constitution under
`.hopper/governance/`. From then on, `hopper-dispatch` prepends `constitution
+ per-vendor overlay` onto the composed prompt — keyed on the same vendor the
router already resolves.

- Disable globally: delete `.hopper/GOVERNANCE.md`.
- Disable per task: add a `Govern` column to `queue.md` and set it to `off`.
- The constitution stays owned upstream (fable); hopper carries a stamped
  copy.

This is a prompt-level behavioral contract; it does not change sandbox,
timeout, routing, or the one-spawn-no-retry guarantee.

## Install

Detailed host-by-host installation is in
[docs/release/INSTALL-MATRIX.md](docs/release/INSTALL-MATRIX.md).

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

## Upgrading

See [MIGRATION.md](MIGRATION.md) for upgrading from an older version,
especially across the v0.40.0 line.

**v0.40.0 is a breaking change for existing projects**: it adds a new
`## Approved Vendors` section to `.hopper/AGENTS.md`, and that section is
fail-closed — for a project built before v0.40.0, if `.hopper/AGENTS.md`
doesn't have this section yet, **every vendor's dispatch will be refused
after upgrading**, until you manually add the table and mark the vendors you
want to use `yes`. This isn't a gradual warning, it's a hard refusal — read
the table-filling steps in MIGRATION.md before you upgrade.

## Documentation / Status / License

Start from [docs/cookbook.md](docs/cookbook.md) for the complete dispatch,
progress, notification, dashboard, probe, stale-job cleanup, and
multi-vendor review workflows.

- PRD: [docs/specs/background-progress-notification-prd-trd.md](docs/specs/background-progress-notification-prd-trd.md)
- Install matrix: [docs/release/INSTALL-MATRIX.md](docs/release/INSTALL-MATRIX.md)
- Dashboard: [dashboard/README.md](dashboard/README.md)
- Telemetry manual: [docs/specs/background-progress-notification-dogfood-telemetry-MANUAL.md](docs/specs/background-progress-notification-dogfood-telemetry-MANUAL.md)

Status:

- v1.0 (progress + terminal notifications): GA
- v1.1 (dashboard integration + OS toast + docs): GA
- v1.2 (pipe+tee + stream-parser + more providers): planned

License: Apache-2.0. See [LICENSE](LICENSE).
