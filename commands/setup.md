---
description: Vendor readiness report — for every registered vendor show installed/auth/models/sandbox-control/web-search in one table, so you know what's usable before dispatching.
allowed-tools: Bash
argument-hint: [vendor] [--deep]
---

This command runs inside a Claude Code session. It accepts an optional vendor name and an optional `--deep` flag.

Print the consolidated vendor readiness report:

```bash
node "$CLAUDE_PLUGIN_ROOT/cli/bin/hopper-dispatch" --setup
```

For a single vendor, or to add the `--deep` diagnostics — flag/parameter drift (`<vendor> --help` vs the flags the adapter emits) **and** live model-catalog reconciliation (enumerate the vendor's current models and diff them against hopper's hardcoded `knownGood` defaults). `--deep` spawns the `--help` and model-enumeration probes once per vendor and refreshes the probe cache:

```bash
node "$CLAUDE_PLUGIN_ROOT/cli/bin/hopper-dispatch" --setup codex --deep
```

## What it reports (per vendor)

- **Installed** — is the vendor CLI resolvable on PATH (or a known install path)?
- **Auth** — is auth detected (`ok`), or missing/unverified (`NO`)? See the auth notes for how to fix. **Grok is special:** its `auth_context` is only a zero-spawn, non-secret check of the Hopper Node parent's local credential context. It is rendered as `unverified` (`key-present-unverified`, `credential-artifact-present-unverified`, `not-detected`, or `unknown`), never as remote-auth proof; an interactive/browser session elsewhere may not be inherited.
- **Sandbox** — `argv` means the read-only argv genuinely differs from full-access AND carries no permission flag that grants unconditional write access regardless of mode (hopper can force a real downgrade) — e.g. **codex on macOS/Linux** (its own `-s read-only` sandbox is verified working: a write attempt fails with `operation not permitted`). `full` means the vendor always runs full-access and is NOT downgradable — either because the argv is identical for both modes, or because it differs on paper but the read-only form still carries an unconditional-access flag/permission-mode (**codex on Windows**: `-s` sandbox cannot spawn child processes there so it always bypasses via `--dangerously-bypass-approvals-and-sandbox`; **grok, every platform**: `--permission-mode` stays `bypassPermissions` regardless of the requested sandbox — only the unrelated `--always-approve` flag varies). This column reflects the platform `--setup` is actually run on, so codex shows `argv` on a macOS/Linux host and `full` on a Windows host. `native` means the vendor only honors its own permission policy and carries no sandbox flag at all (e.g. kimi) — also not argv-downgradable.
- **WebSrch** — `yes` means the adapter plumbs a web-search toggle headlessly (needed for research / market-research tasks): **codex, claude, grok, kimi**. `manual` (copilot, mimo) means the vendor can search but needs env/config; `no` (opencode, agy) means unsupported out of the box.
- **Models** — how many models are in the probe cache; run `/hopper:probe <vendor>` (or `--probe`) to populate. `--deep` refreshes this live.
- **Caps stale** — the date the adapter's hand-recorded capability metadata should be re-verified; `STALE …` means it has passed.

With `--deep`, two extra sections print after the table:

- **Flag/param drift** — per vendor, whether the flags the adapter emits are still present in `<vendor> --help`.
- **Model catalog drift** — per vendor, `OK` or `DRIFT` comparing the live-enumerated catalog against the hardcoded `knownGood`: `STALE default(s)` are names hopper ships that the vendor no longer lists, and `NEW live model(s)` are names the vendor now lists that hopper hasn't adopted. It is **advisory** — the live source can differ from what an account can actually use, so treat it as a prompt to review the adapter's `knownGood`, not an auto-edit. An adapter may declare a `modelArg.driftExpected` list (names whose divergence is intentional — e.g. a Pro-only model absent from the free bundle, or an internal model deliberately not promoted); those are suppressed so the verdict stays `OK` until a *genuinely new* model appears.

## How to use the output

- Before routing a task to a vendor, confirm it shows Installed=yes + Auth=ok. For Grok, treat `status=READY` only as binary-dispatch readiness: `auth_context` is not a login verdict and this command must not trigger `grok login`, set a secret, or run an authentication smoke.
- For a **research / PRD / market** task that needs the web, route only to a vendor whose **WebSrch=yes**.
- For a **review / read-only** task, prefer a vendor whose **Sandbox=argv** so read-only is actually enforced. Note hopper's two built-in reviewer defaults — **codex** (acceptance) and **grok** (adversarial) — are both `full`, i.e. always full-access and not downgradable via any flag; for those, read-only is a *request* carried by the executor prompt frame only, and `--subject-root` (macOS, opt-in) is the only genuine per-process guard (see `/hopper:review`'s caveats).
- The authoritative model/effort/sandbox matrix is `/hopper:vendors` + `hopper-dispatch --rules`; `--setup` is the readiness layer on top.

Surface the table to the user. If any vendor is NOT installed or Auth=NO, point them at `/hopper:smoke` and the install matrix; do not auto-install or auto-authenticate.
