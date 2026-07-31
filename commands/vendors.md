---
description: List registered vendor adapters (codex, kimi, opencode, copilot, agy, grok, mimo, claude).
allowed-tools: Bash
---

This command runs inside a Claude Code session. It accepts no arguments.

Print the registered vendor adapters:

```bash
node "$CLAUDE_PLUGIN_ROOT/cli/bin/hopper-dispatch" --vendors
```

The dispatcher will print its own version banner and the registered adapter list. As of v0.39.0, 8 vendor adapters are registered: codex, kimi, opencode, copilot, agy, grok, mimo, claude. **`agy` is DISABLED by default** — its headless output is unsupported (agy 1.0.12 `--print` renders the answer only in its interactive TUI), so hopper refuses to dispatch to it; the `--vendors` output flags it, and `HOPPER_ENABLE_AGY=1` overrides at your own risk.

Note on the `claude` vendor: it spawns `claude -p` (Claude Code headless) and is meant for dispatch FROM another host (codex / opencode / grok / standalone); the host≠vendor rule blocks a Claude Code host from dispatching back to it. Billing for `claude -p` against a Claude plan changed repeatedly across 2026 (the 2026-06-15 separate-Agent-SDK-credit split was later rolled back) — the adapter is billing-agnostic; verify the current policy at anthropic.com if cost matters to you.

A failed task can show parser-designated recovered output when its provenance is known. It remains `failed`: `verified-complete` means the adapter observed a completion marker, while `unknown-completeness` is advisory and may be incomplete. Recovered output is not a successful dispatch or a reason to relax the task boundary.

If a vendor is missing from this list but referenced in `.hopper/AGENTS.md`, dispatch will fail with `Unknown vendor: <name>` — flag this to the user and suggest checking the vendor name spelling in AGENTS.md (vendor names are normalized: trailing `-cli` and `_cli` are stripped).
