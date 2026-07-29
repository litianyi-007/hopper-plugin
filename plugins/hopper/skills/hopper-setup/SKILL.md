---
name: hopper-setup
description: "Use when the user wants a Hopper vendor readiness check or doctor — which vendor CLIs are installed and authenticated, which support sandbox control or web search, cached/known models, and (with --deep) live model-catalog drift. Triggers: 'hopper setup', 'hopper doctor', 'are my vendors ready', 'check vendor health', 'which vendors can I dispatch to'."
---

# Hopper Setup / Doctor

Report per-vendor readiness before dispatching: installed? · authenticated? · sandbox control · web-search · models · capability freshness. This is the consolidated `--setup` / `--doctor` diagnostic — a read-only registry+filesystem check that does NOT need a `.hopper/` project directory, so it runs from anywhere.

## Steps

1. Locate `hopper-dispatch` from `PATH` or the plugin root near this `SKILL.md` (no `.hopper/` project lookup is required — `--setup` computes from the static adapter registry plus per-vendor install/auth checks).
2. Run the readiness report:
   - All vendors: `hopper-dispatch --setup` (alias: `hopper-dispatch --doctor`).
   - One vendor: `hopper-dispatch --setup <vendor>`.
   - Deep diagnostics: add `--deep` to also check flag/parameter drift (`<vendor> --help` vs the flags the adapter emits) AND reconcile each vendor's live-enumerated model catalog against the hardcoded `knownGood` defaults. `--deep` spawns `<vendor> --help` and the model-enumeration probe once per vendor and refreshes the probe cache.
3. Surface the table. Guidance for routing the next task:
   - Confirm Installed=yes + Auth=ok before routing to a vendor. For Grok, `auth_context` is deliberately `unverified` (`key-present-unverified`, `credential-artifact-present-unverified`, `not-detected`, or `unknown`): it is a zero-spawn local context signal for the Hopper Node parent, not remote-auth proof. Interactive/browser state in another session may not be inherited.
   - Research / PRD / market tasks that need the web → a vendor with WebSrch=yes.
   - Review / read-only tasks → prefer Sandbox=argv (read-only is actually enforced via flags), not native or full. Sandbox=full means always full-access, not downgradable by any flag (codex: broken Windows `-s` sandbox always bypasses; grok: `--permission-mode` stays `bypassPermissions` regardless of the requested sandbox) — hopper's two built-in reviewer defaults (codex, grok) are both `full`, so for those, read-only is a prompt-frame *request*, not an OS-enforced boundary; `--subject-root` (macOS, opt-in) is the only genuine per-process guard.
   - Under `--deep`, a `DRIFT` model row is advisory (the live bundled list can differ from what an account can actually use); `driftExpected` names are suppressed so DRIFT only fires on a genuinely new model.

## Safety

- Read-only. Do NOT auto-install or auto-authenticate any vendor. If one is missing or unauthed, point the user at `hopper-smoke` and the install matrix; surface the auth notes rather than acting. Never invoke `grok login`, set `XAI_API_KEY`, or run a Grok authentication smoke from `--setup`/`--check`; a Grok `READY` status is only binary-dispatch readiness.
- `--deep` is opt-in and single-attempt per vendor (distinct from the dispatch single-spawn invariant); it is the only mode that spawns subprocesses here.
- The authoritative model/effort/sandbox matrix is `hopper-dispatch --rules`; `--setup` is the readiness layer on top.
