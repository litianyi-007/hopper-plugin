---
name: hopper-models
description: "Use when the user asks Hopper which vendor models are available, wants cached model names, or needs model/reasoning options before dispatch."
---

# Hopper Models

Show Hopper's cached vendor model inventory. This is read-only and does not spawn vendor CLIs.

## Steps

1. Locate `hopper-dispatch` from `PATH` or the plugin root near this `SKILL.md`. No `.hopper/` project directory is required — `--models` reads the machine-local cache (`~/.hopper/cache/`) and runs from anywhere.
2. Accept either no argument or one vendor: `codex`, `kimi`, `opencode`, `copilot`, `agy`, `grok`, `mimo`, `claude`, or `pi`.
3. Run `hopper-dispatch --models` or `hopper-dispatch --models <vendor>`.
4. Surface the raw output, then briefly call out stale or missing cache entries.
5. If cache is empty or stale, suggest `hopper-dispatch --probe [vendor]` as the explicit refresh path.
6. Once the user has picked a specific `<model>`, the precheck before dispatching it is `hopper-dispatch --check-model <vendor> <model>` — a zero-spawn assertion (verified/catalog-only/not-found, distinct exit codes) rather than this listing command.

## Safety

- Do not dispatch a task from this skill.
- Do not refresh the cache unless the user asks; use `hopper-probe` for refreshes.
- Do not pass an unrecognized vendor to the shell.
