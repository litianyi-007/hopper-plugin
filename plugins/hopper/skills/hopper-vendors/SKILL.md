---
name: hopper-vendors
description: "Use when the user asks Hopper to list registered vendor adapters, confirm supported vendors, or check vendor naming."
---

# Hopper Vendors

List Hopper's registered vendor adapters.

## Steps

1. Locate `hopper-dispatch` from `PATH` or the plugin root near this `SKILL.md`. No `.hopper/` project directory is required — `--vendors` lists the static adapter registry and runs from anywhere.
2. Run `hopper-dispatch --vendors`.
3. Surface the registered adapter list. Registered adapters: `codex`, `kimi`, `opencode`, `copilot`, `agy`, `grok`, `mimo`, `claude`, and `pi`. Note: **`agy` is DISABLED by default** — its headless output is unsupported (agy 1.0.12 `--print` is TUI-only), so hopper refuses to dispatch to it; the `--vendors` output flags it and `HOPPER_ENABLE_AGY=1` overrides. Note: the `claude` vendor spawns `claude -p`, and the host≠vendor rule blocks a Claude Code host from dispatching to it (use it from another host). It is billing-agnostic — the `claude -p` plan-billing policy changed repeatedly across 2026, so verify current policy at anthropic.com if cost matters.
4. If `.hopper/AGENTS.md` references a missing vendor, flag the spelling mismatch; Hopper normalizes trailing `-cli` and `_cli`.

## Safety

- Do not probe vendors here; use `hopper-probe` for live capability refresh.
- Do not edit `.hopper/AGENTS.md` unless the user explicitly asks.
