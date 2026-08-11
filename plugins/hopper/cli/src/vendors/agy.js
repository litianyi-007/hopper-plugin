// Antigravity (agy) vendor adapter (T-PLUGIN-05e)
// Anchor: cli/src/vendors/agy.js
//
// Per spec v2.0.3 §6 T-PLUGIN-05e + codex audit F2: agy has THE most complex
// adapter due to silent auth-fail behavior (exit 0 + empty stdout when not
// OAuth-authed). Adapter MUST:
//
// 1. Generate unique per-dispatch log file (avoid stale-log false positives)
// 2. Pass via --log-file
// 3. Inspect log after exit; classify failure: auth / timeout / permission / unknown
// 4. NOT bake OAuth cred path as literal (path is TBD until post-login evidence)
//
// Per spec §3 #4: no retry, no fallback, single subprocess spawn.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { makeUniqueLogPath, applyTaskTypeFloor } from '../subprocess.js';

/** @type {import('../types.js').VendorAdapter} */
export const agyAdapter = {
  name: 'agy',
  command: 'agy',
  stdinMode: 'none',
  // Dispatch gate — agy is DISABLED by default (2026-06-26). agy 1.0.12 `--print` renders the
  // answer only in its interactive TUI; under a non-TTY stdout (every hopper dispatch) it emits
  // nothing capturable (not stdout/stderr, not --log-file, not the brain store), so a dispatch
  // can never return an answer. Blocking it prevents silent empty/failed runs. A real fix needs a
  // PTY, which is excluded for agy (it hangs on an open stdin pipe). Re-enable explicitly with
  // HOPPER_ENABLE_AGY=1 once an upstream fix or a sanctioned capture path lands. See
  // docs/specs/vendor-io-protocol-current-vs-target.md (agy OUTPUT LIMIT).
  dispatchDisabled: {
    reason: 'agy 1.0.12 `--print` emits no capturable answer on a non-TTY stdout (its answer renders only in the interactive TUI), so a hopper dispatch cannot return a result. Disabled pending an upstream fix or a sanctioned PTY-free capture path.',
    enableEnv: 'HOPPER_ENABLE_AGY',
  },
  // Phase 6c F2: agy installer on Windows does NOT add its bin to PATH.
  // Probe and dispatch both correctly report "not found" without these
  // fallbacks. When PATH lookup fails, the runner consults this list to
  // locate the binary at its deterministic install location.
  knownInstallPaths: process.platform === 'win32'
    ? [join(homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe')]
    : [join(homedir(), '.local', 'bin', 'agy')],

  // Phase 6a static capability hint — sourced from docs/research/.
  capabilities: {
    modelArg: {
      accepted: 'freeform',
      // Same value the sentinel already inferred from knownGood[0] — declared
      // explicitly so the intent survives a future reordering of the catalog.
      // NOTE the format: agy's `--model` takes the full DISPLAY LABEL with tier,
      // not a slug (see sourceNote), so this string looks like a UI label and is
      // nevertheless the correct selector.
      hopperDefault: 'Gemini 3.5 Flash (High)',
      // V1 verification (2026-06): agy NOW exposes `--model` + a `models` subcommand (added
      // since the 2026-05 research). The flag takes the FULL DISPLAY LABEL with the reasoning
      // tier in parens — bare slugs (gemini-3.5-flash) are rejected and silently fall back to
      // the default "Gemini 3.5 Flash (Medium)". Claude/GPT-OSS labels appear in the picker but
      // are plan-gated (rejected on consumer accounts), so excluded here.
      knownGood: ['Gemini 3.5 Flash (High)', 'Gemini 3.5 Flash (Medium)', 'Gemini 3.1 Pro (High)', 'Gemini 3.1 Pro (Low)'],
      sourceNote: 'agy --model "<Display Label (Tier)>" (verified live 2026-06; labels only, no bare slug; account/tier-gated — list with `agy models`). Adapter forwards opts.model verbatim.',
    },
    reasoningArg: {
      accepted: 'ignored',
      knownGood: [],
      sourceNote: 'agy uses internal "parallel subagents" orchestration; no external reasoning-effort flag.',
    },
    features: {
      sessionResume: { supported: false, mechanism: 'UNCONFIRMED — no documented --resume <id> flag as of 2026-05-20.' },
      fileOutput: { supported: false, mechanism: '`--log-file <path>` writes diagnostic log (NOT answer text). Answer text is stdout-only.' },
      streaming: { supported: true, mechanism: '`agy -p` streams; first-run blocked by OAuth (interactive once).' },
    },
    // Phase 6a dogfood 2026-05-21 (CORRECTED 2026-05-21 evening per user
    // feedback): this adapter targets the AGENTIC `agy` CLI. Confirmed on
    // this dev machine at:
    //   C:\Users\litianyi\AppData\Local\agy\bin\agy.exe
    // user-verified `agy --help` from PowerShell shows: --print / -p,
    // --dangerously-skip-permissions, --log-file, --continue,
    // --conversation, --add-dir (repeatable workspace dir), --sandbox,
    // --print-timeout (default 5m0s), subcommands: changelog / help /
    // install / plugin{,s} / update.
    // RE-VERIFIED 2026-06-05: --add-dir IS present (earlier note omitted it);
    // adapter now threads opts.cwd via --add-dir for cross-vendor parity.
    //
    // Bash session PATH coverage caveat (verified live): some MSYS2 /
    // Git-Bash environments do NOT inherit Windows-installed-app PATH
    // entries by default. PowerShell users get agy on PATH; Git-Bash users
    // may need to add `~/AppData/Local/agy/bin` manually OR run via full
    // path. Our `--check` correctly reflects whichever shell ran it.
    //
    // Distinct binary: `antigravity` (Google's VS-Code-fork editor at
    // ~/AppData/Local/Programs/Antigravity/bin/) is a SEPARATE product
    // from `agy` (the agentic CLI). They are NOT aliases of each other.
    webSearch: { headless: false, hopperEnabled: false, how: 'none found (agy -p exposes no web-search tool/flag)' },
    staleAfter: '2026-08-21',
    installPath: 'Default Windows install: ~/AppData/Local/agy/bin/agy.exe. PATH coverage shell-dependent on Windows (PowerShell yes; Git-Bash may need manual setup).',
  },

  args(input, opts) {
    const sandbox = opts.sandbox ?? 'danger-full-access';
    return [
      '-p', input,
      // V1: agy now honors `--model "<Display Label (Tier)>"` (verbatim; bare slugs rejected).
      ...(opts.model ? ['--model', opts.model] : []),
      ...(sandbox === 'danger-full-access' ? ['--dangerously-skip-permissions'] : []),
      // Cross-vendor working-dir support (mirrors opencode --dir / grok --cwd /
      // codex --cd). agy has no cwd-setting flag, but `--add-dir <path>`
      // (CONFIRMED present + repeatable via `agy --help`) grants a directory to
      // its workspace. hopper injects opts.cwd = resolved vendor CWD (repo root
      // by default, or $HOPPER_VENDOR_CWD) so agy can read/write project files
      // regardless of where `-p` anchors its own working context. "enable not
      // bypass" — grants the specific repo root, does NOT widen the sandbox.
      ...(opts.cwd ? ['--add-dir', opts.cwd] : []),
      ...(opts.logFile ? ['--log-file', opts.logFile] : []),
      ...(opts.conversationId ? ['--conversation', opts.conversationId] : []),
    ];
  },

  /**
   * Prepare a unique log file path for this dispatch.
   * Called by dispatch executor BEFORE args() so the path can be threaded in.
   */
  prepareLog(taskId, vendorName) {
    return { logPath: makeUniqueLogPath(taskId, vendorName) };
  },

  envPreflight() {
    // Per codex v2.0.3 audit F2: do NOT bake ~/.gemini/oauth_creds.json as literal.
    // Check for presence of any non-empty file under ~/.gemini/antigravity-cli/
    // or ~/.gemini/ that looks like an auth artifact.
    const geminiDir = join(homedir(), '.gemini');
    if (!existsSync(geminiDir)) {
      return {
        ok: false,
        missing: ['Run `agy install` (PATH setup) THEN `agy` interactively (OAuth login) before -p mode works.'],
      };
    }
    // Look for likely auth artifact files. If none, surface clear instruction.
    try {
      const candidates = ['oauth_creds.json', 'credentials.json', 'token.json', 'auth.json'];
      // Check root .gemini/ first
      for (const c of candidates) {
        if (existsSync(join(geminiDir, c))) {
          return { ok: true, missing: [] };
        }
      }
      // Check .gemini/antigravity-cli/ subdir
      const cliDir = join(geminiDir, 'antigravity-cli');
      if (existsSync(cliDir)) {
        const entries = readdirSync(cliDir);
        if (entries.some((e) => /credential|token|auth|oauth/i.test(e))) {
          return { ok: true, missing: [] };
        }
      }
      // No auth artifact found — but agy might use other storage. Don't block;
      // parseResult will detect silent auth-fail via log file. Return ok=true
      // but include a soft warning in missing field.
      return {
        ok: true,
        missing: ['Note: no obvious agy auth artifact found in ~/.gemini/; if smoke fails with "not logged in", run `agy` interactively to OAuth.'],
      };
    } catch (_) {
      return { ok: true, missing: [] };
    }
  },

  timeoutMs(opts) {
    // Native: 360s (agy default print-timeout is 5min; we cap at 6min)
    // Phase 6c F1: review task-types get raised to 30min floor
    return applyTaskTypeFloor(360_000, opts);
  },

  parseResult(raw) {
    // Per codex Phase 2 audit F2: classify over BOTH log + stderr.
    // Missing log is distinguishable from empty-clean log.
    if (raw.timedOut) {
      return { text: raw.stdout, status: 'timeout', error: `agy -p timed out after ${raw.durationMs}ms (default 5min print-timeout exceeded)` };
    }
    if (raw.exitCode === 127) {
      return {
        text: '',
        status: 'permission-fail',
        error: 'agy binary not found in PATH. Run `agy install` to configure PATH.',
      };
    }

    // Combine signals: log file content (if read) + stderr (always captured).
    // Per F2: stderr may contain failure pattern when log is missing/disabled.
    const log = raw.logFileContent || '';
    const logFileMissing = raw.logFileContent === undefined;
    const signal = `${log}\n${raw.stderr || ''}`;
    // In BACKGROUND, the runner captures stdout+stderr into one log and passes it as raw.stdout,
    // so raw.stdout is the whole log (agy's Go-klog diagnostics + any answer). Strip the glog to
    // recover the actual ANSWER; an answer-less run (only glog) must NOT count as stdout (else a
    // headless run that emitted no answer false-succeeds — agy 1.0.12 `--print` drops the answer
    // to a non-TTY stdout entirely, see the empty-stdout branch below).
    const answerText = stripAgyGlog(raw.stdout);
    const hasStdout = Boolean(answerText);

    // Auth classification (V5 fix — agy false "never auth"). agy print mode emits transient
    // "not logged in" / "Failed to get OAuth token" noise during boot, then recovers ~0.3s
    // later via silent KEYRING auth, emitting an AUTHORITATIVE success marker. The old
    // heuristic matched the boot noise even AFTER recovery (and the empty stdout from the
    // non-TTY drop) → FALSE auth-fail although the run authed + completed. Fix = a
    // success-marker VETO: if a terminal auth-success marker is present, agy authed, so never
    // classify auth-fail regardless of early noise or empty stdout. A genuine failure shows
    // the noise (incl. "silent auth failed" / "keyringAuth timed out") WITHOUT a success marker.
    // Anchor the keyring marker to its real emitter ("ChainedAuth: authenticated via keyring
    // (effective: keyring)") so a NEGATED phrase (e.g. "could not be authenticated via keyring")
    // can't falsely veto a genuine auth failure. The other two markers are already specific.
    // NOTE: the failure branches below match substrings over the COMBINED log+stderr `signal`,
    // which in background also holds glog from sub-calls. They are gated on `!hasStdout` so a run
    // that produced a real answer is NEVER misrouted to a failure by incidental sub-call noise
    // (e.g. a tool that hit a deadline / permission error mid-run, then recovered and answered).
    const authSucceeded = /Print mode: silent auth succeeded|OAuth: authenticated successfully|ChainedAuth:[^\n]*authenticated via keyring/i.test(signal);
    const authNoise = /You are not logged into Antigravity|Failed to get OAuth token|error getting token source|Print mode: silent auth failed|keyringAuth: timed out/i.test(signal);
    if (authNoise && !authSucceeded && !hasStdout) {
      return {
        text: '',
        status: 'auth-fail',
        error: `agy is not OAuth-authed (no silent-auth success marker in this run). Run \`agy\` interactively once (browser OAuth) to populate the keyring.${logFileMissing ? ' [Note: --log-file content was missing; matched stderr]' : ''}`,
      };
    }

    if (!hasStdout && /deadline exceeded|context cancelled|context deadline/i.test(signal)) {
      return {
        text: raw.stdout,
        status: 'timeout',
        error: 'agy print-timeout. Increase via --print-timeout OR check network.',
      };
    }

    if (!hasStdout && /permission denied|permission error|access denied|forbidden|not allowed/i.test(signal)) {
      return {
        text: raw.stdout,
        status: 'permission-fail',
        error: `agy permission error. Signal excerpt: ${signal.slice(0, 300)}`,
      };
    }

    if (raw.exitCode === 0 && hasStdout) {
      return { text: answerText, status: 'success' };
    }

    // Exit 0 + NO answer text (after stripping glog). agy 1.0.12 `--print` renders the answer
    // ONLY in its interactive TUI — under a non-TTY stdout (every headless dispatch) it emits
    // nothing capturable: the answer is NOT on stdout/stderr and NOT in the --log-file (verified
    // 2026-06-25 on 1.0.12; regressed from the earlier non-TTY behaviour). A PTY wrap would
    // capture it but node-pty is excluded for agy by project policy (agy hangs on an open stdin
    // pipe). So this is a real OUTPUT limitation, surfaced as a failure — NEVER a false success.
    if (raw.exitCode === 0 && !hasStdout) {
      if (authSucceeded) {
        return {
          text: '',
          status: 'unknown-fail',
          error: `agy authed + ran to completion but emitted NO answer text on a non-TTY stdout — agy 1.0.12 \`--print\` only renders the answer in its interactive TUI (the answer is not on stdout/stderr or in --log-file). Headless answer capture needs a PTY, which is excluded for agy (open-stdin hang). Treat agy as interactive-only until this is resolved upstream.`,
        };
      }
      return {
        text: '',
        status: 'unknown-fail',
        error: `agy returned no answer text with exit 0 but no matching error pattern.${logFileMissing ? ' [Note: --log-file content was missing — adapter could not read diagnostic log.]' : ''} Log excerpt: ${log.slice(0, 300)}. Stderr excerpt: ${(raw.stderr || '').slice(0, 200)}`,
      };
    }

    return {
      text: raw.stdout,
      status: 'unknown-fail',
      error: `agy exited ${raw.exitCode}.${logFileMissing ? ' [log file missing]' : ''} Stderr: ${(raw.stderr || '').slice(0, 300)}. Log: ${log.slice(0, 300)}`,
    };
  },
};

// agy's diagnostic glog (Go klog) line: `I0625 23:01:44.139735 43904 input_loop.go:518] msg`
// — a level letter (I/E/W/F), MMDD, HH:MM:SS.micros, pid, file:line], message. In background the
// runner folds stdout+stderr into one log, so an answer-less agy run still yields a non-empty
// `raw.stdout` full of glog. This recovers the real ANSWER by dropping glog lines; an empty
// result means agy emitted no answer (the 1.0.12 non-TTY --print drop). Exported for tests.
const AGY_GLOG_LINE = /^\s*[IEWF]\d{4}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\S+:\d+\]/;
export function stripAgyGlog(s) {
  // Drop ONLY glog lines — keep interior blank lines so a multi-paragraph answer's paragraph
  // breaks survive — then trim leading/trailing whitespace (incl. blank lines from removed glog).
  return String(s || '')
    .split(/\r?\n/)
    .filter((ln) => !AGY_GLOG_LINE.test(ln))
    .join('\n')
    .trim();
}
