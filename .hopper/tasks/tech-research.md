# Task-type: tech-research

Anchor: `.hopper/tasks/tech-research.md::root`

## Purpose

Evaluate implementation approaches for a stated technical problem using web search — compare candidate libraries, patterns or architectures on the criteria the brief names, and return a recommendation with the trade-offs made explicit. Distinct from `prd-research` (what should we build) and from `decision-review` (rule on a fork I have already framed): this one surveys the option space first. Research only — no code, no edits.

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
- **Verdict**: PASS | PASS_WITH_CHANGES | REWORK
- **Next recommendation**: what should happen next

## Notes

**Recommended execution profile**: web-search REQUIRED; high reasoning (trade-off analysis, not retrieval) — an abstract capability tier, not
a vendor name. Bind an actual vendor to this task-type in `.hopper/AGENTS.md`'s
task-vendor-preference table; match the profile to a vendor via `hopper-dispatch
--setup` (Sandbox/WebSrch columns) or `hopper-dispatch --capabilities <vendor>`.

This frame describes the SHAPE of the work and the expected output, not an
identity to adopt. The vendor CLI brings its own behavior; the frame only states
what the protocol expects back.
