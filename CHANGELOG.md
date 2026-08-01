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

## [0.41.1] - 2026-08-02

### Changed — non-functional (GitHub username rename)

- **GitHub owner handle renamed `surebeli` → `litianyi-007`** (account rename;
  the old handle still redirects, so this is a text-only follow-up, not an
  urgent fix). Updated every currently-effective reference to the new handle:
  `package.json` (`author`, `homepage`, `repository.url`), `.claude-plugin/plugin.json`
  (`description`, `author`), `.codex-plugin/plugin.json` (`author`, `homepage`,
  `repository`, `interface.developerName`, `interface.websiteURL` — synced to
  `plugins/hopper/.codex-plugin/plugin.json` via `npm run sync:plugin`),
  `.claude-plugin/marketplace.json` (top-level `homepage`/`repository`/`owner.name`
  and the `plugins[0]` entry's `author.name`/`homepage`/`repository` — `owner.email`
  deliberately left untouched, it is not a GitHub-identity field), `plugins/hopper/kimi.plugin.json`
  (`author`, `homepage`, `interface.developerName`, `interface.websiteURL`),
  `LICENSE`, `README.md` badge, and the three host-adapter READMEs
  (`hosts/{claude-code,codex-cli,opencode}/README.md`).
- Historical references to the old handle inside already-published CHANGELOG
  entries above and inside `docs/spikes/T-PLUGIN-00b-vendors.md` (a literal
  email address in a completed spike log, not a GitHub handle) are left as-is
  — they record what was true at the time.
- Patch-only per this file's own versioning convention ("Versioning" above):
  non-functional tweak, no user-observable behavior change.

## [0.41.0] - 2026-07-31

### Changed — BEHAVIOR CHANGE (codex read-only dispatch on macOS/Linux)

- **codex's sandbox-bypass default is now platform-split, reversing part of
  the 0.34.0-era "codex has NO read-only scenario" decision.** That decision
  applied the Windows-only rationale (`-s <mode>` sandbox harness cannot spawn
  ANY child process there — `CreateProcessWithLogonW` 1326,
  ISSUE-codex-callchain-windows) to **every** platform, so codex always ran
  full-access via `--dangerously-bypass-approvals-and-sandbox` regardless of
  platform or requested sandbox. Manually verified 2026-07-31 on macOS that
  this was unnecessarily broad: `codex exec -s read-only` genuinely denies a
  write (`operation not permitted`, file never created) while
  `--dangerously-bypass-approvals-and-sandbox` with the identical command
  creates it — codex's own sandbox works fine on macOS/Linux; only Windows is
  broken.

  `codexSandboxBypassActive(platform)` (new, exported from
  `cli/src/vendors/codex.js`) now branches on `process.platform`:

  ```js
  export function codexSandboxBypassActive(platform = process.platform) {
    return platform === 'win32'
      ? process.env.HOPPER_CODEX_SANDBOX_BYPASS !== '0'
      : process.env.HOPPER_CODEX_SANDBOX_BYPASS === '1';
  }
  ```

  - **Windows: unchanged.** Bypass stays the default; `HOPPER_CODEX_SANDBOX_
    BYPASS=0` still reverts to the (broken) real `-s` sandbox.
  - **macOS/Linux: reversed.** Bypass is now OFF by default — codex honors the
    *requested* `-s <mode>` for real, including `read-only`.
    `HOPPER_CODEX_SANDBOX_BYPASS=1` opts back into the old always-full-access
    behavior.
  - **The escape hatch's default polarity is intentionally OPPOSITE per
    platform** — same env var, `=0` disables bypass on Windows but `=1`
    enables it on macOS/Linux. This is documented in the function's own JSDoc,
    in `cli/src/rules.js`'s generated `--sandbox` note, and in every affected
    user-facing doc (see below) specifically so a reader does not assume "=0
    always means off."

  `cli/src/dispatch.js`'s `resolveAdapterOptsForTask` (the `codexAlwaysFullAccess`
  check that used to force codex to `danger-full-access` unconditionally) and
  `cli/src/setup.js`'s `sandboxControl()` (the `--setup`/`doctor` classifier)
  both now re-derive from the same `codexSandboxBypassActive()` helper instead
  of duplicating the old unconditional formula — `sandboxControl(codex)` is
  therefore `'full'` on Windows and `'argv'` on macOS/Linux (previously
  unconditionally `'full'`); `sandboxControl()` gained an optional `{ platform
  }` test-only override to make both branches assertable without a real
  Windows host.

  `--skip-git-repo-check` now rides along on **every** sandbox mode and
  platform (previously bypass-path only). Manually verified: `codex exec -s
  read-only` in a non-git directory hits the exact same "Not inside a trusted
  directory" trust-gate error that the bypass path hit before
  `--skip-git-repo-check` was added for it — the gate is not specific to
  bypass mode, so a `HOPPER_VENDOR_CWD` pointed at a non-git root would have
  silently broken every macOS/Linux read-only codex dispatch under this
  release without this change. `HOPPER_CODEX_SKIP_GIT_CHECK=0` still restores
  codex's default trust-gate behavior on every mode/platform.

  **`--subject-root`'s reachable surface widens as a side effect.** It requires
  the *effective* sandbox to be `read-only`; before this change codex's
  effective sandbox was always forced to `danger-full-access`, so
  `--subject-root` + codex was dead-on-arrival on every platform (the
  precondition could never hold). On macOS it can now hold for real, and
  `--subject-root`'s outer `sandbox-exec` guard composes cleanly with codex's
  own inner `-s read-only` — manually verified: nesting them denies the write
  with no hang, crash, or conflict (Seatbelt sandboxes nest fine; both layers
  only ever narrow permissions).

  **Who is affected / how to roll back:** any *existing* dispatch on macOS or
  Linux that relies on a `read-only`-defaulting task-type (`code-review-
  adversarial`, `code-review-acceptance`, `spec-blindspot-hunt`, `prd-research`,
  `market-research` — see `validation.js`'s `READ_ONLY_DEFAULT_TASK_TYPES`) or
  an explicit `--sandbox read-only`/`workspace-write` routed to **codex**, and
  which was until now silently getting full write access, will start actually
  being denied writes. Audited: the five read-only-default task-types are
  documented review/research work that should not write
  (`code-review-adversarial`/`-acceptance` are explicitly annotated "read-only
  sandbox REQUIRED" in `cli/src/scaffold.js`'s task-frame template) — none of
  them are expected to need write access. `code-impl` and other genuinely
  writable task-types are unaffected (they default to `danger-full-access`,
  which still gets full access on every platform, just via `-s
  danger-full-access` instead of the bypass flag on macOS/Linux — verified
  functionally equivalent). If a project-specific brief was quietly relying on
  a "read-only" codex dispatch actually having write access on macOS/Linux, set
  `HOPPER_CODEX_SANDBOX_BYPASS=1` (globally) to restore the pre-0.41.0
  always-full-access behavior on those platforms, or pass an explicit
  `--sandbox danger-full-access`/`workspace-write` for that dispatch. Windows
  dispatches are completely unaffected either way.

  Docs updated in the same change: `README.md` (both the Scenario-1 permission
  paragraph and the Core Skills footnote), `commands/dispatch.md`,
  `review.md`, `research.md`, `market.md`, `swarm.md`, `setup.md`,
  `skills/hopper-setup/SKILL.md`, `cli/src/rules.js`'s generated `--sandbox`
  note (plus `HOPPER_CODEX_SANDBOX_BYPASS`/`HOPPER_CODEX_SKIP_GIT_CHECK` added
  to `rules.js`'s env-neutralization list so the generated matrix doesn't pick
  up a generating shell's env), and a new dated row in
  `docs/specs/vendor-io-protocol-current-vs-target.md` (the 2026-06-25 row
  this partially reverses is left as historical record, per this file's
  append-only convention).

  Tests: `tests/unit/codex-isolation.test.js`, `dispatch-flags.test.js`,
  `prompt-delivery.test.js`, `setup.test.js`, `vendor-security-claims.test.js`,
  and `vendors-contract.test.js` all gained platform-injected fixtures
  (`win32`/`darwin`/`linux` via a test-only `opts.platform` /
  `adapterOpts.platform` override — real dispatch never sets it) plus a
  destructive counter-proof that pins the platform branch as load-bearing (a
  return to the old unconditional-bypass formula flips the darwin/linux
  fixtures red). Windows fixtures are necessarily injected, not run for real
  (no Windows host available); this is called out explicitly in the test
  comments rather than silently assumed.

## [0.40.0] - 2026-07-31

### Added

- **`.hopper/AGENTS.md` gains a "## Approved Vendors" whitelist section**,
  upgrading AGENTS.md from a pure routing table into an actual per-project
  vendor gate. Previously the `Notes` column's "入选/未入选" (approved/not
  approved) annotations were prose only — nothing in the code read them, so
  `--vendor <anything-registered>` dispatched regardless of what a project
  had actually approved. Now `cli/src/agents.js`'s `parseAgentsContent`
  parses a `| Vendor | Approved | Approved by | Date | Scope / Notes |`
  table into a new `approvedVendors` field, and a new
  `assertVendorApproved(agentsData, vendor)` enforces it at **both**
  vendor-resolution call sites in `cli/src/dispatch.js` — `resolveDispatch`
  (the queue.md path) and `resolveAdhocDispatch` (the ad-hoc
  review/research/market/swarm path) — running immediately AFTER
  `vendorOverride || resolveVendor(...)`, so an explicit `--vendor` override
  is checked too, not just AGENTS.md-routed dispatches.
- **Polarity is fail-closed by design**: an AGENTS.md with no "## Approved
  Vendors" section refuses EVERY vendor (`E_APPROVED_VENDORS_SECTION_MISSING`),
  and a section that exists but doesn't list a vendor as `yes` also refuses
  it (`E_VENDOR_NOT_APPROVED`, listing the known entries). This project has
  direct history with the opposite polarity ("missing = allow") turning one
  deleted line into a silent global kill-switch (see the `.codex-plugin/
  plugin.json` version-drift incidents in this same file); the new gate
  deliberately does not repeat that shape one layer up.
- This is a **separate, independent control from the existing host!=vendor
  isomorphism guard** (`validateHostVendorSeparation`) — a vendor can be
  Approved-Vendors-whitelisted and still rejected by host!=vendor (e.g. a
  Claude Code host dispatching to the approved `claude` vendor), and neither
  gate short-circuits the other. Covered by new tests in
  `tests/unit/host-detect.test.js` (approving `claude` in the fixture's
  Approved Vendors table, then confirming the CLI still rejects it via
  host!=vendor) and new cases in `tests/unit/agents.test.js`.
- The scaffold template (`cli/src/scaffold.js`, `hopper-dispatch
  --init-tasks`) now generates the new section (present but empty) alongside
  the existing "Active Agent Instances" table — unchanged/still generated —
  with a note that every dispatch is refused until the project fills it in.
- **Documentation-only vendor support-tier decision**: `commands/vendors.md`
  and `README.md` now note that the actively product-supported vendor set is
  `codex` / `grok` / `claude` / `kimi`; `agy` / `copilot` / `mimo` /
  `opencode` are marked **not supported** (distinct from `agy`'s pre-existing
  technical `dispatchDisabled` gate). No adapter files were removed and
  nothing is hardcoded in code to enforce a 4-vendor limit — the Approved
  Vendors table above is the single execution point, so this note and that
  mechanism cannot drift apart the way a hardcoded list would.

## [0.39.0] - 2026-07-31

### Fixed

- **The host!=vendor isomorphism guard (`validateHostVendorSeparation`) was a
  no-op for the Claude Code host, and even a fixed version of the same guard
  would have stayed a no-op under pure string equality.** Two independent
  defects, both real, both confirmed empirically:
  1. `hostVendor` came ONLY from `process.env.HOPPER_HOST_VENDOR`, which is
     set exclusively by the 5 Tier-C bash wrappers (`hosts/{codex-cli,
     copilot-cli,grok-cli,cursor-cli,opencode}/bin/hopper-*`). `hosts/
     claude-code/bin` does not exist — Claude Code's slash commands invoke
     `hopper-dispatch` directly (see `commands/dispatch.md`) — so the env var
     was NEVER set under Claude Code, and `validateHostVendorSeparation`'s own
     `if (!hostVendor) return;` guard silently skipped the check for every
     real dispatch from inside a Claude Code session.
  2. The comparison itself was `hostVendor === resolvedVendor` — even had a
     host identity been supplied for Claude Code, the natural value ('claude-
     code') would never equal the vendor name ('claude'), so string equality
     could not have caught the one case the guard exists for (a Claude Code
     host dispatching back to the `claude` vendor, i.e. `claude -p` calling
     itself through a different entry point).

  Fixed with two additions: `cli/src/host-detect.js` self-detects the Claude
  Code host from markers Claude Code itself sets (`CLAUDECODE`,
  `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID`) whenever
  `HOPPER_HOST_VENDOR` is unset — deliberately NOT branching on any other
  vendor's env vars, because a Codex Claude-Code-plugin was observed setting
  `CODEX_COMPANION_SESSION_ID`/`CODEX_COMPANION_TRANSCRIPT_PATH` INSIDE a real
  Claude Code session; a naive "sees a `CODEX_*` var → host is codex" rule
  would have misidentified that session as the Codex CLI host. And
  `cli/src/validation.js` now exports a `VENDOR_FAMILY` map (`claude`/
  `claude-code` → `anthropic`, `codex` → `openai`, `grok` → `xai`, `kimi` →
  `moonshot`) so `validateHostVendorSeparation` compares FAMILY, not raw
  strings — bridging the `claude-code`/`claude` naming mismatch while still
  allowing `claude` as a legal vendor for every OTHER host (a Codex/Grok/etc.
  host dispatching to the `claude` vendor remains a legitimate heterogeneous
  dispatch and is unaffected). `copilot`/`opencode`/`mimo`/`agy` are
  deliberately left OUT of the family map — each is documented in its own
  adapter file as multi-backend (spanning multiple model companies depending
  on subscription/config), so guessing a single family for them would be
  fabricated, not derived; see the map's own comment in `validation.js` for
  the per-vendor citation trail. When a host identity has no family mapping
  (including a host that self-detection could not confidently identify), the
  guard no longer silently no-ops: it returns a `notice` that the isomorphism
  check did not run, and `hopper-dispatch` prints it (never a silent skip).

  `commands/dispatch.md` and `hosts/claude-code/README.md` previously claimed
  "host≠vendor still enforced" / the guard "blocks... a Claude Code host
  dispatching back to the claude vendor" — both now describe the actual
  (fixed) behavior, including the family-based comparison and the
  host-unrecognized upper bound. No vendor adapter argv changed.

## [0.38.0] - 2026-07-29

### Fixed

- **User-facing docs asserted a "read-only" sandbox was enforced when it isn't,
  for the two vendors that route there by default.** `commands/review.md`,
  `research.md`, `market.md`, `swarm.md`, and `README.md` said things like
  "so the reviewer never edits the repo" and labeled `/hopper:review` /
  `research` / `market` as flatly "(ad-hoc, read-only)". That was false for
  **codex** (the default reviewer for acceptance review, research, and market;
  a common swarm panelist) and **grok** (the default adversarial reviewer; also
  a common swarm panelist): codex *always* runs full-access via
  `--dangerously-bypass-approvals-and-sandbox` (`cli/src/vendors/codex.js:292`
  — a deliberate Windows-sandbox workaround, not a bug), and grok *always* runs
  `--permission-mode bypassPermissions` (`cli/src/vendors/grok.js`) regardless
  of the requested sandbox. The engine's own generated dispatch rules already
  said this honestly (`cli/src/rules.js:153`, `.hopper/DISPATCH.md`); the
  plugin's own command docs and README did not, until now.

  All five files now say "read-only" is a *request* carried by the executor
  prompt frame, name codex/grok's actual always-full-access behavior, and point
  at `--subject-root` (macOS, opt-in) for a genuine per-process guard —
  including its own already-documented limits (pre-existing hard links, reads,
  and network/IPC are out of scope; not a confidentiality boundary). No vendor
  sandbox behavior changed — only the doc's description of it.

  `commands/setup.md:25,39` and `skills/hopper-setup/SKILL.md:20` were audited
  too ("prefer a vendor whose Sandbox=argv so read-only is actually enforced").
  That phrasing itself is a conditional vendor-*selection* recommendation, not
  an unconditional claim about every dispatch — but the audit found the
  classification it leans on, `cli/src/setup.js`'s `sandboxControl()`, was
  itself wrong for grok (see the same-day follow-up fix directly below).

- **`sandboxControl()` classified grok as `'argv'` (downgradable via flags)
  when grok never actually honors a read-only request.** The classifier's only
  test was "does the argv differ between full-access and read-only requests" —
  true for grok (`--always-approve` toggles), so it read as downgradable. But
  grok's `--permission-mode` stays `bypassPermissions` regardless of the
  requested sandbox (`cli/src/vendors/grok.js`), so the "read-only" argv it was
  comparing never actually restricted anything — the exact gap the pin tests
  added above already proved at the argv level, just not yet reflected in the
  classifier a human (or `/hopper:setup`) would read. Fixed by having
  `sandboxControl()` additionally check whether the *read-only* argv itself
  still carries an unconditional-access flag/permission-mode
  (`argvPinsUnconditionalAccess()`, covering `--dangerously-bypass-*`,
  `--dangerously-skip-*`, `--always-approve`, and `--permission-mode
  bypassPermissions`); grok now reports `'full'` — the same bucket as codex,
  which the fix leaves unchanged. Verified this does not point "prefer
  Sandbox=argv" at an empty set: `opencode`, `copilot`, `agy`, `mimo`, and
  `claude` all remain genuinely `'argv'` (their read-only argv carries no such
  flag), so the recommendation stays true and actionable in general — it's
  just that hopper's two *built-in reviewer defaults* (codex, grok) were never
  (codex) or are no longer misreported as (grok) members of that set.
  `commands/setup.md:25,39` and `skills/hopper-setup/SKILL.md:20` were updated
  in the same change to spell out the `'full'` value and name codex+grok as
  both `'full'`.

### Added

- **`tests/unit/vendor-security-claims.test.js`** — pins codex/grok's real
  argv for a `sandbox: 'read-only'` request (so a future genuine fix to either
  vendor's read-only support fails this test, forcing the docs above to be
  updated in the same change) and denylist-scans `commands/*.md` (excl.
  `setup.md`) + `README.md` for recurrence of the exact false phrasings fixed
  above. Explicitly documented as a denylist, not a semantic checker: it
  catches recurrence of these phrasings, not a differently-worded false claim.
  Same-day follow-up added T-a/T-b/T-c: `sandboxControl(grok)` must not be
  `'argv'` (must be `'full'`); `sandboxControl(codex)` stays `'full'`
  (no regression); and a fake adapter with a genuinely downgradable read-only
  argv still reports `'argv'` (positive control — proves the fix targets the
  specific unconditional-access-flag case rather than collapsing every vendor
  into `'full'`).

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
