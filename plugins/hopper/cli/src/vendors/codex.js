// Codex vendor adapter (T-PLUGIN-05a)
// Anchor: cli/src/vendors/codex.js
//
// Implements VendorAdapter contract per cli/src/types.js.
// Per spec §3 #4: thin wrapper, ZERO retry/fallback/circuit-breaker.
// Per T-PLUGIN-00 Prong 2 resolved: codex exec is the noninteractive form.

import {
  existsSync, mkdirSync, copyFileSync, symlinkSync, lstatSync, readlinkSync, statSync, unlinkSync,
  readFileSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { applyTaskTypeFloor } from '../subprocess.js';

/**
 * HOPPER-3: build the `-c key=value` overrides that isolate a dispatched codex
 * from the dispatching machine's global config. Without this, `codex exec`
 * loads ~/.codex/config.toml + AGENTS.md (global and project) + marketplace
 * skills + the notify hook from the HOST, which contaminates the vendor run and
 * breaks deterministic dispatch (spec §3 #4, Host != Vendor). On a hopper dev
 * box this is acute: codex would load hopper's OWN marketplace skills while
 * being dispatched BY hopper — a feedback loop.
 *
 * `-c key=value` is the highest-precedence config layer and overrides every
 * config file (verified: developers.openai.com codex config-reference; the
 * precedence table at codex.danielvaughan.com). We override the two keys that
 * `-c` reliably controls:
 *   - project_doc_max_bytes=0 → stop reading AGENTS.md / project + global docs
 *   - notify=[]               → disable the notify hook (a program-argv array)
 *
 * What `-c` CANNOT do: disable globally-installed marketplace skills for a
 * single invocation (openai/codex#20210 — project-scoped skill filtering is
 * unimplemented upstream). Skills are isolated instead by pointing codex at an
 * auto-built, login-preserving CODEX_HOME — see resolveIsolatedCodexHome().
 *
 * Escape hatches (no code change needed):
 *   - HOPPER_CODEX_ISOLATE=0          → disable ALL isolation (these overrides
 *                                        AND the CODEX_HOME swap), e.g. if a
 *                                        future codex changes a key's type and
 *                                        the override would error.
 *   - HOPPER_CODEX_EXTRA_CONFIG="a=b,c=d" → append extra `-c` overrides.
 *
 * @returns {string[]} flat argv fragments, e.g. ['-c', 'project_doc_max_bytes=0', ...]
 */
export function codexIsolationConfig() {
  if (process.env.HOPPER_CODEX_ISOLATE === '0') return [];
  const pairs = ['project_doc_max_bytes=0', 'notify=[]'];
  const extra = process.env.HOPPER_CODEX_EXTRA_CONFIG;
  if (extra) {
    for (const kv of extra.split(',')) {
      const trimmed = kv.trim();
      if (trimmed) pairs.push(trimmed);
    }
  }
  return pairs.flatMap((p) => ['-c', p]);
}

/**
 * Disable codex's global orchestration for a dispatched run so the piped brief
 * is the only instruction (ISSUE-codex-callchain-windows). `--disable <feature>`
 * is codex 0.131.0's in-invocation override (= `-c features.<name>=false`; it
 * does NOT write config):
 *   - multi_agent          → no owner/reviewer SUB-AGENT spawns (those sub-spawns
 *                            also hit the Windows CreateProcessWithLogonW 1326)
 *   - hooks / plugin_hooks → no Pre/Post/Stop hook-driven meta-orchestration
 * Without this, global marketplace plugins (e.g. superpowers) re-derive an
 * unrelated task and emit confident OFF-TASK output (a false success).
 * Escape hatch: HOPPER_CODEX_KEEP_ORCHESTRATION=1 keeps codex's defaults.
 * @returns {string[]}
 */
export function codexOrchestrationDisableFlags() {
  if (process.env.HOPPER_CODEX_KEEP_ORCHESTRATION === '1') return [];
  return ['multi_agent', 'hooks', 'plugin_hooks'].flatMap((f) => ['--disable', f]);
}

/**
 * HOPPER-3 (auto-isolation): build a cached, login-preserving CODEX_HOME that
 * has the user's auth but NOT their globally-installed marketplace skills, so a
 * dispatched codex runs deterministically with ZERO user setup.
 *
 * codex resolves its home as `$CODEX_HOME || ~/.codex` — a deterministic 1–2
 * candidate lookup (we mirror codex's own rule, not a guess). We discover that
 * real home, then materialize an isolated home (default ~/.hopper/codex-isolated,
 * override via HOPPER_CODEX_HOME) containing:
 *   - auth.json   → symlinked to the real one so token refresh stays live;
 *                   copied as a fallback where symlinks need privilege (Windows).
 *   - config.toml → copied if present (model/provider/MCP config preserved; the
 *                   notify hook is still neutralized by the -c override).
 *   - NO skills/ directory → the host's global marketplace skills do not load.
 *
 * Returns the isolated home path, or null meaning "leave CODEX_HOME as-is"
 * (isolation disabled, no discoverable auth to preserve, or a build failure) —
 * codex then runs against its default home with only the -c overrides applied.
 * Never spawns a subprocess (single-spawn invariant intact).
 *
 * @returns {string|null}
 */
export function resolveIsolatedCodexHome() {
  if (process.env.HOPPER_CODEX_ISOLATE === '0') return null;

  const realHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  const realAuth = join(realHome, 'auth.json');
  const haveAuthFile = existsSync(realAuth);
  const haveAuthEnv = Boolean(process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY);
  // Building an isolated home with no auth would strip the user's login. Only
  // isolate when auth can be preserved (a discoverable auth.json, or an env key
  // codex reads directly). Otherwise fall back to the default home + -c.
  if (!haveAuthFile && !haveAuthEnv) return null;

  const isoHome = process.env.HOPPER_CODEX_HOME || join(homedir(), '.hopper', 'codex-isolated');
  // Never let the isolated home BE — or live INSIDE — the real home: that would
  // defeat isolation and risk hopper writing/symlinking into the real ~/.codex
  // tree (e.g. a stray HOPPER_CODEX_HOME=~/.codex/sub). Default location is
  // safely outside the real home.
  const isoResolved = resolve(isoHome);
  const realResolved = resolve(realHome);
  if (isoResolved === realResolved || isoResolved.startsWith(realResolved + sep)) return null;

  try {
    mkdirSync(isoHome, { recursive: true });
    if (haveAuthFile) linkOrCopy(realAuth, join(isoHome, 'auth.json'));
    const realCfg = join(realHome, 'config.toml');
    // ISSUE-codex-review-hijack: copy config.toml but STRIP skill registrations.
    // The skill-free isoHome/skills already excludes DIRECTORY skills, but
    // config-registered skills ([[skills.config]] absolute paths / a [skills]
    // table) would otherwise be re-introduced by copying the host config — which
    // is exactly how gstack/superpowers/cli-audit skills hijacked dispatched
    // reviews. Sanitizing keeps model/provider/MCP config intact.
    if (existsSync(realCfg)) writeSanitizedCodexConfig(realCfg, join(isoHome, 'config.toml'));
    // Intentionally never create isoHome/skills — that omission IS the isolation.
    return isoHome;
  } catch (_) {
    return null;  // any build error → safe fallback to default home + -c overrides
  }
}

/** Symlink src→dest (preferred — keeps token refresh live); copy as fallback. */
function linkOrCopy(src, dest) {
  try {
    if (lstatExists(dest)) {
      try {
        const st = lstatSync(dest);
        if (st.isSymbolicLink() && resolve(readlinkSync(dest)) === resolve(src)) return;
      } catch (_) {}
      try { unlinkSync(dest); } catch (_) {}
    }
    try { symlinkSync(src, dest); return; } catch (_) { /* privilege/unsupported → copy */ }
    copyFileSync(src, dest);
  } catch (_) { /* leave whatever exists; resolveIsolatedCodexHome() will catch */ }
}

/** lstat-based existence check that also sees broken symlinks. */
function lstatExists(p) {
  try { lstatSync(p); return true; } catch (_) { return false; }
}

/** Copy src→dest only when src is newer than dest (or dest is absent). */
function refreshCopy(src, dest) {
  try {
    if (existsSync(dest)) {
      try { if (statSync(dest).mtimeMs >= statSync(src).mtimeMs) return; } catch (_) {}
    }
    copyFileSync(src, dest);
  } catch (_) { /* best-effort */ }
}

/**
 * Strip host orchestration from a codex config.toml so a dispatched, isolated
 * codex runs ONLY the piped brief (ISSUE-codex-review-hijack +
 * ISSUE-codex-callchain-windows). Removes the `[skills...]`, `[plugins...]`,
 * `[marketplaces...]`, and `[[hooks...]]`/`[hooks...]` tables (plus their bodies,
 * up to the next table header). codex 0.131.0 moved global skills to marketplace
 * PLUGINS (e.g. `[plugins."superpowers@openai-curated"]`) and drives
 * meta-orchestration via Pre/Post/Stop hooks — the old skills-only strip missed
 * both, so dispatched reviews kept getting hijacked. Leaves model/provider/MCP/
 * sandbox/auth config untouched. Pure — exported for unit testing.
 * @param {string} toml
 * @returns {string}
 */
export function stripCodexSkillsConfig(toml) {
  const lines = String(toml ?? '').split(/\r?\n/);
  const isTableHeader = (l) => /^\s*\[\[?[^\]]+\]\]?\s*(#.*)?$/.test(l);
  // codex 0.131.0 hijacks the brief via marketplace plugins (e.g.
  // [plugins."superpowers@openai-curated"]) + [marketplaces.*] + Pre/Post/Stop
  // [[hooks.*]] — none of which the old skills-only strip removed.
  const isHijackHeader = (l) => /^\s*\[\[?\s*(skills|plugins|marketplaces|hooks)(\.|\s|\]|\b)/i.test(l);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (isTableHeader(line)) {
      skipping = isHijackHeader(line);
      if (skipping) continue;          // drop the hijack table header itself
    }
    if (!skipping) out.push(line);     // keep preamble + model/provider/MCP/sandbox + bodies
  }
  return out.join('\n');
}

/** Read src config, strip skill registrations, write to dest (idempotent). */
function writeSanitizedCodexConfig(src, dest) {
  try {
    const cleaned = stripCodexSkillsConfig(readFileSync(src, 'utf-8'));
    if (existsSync(dest)) {
      try { if (readFileSync(dest, 'utf-8') === cleaned) return; } catch (_) {}
    }
    writeFileSync(dest, cleaned, 'utf-8');
  } catch (_) { /* best-effort; leave whatever exists */ }
}

/**
 * Whether codex should bypass its own sandbox harness
 * (`--dangerously-bypass-approvals-and-sandbox`) instead of honoring the
 * requested `-s <mode>` argv. Platform-split (2026-07-31 reversal of the
 * 2026-06-25 "codex has NO read-only scenario" decision):
 *
 *   - **Windows**: codex's `-s` sandbox harness cannot spawn ANY child process
 *     (`CreateProcessWithLogonW` fails with 1326 — ISSUE-codex-callchain-windows
 *     / ISSUE-codex-windows-sandbox-1326), so bypass stays the DEFAULT there.
 *     `HOPPER_CODEX_SANDBOX_BYPASS=0` is the escape hatch that turns bypass OFF
 *     (falls through to a real, broken `-s` sandbox — for testing only).
 *   - **macOS / Linux**: codex's own `-s <mode>` sandbox is VERIFIED WORKING —
 *     manually verified 2026-07-31: `codex exec -s read-only ... "echo x >
 *     f"` denies the write (`operation not permitted`, file never created),
 *     while `--dangerously-bypass-approvals-and-sandbox` with the same command
 *     creates the file. Honoring `-s <mode>` is now the DEFAULT there.
 *     `HOPPER_CODEX_SANDBOX_BYPASS=1` is the escape hatch that turns bypass ON
 *     (opts IN to the old always-full-access-no-OS-sandbox behavior).
 *
 * THE ESCAPE HATCH'S DEFAULT MEANING IS REVERSED BETWEEN THE TWO BRANCHES —
 * same env var, opposite polarity. On Windows, `=0` DISABLES bypass (dangerous:
 * re-enables the sandbox harness that cannot spawn children). On macOS/Linux,
 * `=1` ENABLES bypass (drops back to no-OS-sandbox-at-all). Do not assume "=0
 * always means off"; the meaning depends on which platform is running.
 *
 * @param {NodeJS.Platform} [platform] injectable for tests (defaults to the
 *   real host platform; production callers never override this)
 * @returns {boolean}
 */
export function codexSandboxBypassActive(platform = process.platform) {
  return platform === 'win32'
    ? process.env.HOPPER_CODEX_SANDBOX_BYPASS !== '0'
    : process.env.HOPPER_CODEX_SANDBOX_BYPASS === '1';
}

/** @type {import('../types.js').VendorAdapter} */
export const codexAdapter = {
  name: 'codex',
  command: 'codex',
  stdinMode: 'none',
  // Prompt-delivery capability (Windows cmd.exe-shim multi-line truncation fix).
  // `codex exec -` reads the full prompt from stdin (help + docs + repro confirmed),
  // which survives the cmd.exe `.cmd` shim that truncates a multi-line argv positional.
  // The delivery layer routes to stdin ONLY on the win-cmd-shim regime; argv elsewhere.
  // Default ON (proven); env opt-out HOPPER_CODEX_STDIN=0.
  promptStdin: 'supported',
  promptStdinDefault: true,

  // Phase 6a static capability hint (no live vendor introspection — would
  // break single-spawn proof). Source: docs/research/.
  capabilities: {
    modelArg: {
      accepted: 'freeform',
      // The model hopper prefers for hopper-shaped work (adversarial review,
      // acceptance review, high-reasoning judgment). Same value the sentinel
      // already inferred from knownGood[0]; declaring it explicitly means the
      // ORDERING CONVENTION documented below is no longer load-bearing — a
      // reordering of the catalog can no longer silently change what
      // `verified-latest` dispatches to.
      hopperDefault: 'gpt-5.6-sol',
      // ISSUE-codex-vendor-model-effort (2026-06): adapter now forwards opts.model
      // as `-m <MODEL>`. ChatGPT-account auth accepts BARE names only — provider-
      // prefixed ids (openai-codex/gpt-5.1-codex) are rejected (openai/codex#12295).
      // Catalog is subscription-dependent; `hopper-dispatch --probe codex`
      // reconciles `codex debug models` with Codex's account-aware cache.
      // gpt-5.6-sol / gpt-5.6-terra / gpt-5.6-luna: V-verified 2026-07-17 via live
      // micro-test on codex CLI 0.144.5; requires codex CLI >= 0.144 (older CLIs 400
      // with 'requires a newer version of Codex' — observed live on 0.142.5). This is
      // exactly the --check-model catalog-only/verified distinction in practice: the
      // bundled catalog listed these three on 0.142.5 too, but they 400'd there — only
      // promote a model out of catalog-only and into knownGood after a live dispatch
      // confirms it on the CLI version actually installed.
      //
      // ORDERING CONVENTION (batch 2, 2026-07): index 0 is the CURRENT preferred/
      // verified model for this vendor — `cli/src/policy.js`'s `resolveVerifiedLatest()`
      // reads knownGood[0] to resolve the AGENTS.md `Model rule: verified-latest`
      // sentinel (and `hopper-dispatch --model verified-latest`). Keep the newest
      // live-confirmed generation FIRST when you promote it out of catalog-only —
      // that is the whole point of the sentinel (callers get "whatever's current"
      // without hard-coding a model string). gpt-5.6-sol leads for that reason.
      knownGood: [
        'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
        'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark',
      ],
      // V3 drift-suppression: names whose absence-from / presence-in the live
      // `codex debug models` catalog is EXPECTED, so doctor --deep does
      // not flag them. `gpt-5.3-codex-spark` is ChatGPT-Pro-only (absent from the
      // free bundle → would false-STALE). `codex-auto-review` is an internal
      // review model and `gpt-5.2` is an older/superseded model — both ship in the
      // bundle but are intentionally NOT promoted as dispatch defaults (→ false-NEW).
      // A genuinely-new model codex ships will still surface as NEW (the useful signal).
      driftExpected: ['gpt-5.3-codex-spark', 'codex-auto-review', 'gpt-5.2'],
      sourceNote: 'codex exec -m <MODEL>; adapter forwards opts.model verbatim (ISSUE-codex-vendor-model-effort, 2026-06; V1-verified 2026-06). ChatGPT-account auth accepts BARE model names only (gpt-5.5 / gpt-5.4 / gpt-5.4-mini / gpt-5.3-codex); provider-prefixed names rejected (openai/codex#12295). gpt-5.3-codex-spark is a ChatGPT-Pro-only research preview (conditional — not on every account). gpt-5.6-sol / gpt-5.6-terra / gpt-5.6-luna: V-verified 2026-07-17 via live micro-test on codex CLI 0.144.5; requires codex CLI >= 0.144 (older CLIs 400 with "requires a newer version of Codex" — observed live on 0.142.5). Effort is SEPARATE from the model name: --reasoning -> -c model_reasoning_effort. Account catalog: `hopper-dispatch --probe codex` combines `codex debug models` with `$CODEX_HOME` (or `~/.codex`) `models_cache.json`, rejecting stale, version-mismatched, or conflicting cache data (V3 doctor --deep reconciles it; see driftExpected).',
    },
    reasoningArg: {
      accepted: 'enumerated',
      // Phase 6b vendor-introspection research 2026-05-21: codex supports 5
      // reasoning levels per official config-reference, not 4. `minimal` is
      // the lowest tier (cheap routing/extraction use cases).
      knownGood: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      sourceNote: 'docs/research/async-execution/01-openai-hosts.md + docs/research/vendor-introspection/01-codex-opencode.md (live: 5 levels, including `minimal` previously missed).',
    },
    features: {
      sessionResume: { supported: true, mechanism: '`codex exec resume <SESSION_ID>` — hopper does not currently auto-capture session_id' },
      fileOutput: { supported: true, mechanism: '`--output-last-message <path>` exists (NOT currently used by adapter)' },
      streaming: { supported: true, mechanism: 'codex exec streams progress to stderr; final message to stdout' },
    },
    webSearch: { headless: true, hopperEnabled: true, how: 'cached on by default; --search forwards LIVE web_search when opts.webSearch (2026 research)' },
    staleAfter: '2026-08-21',
  },

  args(input, opts) {
    const sandbox = opts.sandbox ?? 'danger-full-access';
    // 2026-07-31 platform split (reverses the 2026-06-25 "codex has NO read-only
    // scenario" decision) — see codexSandboxBypassActive() jsdoc for the full
    // rationale + verified evidence. `opts.platform` is a test-only override
    // (real dispatch always uses the host's actual process.platform).
    const platform = opts.platform ?? process.platform;
    const bypassSandbox = codexSandboxBypassActive(platform);
    const sandboxArgs = bypassSandbox
      ? ['--dangerously-bypass-approvals-and-sandbox']
      : ['-s', sandbox];
    // ISSUE-codex-bypass-flag-missing-from-argv (run #1 footgun): when the vendor
    // CWD is widened to a non-git root (HOPPER_VENDOR_CWD), `codex exec` aborts
    // early with "Not inside a trusted directory and --skip-git-repo-check was not
    // specified" — codex never runs. Manually verified 2026-07-31: this trust gate
    // fires for a REAL `-s read-only` sandbox exactly the same way it fires for the
    // full-access bypass path (same error, same non-git-dir trigger) — it is not
    // specific to bypass mode. So `--skip-git-repo-check` now rides along on EVERY
    // mode, not just the bypass path (`--skip-git-repo-check` is a documented
    // `codex exec` flag; it only affects the trust gate, not sandbox enforcement —
    // a real `-s read-only` invocation still denies writes with the flag present,
    // verified in the same test). Escape hatch: HOPPER_CODEX_SKIP_GIT_CHECK=0 keeps
    // codex's default trust-gate behavior on every mode.
    const skipGitArgs = process.env.HOPPER_CODEX_SKIP_GIT_CHECK !== '0'
      ? ['--skip-git-repo-check']
      : [];
    return [
      // Web search (research/PRD/market dispatches). `--search` opts into LIVE
      // web search (web_search=live); codex enables CACHED search by default, so
      // the old `--enable web_search_cached` was a deprecated no-op (2026 vendor
      // research).
      //
      // POSITION IS LOAD-BEARING: `--search` is a TOP-LEVEL codex flag, accepted
      // only BEFORE the subcommand. Placed after `exec` (where it sat until
      // 0.37.0) codex aborts on argv with `error: unexpected argument '--search'
      // found` and the dispatch never starts -- so every prd-research /
      // market-research task routed to codex died before doing any work, because
      // those task-types auto-enable webSearch. Verified live on codex-cli
      // 0.145.0: `codex exec --search <prompt>` -> unexpected argument;
      // `codex --search exec <prompt>` -> rc=0 with real output; `codex exec
      // --help` does not list it while `codex --help` does.
      //
      // The pre-0.37.0 test asserted only that '--search' appeared SOMEWHERE in
      // argv, which it always did -- presence was never the defect. Its
      // replacement asserts the index, and asserts no other top-level-only flag
      // drifts behind the subcommand.
      ...(opts.webSearch ? ['--search'] : []),
      'exec',
      // Forward an explicit model when the dispatch sets one. `codex exec -m <MODEL>`
      // (ISSUE-codex-vendor-model-effort). ChatGPT-account auth accepts BARE names
      // only (gpt-5.5 / gpt-5.4-mini / gpt-5.3-codex-spark); provider-prefixed ids
      // are rejected (openai/codex#12295). Omitted -> codex account default. Effort
      // is a SEPARATE knob (--reasoning -> model_reasoning_effort), NOT the model name.
      ...(opts.model ? ['-m', opts.model] : []),
      // Set the workspace root explicitly (CONFIRMED `--cd/-C <path>` works with
      // `codex exec`, developers.openai.com/codex/cli/reference). hopper injects
      // opts.cwd = resolved vendor CWD (repo root by default, or $HOPPER_VENDOR_CWD).
      ...(opts.cwd ? ['--cd', opts.cwd] : []),
      ...sandboxArgs,
      ...skipGitArgs,
      '-c', `model_reasoning_effort="${opts.reasoning ?? 'medium'}"`,
      // Suppress codex's global orchestration (multi-agent sub-spawns + hooks) so
      // only the dispatched brief runs — prevents the marketplace-plugin hijack
      // and the 1326 sub-spawn failures (ISSUE-codex-callchain-windows).
      ...codexOrchestrationDisableFlags(),
      // HOPPER-3: isolate the dispatched codex from the HOST's global config so
      // dispatch stays deterministic (Host != Vendor, spec §3 #4).
      ...codexIsolationConfig(),
      // ISSUE-codex-bypass-flag-missing-from-argv (ROOT CAUSE): the PROMPT
      // positional MUST be the LAST argv element. On Windows `codex` is reached
      // through a cmd.exe `.cmd` shim whose command line is capped at ~8191 chars;
      // an over-long line is silently truncated. The composed prompt is large
      // (frame + governance + spec), so with the prompt placed BEFORE the flags
      // (the previous order) the truncation casualty was the TRAILING sandbox /
      // bypass / -c / --disable flags — codex then fell back to its default
      // `workspace-write` sandbox and hit CreateProcessWithLogonW 1326 on every
      // child (a silent no-op). Keeping the prompt last makes the *end of the
      // prompt* the only thing a truncation can eat — the safety flags always
      // reach codex. This also matches codex's own documented usage form,
      // `codex exec [FLAGS] "<prompt>"` (docs/research/async-execution/01-openai-hosts.md).
      // STDIN MODE: when the delivery layer pipes the prompt to stdin (win-cmd-shim,
      // where a multi-line argv positional truncates at the first newline), emit the
      // `-` sentinel so `codex exec … -` reads the FULL prompt from stdin instead.
      ...(opts.promptViaStdin ? ['-'] : [input]),
    ];
  },

  // HOPPER-3 (auto-isolation): extra env merged into the codex spawn. Points
  // codex at an auto-built, login-preserving CODEX_HOME with the host's global
  // marketplace skills excluded — zero user setup. Returns {} (no override) when
  // isolation is off or no auth is discoverable, so codex falls back to its
  // default home. Threaded into the spawn by dispatch.js + hopper-runner.
  env() {
    const iso = resolveIsolatedCodexHome();
    return iso ? { CODEX_HOME: iso } : {};
  },

  envPreflight() {
    // Per codex Phase 2 audit F1: broaden checks to avoid false-negatives.
    // codex supports: ~/.codex/auth.json (default), $CODEX_HOME override,
    // $CODEX_API_KEY env, $OPENAI_API_KEY env (keychain backed in some installs).
    const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
    if (existsSync(join(codexHome, 'auth.json'))) return { ok: true, missing: [] };
    if (process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY) return { ok: true, missing: [] };
    // Soft warn instead of hard block — codex may use keychain we cannot detect.
    return {
      ok: true,
      missing: ['Note: no obvious codex auth artifact found. If smoke fails, run `codex login` OR set CODEX_API_KEY/OPENAI_API_KEY.'],
    };
  },

  timeoutMs(opts) {
    // Native: codex scales with reasoning level
    let native = 300_000;
    if (opts.reasoning === 'xhigh') native = 900_000;
    else if (opts.reasoning === 'high') native = 600_000;
    // Phase 6c F1: review task-types get raised to 30min floor
    return applyTaskTypeFloor(native, opts);
  },

  parseResult(raw) {
    if (raw.timedOut) {
      return {
        text: raw.stdout,
        status: 'timeout',
        error: `codex exec timed out after ${raw.durationMs}ms`,
      };
    }
    if (raw.exitCode === 127) {
      return {
        text: '',
        status: 'permission-fail',
        error: 'codex binary not found in PATH. Install: see https://github.com/openai/codex',
      };
    }
    // Windows sandbox false-success guard (ISSUE-codex-callchain-windows): codex
    // can exit 0 with confident-looking output while EVERY shell command it ran
    // failed with `CreateProcessWithLogonW failed: 1326` (its sandbox cannot spawn
    // children on this host) — so the dispatched brief was never performed. Surface
    // that as a failure instead of a false `success`.
    //
    // BUT only when codex made NO successful progress. If codex ran ANY command
    // successfully (a `succeeded in <N>ms` / `exited 0 in <N>ms` marker) it was NOT
    // sandbox-blocked, and the 1326 string is either an exec it rerouted around OR —
    // commonly — text codex READ or QUOTED from a file/log it was investigating.
    // Failing those is a false-positive (ISSUE-codex-1326-false-positive: a complete
    // research run that quoted a prior failed run's log was mislabeled permission-fail
    // despite 70 successful commands). codex now always runs full-access (no -s
    // sandbox), so a TOTAL 1326 wipeout should only occur on the HOPPER_CODEX_SANDBOX_BYPASS=0
    // escape-hatch path; this gate keeps the guard as defense-in-depth for that case.
    const combined = `${raw.stdout || ''}\n${raw.stderr || ''}`;
    const sawSandbox1326 = /CreateProcessWithLogonW failed:\s*1326|windows sandbox: CreateProcess\w* failed/i.test(combined);
    const ranAnyCommandOk = /\bsucceeded in \d+\s*ms\b|\bexited 0 in \d+\s*ms\b/i.test(combined);
    if (sawSandbox1326 && !ranAnyCommandOk) {
      return {
        text: raw.stdout,
        status: 'permission-fail',
        error: 'codex could not execute commands: Windows sandbox CreateProcessWithLogonW failed (1326) on every command (no command succeeded). The dispatched brief was likely NOT performed (false success). codex runs full-access (no sandbox) by default; if you forced HOPPER_CODEX_SANDBOX_BYPASS=0, run codex where its sandbox can spawn children.',
      };
    }
    if (raw.exitCode === 0 && raw.stdout) {
      // Parse tokens from stderr metadata if present
      const tokenMatch = raw.stderr.match(/tokens used\s*\n(\d+)/);
      const tokens = tokenMatch ? parseInt(tokenMatch[1]) : undefined;
      return {
        text: raw.stdout.trim(),
        status: 'success',
        usage: tokens ? { totalTokens: tokens } : undefined,
      };
    }
    return {
      text: raw.stdout,
      status: 'unknown-fail',
      error: `codex exited ${raw.exitCode}: ${(raw.stderr || '').slice(0, 500)}`,
    };
  },
};
