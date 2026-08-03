---
name: hopper
description: "Use when the user asks to operate Hopper or llm-hopper broadly, troubleshoot Hopper's file-backed .hopper protocol, or choose among Hopper dispatch, status, progress, result, probe, models, vendors, setup/doctor (vendor readiness), and smoke workflows."
---

# Hopper

Use Hopper as a thin, file-backed dispatcher. State lives in the target project's `.hopper/` directory. The dispatcher must not add hidden state, retry a failed vendor automatically, or switch vendors unless the user explicitly asks for that separate action.

## First Run And After An Upgrade

Run this check before anything else in a session — it decides which of the two situations below applies, and both are silent otherwise (no `.hopper/` prompts for a path; a pre-v0.40.0 project fails dispatch with an opaque error unless you know to look here).

1. **No `.hopper/` found in cwd or any ancestor** — this is a first run, not a missing-argument error. Run `hopper-dispatch --init-tasks` from the intended project root to scaffold a full workspace (queue.md, AGENTS.md, DISPATCH.md, task frames). Only fall back to asking the user for the project root or `HOPPER_DIR` when the project genuinely lives somewhere `--init-tasks` should not run from cwd (e.g. a monorepo subdir vs. the repo root) — `HOPPER_DIR` is the second choice, not the first.
2. **`.hopper/` exists but `.hopper/AGENTS.md` has no `## Approved Vendors` section** — this is a pre-v0.40.0 project that predates the vendor whitelist gate; every dispatch (including an explicit `--vendor` override) will be refused with `E_APPROVED_VENDORS_SECTION_MISSING`. Point the user at the repository's `MIGRATION.md` for the fix. Deciding which vendors to approve is a security-relevant whitelist decision — Safety Rules below already forbids editing `.hopper/AGENTS.md` without the user explicitly asking for that edit, and this case is no exception: **ask the user which vendors to approve, then make the edit they confirm.** Do not guess a vendor list and do not silently skip the task waiting on this — surface the blocker.
3. **Not sure what's installed/authenticated on this machine vs. what this project allows** — these are two different layers and both must pass before a dispatch works: `hopper-dispatch --setup` (alias `--doctor`) reports what vendor CLIs are installed/authenticated on THIS MACHINE; `.hopper/AGENTS.md`'s `## Approved Vendors` table reports what THIS PROJECT allows dispatching to. A vendor can be fully installed and authenticated and still be refused if it is not `yes` in Approved Vendors, and a vendor can be listed `yes` in Approved Vendors and still fail if it is not installed/authenticated locally.

## Locate The Target

1. Use the current working directory when it contains `.hopper/`.
2. Otherwise walk upward to the nearest directory containing `.hopper/`.
3. If no `.hopper/` exists: see "First Run And After An Upgrade" above — prefer `hopper-dispatch --init-tasks`; ask the user for the project root or `HOPPER_DIR` only when the project lives somewhere `--init-tasks` should not run from cwd.
4. Run commands from the project root, or set `HOPPER_DIR` to the target `.hopper` path.

## Locate The CLI

Prefer `hopper-dispatch` on `PATH`. If it is not available, resolve the loaded `SKILL.md` path and search upward for `cli/bin/hopper-dispatch`. Marketplace installs should have the CLI two directories above the skill file:

```powershell
node <plugin-root>\cli\bin\hopper-dispatch <args>
```

When working inside the source repository, `node .\cli\bin\hopper-dispatch <args>` is also valid.

## Commands

- Queue status: `hopper-dispatch --status`
- Resolve a task without dispatching: `hopper-dispatch --resolve <task-id>`
- Dispatch one task: `hopper-dispatch <task-id> --background`
- Snapshot progress: `hopper-dispatch --progress <task-id>`
- Watch a task until terminal state: `hopper-dispatch --watch <task-id>`
- Read final output and log tail: `hopper-dispatch --result <task-id>`
- Watch terminal events: `hopper-dispatch --watch-events`
- Probe vendor capabilities: `hopper-dispatch --probe <vendor>`
- Read cached models: `hopper-dispatch --models <vendor>`
- Assert a model before dispatching: `hopper-dispatch --check-model <vendor> <model>` (verified/catalog-only/not-found; add `--json` for machine-readable output)
- List vendors: `hopper-dispatch --vendors`
- Vendor readiness (doctor): `hopper-dispatch --setup` (alias `--doctor`; add `--deep` for flag + model-catalog drift)
- Smoke check: `hopper-dispatch --smoke`

Diagnostics that read only the adapter registry — `--vendors`, `--rules`, `--setup`/`--doctor`, `--capabilities`, `--check-model`, `--probe`, `--models`, `--smoke` — do NOT need a `.hopper/` directory and run from anywhere. The project-context steps above apply to dispatch/status/result/progress, which operate on `.hopper/`.

## Safety Rules

- Validate task IDs before shelling out: `^[A-Za-z][A-Za-z0-9._-]{0,99}$`.
- Dispatch only one task per user request unless the user explicitly asks for multiple task IDs.
- Do not modify `.hopper/queue.md`, `.hopper/AGENTS.md`, or `.hopper/COST-LOG.md` unless the user explicitly asks for those file edits.
- Do not auto-retry, auto-fallback, or silently reroute on failure. Surface the dispatcher status, stderr, and output paths.
- For long tasks, prefer `--background`, then use `--progress`, `--watch`, `--watch-events`, or `--result`.
