# Hopper Queue — hopper-plugin (v2 schema)

Anchor: `.hopper/queue.md::root`

- **Schema version**: 2 (Task-type column primary; Role column omitted per task-based orchestration v2.0 amendment 2026-05-20)
- **Task spec source**: `.hopper/handoffs/leader-tasklist.md`
- **Status values**: `pending` / `in-progress` / `done` / `failed` / `removed`
- **Push privilege**: Leader only (per PING.md §Push protocol)
- **Pop protocol**: PING.md `ping <task-id>` (v5 form)
- **Vendor routing**: each Task-type has default vendor preference in `.hopper/AGENTS.md` task-vendor-preference table; row-level override possible via optional `Vendor` column (not used in initial queue)
- **Spec authority**: `F:\workspace\ai\llm-hopper\docs\plans\2026-05-19-hopper-plugin-demo-spec.md` v2.0

---

## Tasks

| ID | Task-type | Status | Depends | Priority | Brief | Vendor |
|----|-----------|--------|---------|----------|-------|--------|
| T-PLUGIN-00 | spec-blindspot-hunt | in-progress | | high | Phase 0 host-lifecycle spike: 3 prongs. Prong 2 + Prong 3 VERIFIED. **Prong 1 Claude Code plugin install blocked-on-user-manual** per PING.md Step 6 — task stays in-progress until user installs plugin + reports `/hopper:smoke` output. Codex Phase 0 audit F2 fix. | |
| T-PLUGIN-00b | spec-blindspot-hunt | done | | high | Vendor invocation spike: kimi + opencode + copilot + **agy** (Antigravity; swapped in for Gemini per user 2026-05-20) headless calls. Outputs `docs/spikes/T-PLUGIN-00b-vendors.md`. Parallel-eligible with T-PLUGIN-00. Final score: 4/5 vendors smoke-verified (Codex+Kimi+OpenCode+Copilot); agy smoke pending user OAuth login per unified user-action gate. | |
| T-PLUGIN-00.5 | spec-write | done | T-PLUGIN-00, T-PLUGIN-00b | high | Tasks library bootstrap: write 6 `.hopper/tasks/<type>.md` frames (spec-write, code-impl, code-review-adversarial, code-review-acceptance, sidecar-polish, spec-blindspot-hunt). | |
| T-PLUGIN-01 | code-impl | done | T-PLUGIN-00, T-PLUGIN-00.5 | normal | Repo init + Claude Code plugin manifest (scaffolded Phase 0; expanded Phase 1 with test scripts + dispatch orchestrator wiring). Prong 1 install user-verify gated separately under T-PLUGIN-00 status. | |
| T-PLUGIN-02 | code-impl | done | T-PLUGIN-01 | normal | Core queue.md parser (v2 schema, Task-type column primary, Role column legacy fallback). 12 unit tests pass. | |
| T-PLUGIN-03 | code-impl | done | T-PLUGIN-01 | normal | Tasks library loader + anti-persona verifier. 11 unit tests pass. | |
| T-PLUGIN-04 | code-impl | done | T-PLUGIN-02, T-PLUGIN-03 | normal | AGENTS.md parser + deterministic vendor router (4-step resolution: row override → preference → agent pref array → throw). 7 unit tests including 10-call determinism check. | |
| T-PLUGIN-04.5 | spec-write | done | T-PLUGIN-00b | high | VendorAdapter JSDoc contract + runSubprocessOnce shared wrapper with Windows taskkill /T /F + Unix detached-group SIGKILL + makeUniqueLogPath for codex F2 stale-log prevention. 11 unit tests pass. | |
| T-PLUGIN-05a | code-impl | done | T-PLUGIN-04, T-PLUGIN-04.5 | normal | Codex vendor adapter (cli/src/vendors/codex.js, ~55 lines on shared wrapper). 9 contract tests pass. | |
| T-PLUGIN-05b | code-impl | done | T-PLUGIN-04, T-PLUGIN-00b | normal | Kimi vendor adapter with HTTP 402 detection (~55 lines). 9 contract tests pass. | |
| T-PLUGIN-05c | code-impl | done | T-PLUGIN-04, T-PLUGIN-00b | normal | OpenCode vendor adapter with ANSI strip + run subcommand (~60 lines). Pin 0.14.7 advisory only. 9 tests pass. | |
| T-PLUGIN-05d | code-impl | done | T-PLUGIN-04, T-PLUGIN-00b | normal | Copilot vendor adapter with GH_TOKEN preflight + quota detection (~60 lines). 9 tests pass. | |
| T-PLUGIN-05e | code-impl | done | T-PLUGIN-04, T-PLUGIN-04.5, T-PLUGIN-00b | normal | **Antigravity (agy) adapter** (~115 lines). Silent auth-fail detection via unique --log-file per codex F2. 22 tests pass (10 contract + 12 quirks). Real smoke gated on user OAuth per spec §11 unified user-action gate. | |
| T-PLUGIN-06 | code-impl | done | T-PLUGIN-05a | normal | Output.md writer (cli/src/output.js, ~250 lines) + Phase-2-schema-faithful template + sidecar raw file for long outputs + suggested queue/cost edits printed to stdout. Codex mini-audit FIX_AND_RECHECK → PROCEED_TO_T07 (all 4 P1 findings resolved). 16+13 tests pass. | |
| T-PLUGIN-07 | code-impl | done | T-PLUGIN-06 | normal | Claude Code Tier B slash commands wired: /hopper:dispatch + /hopper:status + /hopper:smoke + /hopper:vendors as commands/*.md prompt templates; plugin.json simplified to standard schema. 12 host-adapter tests pass. User-action gate (T-00 Prong 1 install verify) still open per spec §11. | |
| T-PLUGIN-08a | code-impl | done | T-PLUGIN-07 | normal | Codex CLI host adapter (Tier C #1): bash wrapper `hosts/codex-cli/bin/hopper-codex` (+ Windows `.cmd`) that validates args, locates dispatcher, invokes `codex exec` once with a prompt that drives codex to call hopper-dispatch via its shell tool. Single-spawn at every layer. 14 wrapper tests pass. | |
| T-PLUGIN-08b | code-impl | done | T-PLUGIN-07 | normal | OpenCode host adapter (Tier C #2): bash wrapper `hosts/opencode/bin/hopper-opencode` (+ Windows `.cmd`) parallel to T-08a. Cross-host parity: identical regex, .. rejection, flag whitelist, symlink-safe SCRIPT_DIR, no-soft-orchestration prompt clause. Invokes `opencode run` once. 16 tests pass + parity test asserts byte-equivalent validation logic with Codex CLI wrapper. | |
| T-PLUGIN-09 | spec-write | done | T-PLUGIN-08a, T-PLUGIN-08b | normal | PASS materials (no-screencast variant per user 2026-05-20): docs/release/PASS-RATIONALE.md + docs/release/INSTALL-MATRIX.md + scripts/cross-host-verify.sh + root README refresh. **Screencast deferred as TODO — tracked separately, NOT part of this task's scope.** | |
| T-PLUGIN-10 | code-review-acceptance | done | T-PLUGIN-09 | high | Critic end-to-end verdict PASS_WITH_NOTES. Per-criterion: #1 PASS_WITH_NOTE (sidecar .txt disclosed); #2 PASS_WITH_NOTE (4/5 live-smoked, structural cross-host); #3 PASS_WITH_NOTE (OpenCode ANTHROPIC_API_KEY env-var fallback disclosed); #4 PASS clean; #5 PASS_WITH_NOTE (role vocabulary retained as legacy). GO for essay material with framing constraints. | |
| T-AUDIT-PH5-codex | code-review-adversarial | done | T-PLUGIN-10 | high | Heterogeneous third-party audit by codex xhigh via hopper-dispatch --background. VERDICT: REWORK. 7 findings (4 P1 + 3 P2) — all NEW (missed by 12 prior local-scope audit cycles). Codex completed audit at 198k tokens just as misconfigured 300s SIGTERM fired (F2 self-evidence). Output: .hopper/handoffs/T-AUDIT-PH5-codex-output.md. | codex |
| T-AUDIT-PH5-kimi | code-review-adversarial | failed | T-PLUGIN-10 | high | Kimi vendor dispatched in parallel; **silent failure** — 0-byte log + SIGTERM at 180s default timeout. Heterogeneous parallel structure WORKED (both vendors ran simultaneously via --background), but kimi produced no output. Hypothesis: kimi adapter timeout too short for 4.7k-char prompt + kimi-cli first-token wait stall. Output: .hopper/handoffs/T-AUDIT-PH5-kimi-output.md. | kimi |
| T-AUDIT-PH6B-codex | code-review-adversarial | pending | | high | Phase 6b dogfood 5-vendor audit. codex with gpt-5.5 + reasoning xhigh. Independent cross-check of probe+cache implementation (commit ed16903); looks for things both prior codex rounds R1/R2 missed. | codex |
| T-AUDIT-PH6B-kimi | code-review-adversarial | pending | | high | Phase 6b dogfood 5-vendor audit. kimi with -m kimi-thinking. KNOWN TIMEOUT RISK — adapter hardcodes 180s; prior T-AUDIT-PH5-kimi failed silently. This run will surface whether the timeout issue is reproducible. | kimi |
| T-AUDIT-PH6B-opencode | code-review-adversarial | pending | | high | Phase 6b dogfood 5-vendor audit. opencode with --model deepseek/deepseek-v4-flash + reasoning high. Second-tier vendor cross-check; first time deepseek-v4-flash is dispatched as an audit reviewer. | opencode |
| T-AUDIT-PH6B-copilot | code-review-adversarial | pending | | high | Phase 6b dogfood 5-vendor audit. copilot with --model claude-sonnet-4.6. Sonnet 4.6 is a step up from copilot default (Sonnet 4.5); meters premium quota per call. | copilot |
| T-AUDIT-PH6B-agy | code-review-adversarial | pending | | high | Phase 6b dogfood 5-vendor audit. agy (Antigravity); model gemini-3.5-flash baked into binary; no --model / --reasoning flags. agy quirk: silent auth-fail (empty stdout, exit 0) when OAuth missing — adapter detects via log file. | agy |
| T-AUDIT-PH6C-codex | code-review-adversarial | pending | | high | Phase 6c re-run 5-vendor audit (commit fe9a79f). codex with gpt-5.5 + reasoning xhigh. Review task-types now floor at 30min (was 900s). Audit Phase 6b implementation (commit ed16903) — primary, with Phase 6c (fe9a79f) as secondary scope. | codex |
| T-AUDIT-PH6C-kimi | code-review-adversarial | pending | | high | Phase 6c re-run 5-vendor audit. kimi with -m kimi-thinking. Phase 6c wires --thinking flag (opts.reasoning truthy). Soft-warn now prints TOML block snippet if alias missing. Will still fail if user hasn't added [models.kimi-thinking] to ~/.kimi/config.toml. | kimi |
| T-AUDIT-PH6C-opencode | code-review-adversarial | pending | | high | Phase 6c re-run. opencode with --model deepseek/deepseek-v4-flash + reasoning high. 30min floor now applies (was 180s). | opencode |
| T-AUDIT-PH6C-copilot | code-review-adversarial | pending | | high | Phase 6c re-run. copilot with --model claude-sonnet-4.6. 30min floor (was 120s — the most aggressively misaligned). | copilot |
| T-AUDIT-PH6C-agy | code-review-adversarial | failed | | high | Phase 6c re-run. agy resolved via knownInstallPaths (~/AppData/Local/agy/bin/agy.exe). Hit auth-fail (no OAuth token). NOTE: this row was contaminated 2026-05-21 by copilot sub-agent claiming agy completed the review — corrected here per ground-truth frontmatter in `.hopper/handoffs/T-AUDIT-PH6C-agy-output.md` (adapter_status: auth-fail). | agy |
| T-AUDIT-PH6C-kimi-v2 | code-review-adversarial | done | | high | Phase 6c re-run of kimi WITHOUT --model (corrected per user 2026-05-21: kimi has implicit default; -m only needed for explicit non-default alias). Dispatch: --reasoning high (adapter maps to --thinking; default model implicit). | kimi |
| T-PROG-R07-RESEARCH-codex | code-impl | pending | | high | Research three-platform native toast invocation, quoting, timeout, and injection-prevention idioms for v1.1 R07 OS notify helper. | codex |
| T-PROG-R07-REVIEW-opencode | code-review-adversarial | pending | | high | Adversarial review of v1.1 R07 OS notify helper and watch-events integration after commits land. | opencode |
| T-PROG-R14-RESEARCH | code-impl | pending | | high | Research chokidar truncate/rotate idioms for v1.1 R14 dashboard tail. Dogfood task for v1.0 monitor. | codex |
| T-PROG-R14-REVIEW-kimi | code-review-adversarial | pending | | high | Adversarial review of v1.1 R14 dashboard progress bridge commits. | kimi |
| T-PROG-R15-REVIEW-opencode | code-review-adversarial | pending | | high | Adversarial UI review of v1.1 R15 dashboard progress tab, status strip, a11y, perf, and token consistency. | opencode |
| T-FIX-PWHANG | code-impl | pending | | high | Fix the progress-watch.test.js hang (see ISSUE-progress-watch-hang.md). The test file never exits and `--watch-events --once` can hang forever. Root-cause the leaked handle, make runWatchEvents release its timers/watchers and give --once a bounded exit, then verify `node --test tests/unit/*.test.js` completes green with NO file exclusion. ALWAYS bound test runs while investigating (the suite hangs). | opencode |

---

## Activity log

- 2026-05-20 (Phase 3): T-PLUGIN-06 + T-PLUGIN-07 dispatched as Strategy-as-developer per user goal 2026-05-19. Mini-audit checkpoint after T-06: codex returned FIX_AND_RECHECK with 4 P1/P2 findings (format fidelity, lossy long outputs, task.id path safety, markdown injection). All 4 fixed in commit 7b8624c; recheck verdict PROCEED_TO_T07. T-07 wired 4 slash commands (dispatch/status/smoke/vendors) as commands/*.md prompt templates, simplified plugin.json to standard schema (removed tentative commands/entry/permissions blocks). 158/158 tests pass.



> Each pop / done / failed by popping session appends a line. Format per PING.md §Step 3 / §Step 7.

- queue initialized at 2026-05-20T02:42:00+08:00 by strategy-primary (claude-opus-4-7) — 11 tasks v1.1.1 schema
- queue migrated to v2 schema at 2026-05-20T03:30:00+08:00 by strategy-primary — Task-type column primary; added T-PLUGIN-00b (vendor spike), T-PLUGIN-00.5 (tasks library), T-PLUGIN-05a-e (5 vendor adapters), T-PLUGIN-08a/b (2 host adapters); total 18 tasks; per spec v2.0 amendments A (task-based) + B (no-harness-core) + C (5-vendor scope per user decision C+)
- queue patched at 2026-05-20T<later> by strategy-primary — T-PLUGIN-04.5 vendor adapter contract task added (codex F5 fix); T-PLUGIN-05e brief updated to Gemini (not Antigravity; codex F4 fix); adapter line counts revised; total 19 tasks; per spec v2.0.1 codex audit response
- T-PLUGIN-00 started at 2026-05-20T22:30:00+08:00 by strategy-as-developer (claude-opus-4-7) — per user directive demo阶段由Strategy直接开发
- T-PLUGIN-00b started at 2026-05-20T22:30:00+08:00 by strategy-as-developer (parallel with T-00)
- T-PLUGIN-00.5 started at 2026-05-20T22:30:00+08:00 by strategy-as-developer (parallel)
- T-PLUGIN-00 done at 2026-05-20T23:15:00+08:00 — Verdict PASS_WITH_NOTE; resolved values locked in docs/spikes/T-PLUGIN-00-resolved.md; Prong 1 install user-blocked but not blocker for Phase 1
- T-PLUGIN-00 status reverted to in-progress at 2026-05-20T23:50:00+08:00 by strategy-as-developer (claude-opus-4-7) — Codex Phase 0 audit F2 finding: marking Prong 1 user-blocked as `done` violated PING.md Step 6 manual-verify rule. Task stays in-progress until user installs plugin + confirms `/hopper:smoke` output. Prong 2 + Prong 3 verification stands; Phase 1 plumbing tasks (T-01/02/03/04) can proceed since they don't depend on Prong 1 install, but T-07 (Claude Code slash wiring) is blocked on Prong 1 confirm.
- T-PLUGIN-00b re-verified at 2026-05-20T<later>+08:00 by strategy-as-developer — Path A initial resolution: Kimi membership restored (HOPPER_KIMI_OK), Copilot installed (HOPPER_COPILOT_OK), Gemini installed (HOPPER_GEMINI_OK).
- T-PLUGIN-00b updated 2026-05-20T<later2>+08:00 by strategy-as-developer — User decision "移除gemini cli, 替换成agy". Gemini swapped out of functional pool; Antigravity (agy v1.0.0) swapped in. agy smoke diagnosed as silent auth-fail (exit 0 + empty stdout = not OAuth-authed). User OAuth completion pending. 4/5 vendors smoke-verified (Codex+Kimi+OpenCode+Copilot); agy adapter implementation can proceed in parallel under unified user-action gate per spec §11.
- Phase 1 batch started 2026-05-20T<later3>+08:00 by strategy-as-developer (claude-opus-4-7) — T-PLUGIN-01/02/03/04/04.5 all in-progress in parallel per spec §7 timeline.
- T-PLUGIN-04.5 done at 2026-05-20T<later3>+08:00 — VendorAdapter contract + runSubprocessOnce shared wrapper; 11 unit tests pass; no orchestration logic verified via grep.
- T-PLUGIN-02 done at 2026-05-20T<later3>+08:00 — queue.md v2 parser; 12 unit tests pass; v1 Role-column legacy fallback verified.
- T-PLUGIN-03 done at 2026-05-20T<later3>+08:00 — tasks library loader + anti-persona verifier; 11 unit tests pass; all 6 existing frames verified anti-persona-clean.
- T-PLUGIN-04 done at 2026-05-20T<later3>+08:00 — AGENTS parser + deterministic vendor router; 7 unit tests pass; 10-call determinism test confirms no state leakage.
- T-PLUGIN-01 done at 2026-05-20T<later3>+08:00 — repo init + plugin manifest (Phase 0 + Phase 1); E2E smoke against actual queue.md works; Prong 1 install user-verify separate unified user-action gate.
- Phase 2 batch started at 2026-05-20T<later4>+08:00 by strategy-as-developer — T-PLUGIN-05a/b/c/d/e in parallel.
- T-PLUGIN-05a done at 2026-05-20T<later4>+08:00 — Codex adapter; 9 contract tests pass.
- T-PLUGIN-05b done at 2026-05-20T<later4>+08:00 — Kimi adapter with 402 membership detection; 9 tests pass.
- T-PLUGIN-05c done at 2026-05-20T<later4>+08:00 — OpenCode adapter; 9 tests pass; pin 0.14.7 advisory only.
- T-PLUGIN-05d done at 2026-05-20T<later4>+08:00 — Copilot adapter with quota detection; 9 tests pass.
- T-PLUGIN-05e done at 2026-05-20T<later4>+08:00 — agy adapter with silent auth-fail detection per codex F2; 22 tests pass (10 contract + 12 quirks); real smoke gated on user OAuth.
- Phase 2 wiring: dispatch.js gained `executeDispatch` (preflight + spawn + parseResult chain); cli/src/vendors/index.js registry; bin/hopper-dispatch v0.3.0-phase-2 with --vendors flag + real spawn entry. 107 total tests pass.
- T-PLUGIN-00b done at 2026-05-20T23:15:00+08:00 — Verdict PASS_WITH_NOTE; 2 of 5 vendors fully smoke-verified (Codex + OpenCode); Kimi auth blocked; Copilot/Gemini not installed; documented for user-action
- T-PLUGIN-00.5 done at 2026-05-20T23:15:00+08:00 — Verdict PASS; 6 .hopper/tasks/*.md frames written; anti-persona test passes
- T-AUDIT-PH6C-kimi-v2 done at 2026-05-21T19:00:41+08:00 — Verdict PASS_WITH_CHANGES; 2 P1 + 5 P2 findings; 7 findings total (F1 missing background integration test, F2 mutable REVIEW_TASK_TYPES Set, F3 misleading JSDoc, F4 no runtime path validation, F5 probe/dispatch inconsistency, F6 hint gated on cache metadata, F7 kimi reasoning case-sensitivity); output: .hopper/handoffs/T-AUDIT-PH6C-kimi-v2-output.md
