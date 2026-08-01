# hopper-plugin host adapter: OpenCode (Tier C #2)

Anchor: `hosts/opencode/README.md::root`

> **Status (2026-05-20)**: Phase 4 functional. Either Tier C host (Codex CLI or OpenCode) satisfies spec §1 #2 cross-host architecture requirement.

## What this is

The OpenCode host adapter for [hopper-plugin](https://github.com/litianyi-007/hopper-plugin). OpenCode does not (as of v1.15.x) have a slash-command plugin system equivalent to Claude Code. Like the Codex CLI adapter, this is a **prompt wrapper** that uses OpenCode's `run` subcommand + built-in shell tool to invoke `hopper-dispatch`.

This is **Tier C #2** of the cross-host architecture (Tier C #1 is `hosts/codex-cli/`).

## How it works

`hopper-opencode` is a thin shell wrapper that:

1. Validates the task ID + flags against the **same** rules as Tier B Claude Code + Tier C #1 Codex CLI (regex `^[A-Za-z][A-Za-z0-9._-]{0,99}$`, no `..`, whitelist `{--write, --force}`)
2. Locates `cli/bin/hopper-dispatch` via `HOPPER_PLUGIN_ROOT` or wrapper-relative resolution (symlink-safe)
3. Builds an OpenCode prompt that instructs OpenCode to invoke `hopper-dispatch` via its shell tool
4. Runs `opencode run` once; opencode spawns hopper-dispatch once; hopper-dispatch spawns the vendor adapter once

Single-spawn invariant preserved at every level. No retries, no fallbacks, no soft-orchestration (spec §3 #4).

## Install

### Option A — symlink onto PATH

Linux / macOS:

```bash
ln -s /absolute/path/to/hopper-plugin/hosts/opencode/bin/hopper-opencode \
      ~/.local/bin/hopper-opencode
chmod +x /absolute/path/to/hopper-plugin/hosts/opencode/bin/hopper-opencode
```

Windows (PowerShell, admin):

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$HOME\bin\hopper-opencode.cmd" `
  -Target "F:\path\to\hopper-plugin\hosts\opencode\bin\hopper-opencode.cmd"
```

### Option B — invoke directly

```bash
/path/to/hopper-plugin/hosts/opencode/bin/hopper-opencode T-PLUGIN-05a --write
```

## Prerequisites

| Requirement                  | How to check                                          |
|------------------------------|-------------------------------------------------------|
| Node 18+ on PATH             | `node --version`                                      |
| opencode CLI on PATH         | `command -v opencode`                                 |
| opencode provider configured | `opencode run "say HOPPER_OPENCODE_OK"` should return |
| bash (Windows: WSL/git bash) | `bash --version`                                      |

## Usage

```bash
hopper-opencode <task-id> [--write] [--force] [--model <name>] [--reasoning <level>] [--sandbox <mode>]
```

Examples:

```bash
hopper-opencode T-PLUGIN-05a
hopper-opencode T-PLUGIN-05a --write
hopper-opencode T-PLUGIN-05a --write --force

# Force a specific model
hopper-opencode T-PLUGIN-05a --write --model "deepseek/v4-flash"

# Force reasoning effort (honored by codex adapter; others ignore)
hopper-opencode T-PLUGIN-05a --write --reasoning xhigh

# Force vendor permission
hopper-opencode T-PLUGIN-05a --write --sandbox danger-full-access

# Combine
hopper-opencode T-PLUGIN-05a --write --model "claude-opus-4-7" --reasoning high --sandbox danger-full-access
```

**`--model` accepts**: `^[A-Za-z][A-Za-z0-9._/:-]{0,99}$` (e.g. `gpt-5.5`, `claude-opus-4-7`, `deepseek/v4-flash`). No spaces, no shell metachars.

**`--reasoning` accepts**: `minimal | low | medium | high | xhigh`. Adapters that don't honor reasoning ignore it harmlessly.

**`--sandbox` accepts**: `read-only | workspace-write | danger-full-access`. Default is `danger-full-access` unless the task brief/spec explicitly says `read-only` / `只读`.

## Environment variables

| Var                  | Default                              | Effect                                                |
|----------------------|--------------------------------------|-------------------------------------------------------|
| `HOPPER_PLUGIN_ROOT` | wrapper-relative                     | Override plugin root                                  |
| `HOPPER_DIR`         | walks up from cwd for .hopper/       | Override `.hopper/` location                          |
| `OPENCODE_MODEL`     | (opencode default)                   | Override model (e.g. `deepseek-coder/v4-flash`)       |

## Cross-host equivalence claim

Identical to the Codex CLI host claim: dispatching the **same task-id** from any of Tier A standalone CLI, Tier B Claude Code, Tier C #1 Codex CLI, or Tier C #2 OpenCode produces the **same vendor invocation** of hopper-dispatch. Vendor selection comes from `.hopper/AGENTS.md`, not from the host.

Quick verification:

```bash
# Tier A
./cli/bin/hopper-dispatch --resolve T-PLUGIN-05a    # expect vendor: kimi

# Tier B (inside Claude Code session)
/hopper:dispatch T-PLUGIN-05a                       # codex tool-use → same dispatcher

# Tier C #1 (codex CLI)
./hosts/codex-cli/bin/hopper-codex T-PLUGIN-05a     # codex tool-use → same dispatcher

# Tier C #2 (opencode)
./hosts/opencode/bin/hopper-opencode T-PLUGIN-05a   # opencode tool-use → same dispatcher
```

All four routes should resolve to vendor `kimi` and spawn the kimi CLI subprocess.

## What this adapter does NOT do

Per spec §3 #4:

- No retry on dispatch failure
- No fallback to other hosts or vendors
- No automatic queue.md / COST-LOG.md mutation
- No prompt-level "helpful suggestions" that nudge the user toward retries or vendor-switches (soft orchestration)
- No persistent state outside `.hopper/`

## Troubleshooting

| Symptom                              | Likely cause                                  | Fix                                                          |
|--------------------------------------|-----------------------------------------------|--------------------------------------------------------------|
| `opencode: command not found`        | opencode CLI not installed                     | `npm i -g opencode-ai`                                       |
| `Error: hopper-dispatch not found`   | Plugin root path wrong                         | Set `HOPPER_PLUGIN_ROOT` to plugin repo root                 |
| opencode authenticates but no output | Provider auth missing                          | `opencode auth` to configure (e.g. deepseek, anthropic, ...)|
| Task ID rejected                      | Contains invalid chars or `..`                | Use `[A-Za-z0-9._-]`, start with letter, no `..`             |
| Hangs on first run                    | Provider download large (e.g. model load)     | Wait; adapter timeout will fire eventually                   |
