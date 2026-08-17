---
name: hopper
description: "Use when the user asks to operate Hopper or llm-hopper broadly, troubleshoot Hopper's file-backed .hopper protocol, or choose among Hopper dispatch, status, progress, result, probe, models, vendors, setup/doctor (vendor readiness), and smoke workflows."
---

# Hopper

Use Hopper as a thin, file-backed dispatcher. State lives in the target project's `.hopper/` directory. The dispatcher must not add hidden state, retry a failed vendor automatically, or switch vendors unless the user explicitly asks for that separate action.

## Should This Be Dispatched At All

Answer this before any of the mechanics below. **Hopper is accountable for a result; it is not a place to run a process you need to steer.**

1. **Could you compute the one correct answer yourself?** If yes — do it yourself. Source summaries, commit logs, file searches and version lookups are determinate queries; a dispatch costs minutes and dollars to return a *less* reliable answer. (Measured on one machine: a review dispatch ran 5m16s / 1.53M tokens / $0.74, against 40ms for the `git log` it was being compared to.)
2. **Can you state the whole question right now?** If no — it is exploratory, and exploration needs steering a single-spawn, no-retry dispatch cannot give you. A follow-up is a *new* dispatch.

Both pass → the deciding question is **whether independence is the point**: is the value in an answer that does not share your context, priors and mistakes?

The discriminator is the deliverable, not the topic. A code review *reads source* — that is its method; its deliverable is a judgment, so dispatch it. "Tell me what this module does" also reads source, but hands back data you can produce directly, so do not.

**There is no task-type for the "do not" cases, and that absence is the enforcement** — nothing has to guess at a brief's intent. If a request has no matching task-type, that is the answer, not a gap to work around. Full rationale: `docs/WHEN-TO-USE.md` in the hopper repository; `hopper-dispatch --task-types` prints the same for/not-for note per type.

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
