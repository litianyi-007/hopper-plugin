# ISSUE: opencode on Windows receives only the first line of the task brief — cmd-shim truncates multi-line argv at the first newline, opencode has no stdin channel

> Reporter: Kimi Work orchestration session (hawk-clawhive project), dispatching adversarial review tasks to opencode/grok
> Date: 2026-07-24
> Severity: high on Windows — every opencode dispatch with a multi-line brief is a silent no-op; the vendor answers "your message seems to be cut off" and hopper records `adapter-protocol-invalid`
> Env: Windows; opencode reached via cmd.exe shim `C:\nvm4w\nodejs\opencode.cmd`; hopper-dispatch `0.35.1`; CLI = `<hopper>/cli/bin/hopper-dispatch` (loads `cli/src/prompt-delivery.js` + `cli/src/vendors/opencode.js`)
> Status: **CLOSED** — fixed in this commit (see Resolution)

## Evidence

Any background dispatch to the opencode vendor with a composed (multi-line)
brief returns an answer whose entire content is a truncation complaint:

> "Your message seems to be cut off. I see you've sent a header/preamble …"

`parseResult` then classifies the run `unknown-fail` /
`adapter-protocol-invalid` (exit 0 but no usable terminal result), so the
queue row shows `failed` even though opencode ran fine — it simply never
received the task.

Repro:

```
# Windows, from a repo with .hopper/
hopper-dispatch --adhoc --task-type code-review-adversarial --vendor opencode --background
hopper-dispatch --result <taskId>   # → opencode: "message cut off …", status failed
```

## Root cause (confirmed chain)

1. On Windows, `opencode` resolves to a **cmd.exe `.cmd` shim**
   (`C:\nvm4w\nodejs\opencode.cmd`), so `commandLineRegime()` puts the spawn in
   the `cmd-shim` regime (`cli/src/prompt-delivery.js`).
2. The win-cmd-shim channel **truncates a multi-line argv positional at the
   FIRST newline**, at any size (documented in the prompt-delivery header and
   `useStdinPrompt()`'s comment, lines 89–94). The size-gated pointer
   mechanism does NOT catch this: the truncation victim is usually a SMALL
   prompt that sits far under the 4000-byte inline budget.
3. For vendors that declared `promptStdin: 'supported'` (codex/claude/mimo,
   opt-in copilot), hopper already pipes the prompt over stdin to dodge the
   truncation. **`cli/src/vendors/opencode.js` has no `promptStdin`
   declaration** (only `stdinMode: 'none'`), so opencode stayed on
   `argv-inline`.
4. opencode CLI genuinely **cannot read the message from stdin** (verified
   `opencode run --help`: the message is an argv positional array only), so
   routing it to stdin was never an option.

Net effect: a multi-line composed brief was inlined into argv, cmd.exe cut it
at the first `\n`, opencode received only the header, and correctly asked for
the rest.

## Resolution (2026-07-24 — hopper 0.35.1+)

**FIXED** in `cli/src/prompt-delivery.js` (synced to `plugins/hopper/cli/src/`):

A newline-gated companion rule to the existing size gate: on the `cmd-shim`
regime, when the adapter does NOT declare `promptStdin: 'supported'` and the
composed prompt contains a newline, delivery now takes the **pointer-file**
channel (`handoffs/<taskId>-prompt.md` + a small single-paragraph "read this
file" pointer instruction) regardless of size. opencode — like every hopper
vendor — is an agentic coding CLI that can read a file in its workspace, so
the pointer is fully compatible.

Behavior preserved:
- stdin-capable vendors (codex/claude/mimo, opt-in copilot) still use the
  stdin channel on cmd-shim (checked before the new gate).
- Single-line prompts within budget still inline (deterministic path).
- native-exe and POSIX regimes are untouched (their argv is multi-line-safe).
- The cwd-scope guard and write-failure fallback (fall back to inline with
  `fallbackReason`, never break dispatch) apply to the forced pointer exactly
  as to the size-gated one.

Tests added in `tests/unit/prompt-delivery.test.js`:
- small multi-line prompt on cmd-shim + non-stdin adapter → pointer file;
- single-line prompt on cmd-shim → still inline (no regression);
- multi-line on native-exe/posix → still inline;
- stdin-capable codex on cmd-shim → still stdin channel (gate ordering);
- REAL opencode adapter + cmd-shim + multi-line → pointer file, prompt off
  argv, `run …` argv shape preserved.

All 33 prompt-delivery tests pass; the full unit suite shows no new failures
(the 7 dashboard-* suites + 1 flaky lifecycle test that fail also fail on the
unmodified baseline).
