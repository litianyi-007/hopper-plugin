# hopper-plugin cookbook

Practical recipes for using hopper-plugin across hosts and vendors.

These examples assume:

- `hopper-dispatch` is on `PATH`, or you run `node /absolute/path/to/hopper-plugin/cli/bin/hopper-dispatch`.
- The current project has a `.hopper/` directory.
- You run `hopper-dispatch` from the project repo root (the dir that contains `.hopper/`), or you set `HOPPER_DIR`. The dispatched vendor CLI runs in that repo root regardless of your shell's CWD, so it always sees your project files — you never need to `cd` into the plugin directory.
- Task IDs such as `T-PROG-REVIEW` are examples. Replace them with a pending task from your own `.hopper/queue.md`.

## Recipe 1 - Dispatch to a specific vendor, model, and reasoning level

**Scenario**: Start a long review task and pass vendor-specific knobs.
**Hosts**: standalone, Claude Code, Codex CLI, OpenCode, Copilot CLI, Grok Build, Cursor CLI
**Vendors involved**: codex, kimi, opencode, copilot, mimo

### Steps

Check what the resolved vendor supports:

```bash
hopper-dispatch --resolve T-PROG-REVIEW
hopper-dispatch --capabilities codex
hopper-dispatch --capabilities kimi
```

Dispatch with codex reasoning effort when the task resolves to codex:

```bash
hopper-dispatch T-PROG-REVIEW --background --reasoning xhigh
hopper-dispatch --progress T-PROG-REVIEW
```

Dispatch with an explicitly selected OpenCode variant when the selected
provider/model documents that variant:

```bash
hopper-dispatch T-PROG-REVIEW --background --vendor opencode --reasoning high
# Hopper emits: opencode run ... --variant high
```

Dispatch with a model override for vendors that honor `--model`:

```bash
hopper-dispatch T-PROG-UI --background --model deepseek/v4-flash
hopper-dispatch T-PROG-KIMI --background --model kimi-code/kimi-for-coding
```

Expected output includes a runner PID and `.hopper/handoffs/<task-id>-output.md`.

### Notes

Vendor selection comes from `.hopper/AGENTS.md`, not from `--model`. `--reasoning` is honored by codex, mimo, grok, copilot, and pi; OpenCode maps an **explicitly supplied** value to its provider-specific `--variant`, but omits AGENTS/global defaults to protect arbitrary providers. `HOPPER_OPENCODE_VARIANT` has higher precedence and passes through verbatim. Kimi reasoning is config/provider driven in `kimi -p`; `--model` is honored by kimi, opencode, copilot, grok, mimo, claude, and pi. pi is the one vendor whose `--thinking` enum is a **superset** of hopper's five levels, so an `xhigh` request reaches it unclamped (grok and copilot clamp `xhigh`→`high`). OpenCode/provider validates variants, so tokenbox/DeepSeek support is unverified unless its provider documents it.

## Recipe 2 - Background dispatch and active progress checks

**Scenario**: Keep the host session responsive while you pull progress on demand.
**Hosts**: standalone, Claude Code, Codex CLI, OpenCode, Copilot CLI, Grok Build, Cursor CLI
**Vendors involved**: any configured vendor

### Steps

```bash
hopper-dispatch T-PROG-LONG --background
hopper-dispatch --progress T-PROG-LONG
hopper-dispatch --watch T-PROG-LONG
hopper-dispatch --result T-PROG-LONG
```

Expected `--progress` output shows frontmatter phase, elapsed time, last progress text, and recent progress events. `--watch` blocks until the background job reaches a terminal state.

### Notes

Use `--progress` for a snapshot. Use `--watch` when you want the terminal to follow the task until completion.

## Recipe 3 - Background dispatch and passive completion notifications

**Scenario**: Start a long job, stop polling, and let a terminal event wake you.
**Hosts**: Claude Code, standalone, Codex CLI, OpenCode wrapper, Copilot CLI, Grok Build, Cursor CLI
**Vendors involved**: any configured vendor

### Steps

In one terminal:

```bash
hopper-dispatch --watch-events
```

In another terminal:

```bash
hopper-dispatch T-PROG-LONG --background
```

For one-shot automation:

```bash
hopper-dispatch --watch-events --once
```

Expected event:

```json
{"type":"hopper.task.terminal","task_id":"T-PROG-LONG","status":"done","recovered_output":false,"recovered_output_state":"no-text","recovered_output_source":"none"}
```

### Notes

Claude Code loads `monitors/monitors.json` from the plugin root and forwards watcher stdout lines to the session. Standalone and Codex CLI paths can keep `--watch-events` running for stdout JSONL plus best-effort OS toast. Set `HOPPER_NOTIFY=0` to disable OS toast without disabling JSONL.

Terminal events expose only the closed recovered-output projection: `recovered_output`, `recovered_output_state`, and `recovered_output_source`. If a failed event has `recovered_output: true`, it remains failed; fetch parser-designated text and state-specific guidance with `hopper-dispatch --result <task-id> --full`. Do not use a raw log as a result source.

## Recipe 4 - Watch progress in the dashboard

**Scenario**: Use the browser dashboard for queue, log, progress timeline, and terminal event visibility.
**Hosts**: standalone, Claude Code, Codex CLI, OpenCode, Copilot CLI, Grok Build, Cursor CLI
**Vendors involved**: any configured vendor

### Steps

```bash
npm run dashboard:build
npm run dashboard:start
```

Open:

```text
http://127.0.0.1:7777
```

Start a job:

```bash
hopper-dispatch T-PROG-DASHBOARD --background
```

In the dashboard, open the task drawer and select the Progress tab.

### Notes

The dashboard is a read-only consumer for queue, task, log, and progress data. Vendor probe actions are explicit button actions and are guarded by a server-side vendor allowlist.

## Recipe 5 - Cross-host equivalent dispatch

**Scenario**: Prove that host choice does not change vendor routing.
**Hosts**: Claude Code, Codex CLI, OpenCode, Copilot CLI, Grok Build, Cursor CLI, standalone
**Vendors involved**: any configured vendor

### Steps

Standalone:

```bash
hopper-dispatch --resolve T-PROG-REVIEW
hopper-dispatch T-PROG-REVIEW --background
```

Claude Code:

```text
/hopper:dispatch T-PROG-REVIEW --background
```

Codex CLI wrapper:

```bash
hopper-codex T-PROG-REVIEW --background
```

OpenCode wrapper:

```bash
hopper-opencode T-PROG-REVIEW --background
```

### Notes

Every route eventually invokes the same dispatcher and reads the same `.hopper/AGENTS.md`. The dispatcher now enforces `host != vendor`, so a host session cannot dispatch back into the same vendor identity. Do not use multiple routes to dispatch the same task simultaneously; background dispatch refuses alive duplicate jobs.

### OpenCode execution boundary and operator evidence

Tests use fake binaries and temporary directories; they do not make an external OpenCode session a source of attestation evidence. The native plugin is a disabled shim, and the wrapper is the only repo-owned route. That wrapper dispatches through hopper and does not run `git snapshot`, `git worktree`, or `git checkout`.

If an operator invokes an external OpenCode layer, record the command, CWD, and observed writes. A user-level snapshot side effect, including an observed `index.lock` attempt, is not handoff, cache, attestation status, or model evidence. It must not be copied into those records as proof of a model invocation.

The current native plugin route remains disabled. A future isolated route requires a separate design with an exact temporary root and a cleanup fixture before it can be enabled. This boundary does not promise strict no-write behavior from an external tool unless that behavior has been observed; it only records what the repo-owned route does and how to treat external observations.

## Recipe 6 - Probe vendor capabilities and query the cache

**Scenario**: Refresh per-machine model inventory before choosing a model override.
**Hosts**: standalone, Claude Code through slash commands
**Vendors involved**: codex, kimi, opencode, copilot, agy, grok, mimo, claude, pi

### Steps

Zero-spawn static capability lookup:

```bash
hopper-dispatch --capabilities codex
hopper-dispatch --capabilities opencode
```

Live probe for one vendor:

```bash
hopper-dispatch --probe codex
hopper-dispatch --models codex
```

Live probe for all vendors:

```bash
hopper-dispatch --probe
hopper-dispatch --models
```

Claude Code equivalents:

```text
/hopper:probe codex
/hopper:models codex
```

### Notes

`--probe` is the explicit discovery surface that may spawn vendor CLIs. `--models` reads the cache only. Model availability is account- and machine-dependent.

## Recipe 7 - Clean up stale background jobs

**Scenario**: A machine reboot or killed process left a task in `in-progress`.
**Hosts**: standalone, Claude Code through shell
**Vendors involved**: any configured vendor

### Steps

```bash
hopper-dispatch --jobs
hopper-dispatch --reap
hopper-dispatch --jobs
```

Inspect one reaped task:

```bash
hopper-dispatch --progress T-PROG-STALE
hopper-dispatch --result T-PROG-STALE
```

### Notes

`--reap` classifies stale or dead-PID jobs as `orphaned` and writes a terminal event once. Re-running it should not append duplicate terminal events for the same task.

## Recipe 8 - Multi-vendor adversarial review

**Scenario**: Ask two vendors to review the same spec from different angles, then compare their handoff files.
**Hosts**: standalone, Claude Code
**Vendors involved**: codex, kimi, opencode, copilot, agy, grok, mimo, claude, pi

### Steps

Create two queue rows that point at the same spec but have different task IDs and preferred vendors in `.hopper/AGENTS.md`, for example:

```text
T-REVIEW-CODEX
T-REVIEW-KIMI
```

Dispatch both:

```bash
hopper-dispatch T-REVIEW-CODEX --background --reasoning xhigh
hopper-dispatch T-REVIEW-KIMI --background --model kimi-thinking
hopper-dispatch --watch-events --once
```

Compare results:

```bash
hopper-dispatch --result T-REVIEW-CODEX
hopper-dispatch --result T-REVIEW-KIMI
```

### Notes

Keep each review as a separate task ID. hopper-plugin does not fan out a single queue row to multiple vendors automatically; the file protocol makes the fan-out explicit and auditable.

## Recipe 9 - Pre-flight a dispatch and troubleshoot a failure

**Scenario**: A dispatch failed, or you want to avoid the failure chain from the 2026-06-04 field retrospective (vendor spawned in the wrong directory → couldn't see project files → 180s timeout → operator forced into calling vendor CLIs by hand).
**Hosts**: standalone, Claude Code, Codex CLI, OpenCode, Copilot CLI, Grok Build, Cursor CLI
**Vendors involved**: any configured vendor

### Steps

Four pre-flight checks before dispatching — each is read-only and spawns no vendor:

```bash
# 1. Will the task resolve? (found in queue.md + vendor from AGENTS.md + composed prompt length)
hopper-dispatch --resolve T-PROG-REVIEW

# 2. Is the resolved vendor installed + authenticated on THIS machine?
hopper-dispatch --check codex

# 3. Confirm you are in the right project (vendor will run in the repo root that owns .hopper/).
hopper-dispatch --status

# 4. Passing an explicit --model? Assert it BEFORE spending a real dispatch on it —
#    verified (exit 0) | catalog-only (exit 2, listed but unverified) | not-found (exit 1).
hopper-dispatch --check-model codex gpt-5.5
```

For a background dispatch already in flight, get woken on completion instead of polling:

```bash
hopper-dispatch --watch-events          # stream terminal events as stdout JSONL
hopper-dispatch --watch-events --once   # exit after the first terminal event (CI / scripts)
```

Claude Code users get this automatically: the bundled monitor (`monitors/monitors.json`) runs `--watch-events` and surfaces each terminal event into the session.

### Notes

- `--resolve` / `--check` / `--status` / `--capabilities` / `--models` / `--check-model` are all **zero-spawn** read-only commands. Use them freely to confirm routing *before* committing a real dispatch — this is the `--dry-run` workflow.
- If `--result` shows `Status: failed` alongside recovered output, the task is still failed. Read only its parser-designated content with `hopper-dispatch --result <task-id> --full`; `verified-complete` has a parser terminal marker but still requires a manual decision, while `unknown-completeness` is advisory and needs independent verification. If it is `no-text`, use the public diagnostic and create a separate task explicitly if needed. Never derive findings from the protected raw `.log`.
- The dispatched vendor is anchored to the repo root that owns `.hopper/` (retro #3 fix). You never need to `cd` into the plugin's CLI directory; run from your project or set `HOPPER_DIR=/path/to/project/.hopper`.
- Real dispatch defaults to `--sandbox danger-full-access` for the vendor so implementation tasks can modify files. Hopper automatically uses `read-only` only when the queue brief or detailed task spec explicitly says `read-only` / `只读`; pass `--sandbox <mode>` to override for a single dispatch.
- **Vendor needs to read a path OUTSIDE the repo** (external test evidence, a sibling repo)? The vendor's own sandbox enforces this — e.g. opencode's `external_directory` permission defaults to `ask` and is denied in headless mode. Two ways to handle it without disabling the vendor's permission model:
  1. **Widen the vendor working dir**: `HOPPER_VENDOR_CWD=/path/to/common-ancestor hopper-dispatch <task> --background`. hopper runs the vendor there (opencode receives it via `--dir`), so a subtree that contains both your project and the external path is reachable.
  2. **Authorize in the vendor**: for opencode, add an `opencode.json` rule, e.g. `{"permission": {"external_directory": {"~/path/to/evidence/**": "allow"}}}`.
  3. Or (simplest, most auditable) copy the evidence into the repo so it lives under the default working dir.
- If `hopper-dispatch` itself is not found from Claude Code, `$CLAUDE_PLUGIN_ROOT` may be unset or wrong — see `commands/dispatch.md` Mode C for a resolver that validates the path before using it.
