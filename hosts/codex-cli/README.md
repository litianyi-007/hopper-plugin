# hopper-plugin host adapter: Codex CLI (Tier C)

Anchor: `hosts/codex-cli/README.md::root`

> **Status (2026-05-20)**: Phase 4 functional. Either Tier C host (Codex CLI or OpenCode) satisfies spec §1 #2 cross-host architecture requirement.

## What this is

The Codex CLI host adapter for [hopper-plugin](https://github.com/litianyi-007/hopper-plugin). Unlike Claude Code, Codex CLI does not have a slash-command plugin system — its integration with hopper-plugin is a **prompt wrapper** that uses codex's built-in shell tool to invoke `hopper-dispatch`.

This is **Tier C #1** of the cross-host architecture (Tier C #2 is `hosts/opencode/`).

## How it works

`hopper-codex` is a thin shell wrapper that:

1. Validates the task ID + flags against the same regex / whitelist used by Tier B (`^[A-Za-z][A-Za-z0-9._-]{0,99}$` + `{--write, --force}`)
2. Locates `cli/bin/hopper-dispatch` via `HOPPER_PLUGIN_ROOT` env var or wrapper-relative resolution
3. Builds a codex prompt that instructs codex CLI to invoke `hopper-dispatch` via its shell tool
4. Runs `codex exec` once; codex spawns hopper-dispatch once; hopper-dispatch spawns the vendor adapter once

Single-spawn invariant preserved at every level. No retries, no fallbacks (spec §3 #4).

## Install

### Option A — symlink the wrapper onto PATH

Linux / macOS:

```bash
ln -s /absolute/path/to/hopper-plugin/hosts/codex-cli/bin/hopper-codex \
      ~/.local/bin/hopper-codex
chmod +x /absolute/path/to/hopper-plugin/hosts/codex-cli/bin/hopper-codex
```

Windows (PowerShell, admin):

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$HOME\bin\hopper-codex.cmd" `
  -Target "F:\path\to\hopper-plugin\hosts\codex-cli\bin\hopper-codex.cmd"
```

(Ensure `~/.local/bin` or `$HOME\bin` is on `$PATH`.)

### Option B — invoke directly

```bash
/path/to/hopper-plugin/hosts/codex-cli/bin/hopper-codex T-PLUGIN-05a --write
```

## Prerequisites

| Requirement                | How to check                                      |
|----------------------------|---------------------------------------------------|
| Node 18+ on PATH           | `node --version`                                  |
| codex CLI on PATH          | `command -v codex`                                |
| codex authenticated        | `codex exec "say HOPPER_AUTH_OK"` should succeed  |
| bash (for Windows wrapper) | `git bash` or WSL                                 |

## Usage

```bash
hopper-codex <task-id> [--write] [--force] [--model <name>] [--reasoning <level>] [--sandbox <mode>]
```

Examples:

```bash
# Plain dispatch
hopper-codex T-PLUGIN-05a

# Dispatch + write output.md
hopper-codex T-PLUGIN-05a --write

# Overwrite existing output.md
hopper-codex T-PLUGIN-05a --write --force

# Force a specific model (honored by kimi/opencode/copilot/grok/mimo adapters)
hopper-codex T-PLUGIN-05a --write --model "deepseek/v4-flash"

# Force reasoning effort (honored by codex adapter)
hopper-codex T-PLUGIN-05a --write --reasoning xhigh

# Force vendor permission (default is danger-full-access unless task text says read-only)
hopper-codex T-PLUGIN-05a --write --sandbox read-only

# Combine
hopper-codex T-PLUGIN-05a --write --model "claude-opus-4-7" --reasoning high --sandbox danger-full-access
```

**`--model` accepts**: `^[A-Za-z][A-Za-z0-9._/:-]{0,99}$` (e.g. `gpt-5.5`, `claude-opus-4-7`, `deepseek/v4-flash`, `org/model:tag`). No spaces, no shell metachars.

**`--reasoning` accepts**: `minimal | low | medium | high | xhigh`. Adapters that don't honor reasoning ignore it harmlessly.

**`--sandbox` accepts**: `read-only | workspace-write | danger-full-access`. Default is `danger-full-access` unless the task brief/spec explicitly says `read-only` / `只读`.

## Environment variables

| Var                    | Default                              | Effect                                              |
|------------------------|--------------------------------------|-----------------------------------------------------|
| `HOPPER_PLUGIN_ROOT`   | wrapper-relative (3 levels up)       | Override plugin root                                |
| `HOPPER_DIR`           | walks up from cwd looking for .hopper| Override `.hopper/` location                        |
| `CODEX_REASONING`      | `medium`                              | Codex reasoning effort (`minimal` / `low` / `medium` / `high` / `xhigh`) |
| `CODEX_SANDBOX`        | `workspace-write`                    | Codex sandbox mode (`read-only` will block shell tool execution)         |

## What this adapter does NOT do

Per spec §3 #4 (no harness reaction core):

- No retry on dispatch failure (single-spawn invariant flows through codex → hopper-dispatch)
- No fallback to other hosts (Codex failed → try Claude Code is forbidden)
- No automatic queue.md / COST-LOG.md mutation (codex is instructed via prompt to ASK the user before applying suggested edits)
- No streaming output customization beyond what codex CLI provides
- No persistent state outside `.hopper/`

## Cross-host equivalence claim

The same `<task-id>` produces the same vendor invocation regardless of which supported host path invokes it (Tier A standalone, Tier B Claude Code, or any Tier C wrapper such as Codex CLI / OpenCode / Copilot CLI / Grok Build / Cursor CLI). Vendor selection comes from `.hopper/AGENTS.md`, not from the host. This is the **cross-host portable** claim, subject to the hard `host != vendor` rule.

Verification: dispatch `T-PLUGIN-05a` (a `code-impl` task whose AGENTS preference is `kimi`) via each supported host path; every path should resolve to `kimi`, and any same-identity host/vendor pairing should fail fast before adapter execution.

## Troubleshooting

| Symptom                                    | Likely cause                                          | Fix                                                          |
|--------------------------------------------|-------------------------------------------------------|--------------------------------------------------------------|
| `codex: command not found`                 | codex CLI not installed                                | Install: https://openai.com/codex/cli                        |
| `Error: hopper-dispatch not found`         | Plugin root path wrong                                 | Set `HOPPER_PLUGIN_ROOT` to the plugin repo root             |
| codex refuses to run shell tool            | sandbox set to read-only                              | Set `CODEX_SANDBOX=workspace-write`                         |
| Codex authenticates but dispatch hangs     | Vendor subprocess waiting                              | Adapter timeout fires; check vendor-specific config          |
| Task ID rejected                            | Contains invalid characters                            | Stick to `[A-Za-z0-9._-]`, start with letter, no `..`        |
