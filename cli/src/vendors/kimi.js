// Kimi vendor adapter (T-PLUGIN-05b; migrated to Kimi Code 0.x in T-KIMI-MIGRATE)
// Anchor: cli/src/vendors/kimi.js
//
// MIGRATION (2026-05-23): the `kimi` CLI was REPLACED, not version-bumped.
//   OLD: MoonshotAI/kimi-cli (Python, `pip install kimi-cli`, ~/.kimi/, v1.x)
//   NEW: Kimi Code CLI (single-binary/curl/brew/npm, ~/.kimi-code/, v0.x)
// The binary name is STILL `kimi` (npm bin map), so `command: 'kimi'` is unchanged,
// but the headless flags, config path, and reasoning model all changed.
//
// ⚠ BINARY NAME COLLISION: both products ship a `kimi` binary; whichever is on
// PATH wins, and their version numbers collide (legacy 1.x vs new 0.x). Do NOT
// branch on the version string. This adapter targets the NEW Kimi Code 0.x and
// uses ONLY prompt-mode flags accepted by the new CLI (`-p`, `-m`, `--session`);
// the new tool rejects unknown/conflicting flags, so emitting removed legacy
// flags (--print/--afk/--final-message-only/--thinking) would make it error out.
//
// SOURCE & CONFIDENCE: migrated from a 3-way web research sweep of
// moonshotai.github.io/kimi-code + local Kimi Code 0.14.0 help/provider output
// inspection + adversarial verification (verdict: proceed-with-corrections,
// overall_confidence high). Items marked UNCONFIRMED handled defensively.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { applyTaskTypeFloor } from '../subprocess.js';
import { adapterFailure } from '../adapter-diagnostics.js';
import { diagnosticSignal } from '../vendor-signal.js';

/** @type {import('../types.js').VendorAdapter} */
export const kimiAdapter = {
  name: 'kimi',
  command: 'kimi',
  stdinMode: 'none',

  capabilities: {
    modelArg: {
      accepted: 'freeform',
      knownGood: ['kimi-code/kimi-for-coding'],
      sourceNote: 'Kimi Code 0.x `-m, --model <ALIAS>` takes the configured ALIAS KEY, NOT a raw upstream Moonshot model id. `kimi provider list --json` (0.14+) reports configured providers/models; older installs fall back to `[models."NAME"]` blocks in ~/.kimi-code/config.toml. Default alias when -m omitted is controlled by Kimi config; on the managed Kimi Code setup it is typically `kimi-code/kimi-for-coding` (provider managed:kimi-code, upstream id kimi-for-coding, 262144 ctx). Do NOT hardcode upstream ids.',
    },
    reasoningArg: {
      accepted: 'ignored',
      knownGood: [],
      sourceNote: 'Kimi Code 0.x has no prompt-mode reasoning argv. Reasoning is config/provider driven (model capabilities + Kimi config/env such as KIMI_MODEL_THINKING_MODE / KIMI_MODEL_THINKING_EFFORT where supported). There is NO per-invocation `--reasoning` equivalent in `kimi -p`; adapter emits NO reasoning flag.',
    },
    features: {
      sessionResume: { supported: true, mechanism: '`kimi --session <id>` / `-S <id>` (documented short flag in 0.x; was `-r` in legacy) / `-C` (continue most recent in cwd). `-r` retained as a hidden alias of --session. Prompt mode rejects --session without an id, so adapter forwards it only when opts.conversationId is set.' },
      fileOutput: { supported: false, mechanism: 'stdout only; no --output-file flag. Use --output-format stream-json + shell redirect if needed.' },
      streaming: { supported: true, mechanism: '`-p` streams assistant text to stdout; thinking, tool progress, and resume notices go to stderr. `--output-format stream-json` emits one JSON object per stdout line (thinking excluded); default `text`.' },
      permissions: {
        supported: true,
        mechanism: '`kimi -p` uses Kimi prompt-mode auto permission policy by default. Kimi 0.14 rejects `--prompt` combined with `--yolo`, `--auto`, or `--plan`; adapter therefore does not forward hopper sandbox flags. Static deny rules in Kimi config still apply.',
        readOnlySandbox: {
          enforceable: false,
          failureCode: 'E_KIMI_READ_ONLY_UNENFORCEABLE',
          mechanism: 'Kimi prompt mode has no argv or sandbox primitive that can enforce hopper read-only intent.',
        },
      },
    },
    webSearch: { headless: true, hopperEnabled: true, how: 'automatic — built-in SearchWeb tool (auto-wired on Kimi Code login)' },
    staleAfter: '2026-09-11',
  },

  // HOPPER (vendor-preset feedback 2026-06-15): long-form flags the adapter
  // relies on, checked by `hopper-dispatch --check --compat` against `kimi --help`.
  // The 0.x rewrite removed --print/--afk/--final-message-only, so a stale preset
  // emitting them would ERROR (Commander allowUnknownOption(false)).
  compatFlags: ['--prompt', '--output-format', '--model'],

  // Text prompt mode has no safe lifecycle envelope to mirror. The runner emits
  // only its fixed process-alive marker; it never derives liveness from Kimi text.
  liveness: { processAlive: true, safeStreamEvents: false },

  args(input, opts) {
    // Kimi Code 0.x headless form (CONFIRMED): kimi -p "<prompt>" [-m <alias>] [--session <id>]
    // REMOVED in the 0.x rewrite (would ERROR OUT — Commander allowUnknownOption(false)):
    //   --print, --afk, --final-message-only, --thinking, --no-thinking.
    // Do NOT emit --yolo/--auto/--plan: Kimi 0.14 rejects those when combined
    // with --prompt, and prompt mode already uses Kimi's auto permission policy.
    // Reasoning has no per-invocation argv, so opts.reasoning is intentionally
    // not forwarded. opts.sandbox is also not forwarded: danger-full-access maps
    // only to Kimi prompt mode's native auto policy, and read-only cannot be
    // enforced by argv in `kimi -p`.
    return [
      '-p', input,
      ...(opts.model ? ['-m', opts.model] : []),
      ...(opts.conversationId ? ['--session', opts.conversationId] : []),
    ];
  },

  envPreflight() {
    // Config path MOVED to ~/.kimi-code/ in the 0.x rewrite; legacy ~/.kimi/ is the
    // old Python tool and is never touched by migration (checking only it would
    // false-negative on fresh new installs). Honor $KIMI_CODE_HOME override.
    // Soft-warn pattern (OAuth creds may live at ~/.kimi-code/credentials/).
    const codeHome = process.env.KIMI_CODE_HOME
      ? process.env.KIMI_CODE_HOME
      : join(homedir(), '.kimi-code');
    const candidates = [
      join(codeHome, 'config.toml'),                          // new primary (TOML-only)
      join(codeHome, 'credentials'),                          // OAuth creds dir (CONFIRMED)
      join(codeHome, 'config.migrated-from-kimi-cli.toml'),   // migration marker
      join(homedir(), '.kimi', 'config.toml'),                // legacy fallback
      join(homedir(), '.kimi', 'config.json'),                // legacy fallback
    ];
    if (candidates.some((p) => existsSync(p))) return { ok: true, missing: [] };
    if (process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY) {
      return { ok: true, missing: [] };
    }
    return {
      ok: true,
      missing: ['Note: no ~/.kimi-code/config.toml (or $KIMI_CODE_HOME) / credentials or KIMI_API_KEY found. If smoke fails, run `kimi` then `/login` (Kimi Code OAuth or Moonshot API key), OR set KIMI_API_KEY.'],
    };
  },

  timeoutMs(opts) {
    // Native: 180s (thinking is config-default-on; coding agent runs can be long).
    const native = 180_000;
    // Phase 6c F1: review task-types get raised to 30min floor.
    return applyTaskTypeFloor(native, opts);
  },

  parseResult(raw) {
    if (raw.timedOut) {
      return adapterFailure('timeout', 'adapter-timeout');
    }
    // Exit 127 is the shell's own verdict and is proof. The `not found` substring
    // test that used to sit beside it was not: in background mode the runner hands
    // over one interleaved transcript, so it matched the assistant's own prose.
    // A binary that is missing cannot also have produced output.
    if (raw.exitCode === 127) {
      return adapterFailure('permission-fail', 'adapter-binary-missing');
    }
    // Primary auth-fail (0.x routes auth errors to stderr + sets non-zero exit;
    // 401->AuthenticationError, 403->PermissionDenied, 402 membership).
    const { text: signal } = diagnosticSignal(raw);
    if (raw.exitCode !== 0
      && (/invalid authentication|api key\s*(?:is\s*)?(?:invalid|expired)|verify your membership|usage limit|unauthoriz|not logged in/i.test(signal)
        || /\bHTTP\s*(?:401|402|403)\b|\bstatus(?:\s*code)?[:=]?\s*(?:401|402|403)\b|\berror code:\s*40[123]\b/i.test(signal))) {
      return adapterFailure('auth-fail', 'adapter-auth-failed');
    }
    // Legacy-compat fallback: the Python 1.x client printed HTTP 402 to stdout at
    // exit 0. UNCONFIRMED whether the Node 0.x tool ever does this; kept defensively.
    if (raw.stdout.includes('Error code: 4') && raw.stdout.includes("'error'")) {
      return adapterFailure('auth-fail', 'adapter-auth-failed');
    }
    if (raw.exitCode === 0 && raw.stdout) {
      // 0.x sends the "To resume this session: kimi -r <id>" hint to STDERR, so this
      // strip is now a defensive no-op for the new tool (still strips the legacy 1.x
      // stdout footer). Assistant text is already stdout-only in -p mode. Kimi has
      // no approved terminal actual-model field yet, so this stays config-only and
      // deliberately never attaches modelAttestation.
      const text = raw.stdout.replace(/\n*To resume this session:[^\n]*\n*$/m, '').trim();
      return { text, status: 'success', diagnosticCode: 'none' };
    }
    return adapterFailure('unknown-fail', 'adapter-unknown-failed');
  },
};
