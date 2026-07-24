# ISSUE: opencode exit-0 success misclassified as adapter-protocol-invalid — this opencode build emits ANSI-colored log lines on stdout instead of the `--format json` NDJSON event stream, and parseOpencodeAnswerEvents parses nothing

> Reporter: Kimi Work orchestration session (hawk-clawhive project)
> Date: 2026-07-24
> Severity: medium-high — the vendor COMPLETES the task correctly (full answer on stdout), but hopper records `failed` / `adapter-protocol-invalid`; orchestration that gates on task status cannot chain on opencode results
> Env: Windows; opencode via cmd.exe shim `C:\nvm4w\nodejs\opencode.cmd`; model `tokenbox/deepseek-v4-pro`; hopper-dispatch `0.35.1+6aa10d3`; CLI = `<hopper>/cli/bin/hopper-dispatch` (loads `cli/src/vendors/opencode.js`)
> Status: open — confirmed root cause, NOT fixed in 6aa10d3 (analysis + fix candidates below)

## Context

Found while validating the fix for
ISSUE-opencode-windows-multiline-prompt-truncation (commit 6aa10d3). That fix
works: the multi-line composed brief now reaches opencode intact via the
pointer-file channel, and opencode completes the task. What remains broken is
the **classification** of the run.

## Evidence (task `adhoc-code-review-adversarial-mryr4dsd`, hawk-clawhive `.hopper/handoffs/`)

Dispatched 2026-07-24 with
`hopper-dispatch --adhoc --task-type code-review-adversarial --vendor opencode --model tokenbox/deepseek-v4-pro --background --brief "READ-ONLY micro task: read the file .hopper/handoffs/REV-GRK-001-output.md and reply with exactly one sentence summarizing it. Do not modify anything."`

- `adhoc-code-review-adversarial-mryr4dsd-output.md` frontmatter:
  `exit_code: 0`, `duration_ms: 69659`, yet `status: failed`,
  `phase: failed`, `--result` reports
  `Adapter diagnostic: adapter-protocol-invalid`, `Recovered output: none`.
- `adhoc-code-review-adversarial-mryr4dsd-output.log` — the run clearly
  **succeeded**: it shows the vendor reading the pointer prompt file
  (`Read .hopper/handoffs/adhoc-code-review-adversarial-mryr4dsd-prompt.md`),
  then reading `REV-GRK-001-output.md`, then emitting the requested
  one-sentence summary as the final answer. But every log line is an
  **ANSI-colored human log line**, not JSON. Readable transcription of the
  actual bytes (ESC = `\x1b`, CR = `\r`):

  ```
  ESC[0m CR
  > build · deepseek-v4-pro CR
  ESC[0m CR
  ESC[0m → ESC[0mRead . CR
  ESC[0m → ESC[0mRead .hopper/handoffs/adhoc-…-prompt.md CR
  <thinking>…</thinking>
  An adversarial code review of the ClawHive Electron app's startup IPC and
  coordinator identifies four real defects—including a high-severity OAuth
  race condition … —with a REWORK verdict …
  ```

  i.e. stdout looks like `opencode run --print-logs` console output (color
  resets, `→ Read <path>` tool traces, `<thinking>` blocks, plain-text final
  answer). **No NDJSON event lines appear anywhere in the captured stdout**,
  even though the adapter argv includes `--format json --print-logs --pure`
  (`cli/src/vendors/opencode.js` args()).

## Root cause analysis

`cli/src/vendors/opencode.js` `parseOpencodeAnswerEvents()` splits stdout into
lines and `JSON.parse`s each line, collecting text only from recognized event
shapes (`{type:"text", part:{text}}`, message/assistant/result envelopes,
terminal markers like `step_finish` / `message.completed` / successful
`result`). On this opencode build:

1. every stdout line is ANSI-decorated human log output → per-line
   `JSON.parse` throws for ALL lines → `chunks` empty, `terminalMarker: 'none'`;
2. `parseResult` then has `exitCode === 0` but no text and no terminal marker
   → falls through to `adapterFailure('unknown-fail', 'adapter-protocol-invalid')`.

So the parser contract ("stdout is a JSON event stream") does not match this
build's actual stdout ("human log stream"). Two open questions for the dev
team:

- **Why does `--format json --print-logs --pure` still yield ANSI log lines?**
  Hypotheses: (a) this opencode build (or the `tokenbox/*` provider path)
  routes `--print-logs` output to **stdout** interleaved with — or instead of —
  the JSON event stream; (b) under the Windows **cmd-shim** spawn the child's
  TTY/color detection differs from a direct console run, so opencode keeps
  colorized console formatting even in `--format json` mode; (c) `--pure`
  semantics changed in this version. Needs a direct repro:
  `opencode run "<prompt>" --model tokenbox/deepseek-v4-pro --print-logs --format json --pure`
  captured to a file on this host, with and without `--print-logs`, and via
  `cmd.exe /c opencode.cmd` vs direct invocation.
- **Is the final plain-text answer line distinguishable?** In the captured
  log the final answer is a plain (non-`→`-prefixed, non-`<thinking>`) text
  block after the tool traces — recoverable with heuristics, but fragile.

## Fix candidates (for the dev team — deliberately NOT fixed in 6aa10d3)

1. **Strip ANSI escape sequences before parsing** (minimal, safe): remove
   `ESC[…m` / CR control bytes in `parseOpencodeAnswerEvents` line
   preprocessing. Necessary but NOT sufficient for this build — the stripped
   lines are still not JSON events.
2. **Force logs off stdout**: drop `--print-logs` (or redirect it) for
   background dispatches so stdout carries only the `--format json` event
   stream; verify whether this build then emits NDJSON at all. If the build
   simply ignores `--format json`, escalate upstream / pin a known-good
   opencode version.
3. **Tolerant non-JSON fallback extraction** (last resort): when zero JSON
   events parse but exit code is 0, extract the trailing plain-text answer
   block (excluding `→` tool-trace lines and `<thinking>` blocks) with
   `completeness: 'unknown-completeness'` evidence, so a genuinely successful
   run is not false-failed. Must stay conservative to keep the
   protocol-invalid guard meaningful for real protocol breaks.

Candidate 1+2 is the preferred path (restores the real event-stream
contract); candidate 3 is the resilience net if the build truly cannot emit
NDJSON in this environment.

## Impact / workaround

Every opencode dispatch on this host is recorded `failed` even when the
vendor did the work (same false-fail class as the fixed
ISSUE-grok-adapter-protocol-invalid-false-fail, different mechanism).
Workaround: read the deliverable / final answer from
`.hopper/handoffs/<taskId>-output.log` manually; do not gate downstream
orchestration on opencode task status until this is fixed.

## Repro

```
# Windows, from a repo with .hopper/
hopper-dispatch --adhoc --task-type code-review-adversarial --vendor opencode \
  --model tokenbox/deepseek-v4-pro --background --brief "<any small read-only task>"
hopper-dispatch --result <taskId>   # → exit_code 0, answer in .log, status failed / adapter-protocol-invalid
# inspect the raw log: ANSI-colored "→ Read …" log lines, zero JSON event lines
```
