# hopper-plugin host adapter: Grok Build (Tier C #4)

Anchor: `hosts/grok-cli/README.md::root`

## What this is

The Grok Build host adapter for `hopper-plugin`. It is a thin prompt wrapper that uses the outer `grok` CLI to invoke the host-agnostic `cli/bin/hopper-dispatch`.

## How it works

`hopper-grok`:

1. Validates task-id and flags with the same rules used by the other host adapters
2. Locates `cli/bin/hopper-dispatch`
3. Exports `HOPPER_HOST_VENDOR=grok`
4. Runs `grok -p ... --always-approve` exactly once so Grok uses its tools to run the dispatcher

The dispatcher enforces the product rule `host != vendor`. A Grok host session cannot dispatch back to the `grok` vendor.

## Install

Linux / macOS:

```bash
ln -s /absolute/path/to/hopper-plugin/hosts/grok-cli/bin/hopper-grok \
      ~/.local/bin/hopper-grok
chmod +x /absolute/path/to/hopper-plugin/hosts/grok-cli/bin/hopper-grok
```

Windows (PowerShell, admin):

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$HOME\bin\hopper-grok.cmd" `
  -Target "F:\path\to\hopper-plugin\hosts\grok-cli\bin\hopper-grok.cmd"
```

## Prerequisites

| Requirement | How to check |
|---|---|
| Node 18+ on PATH | `node --version` |
| Grok CLI on PATH | `command -v grok` |
| Grok launcher context | `hopper-dispatch --check grok` (zero-spawn, non-secret context only; it is not proof of remote authentication) |
| bash on Windows | `bash --version` |

`hopper-dispatch --check grok` reports `auth_context` as `key-present-unverified`,
`credential-artifact-present-unverified`, `not-detected`, or `unknown`. It reads
only the Hopper Node parent's local environment/credential-artifact presence; it
does not validate a credential remotely. Interactive or browser login state in
another session may not be inherited by that Node parent. Do not treat `READY`
or an `auth_context` value as a login verdict; a successful dispatch is the only
runtime evidence for that separate question.

The outer host model defaults to `grok-4.6`. Set `GROK_HOST_MODEL` to an explicit
alternative only when the installed Grok Build CLI supports it; the wrapper passes
that value through as `-m <model>`.

## Usage

```bash
hopper-grok <task-id> [--write] [--force] [--background] [--model <name>] [--reasoning <level>] [--sandbox <mode>]
```

`--sandbox` accepts `read-only | workspace-write | danger-full-access`. Default is `danger-full-access` unless the task brief/spec explicitly says `read-only` / `只读`.

## Cross-host note

This is another Tier C host path. Vendor routing still comes from `.hopper/AGENTS.md`, not from the host wrapper. The same task-id should resolve the same vendor across hosts, subject to the hard rule that `host != vendor`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `grok: command not found` | Grok Build not installed | Install Grok Build CLI |
| `Error: hopper-dispatch not found` | Wrong plugin root | Set `HOPPER_PLUGIN_ROOT` |
| `host != vendor` rejection | `.hopper/AGENTS.md` resolved to `grok` | Change vendor binding or invoke from a different host |
