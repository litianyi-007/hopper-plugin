---
description: Directed product/feature research — dispatch a one-off web-search-backed research task (no queue.md row), then surface the full brief.
allowed-tools: Bash, Read
argument-hint: <question> [--vendor <name>]
---

One-shot product-requirement research via hopper's **ad-hoc** dispatch (no `queue.md` row). The `prd-research` task-type auto-enables **web search** and *requests* a **read-only** sandbox, and routes to **codex** (the only high-confidence headless web-search vendor) unless `--vendor` overrides. That read-only request is an instruction carried by the executor prompt frame — **not unconditionally an OS-enforced boundary**: on macOS/Linux codex (the default) now honors it via its own `-s read-only` sandbox (verified: a write attempt fails with `operation not permitted`); on **Windows** codex's `-s` sandbox cannot spawn child processes at all, so it always runs full-access there via `--dangerously-bypass-approvals-and-sandbox` (a deliberate workaround), regardless of the requested mode.

## What this does
1. Build a research brief from `$ARGUMENTS`.
2. Dispatch a one-off `prd-research` task via `hopper-dispatch --adhoc`.
3. Surface the **full** brief with `--result <id> --full` (research output is long — always use `--full`).

## Steps
1. Parse `$ARGUMENTS`: the leading text is the research QUESTION. Optional `--vendor <name>` overrides the vendor (validate it is a lowercase registered vendor).
2. Compose a focused brief: the question + "use web search; synthesize findings, prior art, comparable products/features, risks, and open questions into PRD input; cite sources; research only — no code, no edits."
3. Pick a short id matching `^[A-Za-z][A-Za-z0-9._-]{0,99}$`, e.g. `research-<8-char-slug>`.
4. Resolve the binary as in `/hopper:dispatch`, then dispatch in the background (Bash tool with `run_in_background: true`):

```bash
node "$HOPPER_BIN" --adhoc --task-type prd-research --brief "<composed brief>" --id "<id>" --background
# add --vendor <name> to override (default = codex; web search auto-enabled by the task-type)
```

5. Poll, then surface the FULL result (a preview would truncate the brief):

```bash
node "$HOPPER_BIN" --result "<id>" --full
```

Surface verbatim.

## Notes
- Only **codex** is wired for headless web search today. A dispatch with `--vendor X` (non-codex) still runs, but the vendor may not actually search — prefer the default (codex) until other vendors are smoke-verified.
- For market sizing / competitor landscape, use `/hopper:market`.

## MUST NOT
- Do NOT re-dispatch on failure (single-spawn).
- Do NOT edit the repo or `queue.md` yourself — this command only researches (the task-type *requests* read-only from the dispatched vendor; see the caveat above, it is not enforced for every vendor).
- Do NOT splat unvalidated `$ARGUMENTS`; build + quote the brief.
