// Grok (xAI "Grok Build" CLI) vendor adapter (T-GROK-01)
// Anchor: cli/src/vendors/grok.js
//
// xAI's official first-party agentic coding CLI "Grok Build". Binary: `grok`.
// Per spec §3 #4: thin wrapper, ZERO retry/fallback/circuit-breaker.
//
// SOURCE & CONFIDENCE: authored from a 3-way web research sweep of docs.x.ai
// plus adversarial verification (recommendation: proceed-with-corrections,
// overall_confidence: high) — NOT from local dogfood (grok not installed on
// the authoring machine). CONFIRMED against docs.x.ai/build/cli/headless-scripting:
// headless form `grok -p "<prompt>" --output-format json`, `-p`(long form
// `--single`), `-m, --model`, `-s/-r/-c` session resume, `--always-approve`
// (-p does NOT auto-approve tool calls — required for background or the agent
// hangs per tool call), `--no-auto-update`, auth via XAI_API_KEY / ~/.grok/.
// Items handled defensively because UNCONFIRMED: the `--output-format json`
// object field names, the built-in default model when -m omitted, exit-code
// semantics, and background+session-flag interaction.
//
// ⚠ BINARY NAME COLLISION: a popular THIRD-PARTY tool (superagent-ai/grok-cli,
// npm `grok-dev` / `@vibe-kit/grok-cli`) ships the SAME binary name `grok`,
// uses GROK_API_KEY (NOT XAI_API_KEY), `--format json` (NOT --output-format),
// and emits OpenAI-style NDJSON with a default of grok-code-fast-1. This adapter
// targets xAI's OFFICIAL Grok Build CLI only — envPreflight checks XAI_API_KEY +
// ~/.grok/, NEVER GROK_API_KEY. If PATH resolves to the third-party binary,
// args/auth/output will mismatch; the sourceNotes flag this.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { applyTaskTypeFloor } from '../subprocess.js';
import { adapterFailure } from '../adapter-diagnostics.js';
import { diagnosticSignal, heuristicsAllowed, isSuccessfulTerminalReason, isUnsuccessfulTerminalReason } from '../vendor-signal.js';

// Always pass -m explicitly: when -m is omitted the CLI's built-in default is
// UNCONFIRMED, and retired slugs can silently redirect. Real-world dogfood on
// 2026-06-02 confirmed `grok-build` as the working coding-model slug — but the
// grok model line ROTATES without notice (see
// ISSUE-grok-model-line-rotation-stale-knownGood.md): as of 2026-07-16/18,
// `grok-build` and `grok-composer-2.5-fast` both 400 with `Couldn't set model
// '<x>': Invalid params: "unknown model id"`. `grok -p ... -m grok-4.5
// --output-format json` live micro-test on 2026-07-18 (grok CLI v0.2.101)
// returned `{"text":"OK","stopReason":"EndTurn",...}` — CONFIRMED working.
const DEFAULT_MODEL = 'grok-4.6';

const GROK_CREDENTIAL_BASENAMES = Object.freeze([
  'config.toml',
  'config.json',
  'auth',
  'managed_config.toml',
]);

/**
 * Report only the local launcher credential context. This never reads a
 * credential value and never validates credentials against a remote service.
 * @param {{env?: NodeJS.ProcessEnv, exists?: typeof existsSync, home?: string}} [options]
 * @returns {'key-present-unverified'|'credential-artifact-present-unverified'|'not-detected'|'unknown'}
 */
export function grokAuthContext({ env = process.env, exists = existsSync, home = homedir() } = {}) {
  if (typeof env.XAI_API_KEY === 'string' && env.XAI_API_KEY.trim()) return 'key-present-unverified';
  try {
    return GROK_CREDENTIAL_BASENAMES.some((name) => exists(join(home, '.grok', name)))
      ? 'credential-artifact-present-unverified'
      : 'not-detected';
  } catch (_) {
    return 'unknown';
  }
}

/** @type {import('../types.js').VendorAdapter} */
export const grokAdapter = {
  name: 'grok',
  command: 'grok',
  stdinMode: 'none',

  // Idle-watchdog hint (ISSUE-grok-claude-buffered-output-idle-falsekill): grok
  // `--output-format json` (passed in args() below) is END-BUFFERED — the vendor
  // writes stdout ONCE at completion, not incrementally (see the `streaming`
  // capability note and parseResult's "single trailing JSON object" comment
  // further down).
  // hopper-runner's background idle poll resets only on log-FILE-size growth, so
  // for a fully-buffered vendor that never grows the log until exit, idle
  // degenerates into an unconditional kill ~idleMs after spawn. This flag tells
  // the runner to skip arming that poll entirely for grok (the absolute ceiling
  // timeout still applies as the safety net).
  bufferedOutput: true,

  capabilities: {
    modelArg: {
      accepted: 'freeform',
      // The model hopper prefers for hopper-shaped work. Same value as
      // DEFAULT_MODEL above (which args() passes when no model is requested), so
      // a grok dispatch is now pinned to the SAME model whether it arrives via
      // the sentinel or via the adapter fallback — and the sentinel path RECORDS
      // it, which the fallback path never did (a swarm panelist showed
      // `observed_models_json: []` while really running grok-4.5).
      hopperDefault: DEFAULT_MODEL,
      // knownGood[0] is the `verified-latest` sentinel target (cli/src/dispatch.js
      // resolveAdapterOptsForTask + cli/src/policy.js). The grok model LINE is
      // version-coupled and rotates without notice — xAI retires slugs and this
      // list rots out from under us (ISSUE-grok-model-line-rotation-stale-
      // knownGood.md: `grok-build` + `grok-composer-2.5-fast`, both live-good as
      // of 2026-06-02, returned `Couldn't set model '<x>': Invalid params:
      // "unknown model id"` by 2026-07-16). Live `--probe grok` (see
      // cli/src/vendor-probe/grok.js) now parses `grok models`' own "Available
      // models:" listing.
      //
      // **更正 2026-08-13** —— 这里原本写着「实时 probe 是缓存新鲜时的首选自愈来源，
      // 本静态列表只是离线/未探测过的回退基线，不是事实来源」。**对真正决定派哪个模型
      // 的那条路径，这两句都是假的。** `cli/src/dispatch.js:868` 调的是
      // `resolveVerifiedLatest(getAdapter(vendor)?.capabilities?.modelArg)` —— 它读的
      // 就是这个静态对象，从不查 `~/.hopper/cache/vendor-capabilities.json`。
      // 2026-08-13 实测：跑完 `--probe grok`（缓存里已写入 `grok-4.6, grok-4.5`）之后，
      // 紧接着解析出来的仍然是 `grok-4.5`，因为下面那行 `hopperDefault` 才是
      // `resolveVerifiedLatest` 的返回值。**probe 自愈的是缓存，不是派发。**
      // 这正是 ISSUE-grok-model-line-rotation-stale-knownGood 点名的根因
      //（「修复静态数据的唯一机制本身也是静态的」）以更窄的形式存活下来：探针变成实时的
      // 了，但它的结果从未接进解析路径。已另行登记；此注释存在的意义，是不让下一个读者
      // 像这一个一样被误导。
      knownGood: ['grok-4.6', 'grok-4.5'],
      sourceNote: 'grok `-m, --model <MODEL>` (CONFIRMED docs.x.ai/build/cli/headless-scripting). **grok-4.6 V-verified 2026-08-13** via `grok -p "Reply with exactly: MODELCHECK-46-OK" -m grok-4.6 --output-format json --no-auto-update` live micro-test → {"text":"MODELCHECK-46-OK","stopReason":"end_turn",...} (real dispatch, NOT just `grok models` listing it — that distinction is the whole lesson of ISSUE-grok-model-line-rotation-stale-knownGood). Same-date `--probe grok` lists exactly two: grok-4.6, grok-4.5. Prior baseline: V-verified 2026-07-18 via `grok -p "..." -m grok-4.5 --output-format json` live micro-test on grok CLI v0.2.101 → {"text":"OK","stopReason":"EndTurn",...} (real dispatch, not just `grok models` listing it). `grok models` (live, same date) confirms grok-4.5 is also the CLI\'s own default. `grok-build` / `grok-composer-2.5-fast` (the prior knownGood) both now 400 with "unknown model id" — retired sometime between 2026-06-02 and 2026-07-16. CLI built-in default when -m omitted is still UNCONFIRMED as a matter of policy, so this adapter ALWAYS passes -m explicitly. NAME COLLISION: the third-party grok-cli defaults to grok-code-fast-1 and uses different auth/output flags.',
    },
    reasoningArg: {
      accepted: 'enumerated',
      knownGood: ['low', 'medium', 'high'],
      sourceNote: 'grok headless `--effort`/`--reasoning-effort <EFFORT>` exists (CONFIRMED via `grok --help` on v0.2.101, re-checked 2026-07-18 — flag present, unchanged). The adapter forwards opts.reasoning -> --effort ONLY when set (opt-in), so grok builds predating the flag are unaffected by default dispatches. Accepted level vocabulary is STILL not enumerated by `grok --help` (unlike --permission-mode/--output-format, which do list "[possible values: ...]"); low|medium|high remain the known-good levels observed, re-confirmed 2026-07-18 alongside the grok-4.5 model-line rotation fix — no xhigh ceiling on grok, unchanged. Older docs.x.ai claimed no CLI effort flag — that is now stale.',
    },
    features: {
      sessionResume: { supported: true, mechanism: '`grok -s <id>` (named headless session) / `-r <id>` (resume) / `-c` (continue cwd). Adapter passes `-r <id>` only when opts.conversationId set. Background+session interaction UNCONFIRMED.' },
      fileOutput: { supported: false, mechanism: 'stdout only; no --output-file flag (CONFIRMED absent). Redirect --output-format json at the shell layer if a file is needed.' },
      streaming: { supported: true, mechanism: '`--output-format streaming-json` emits NDJSON events; accepted values are plain|json|streaming-json (plain = human-readable, CONFIRMED). Adapter uses `json` for a single trailing object suited to background capture.' },
    },
    webSearch: { headless: true, hopperEnabled: true, how: 'automatic — web_search/x_search are default agent tools (no flag needed)' },
    staleAfter: '2026-08-31',
  },

  // HOPPER (vendor-preset feedback 2026-06-15): long-form flags the adapter
  // relies on, checked by `hopper-dispatch --check --compat` against `grok --help`.
  compatFlags: ['--single', '--output-format', '--model', '--permission-mode', '--cwd'],

  args(input, opts) {
    const sandbox = opts.sandbox ?? 'danger-full-access';
    // Headless single-prompt form (CONFIRMED): grok -p "<prompt>" --output-format json
    // (-p is the short form of --single). --no-auto-update suppresses CI update noise.
    //
    // Headless = no interactive approval is possible: a background dispatch, an
    // injected log file, or a non-TTY stdout (a host shell driving us). In that
    // case grok needs an explicit permission mode (and, for full-access, also
    // --always-approve) or it stalls and returns stopReason:"Cancelled" with
    // Auth(AuthorizationRequired) + "worker quit" (vendor-preset feedback
    // 2026-06-15 — --always-approve alone was insufficient). bypassPermissions is
    // the headless-safe mode (CONFIRMED `grok --help`:
    // default|acceptEdits|auto|dontAsk|bypassPermissions|plan). The --sandbox opt
    // still gates --always-approve (full-access only). Escape hatch:
    // HOPPER_GROK_PERMISSION_MODE overrides the mode (empty = omit it on grok
    // builds that lack the flag).
    const headless = Boolean(opts.background || opts.logFile || !process.stdout.isTTY);
    const permMode = process.env.HOPPER_GROK_PERMISSION_MODE ?? 'bypassPermissions';
    return [
      '-p', input,
      '--output-format', 'json',
      '--no-auto-update',
      '-m', opts.model ?? DEFAULT_MODEL,
      // Anchor the working dir explicitly (CONFIRMED `--cwd <PATH>` docs.x.ai).
      // hopper injects opts.cwd = resolved vendor CWD (repo root by default, or
      // $HOPPER_VENDOR_CWD). grok's sandbox is relative to --cwd, so a widened
      // root reaches external paths without disabling grok's permission model.
      ...(opts.cwd ? ['--cwd', opts.cwd] : []),
      ...(headless && permMode ? ['--permission-mode', permMode] : []),
      ...(headless && sandbox === 'danger-full-access' ? ['--always-approve'] : []),
      // Reasoning effort. grok --effort vocabulary is low|medium|high, but the
      // dispatch layer now defaults opts.reasoning to the canonical max 'xhigh'
      // (5-level scale), so clamp it down (xhigh→high, minimal→low). Escape hatch:
      // HOPPER_GROK_EFFORT overrides the level (empty string omits --effort
      // entirely, for grok builds that predate the flag). A direct adapter call
      // with no reasoning + no env still emits NO --effort (opt-in preserved).
      ...(() => {
        const raw = process.env.HOPPER_GROK_EFFORT !== undefined
          ? process.env.HOPPER_GROK_EFFORT
          : opts.reasoning;
        const eff = clampGrokEffort(raw);
        return eff ? ['--effort', eff] : [];
      })(),
      ...(opts.conversationId ? ['-r', opts.conversationId] : []),
    ];
  },

  envPreflight() {
    // This stays a zero-spawn, non-secret context check. A browser/OAuth state
    // in another session might not be inherited by the Hopper Node parent, so
    // no local artifact can establish remotely verified authentication.
    const authContext = grokAuthContext();
    const note = authContext === 'key-present-unverified'
      ? 'Note: XAI_API_KEY is present, but this zero-spawn check cannot validate it remotely.'
      : authContext === 'credential-artifact-present-unverified'
        ? 'Note: a Grok credential artifact is present, but this zero-spawn check cannot validate it remotely.'
        : authContext === 'not-detected'
          ? 'Note: no XAI_API_KEY or recognized ~/.grok credential artifact was detected. This zero-spawn check cannot verify remote auth; browser state in another session may not be inherited.'
          : 'Note: Grok credential context could not be read. This zero-spawn check cannot verify remote auth.';
    return {
      ok: true,
      missing: [note],
      authContext,
    };
  },

  timeoutMs(opts) {
    // Native: 300s (agentic coding CLI; same tier as codex).
    const native = 300_000;
    // Phase 6c F1: review task-types raised to 30min floor (all-adapter consistent).
    return applyTaskTypeFloor(native, opts);
  },

  parseResult(raw) {
    // ── Harness-established failures. Decided by the runner, not by reading
    // vendor prose, so they run first and are never subject to the veto below.
    if (raw.timedOut) {
      return adapterFailure('timeout', 'adapter-timeout');
    }
    // Exit 127 is the shell's own "command not found" and is proof. The substring
    // test that used to sit beside it was NOT proof: it scanned the whole
    // transcript for `not found`, a phrase any code reviewer writes ("element not
    // found"), and filed completed reviews as `adapter-binary-missing`. A missing
    // binary cannot coexist with a vendor that ran for three minutes and returned
    // an envelope, so there is nothing to recover by guessing.
    if (raw.exitCode === 127) {
      return adapterFailure('permission-fail', 'adapter-binary-missing');
    }

    const parsed = extractGrokText(raw.stdout);
    const outputEvidence = grokOutputEvidence(parsed);
    const hasAnswer = Boolean(parsed.parsedJson && !parsed.hasError && parsed.text.trim());
    const terminalSuccess = isSuccessfulTerminalReason(parsed.stopReason);
    const unsuccessfulStop = isUnsuccessfulTerminalReason(parsed.stopReason);

    if (raw.exitCode === 0 && hasAnswer && !unsuccessfulStop) {
      const result = parsed.usage
        ? { text: parsed.text, status: 'success', diagnosticCode: 'none', usage: parsed.usage }
        : { text: parsed.text, status: 'success', diagnosticCode: 'none' };
      return outputEvidence ? { ...result, outputEvidence } : result;
    }

    // ── Text heuristics, and only from here down. They may explain a failure;
    // they may not declare one the vendor already said did not happen.
    const { text: signal } = diagnosticSignal(raw);
    const mayGuess = heuristicsAllowed({ exitCode: raw.exitCode, hasAnswer, terminalSuccess });
    const status = mayGuess && hasSpecificGrokAuthFailure(signal) ? 'auth-fail' : 'unknown-fail';
    const diagnostic = status === 'auth-fail'
      ? 'adapter-auth-failed'
      : (raw.exitCode === 0 ? 'adapter-protocol-invalid' : 'adapter-unknown-failed');
    return failedGrokOutput(status, diagnostic, parsed, outputEvidence);
  },
};

/**
 * Clamp the canonical 5-level reasoning scale to grok's known-good --effort
 * vocabulary (low|medium|high). xhigh→high, minimal→low; unknown/empty → null
 * (omit the flag). Exported-by-position next to args() for locality.
 * @param {string|undefined|null} level
 * @returns {string|null}
 */
function clampGrokEffort(level) {
  switch (level) {
    case 'xhigh':
    case 'high': return 'high';
    case 'medium': return 'medium';
    case 'low':
    case 'minimal': return 'low';
    default: return null;
  }
}

/**
 * Defensive extraction of answer text from grok --output-format json stdout.
 * Field names are UNCONFIRMED (docs never document the object shape), so try
 * only common fields from a whole or trailing JSON object. Plain stdout is
 * never parser-designated answer text.
 * @param {string} stdout
 * @returns {{ text: string, usage?: object, stopReason?: string, parsedJson: boolean, hasError?: boolean }}
 */
function extractGrokText(stdout) {
  const trimmed = (stdout || '').trim();
  const envelopeKeys = new Set([
    'text', 'content', 'output', 'result', 'response', 'message',
    'stopReason', 'stop_reason', 'finishReason', 'finish_reason', 'error', 'usage',
  ]);
  const noSelectedObject = { text: '', parsedJson: false };
  const fromValue = (value) => {
    const obj = value;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const recognized = Object.keys(obj).some((key) => envelopeKeys.has(key));
      if (!recognized) {
        return noSelectedObject;
      }
      const text = obj.text ?? obj.message ?? obj.content ?? obj.output ?? obj.result ?? obj.response;
      const stopReason = obj.stopReason ?? obj.stop_reason ?? obj.finishReason ?? obj.finish_reason;
      return {
        text: typeof text === 'string' ? text : '',
        usage: obj.usage,
        stopReason,
        parsedJson: true,
        hasError: Boolean(obj.error),
      };
    }
    return noSelectedObject;
  };
  const parseCandidate = (candidate) => {
    try {
      return fromValue(JSON.parse(candidate));
    } catch (_) {
      return null;
    }
  };

  const whole = parseCandidate(trimmed);
  if (whole) return whole;

  // Grok emits one trailing JSON line after warnings. Inspect only that line;
  // earlier unrelated JSON must not hijack result classification.
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  const trailing = lines[lines.length - 1] || '';
  const tail = trailing === trimmed ? null : parseCandidate(trailing);
  if (tail) return tail;

  // Framed multi-line object. grok `--output-format json` pretty-prints the result
  // envelope across MANY lines, and the runner's captured stdout is preceded by log
  // output (its own notices plus the vendor's startup diagnostics). Neither the
  // whole-stdout parse nor the single trailing line sees the object.
  //
  // The first version of this candidate sliced from the FIRST '{' to the LAST '}'.
  // That assumed the preamble contains no braces — and Rust's `tracing`, which grok
  // is built on, prints structs inline: a warning about a malformed
  // ~/.cursor/hooks.json rendered as `ParseFile { path: ..., detail: ... }` and
  // became the first '{' in the stream. The slice was garbage, extraction failed,
  // and a complete run was filed as a failure. Measured on the real log: first '{'
  // at 145948, actual envelope at 149691.
  //
  // Scan BACKWARDS instead. The envelope is the LAST top-level object in the
  // stream, so the last line-initial '{' that yields a parseable object wins, and
  // no amount of brace-bearing preamble can shadow it. Bounded so a pathological
  // stream cannot turn this into a quadratic parse.
  const close = trimmed.lastIndexOf('}');
  if (close !== -1) {
    const starts = [];
    for (let i = trimmed.indexOf('\n{'); i !== -1; i = trimmed.indexOf('\n{', i + 1)) starts.push(i + 1);
    if (trimmed.startsWith('{')) starts.unshift(0);
    for (const open of starts.slice(-MAX_FRAMED_CANDIDATES).reverse()) {
      if (open >= close) continue;
      const framed = parseCandidate(trimmed.slice(open, close + 1));
      if (framed) return framed;
    }
  }
  return noSelectedObject;
}

/**
 * How many line-initial '{' positions to try, counting back from the end. The
 * envelope is realistically the last one; the rest is preamble. Bounded so a
 * stream full of brace-bearing log lines costs a fixed number of parse attempts
 * rather than one per line.
 */
const MAX_FRAMED_CANDIDATES = 40;

function grokOutputEvidence(parsed) {
  if (!parsed?.parsedJson || parsed.hasError || !parsed.text.trim()) return undefined;
  // Compared NORMALIZED. This tested `=== 'EndTurn'` while grok's actual envelopes
  // carry `end_turn`, so a genuinely complete run was filed `unknown-completeness`
  // purely on casing and an underscore — and the existing tests only ever used the
  // capitalized spelling, so nothing caught it.
  return isSuccessfulTerminalReason(parsed.stopReason)
    ? { completeness: 'verified-complete', source: 'vendor-result-field', terminalMarker: 'grok-end-turn' }
    : { completeness: 'unknown-completeness', source: 'vendor-result-field', terminalMarker: 'none' };
}

/**
 * A SPECIFIC authentication failure — the name was already a promise the regex did
 * not keep.
 *
 * Two alternatives were doing the damage:
 *   - `invalid(?:\s+(?:api\s*)?key)?` made the qualifier OPTIONAL, so a bare
 *     `invalid` matched. That word appears in ordinary vendor startup noise (the
 *     real case: a warning that ~/.cursor/hooks.json had "invalid matcher groups")
 *     and in any review that discusses invalid input.
 *   - `\b(?:HTTP\s*)?(?:401|403)\b` made the HTTP prefix optional, so a bare 401 or
 *     403 anywhere — a line number, a byte offset, a token count, a port — matched.
 *
 * Both qualifiers are now REQUIRED. The cost of a miss is a less specific
 * `unknown-fail`; the cost of a false positive was a completed, paid review
 * discarded as an auth error, twice.
 */
function hasSpecificGrokAuthFailure(signal) {
  return /\b(?:unauthorized|invalid\s+(?:api\s*)?key|login\s+required|sign[ -]?in\s+required|auth(?:oriz|entic)ation\s+required|AuthorizationRequired)\b/i.test(signal)
    || /\bHTTP\s*(?:401|403)\b|\bstatus(?:\s*code)?[:=]?\s*(?:401|403)\b/i.test(signal);
}

function failedGrokOutput(status, diagnosticCode, parsed, outputEvidence) {
  const failure = adapterFailure(status, diagnosticCode);
  if (!outputEvidence || !parsed.text.trim()) return failure;
  return { ...failure, text: parsed.text, outputEvidence };
}
