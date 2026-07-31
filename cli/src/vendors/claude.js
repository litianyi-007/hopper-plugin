// Claude Code (`claude`) vendor adapter (T-VENDOR-CLAUDE)
// Anchor: cli/src/vendors/claude.js
//
// Anthropic's first-party agentic coding CLI "Claude Code". Binary: `claude`.
// Headless form `claude -p "<prompt>" --output-format json` (CONFIRMED
// code.claude.com/docs/en/headless + /en/cli-reference, web research 2026-06-16).
// Per spec §3 #4: thin wrapper, ZERO retry/fallback/circuit-breaker.
//
// HOST != VENDOR. This VENDOR exists so a hopper running under a DIFFERENT host
// (codex / opencode / grok / Cursor / standalone CLI) can dispatch a task TO
// `claude -p`. The host!=vendor guard (validation.validateHostVendorSeparation)
// blocks the one nonsensical case: a Claude-Code host dispatching back to the
// claude vendor (self-dispatch). NOTE (2026-07-31 fix): until this fix, that
// guard was pure string equality AND Claude Code (Tier B) has no wrapper to set
// HOPPER_HOST_VENDOR, so it silently never ran here — see cli/src/host-detect.js
// (self-detects the Claude Code host) and VENDOR_FAMILY in cli/src/validation.js
// (family-based comparison, since host id 'claude-code' != vendor name 'claude').
//
// BILLING NOTE (volatile — do NOT trust this comment as current). How `claude -p`
// / Agent SDK usage bills against a Claude Pro/Max subscription churned through
// 2026: the 2026-06-15 "separate Agent SDK credit pool" split was rolled back by
// a later policy change (maintainer, 2026-06-16) putting `claude -p` back on the
// regular plan. Because this keeps moving, the adapter is intentionally
// BILLING-AGNOSTIC — it just dispatches. Treat any billing prose here as a dated
// pointer and confirm the live policy at anthropic.com / docs.claude.com.
//
// SOURCE & CONFIDENCE: authored from official docs (code.claude.com/docs
// headless + cli-reference, fetched 2026-06-16) — high confidence on flag names
// and the JSON result shape; NOT from local dogfood (claude may not be installed
// on the authoring machine). compatFlags + parseResult are defensive so a CLI
// version drift surfaces via `--check --compat` / a classified failure rather
// than a silent empty result.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { applyTaskTypeFloor } from '../subprocess.js';
import { adapterFailure } from '../adapter-diagnostics.js';

// Versioned adapter metadata is the closed allowlist for result fields that are
// stable enough to attest an actual runtime model. It deliberately names paths,
// rather than allowing a recursive search through a vendor payload.
const CLAUDE_RUNTIME_MODEL_METADATA = Object.freeze({
  schemaVersion: 1,
  terminal: Object.freeze({ type: 'result', subtype: 'success' }),
  modelUsagePaths: Object.freeze([
    Object.freeze({ path: Object.freeze(['modelUsage']), source: 'claude.result.modelUsage.keys' }),
    Object.freeze({ path: Object.freeze(['result', 'modelUsage']), source: 'claude.result.result.modelUsage.keys' }),
    Object.freeze({ path: Object.freeze(['usage', 'modelUsage']), source: 'claude.result.usage.modelUsage.keys' }),
    Object.freeze({ path: Object.freeze(['usage', 'model_usage']), source: 'claude.result.usage.model_usage.keys' }),
  ]),
});

/** @type {import('../types.js').VendorAdapter} */
export const claudeAdapter = {
  name: 'claude',
  command: 'claude',
  stdinMode: 'none',
  runtimeModelMetadata: CLAUDE_RUNTIME_MODEL_METADATA,
  // Prompt-delivery capability (win-cmd-shim multi-line truncation fix). `claude -p`
  // with NO positional reads the prompt from stdin (live-confirmed through claude.cmd:
  // token honored, exit 0). The delivery layer routes to stdin ONLY on win-cmd-shim;
  // argv elsewhere. Default ON; env opt-out HOPPER_CLAUDE_STDIN=0.
  promptStdin: 'supported',
  promptStdinDefault: true,

  // Idle-watchdog hint (ISSUE-grok-claude-buffered-output-idle-falsekill): claude
  // `-p --output-format json` (passed in args() below) is END-BUFFERED — the
  // vendor writes stdout ONCE at completion, not incrementally (see the
  // `streaming` capability note and parseResult's "single trailing result
  // object" comment further down). hopper-runner's background idle poll resets
  // only on log-FILE-size growth, so for a fully-buffered vendor that never
  // grows the log until exit, idle degenerates into an unconditional kill
  // ~idleMs after spawn. This flag tells the runner to skip arming that poll
  // entirely for claude (the absolute ceiling timeout still applies as the
  // safety net).
  bufferedOutput: true,

  // Phase 6a static capability hint (no live vendor introspection — would break
  // the single-spawn proof). Source: code.claude.com/docs/en/cli-reference.
  capabilities: {
    modelArg: {
      accepted: 'freeform',
      knownGood: ['sonnet', 'opus', 'haiku', 'fable', 'opusplan', 'best', 'default', 'sonnet[1m]', 'opus[1m]'],
      sourceNote: '`claude --model <NAME>` accepts a latest-model alias (sonnet|opus|haiku|fable) OR a full model id (e.g. claude-sonnet-4-6) — CONFIRMED code.claude.com/docs/en/cli-reference 2026-06-16. The exact ids/tiers an account can reach depend on its subscription/entitlements, so this adapter does NOT hardcode a default: it omits --model unless opts.model is set and lets the CLI pick the account default (mirrors codex, which also leaves the model to the account).',
    },
    reasoningArg: {
      accepted: 'ignored',
      knownGood: [],
      sourceNote: 'Claude Code has no per-invocation reasoning-effort argv flag in `-p` mode; extended thinking is model/prompt-driven (and can be nudged via --append-system-prompt). opts.reasoning is intentionally NOT forwarded.',
    },
    features: {
      sessionResume: { supported: true, mechanism: '`claude -p --resume <id>` resumes a specific session (the `session_id` from `--output-format json`); `--continue`/`-c` continues the most recent session in the cwd. Adapter forwards `--resume <id>` only when opts.conversationId is set. Resume lookup is scoped to the dispatch cwd + its git worktrees (run resume from the same dir).' },
      fileOutput: { supported: false, mechanism: 'stdout only; no --output-file flag. `--output-format json` puts the answer text in `.result`; redirect at the shell layer if a file is needed.' },
      streaming: { supported: true, mechanism: '`--output-format stream-json` (with --verbose / --include-partial-messages) emits newline-delimited event JSON. Adapter uses `json` for a single trailing result object suited to background capture.' },
    },
    webSearch: { headless: true, hopperEnabled: true, how: 'built-in WebSearch tool; auto-allowed via --allowedTools WebSearch when opts.webSearch' },
    staleAfter: '2026-09-30',
  },

  // Long-form flags the adapter relies on, checked by `hopper-dispatch --check
  // --compat` against `claude --help` (catches CLI-version drift like grok/kimi).
  compatFlags: ['--print', '--output-format', '--model', '--permission-mode', '--add-dir'],

  args(input, opts) {
    const sandbox = opts.sandbox ?? 'danger-full-access';
    // Map hopper's sandbox vocabulary to Claude Code's native permission model so
    // a HEADLESS dispatch never stalls on an approval prompt. Modes confirmed
    // (cli-reference): default|acceptEdits|plan|auto|dontAsk|bypassPermissions.
    //   danger-full-access -> --dangerously-skip-permissions (== bypassPermissions;
    //                         documented headless full-access path)
    //   workspace-write    -> --permission-mode acceptEdits (auto-approves file
    //                         writes + common fs cmds; other shell cmds still gated)
    //   read-only          -> --permission-mode dontAsk (denies anything outside
    //                         the read-only command set instead of prompting —
    //                         the documented "locked-down CI" mode)
    // Escape hatch: HOPPER_CLAUDE_PERMISSION_MODE overrides the mode for the
    // non-danger sandboxes (empty string omits --permission-mode entirely, e.g.
    // on a claude build that renamed a mode).
    const permModeOverride = process.env.HOPPER_CLAUDE_PERMISSION_MODE;
    const defaultPermMode = sandbox === 'workspace-write' ? 'acceptEdits'
      : sandbox === 'read-only' ? 'dontAsk'
      : null; // danger-full-access handled by --dangerously-skip-permissions below
    const permMode = permModeOverride !== undefined ? permModeOverride : defaultPermMode;

    const argv = [];
    // Opt-in CI isolation: `claude --bare` skips auto-discovery of the HOST's
    // ~/.claude hooks/skills/plugins/MCP + project CLAUDE.md for a deterministic
    // dispatch (Host != Vendor, spec §3 #4). It ALSO skips OAuth/keychain, so it
    // requires ANTHROPIC_API_KEY (or an apiKeyHelper). Off by default to preserve
    // OAuth-login users; enable with HOPPER_CLAUDE_BARE=1.
    if (process.env.HOPPER_CLAUDE_BARE === '1') argv.push('--bare');
    argv.push(
      // STDIN MODE (win-cmd-shim): drop the positional so `claude -p` (no prompt arg)
      // reads the FULL prompt from stdin — bypassing the cmd.exe argv newline truncation.
      '-p',
      ...(opts.promptViaStdin ? [] : [input]),
      // Single trailing JSON object: { type, subtype, is_error, result, session_id,
      // total_cost_usd, usage, ... } — parseResult reads `.result`.
      '--output-format', 'json',
      ...(opts.model ? ['--model', opts.model] : []),
      // Web search (research/PRD/market): WebSearch is a built-in claude tool requiring
      // permission; in headless -p it must be pre-authorized. --allowedTools "WebSearch"
      // grants it (redundant but harmless under --dangerously-skip-permissions).
      ...(opts.webSearch ? ['--allowedTools', 'WebSearch'] : []),
      // Working-dir parity (mirrors agy --add-dir / grok --cwd / codex --cd).
      // hopper injects opts.cwd = resolved vendor CWD (repo root by default, or
      // $HOPPER_VENDOR_CWD). --add-dir grants the dir to claude's workspace
      // ("enable not bypass" — file access only; does NOT widen the sandbox and,
      // per docs, does NOT load that dir's .claude/ configuration).
      ...(opts.cwd ? ['--add-dir', opts.cwd] : []),
      ...(sandbox === 'danger-full-access'
        ? ['--dangerously-skip-permissions']
        : (permMode ? ['--permission-mode', permMode] : [])),
      ...(opts.conversationId ? ['--resume', opts.conversationId] : []),
    );
    return argv;
  },

  envPreflight() {
    // Soft-warn pattern (mirrors codex/agy/grok/kimi): a keychain-stored OAuth
    // session (macOS Keychain, etc.) may authenticate even when undetectable on
    // disk; parseResult is the backstop for real auth failures.
    if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      return { ok: true, missing: [] };
    }
    const claudeDir = join(homedir(), '.claude');
    const candidates = [
      join(claudeDir, '.credentials.json'),  // Linux/Windows OAuth creds (macOS uses Keychain)
      join(homedir(), '.claude.json'),       // CLI config (may carry account info)
    ];
    if (candidates.some((p) => existsSync(p))) return { ok: true, missing: [] };
    return {
      ok: true,
      missing: ['Note: no ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN / ~/.claude credentials found. If smoke fails: set ANTHROPIC_API_KEY, run `claude` then `/login` (OAuth), or `claude setup-token` (long-lived token → CLAUDE_CODE_OAUTH_TOKEN). (--bare reads ANTHROPIC_API_KEY/apiKeyHelper only.)'],
    };
  },

  timeoutMs(opts) {
    // Native: 300s (first-party agentic coding CLI; same tier as codex/grok).
    const native = 300_000;
    // Phase 6c F1: review task-types raised to 30min floor (all-adapter consistent).
    return applyTaskTypeFloor(native, opts);
  },

  parseResult(raw) {
    if (raw.timedOut) {
      return adapterFailure('timeout', 'adapter-timeout');
    }
    if (raw.exitCode === 127 || /not found|command not found/i.test(raw.stderr || '')) {
      return adapterFailure('permission-fail', 'adapter-binary-missing');
    }
    // A completed result object is the authoritative vendor outcome. The
    // file-backed runner records startup diagnostics in the same log, so broad
    // auth-shaped text (for example an env-precedence notice) must not override
    // a clean `result/success/is_error:false` envelope.
    const parsedResult = extractClaudeResult(raw.stdout);
    if (raw.exitCode === 0 && parsedResult && !parsedResult.isError && parsedResult.text.trim()) {
      return successfulClaudeOutput(parsedResult);
    }
    const signal = `${raw.stdout || ''}\n${raw.stderr || ''}`;
    // Auth failure (the `error` categories the SDK emits include
    // authentication_failed / oauth_org_not_allowed — code.claude.com/docs/en/headless).
    if (/authentication_failed|oauth_org_not_allowed|invalid api key|invalid x-api-key|ANTHROPIC_API_KEY|not logged in|please run\b.*login|\b401\b|\b403\b/i.test(signal)) {
      return failedClaudeOutput('auth-fail', 'adapter-auth-failed', parsedResult);
    }
    // Billing / credit / usage-limit block. Kept as a distinct branch because the
    // SDK emits a `billing_error` category regardless of the current billing
    // model — the wording stays policy-neutral on purpose (the `claude -p` billing
    // regime changed repeatedly across 2026; see the BILLING NOTE at the top).
    if (/billing_error|credit balance|insufficient.*credit|agent sdk credit|quota exceeded|usage limit/i.test(signal)) {
      return failedClaudeOutput('auth-fail', 'adapter-auth-failed', parsedResult);
    }
    if (raw.exitCode === 0) {
      // --output-format json yields a single trailing result object. Parse
      // defensively (whole-stdout JSON → last JSON line for stream-json safety →
      // raw text for plain --output-format text).
      // FAIL FAST instead of recording a silent empty result: a blocked headless
      // turn (permission mode) or a max-turns hit can exit 0 with is_error/empty
      // result. Treat is_error OR no usable text as failure.
      if (parsedResult.isError || !parsedResult.text.trim()) {
        return failedClaudeOutput('unknown-fail', 'adapter-protocol-invalid', parsedResult);
      }
      return successfulClaudeOutput(parsedResult);
    }
    return failedClaudeOutput('unknown-fail', 'adapter-unknown-failed', parsedResult);
  },
};

/**
 * Defensive extraction of the answer text from `claude -p --output-format json`
 * stdout. The success object shape (code.claude.com/docs/en/headless) is:
 *   { type:"result", subtype:"success"|"error_max_turns"|"error_during_execution",
 *     is_error:boolean, result:"<text>", session_id, total_cost_usd, usage:{...} }
 * Falls back to the last JSON line (stream-json) then to raw text (plain
 * --output-format text, or any unparseable payload) so a format drift degrades
 * gracefully instead of throwing.
 * @param {string} stdout
 * @returns {{ text: string, usage?: object, isError: boolean, subtype?: string, terminalEnvelope?: object|null, answerSource: 'result'|'text-fallback'|'raw-fallback'|'none' }}
 */
function extractClaudeResult(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) return { text: '', isError: false, answerSource: 'none' };
  const noAnswerFromEnvelope = (obj) => ({
    text: '',
    isError: obj.is_error === true || /^error/i.test(String(obj.subtype || '')),
    subtype: obj.subtype,
    terminalEnvelope: obj,
    answerSource: 'none',
  });
  const fromObj = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const answerSource = typeof obj.result === 'string' ? 'result'
      : (typeof obj.text === 'string' ? 'text-fallback' : null);
    const text = answerSource === 'result' ? obj.result
      : (answerSource === 'text-fallback' ? obj.text : null);
    if (text === null) return null;
    const isError = obj.is_error === true || /^error/i.test(String(obj.subtype || ''));
    let usage = (obj.usage && typeof obj.usage === 'object') ? { ...obj.usage } : undefined;
    if (typeof obj.total_cost_usd === 'number') usage = { ...(usage || {}), totalCostUsd: obj.total_cost_usd };
    return { text, usage, isError, subtype: obj.subtype, terminalEnvelope: obj, answerSource };
  };
  try {
    const envelope = JSON.parse(trimmed);
    const got = fromObj(envelope);
    if (got) return got;
    if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) return noAnswerFromEnvelope(envelope);
  } catch (_) { /* not a single JSON object — scan lines for stream-json safety */ }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  let lastEnvelopeWithoutText = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const envelope = JSON.parse(lines[i]);
      const got = fromObj(envelope);
      if (got) return got;
      if (!lastEnvelopeWithoutText && envelope && typeof envelope === 'object' && !Array.isArray(envelope)) {
        lastEnvelopeWithoutText = noAnswerFromEnvelope(envelope);
      }
    } catch (_) { /* keep scanning upward */ }
  }
  if (lastEnvelopeWithoutText) return lastEnvelopeWithoutText;
  // Plain text (default --output-format text) or unparseable → use stdout as-is.
  return { text: trimmed, isError: false, terminalEnvelope: null, answerSource: 'raw-fallback' };
}

function successfulClaudeOutput(parsed) {
  const output = parsed.usage
    ? { text: parsed.text, status: 'success', diagnosticCode: 'none', usage: parsed.usage }
    : { text: parsed.text, status: 'success', diagnosticCode: 'none' };
  if (isVerifiedClaudeResult(parsed)) {
    output.outputEvidence = {
      completeness: 'verified-complete',
      source: 'structured-envelope',
      terminalMarker: 'claude-result-success',
    };
  }
  const modelAttestation = extractClaudeModelAttestation(parsed.terminalEnvelope);
  return modelAttestation ? { ...output, modelAttestation } : output;
}

function failedClaudeOutput(status, diagnosticCode, parsed) {
  const failure = adapterFailure(status, diagnosticCode);
  if (!parsed || parsed.answerSource !== 'result' || !parsed.text.trim()) return failure;
  return {
    ...failure,
    text: parsed.text,
    outputEvidence: {
      completeness: 'unknown-completeness',
      source: 'structured-envelope',
      terminalMarker: 'none',
    },
  };
}

function isVerifiedClaudeResult(parsed) {
  const envelope = parsed?.terminalEnvelope;
  return parsed?.answerSource === 'result'
    && envelope?.type === 'result'
    && envelope?.subtype === 'success'
    && envelope?.is_error === false;
}

/**
 * @param {unknown} terminalEnvelope
 * @returns {{observedModels:string[],source:string,observedAt:string}|undefined}
 */
function extractClaudeModelAttestation(terminalEnvelope) {
  if (!isApprovedClaudeTerminalEnvelope(terminalEnvelope)) return undefined;
  for (const candidate of CLAUDE_RUNTIME_MODEL_METADATA.modelUsagePaths) {
    const observedModels = ownNonEmptyStringKeys(valueAtPath(terminalEnvelope, candidate.path));
    if (observedModels.length > 0) {
      return {
        observedModels: firstSeenUniqueStringArray(observedModels),
        source: candidate.source,
        observedAt: new Date().toISOString(),
      };
    }
  }
  return undefined;
}

function isApprovedClaudeTerminalEnvelope(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && CLAUDE_RUNTIME_MODEL_METADATA.schemaVersion === 1
    && value.type === CLAUDE_RUNTIME_MODEL_METADATA.terminal.type
    && value.subtype === CLAUDE_RUNTIME_MODEL_METADATA.terminal.subtype
    && value.is_error !== true;
}

function valueAtPath(value, path) {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)
      || !Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function ownNonEmptyStringKeys(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => key.trim().length > 0) ? keys : [];
}

function firstSeenUniqueStringArray(values) {
  const seen = new Set();
  const unique = [];
  for (const value of values) {
    if (typeof value === 'string' && !seen.has(value)) {
      seen.add(value);
      unique.push(value);
    }
  }
  return unique;
}
