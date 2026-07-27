# Changelog

All notable changes to hopper-plugin are documented in this file. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); versioning follows the
project's established convention (see "Versioning" below) rather than strict
SemVer patch/minor semantics.

This file starts at 0.32.0 — prior releases (0.1.0 through 0.31.0) are documented
in git commit history (`git log --oneline`) and `.hopper/MANIFEST.md`'s 修改记录
table; they are not backfilled here.

## Versioning

Historically every release (0.20.0 → 0.31.0, 12 releases) bumps the **minor**
digit and leaves patch at `0`, regardless of whether the change was tagged
`fix:` or `feat:` in the commit message — patch-digit releases (0.7.1, 0.8.1,
0.11.1) are rare early-project exceptions. New entries here follow that
convention: any user-observable behavior change (new capability, fixed defect,
changed default) bumps minor; patch is reserved for the rare non-functional
tweak.

## [0.37.0] - 2026-07-28

### Fixed

- **codex `--search` was placed after the `exec` subcommand, so every web-search
  dispatch to codex died on argv.** `--search` is a TOP-LEVEL codex flag; codex
  rejects it after the subcommand with `error: unexpected argument '--search'
  found` and never starts. Because `prd-research` / `market-research` auto-enable
  webSearch, **no research task could be dispatched to codex at all** — it failed
  before doing any work. Verified live on codex-cli 0.145.0: `codex exec --search
  <prompt>` → unexpected argument; `codex --search exec <prompt>` → rc=0 with real
  output; `codex exec --help` does not list the flag while `codex --help` does.
  The adapter now emits `--search` before `exec`, verified end-to-end by spawning
  the adapter's own argv (rc=0, expected output, no argv error).

  The pre-existing test — under a section header literally reading "the
  load-bearing `--search` fix" — asserted only that `--search` appeared
  *somewhere* in argv. It did; presence was never the defect. That test stayed
  green for the entire time the feature was broken. Its replacement asserts the
  index, plus a generalized guard that no known top-level-only flag drifts behind
  the subcommand.

### Added

- **`HOPPER_WEB_SEARCH=0`** opts out of the research-task web-search auto-enable.
  Distinct from the fix above: with argv now correct, a research task over a
  purely local corpus still may not want live web search pulling external content
  in. Suppresses only the *default* — an explicit `--web-search` still wins, and
  only the exact string `0` opts out.

### Changed

- `package-lock.json`'s own `version` field is now part of the release bump. It
  had been left at `0.8.1` across two dozen releases — harmless to npm, but it
  made the lockfile useless as a record of which release it belongs to.

## [0.36.0] - 2026-07-24

### Fixed

- **OpenCode on Windows no longer receives truncated task briefs.** On the win-cmd-shim regime (`cmd.exe /c opencode.cmd`), a multi-line composed prompt now takes the pointer-file channel regardless of size when the vendor cannot read the prompt from stdin — previously only prompts over the byte budget used the pointer, so small multi-line briefs arrived cut to their first segment and opencode answered "your message seems to be cut off" (commit `6aa10d3`, ISSUE-opencode-windows-multiline-prompt-truncation).
- **Grok no longer false-fails successful runs.** `parseResult` now recovers a pretty-printed multi-line JSON result envelope framed by runner log lines, instead of declaring `adapter-protocol-invalid` on an exit-0 run with a complete `EndTurn` answer (commit `6aa10d3`, ISSUE-grok-adapter-protocol-invalid-false-fail).
- **OpenCode exit-0 successes are no longer misclassified from log-shaped output.** The adapter drops `--print-logs` so stdout stays a clean NDJSON event stream, strips ANSI escape sequences before per-line JSON parsing, and conservatively recovers readable plain text (as unverified evidence, never flipping a run to success) when zero JSON events parse (commit `a1fe9fd`, ISSUE-opencode-ansi-log-output-not-parsed).

### Improved

- Pointer instructions are single-line with the prompt-file path front-loaded, so the pointer itself is safe on the same argv channel it works around; prompt-delivery results now carry consistent `channel` labels (`stdin` / `argv-inline` / `argv-pointer`) (commit `7a1e9b2`).

### Added

- **Kimi Work plugin support**: `plugins/hopper/kimi.plugin.json` lets Kimi Work install hopper as a managed plugin (skills under `plugins/hopper/skills/`).
- 19 new unit tests across prompt-delivery, grok, and opencode parsing (suite: 1024 tests total; the 7 dashboard-* environment suites + 1 flaky lifecycle test that fail also fail on the unmodified baseline).

## [0.35.1] - 2026-07-24

### Improved

- Failed task views now front-load the next safe action when parser-designated vendor text was recovered. The task remains `failed`; users are directed to the guarded result surface rather than raw logs.

## [0.35.0] - 2026-07-23

### Fixed

- Failed background dispatches now retain only parser-designated vendor answer text when the adapter can prove its provenance. The task remains `failed`; recovered text is labelled `verified-complete` or advisory `unknown-completeness`.
- Grok readiness reports launcher credential context as unverified instead of claiming remote authentication, narrows transport-vs-auth attribution, and its outer host wrapper now defaults to `grok-4.5`.

### Security

- `--result --full` no longer emits raw vendor log tails. It can show only the guarded parser-designated sidecar or sanitized output body.

## [0.34.2] - 2026-07-22

### Added

- **OpenCode explicit reasoning forwarding.** An explicitly supplied Hopper
  `--reasoning <level>` now becomes `opencode run --variant <level>`. A
  provider-specific `HOPPER_OPENCODE_VARIANT` still has higher precedence and
  is passed through unchanged. Hopper deliberately omits `--variant` when its
  reasoning value was inherited from AGENTS policy or the global default, so
  arbitrary/custom OpenCode providers are not assumed to support a universal
  variant set.

## [0.34.1] - 2026-07-22

### Fixed

- **Corrected Kimi's read-only fail-closed order and diagnostic.** Kimi prompt
  mode still has no permission or sandbox flag that can enforce read-only;
  Hopper now returns `E_KIMI_READ_ONLY_UNENFORCEABLE` before optional
  subject-root setup, with no vendor process, external guard, or output
  artifact started. `--write` controls only Hopper's synchronous `output.md`
  artifact and does not change Kimi or any vendor's permissions.

## [0.34.0] - 2026-07-22

### Fixed

- **Read-only Kimi requests now stop before any vendor process starts when its
  command mode cannot enforce the requested sandbox.** This prevents a task
  from being described as read-only while it can still modify files.
- **Long-running background work now reports that the process is alive without
  exposing prompt text, vendor output, paths, account data, or model details.**
  Terminal updates clear that liveness signal, so completed work does not keep
  appearing active.
- **Public command, watch, and dashboard views now consistently hide raw
  adapter, model, cache, and process diagnostics.** Users receive a stable
  actionable status instead of sensitive implementation details.
- **Windows cleanup, workspace validation, and cache handling now fail safely
  and remain stable across interrupted or concurrent runs.**

### Changed

- **OpenCode and Fable-backed flows now preserve their explicit runtime
  behavior while refusing unsupported or unsafe execution paths.**

### Tests

- Added regression coverage for read-only refusal, content-free liveness,
  closed public diagnostics, cache/workspace recovery, one-spawn execution,
  and root-to-vendored plugin synchronization.

## [0.33.0] - 2026-07-22

### Fixed

- **Grok no longer misclassifies a successful trailing JSON result as an auth
  failure merely because the merged runner log contains an unrelated MCP
  authentication warning.** For exit-0 Grok runs, a parsed JSON envelope with
  non-empty text and a normal stop reason is preferred before existing auth
  detection; genuine non-structured plain stdout keeps its legacy success
  behavior when no auth signal is present. Cancelled, empty, error, malformed,
  and nonzero structured results retain their failure behavior.
- `--result --full` now exits naturally so piped stdout drains completely before process termination.

### Tests

- Added unit and runner regression coverage for merged stderr authentication
  warnings plus a valid Grok JSON result, and for cancelled/empty and nonzero
  auth failures. The runner case also proves one vendor spawn and a nonempty
  parsed output body.

## [0.32.0] - 2026-07-18

### Fixed

- **grok adapter `knownGood` was stale, breaking every `verified-latest`
  dispatch to grok.** xAI rotated the Grok Build CLI's model line between
  2026-06-02 and 2026-07-16: `grok-build` and `grok-composer-2.5-fast` (the
  prior `knownGood`) both now return `Couldn't set model '<x>': Invalid
  params: "unknown model id"`. `knownGood` is now `['grok-4.5']`
  (`cli/src/vendors/grok.js`, live-verified 2026-07-18 via
  `grok -p ... -m grok-4.5` micro-test), and `DEFAULT_MODEL` follows.
  See `ISSUE-grok-model-line-rotation-stale-knownGood.md`.

### Changed

- **`hopper-dispatch --probe grok` now live-parses `grok models` instead of
  returning a hardcoded static catalog.** This was the deeper root cause
  behind the knownGood staleness above: the old probe admitted in its own
  comments that live introspection was an unimplemented follow-up, so
  `--probe grok` could never self-heal a model-line rotation — it just wrote
  the same stale hardcoded list back to the cache. `cli/src/vendor-probe/grok.js`
  now spawns `grok models` (one subprocess, 30s timeout, no retry — mirrors
  the codex/opencode/kimi probe pattern), parses the "Available models:"
  bullet list (new exported pure parser `parseGrokModelsList`), and reports
  `introspection_supported: 'full'` with the live catalog. On spawn/parse
  failure it degrades honestly to the adapter's static `knownGood`
  (`introspection_supported: 'partial'`, notes explain why) instead of
  silently reporting stale or empty data. `estimateSpawns()` in
  `cli/bin/hopper-dispatch` updated (grok: 0 → 1 subprocess per probe).

### Documentation

- `docs/release/INSTALL-MATRIX.md`, `commands/models.md`,
  `cli/src/scaffold.js`'s example vendor table: grok references updated from
  `grok-build` to `grok-4.5` and from "static" to "live `grok models` parse
  with static fallback".
- Recorded a follow-up hardening idea in
  `ISSUE-grok-model-line-rotation-stale-knownGood.md`: `--check-model`'s
  `verified` verdict and the `verified-latest` sentinel resolution
  (`cli/src/model-check.js`, `cli/src/policy.js`) trust the static
  `knownGood` list unconditionally and never cross-check it against a fresh
  probe cache, so a stale `knownGood` entry (as above) produces a false
  "verified" even on a machine that has already probed and knows better.
  `cli/src/setup.js`'s `--setup --deep` / `--doctor --deep` path already has
  a live-vs-static reconciliation mechanism (`modelReconcile` /
  `reconcileModels`) but `--check-model` and `verified-latest` don't reuse
  it. Not fixed in this release — flagged for follow-up.

### Tests

- `tests/unit/vendor-probe.test.js`: 8 new grok cases — 4 pure-function
  fixtures for `parseGrokModelsList` (single model, multiple models with
  dash/asterisk leaders, missing header, header with no bullets) + 3
  fake-binary integration tests covering the `full` / `partial`-fallback /
  `none` introspection paths.
- Updated 3 existing tests that read the live grok adapter state and
  asserted the now-retired `grok-build` value: `tests/unit/
  dispatch-fallback-chain.test.js`, `tests/unit/vendor-model-auth.test.js`,
  `tests/unit/vendors-contract.test.js`.

### Sync points touched

`package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
`.claude-plugin/marketplace.json` (catalog + plugin entry), `commands/smoke.md`,
`commands/vendors.md`; `plugins/hopper/` vendored copy refreshed via
`node scripts/sync-vendored-plugin.mjs`.
