# Task-type: prd-research

Anchor: `.hopper/tasks/prd-research.md::root`

## Purpose

Research a product requirement / feature need using web search — synthesize findings, prior art, comparable products, and open questions into PRD input. Research only — no code, no edits.

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

**Recommended execution profile**: web-search REQUIRED; medium-high reasoning — an abstract capability tier, not
a vendor name. Bind an actual vendor to this task-type in `.hopper/AGENTS.md`'s
task-vendor-preference table; match the profile to a vendor via `hopper-dispatch
--setup` (Sandbox/WebSrch columns) or `hopper-dispatch --capabilities <vendor>`.

This frame describes the SHAPE of the work and the expected output, not an
identity to adopt. The vendor CLI brings its own behavior; the frame only states
what the protocol expects back.
