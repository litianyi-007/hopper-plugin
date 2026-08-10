---
description: Refresh the per-machine vendor capability cache by live-querying each vendor CLI. Run when models change or cache shows `[STALE]`.
allowed-tools: Bash, Read
argument-hint: [vendor]
---

This command runs the Phase 6b probe — actually invokes each vendor's CLI to enumerate installed models + reasoning levels — and writes the results to `~/.hopper/cache/vendor-capabilities.json`. Use it when `/hopper:models` shows stale data or when you've added/removed a vendor model.

## What this command does

1. Invokes `hopper-dispatch --probe [<vendor>]`.
   - No argument: probes every registered vendor (~14 subprocesses total when Kimi, MiMo and pi are installed: codex 2 + kimi 2 + opencode 3 + copilot 1 + mimo 3 + pi 3 (`--version`, `--list-models`, one `auth check` per authenticated provider, capped at 4); agy and grok are zero-spawn).
   - One argument: probes a single vendor.
2. Updates `~/.hopper/cache/vendor-capabilities.json` (atomic write + O_EXCL lock per Phase 6b F2).
3. Surfaces the per-vendor result line (introspection level · model count · duration).

## Why this exists separately from dispatch

Probe is the **only** discovery surface that spawns vendor subprocesses. Per spec §3 #4 (no-harness-core) and §14.6 (single-spawn carve-out), regular dispatch + `--check` + `--capabilities` are all zero-spawn; probe is the explicit opt-in. Don't run it on every dispatch — once a session is usually enough.

## Argument validation (BEFORE Bash)

`$ARGUMENTS` is either empty OR a single vendor name. Validate against `^(codex|kimi|opencode|copilot|agy|grok|mimo|claude|pi)$` if non-empty. Reject anything else.

## Invocation

```bash
# Probe all vendors
node "$CLAUDE_PLUGIN_ROOT/cli/bin/hopper-dispatch" --probe

# Probe one vendor
node "$CLAUDE_PLUGIN_ROOT/cli/bin/hopper-dispatch" --probe "<vendor>"
```

Fallback if `$CLAUDE_PLUGIN_ROOT` is unset: see `/hopper:dispatch` for the standard fallback search.

## After probe completes

- Tell the user how many models per vendor were discovered (e.g. "Codex: 6 models, Kimi: 1 configured alias via provider JSON, OpenCode: 13 models, MiMo: 7 models, Copilot: 0 (server-side per-tier), Agy: 1 static").
- If any vendor reported errors (auth-fail, timeout, missing binary), surface them — the user may need to install / OAuth-login that vendor.
- Suggest `/hopper:models <vendor>` for the detailed model list.

## What this command MUST NOT do

- Do NOT dispatch (probe is discovery-only).
- Do NOT modify `.hopper/queue.md` or `.hopper/AGENTS.md` (read-only at the protocol level; probe only writes to the global cache).
- Do NOT splat unvalidated `$ARGUMENTS` into Bash.
- Do NOT auto-retry on probe failure for a single vendor — the failure mode (auth-fail, command-not-found) is the diagnostic signal.
