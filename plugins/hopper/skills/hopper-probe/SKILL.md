---
name: hopper-probe
description: "Use when the user asks Hopper to refresh vendor capabilities, probe installed CLIs, update cached models, or diagnose model cache staleness."
---

# Hopper Probe

Probe is the explicit discovery surface. It may spawn vendor CLIs and writes the machine-local cache at `~/.hopper/cache/vendor-capabilities.json`.

## Steps

1. Locate `hopper-dispatch` from `PATH` or the plugin root near this `SKILL.md`. No `.hopper/` project directory is required — `--probe` writes the machine-local cache (`~/.hopper/cache/`) and runs from anywhere.
2. Accept either no argument or one vendor: `codex`, `kimi`, `opencode`, `copilot`, `agy`, `grok`, `mimo`, `claude`, or `pi`.
3. Run `hopper-dispatch --probe` or `hopper-dispatch --probe <vendor>`.
4. Surface each vendor result line, including introspection level, model count, duration, and any auth or missing-binary errors.
5. After a successful probe, use `hopper-dispatch --models [vendor]` when the user wants the detailed cached model list.

## Safety

- Do not dispatch a task from this skill.
- Do not auto-retry failed probes; the failure mode is diagnostic signal.
- Do not modify `.hopper/queue.md` or `.hopper/AGENTS.md`.
