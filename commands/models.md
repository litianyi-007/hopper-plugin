---
description: Show cached vendor models (from `--probe`). Use this when you don't remember a specific model name before dispatching.
allowed-tools: Bash, Read
argument-hint: [vendor]
---

This command surfaces the per-vendor cached model list — what each vendor adapter actually has installed/configured on this machine. Use it when you don't know which `--model <name>` to pass to `/hopper:dispatch`.

## What this command does

1. Invokes `hopper-dispatch --models [<vendor>]`.
   - No argument: lists all vendors with cached entries.
   - One argument: filters to a single vendor.
2. Surfaces the output verbatim (vendor · introspection level · cached models · reasoning levels · staleness).
3. If the cache is empty or stale, recommends `/hopper:probe [<vendor>]` to refresh.
4. Once a specific `<model>` is picked, the pre-dispatch precheck is `hopper-dispatch --check-model <vendor> <model>` — a zero-spawn assertion (verified/catalog-only/not-found; distinct exit codes; `--json` for machine-readable output), not this listing command.

## Argument validation (BEFORE Bash)

`$ARGUMENTS` is either empty OR a single vendor name. If non-empty, validate it matches `^(codex|kimi|opencode|copilot|agy|grok|mimo|claude|pi)$`. Reject anything else. Do NOT splat unvalidated input.

## Invocation

```bash
# All vendors
node "$CLAUDE_PLUGIN_ROOT/cli/bin/hopper-dispatch" --models

# Single vendor (when validated <vendor> is present)
node "$CLAUDE_PLUGIN_ROOT/cli/bin/hopper-dispatch" --models "<vendor>"
```

Fallback if `$CLAUDE_PLUGIN_ROOT` is unset: see `/hopper:dispatch` for the standard fallback search.

## Output interpretation

The CLI prints one block per vendor:

```
<vendor> (<introspection-level>, <staleness>)
  - <model-id-1>
  - <model-id-2>
  reasoning: <level1> | <level2> | ...
```

- **introspection-level**: `full` (codex/opencode/mimo — live model commands), `partial` (kimi 0.14+ via `provider list --json`; copilot limited inspection), `config-only` (kimi fallback reads `~/.kimi-code/config.toml`), `none` (agy/grok — static).
- **staleness**: e.g. `6m ago`, `2d ago`. Older than ~14 days → adapter prints `[STALE]`; recommend `/hopper:probe <vendor>` to refresh.

## What to tell the user

Surface the raw output and then a short summary like:

> Codex has 6 models with 5 reasoning levels. Kimi reports configured aliases from `provider list --json` on 0.14+ or from config fallback. OpenCode has 13 models. MiMo reports configured models from `mimo models`. Copilot reports no model list (server-side per-tier). Agy is static (gemini-3.5-flash). Grok reads its live `grok models` output (e.g. `grok-4.6`) and falls back to the static knownGood baseline only if that spawn/parse fails. For dispatch, you can also **omit `--model`** entirely — each vendor has an implicit default.

If the user asked about a specific vendor, focus on that one's models + the "omit --model" alternative.

## What this command MUST NOT do

- Do NOT modify the cache (read-only). Use `/hopper:probe` to refresh.
- Do NOT dispatch (read-only).
- Do NOT splat unvalidated `$ARGUMENTS` into Bash.
