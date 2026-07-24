# ISSUE: grok adapter false-fails successful runs — pretty-printed multi-line JSON envelope behind runner log lines defeats extractGrokText (adapter-protocol-invalid)

> Reporter: Kimi Work orchestration session (hawk-clawhive project), dispatching adversarial review tasks to opencode/grok
> Date: 2026-07-24
> Severity: medium-high — the vendor actually COMPLETES the task (deliverable written), but hopper records `failed` / `adapter-protocol-invalid`, blocking downstream orchestration that gates on task status
> Env: Windows; grok CLI (`grok-4.5`); hopper-dispatch `0.35.1`; CLI = `<hopper>/cli/bin/hopper-dispatch` (loads `cli/src/vendors/grok.js`)
> Status: **CLOSED** — root cause confirmed as a line-level parse gap; fixed in this commit (see Resolution)

## Evidence (task REV-GRK-001, hawk-clawhive `.hopper/handoffs/`)

The vendor run was a real success:

- `REV-GRK-001-output.log` — stdout begins with hopper's own runner notice
  line (`hopper-runner: idle watchdog disabled (bufferedOutput vendor) …`),
  followed by a **pretty-printed, multi-line** JSON envelope containing a full
  `"text"` field (the complete final response), `"stopReason": "EndTurn"`,
  `sessionId`, `usage` (input/output/cache/reasoning tokens), `num_turns: 13`,
  `total_cost_usd`, and `modelUsage`.
- `REV-GRK-001-output.md` — frontmatter records `exit_code: 0`, yet
  `adapter_diagnostic_code: adapter-protocol-invalid`,
  `adapter_status: unknown-fail`, `status: failed`, and
  `recovered_output_state: no-text`. The deliverable body itself was written
  correctly by the vendor.

## Root cause analysis

`cli/src/vendors/grok.js` `extractGrokText()` tried exactly two candidates:

1. **whole-stdout parse** — fails because the captured stdout starts with the
   hopper-runner log line (not JSON), so `JSON.parse` of the whole trimmed
   stream throws;
2. **single trailing line parse** — fails because grok `--output-format json`
   **pretty-prints** the result envelope across many lines, so the last line
   is a bare `}`.

With both candidates missing, `parsedJson: false`, and the `exitCode === 0 &&
parsedJson …` success branch in `parseResult` can never fire → the run falls
through to `unknown-fail` / `adapter-protocol-invalid` despite a complete,
successful, EndTurn-terminated answer sitting in the log.

So the classification logic was fine; the *envelope extraction* had a
line-level blind spot for the combination
`runner-preamble-lines + pretty-printed multi-line envelope`.

## Resolution (2026-07-24 — hopper 0.35.1+)

**FIXED** in `cli/src/vendors/grok.js` (synced to
`plugins/hopper/cli/src/vendors/grok.js`): `extractGrokText()` gains a third
candidate — the **framed object** spanning the FIRST `{` to the LAST `}` of
the trimmed stdout, tried only when both existing candidates miss. The
existing recognized-envelope-keys gate (`text`/`stopReason`/`usage`/…) still
rejects a mismatched slice, and the existing negative guards (error field,
cancel/abort/refus/error stop reasons, non-JSON stdout →
`adapter-protocol-invalid`) are unchanged.

Verified against the REAL `REV-GRK-001-output.log`: `parseResult` now returns
`status: success`, `diagnosticCode: none`, full 1513-char text, usage stats,
and `outputEvidence.terminalMarker: grok-end-turn`.

Tests added in `tests/unit/grok-adapter.test.js` (6 cases): framed multi-line
envelope after runner log lines → success; single-line trailing and
whole-stdout JSON (existing behavior) still succeed; non-JSON stdout on exit 0
still `adapter-protocol-invalid`; framed envelope with `Cancelled` stopReason
or an `error` field still fails. All pass.

## Impact / workaround (pre-fix)

Any orchestration that gates on hopper task status saw grok dispatches as
failed and could not chain on their results, even though the deliverable file
was correctly produced. Workaround: treat `exit_code: 0` + a parseable
envelope in `*-output.log` as success manually, or recover text from the log.
