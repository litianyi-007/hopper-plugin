# Task-type: decision-review

Anchor: `.hopper/tasks/decision-review.md::root`

## Purpose

Adjudicate a decision the host is genuinely torn on. The host supplies the fork — the options, the constraints, what it has already ruled out and why — and this returns an independent ruling with reasoning. Its whole value is that the answering model does NOT share the host's context or priors, so a fork the host framed itself is exactly what it is for. Judgment only — no code, no edits, no new investigation of the codebase beyond what the brief supplies.

## Input shape

- The task spec section from `.hopper/handoffs/leader-tasklist.md` (matched by task ID)
- Acceptance criteria (prefer machine-checkable: a runnable command or grep per criterion)
- Positive scope (files allowed) and negative scope (files that must not change)
- Budget: time and vendor-cost ceiling

## Output shape (output.md)

The output should contain, in this order:

- **Summary**: what was delivered, in two to four sentences
- **Files touched**: paths with a one-line rationale each (or "none")
- **Acceptance verification (N/N)**: each criterion with evidence (command output, file:line, grep match)
- **Decisions / deviations**: judgment calls or scope changes (or "none")
- **Open questions**: list, or "none"
- **Verdict**: CHOOSE_<option-id> | NEITHER (state what you would do instead) | INSUFFICIENT_INPUT (name exactly what is missing)
- **Next recommendation**: what should happen next

## Notes

**Recommended execution profile**: high-reasoning; read-only sandbox REQUIRED; MUST be heterogeneous to the host — an independent ruling from the same model family is not independent — an abstract capability tier, not
a vendor name. Bind an actual vendor to this task-type in `.hopper/AGENTS.md`'s
task-vendor-preference table; match the profile to a vendor via `hopper-dispatch
--setup` (Sandbox/WebSrch columns) or `hopper-dispatch --capabilities <vendor>`.

This frame describes the SHAPE of the work and the expected output, not an
identity to adopt. The vendor CLI brings its own behavior; the frame only states
what the protocol expects back.
