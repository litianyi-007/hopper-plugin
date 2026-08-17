---
name: hopper-dispatch
description: "Use when the user asks Hopper to dispatch, run, start, resolve, or preflight one .hopper queue task through hopper-dispatch."
---

# Hopper Dispatch

Dispatch exactly one Hopper task unless the user explicitly provides multiple task IDs.

## Before dispatching: is this a dispatch at all

**Hopper is accountable for a result; it is not a place to run a process you need to steer.** Two questions, both must pass:

1. **Could you compute the one correct answer yourself?** If yes, do it yourself — a determinate query (source summary, commit log, version lookup) costs minutes and dollars through a dispatch and comes back less reliable.
2. **Can you state the whole question now?** If no, it is exploratory; a single-spawn, no-retry dispatch gives you no way to steer, and a follow-up is a whole new dispatch.

Then: **is independence the point** — is the value in an answer that does not share your context and priors?

Judge by the DELIVERABLE, not the topic: a review reads source as its *method* and returns a judgment (dispatch); "summarize this module" reads source and returns *data* (do it yourself). A request with no matching task-type is answered by that absence — see `docs/WHEN-TO-USE.md`, or `hopper-dispatch --task-types` for the per-type for/not-for note.

## Steps

1. Locate the target project root: use the current directory when it contains `.hopper/`; otherwise walk upward. If no `.hopper/` exists, ask for the project root or `HOPPER_DIR`.
2. Locate the CLI: prefer `hopper-dispatch` on `PATH`; otherwise search upward from this `SKILL.md` for `cli/bin/hopper-dispatch` and run it with `node`.
3. Validate the task ID before shelling out: `^[A-Za-z][A-Za-z0-9._-]{0,99}$`. Reject `/`, `\`, `..`, shell metacharacters, quotes, whitespace, and newlines.
4. Validate optional flags only from this set: `--background`, `--write`, `--force`, `--model <name>`, `--reasoning <minimal|low|medium|high|xhigh>`, `--sandbox <read-only|workspace-write|danger-full-access>`, `--subject-root <absolute-path>`, `--resolve <task-id>`, `--check [<vendor>]`, `--capabilities <vendor>`, `--stop <task-id>`, `--init-tasks`.
   - For an OpenCode vendor, an explicitly requested `--reasoning <level>` is forwarded as `opencode run --variant <level>`. Do not infer provider support: Hopper omits policy/default reasoning for OpenCode, and `HOPPER_OPENCODE_VARIANT=<value>` is the higher-precedence raw provider override.
5. For a macOS read-only research or review dispatch, require a narrow absolute path to the project being examined and append `--subject-root <absolute-path>`. This enables Hopper's process-level no-write guard for that subject tree. If a narrow root is unavailable, do not claim that protection; the compatible no-root behavior remains available.
6. For long-running tasks, prefer `--background`; for a dry routing check (no spawn), use `--resolve <task-id>`. `--check [<vendor>]` is a DIFFERENT command — it shows install/auth status for a vendor CLI (all vendors if omitted), not a task's routing; do not use it as a task-id preflight. To stop a running background job, use `--stop <task-id>` (kills the process tree and marks the task `cancelled`). To bootstrap a new project, run `--init-tasks` (scaffolds `.hopper/` in the current directory; add `--force` to overwrite an existing one).
7. Surface the dispatcher output, including vendor, status, duration, output paths, stderr, and any failure context. If `--resolve` reports that the resolved vendor is not a registered adapter, fix the `Vendor` column / AGENTS.md preference (or move a model name to `--model`) before dispatching.
8. `--vendor <name>` overrides the routed vendor for a REAL dispatch (sync, `--background`, `--adhoc`, `--swarm`) — it is validated against the registered adapters, the project's Approved Vendors table (`.hopper/AGENTS.md`), and the host/vendor family-separation guard still applies (see `cli/src/validation.js`'s `VENDOR_FAMILY`, not a literal string-equality check). **`--resolve` also applies `--vendor`**: `--resolve <task-id> --vendor <v>` previews the override under the identical Approved Vendors + registered-adapter + host/vendor-family checks a real dispatch would run — no spawn either way (fixed; formerly [`resolve-ignores-vendor-override`](../../docs/archive/ISSUES.md#resolve-ignores-vendor-override), now closed).

## Safety

- Do not modify `.hopper/queue.md`, `.hopper/AGENTS.md`, or `.hopper/COST-LOG.md` unless the user explicitly asks for those edits.
- Do not retry, fall back to another vendor, or reroute after a failure unless the user asks for a separate follow-up action.
- Do not pass unvalidated user text into the shell.
- `--subject-root` requires Hopper's effective `read-only` sandbox. During guarded execution it protects writes within that tree, including new hard-link creation using subject paths; it cannot revoke a hard link that existed before the guard, so a known external alias may still mutate the same inode through allowed outside writes. It is not a confidentiality boundary and does not block reads, network/IPC, or writes outside the subject root.
- Kimi `-p` has no permission/sandbox argv. Hopper must refuse an effective Kimi read-only task before spawn; do not suggest `--write` as a bypass — it only writes Hopper's synchronous `output.md` artifact and never changes Kimi permissions. A non-read-only sandbox is a separate, unverified-permission decision and is incompatible with a read-only lane. The macOS subject-root guard is not a current Kimi exception because Kimi is rejected before any guarded vendor process starts.
