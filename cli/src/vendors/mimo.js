// MiMoCode vendor adapter (XiaomiMiMo/MiMo-Code)
// Anchor: cli/src/vendors/mimo.js
//
// MiMoCode is an OpenCode fork with a `mimo run` noninteractive path. Verified
// against local @mimo-ai/cli 0.1.0 and the public XiaomiMiMo/MiMo-Code README.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { applyTaskTypeFloor } from '../subprocess.js';
import { diagnosticSignal } from '../vendor-signal.js';

function reasoningVariant(reasoning) {
  if (!reasoning) return null;
  return reasoning === 'xhigh' ? 'max' : reasoning;
}

/** @type {import('../types.js').VendorAdapter} */
export const mimoAdapter = {
  name: 'mimo',
  command: 'mimo',
  stdinMode: 'none',
  // Prompt-delivery capability (win-cmd-shim multi-line truncation fix). MiMoCode 0.1.3+
  // reads the prompt from stdin when `mimo run` is given NO positional message
  // (content-verified: a line-2 marker echoed back through the mimo.cmd shim). The
  // delivery layer routes to stdin ONLY on win-cmd-shim; argv elsewhere. Default ON;
  // env opt-out HOPPER_MIMO_STDIN=0. (Requires MiMoCode >= 0.1.3 for the stdin form.)
  promptStdin: 'supported',
  promptStdinDefault: true,

  // Background-idle heartbeat filter (mimo background-exit hang). `mimo run --print-logs` emits
  // a GET /session/status poll line to the log every ~400ms FOREVER — even after the answer is
  // delivered — because mimo's session-status completion poller keeps the process alive with no
  // terminal JSON event. That endless growth defeats the runner's raw-size idle detector, so a
  // lingering mimo waits out the full 30-min ceiling. The runner uses this regex to measure
  // SUBSTANTIVE growth instead (reset the idle clock only on non-heartbeat lines), reaping the
  // process ~idleMs after real output stops. parseResult (below) then classifies a reap-after-
  // completion as success with the already-delivered answer. Non-global (used with .test in a loop).
  idleHeartbeatRe: /path=\/session\/status\b/,

  capabilities: {
    modelArg: {
      accepted: 'freeform',
      knownGood: ['mimo/mimo-auto', 'xiaomi/mimo-v2.5-pro', 'xiaomi/mimo-v2.5-pro-ultraspeed'],
      sourceNote: 'MiMoCode `mimo run -m, --model <provider/model>` accepts provider/model identifiers. Run `mimo models` for the account-local catalog.',
    },
    reasoningArg: {
      accepted: 'enumerated',
      knownGood: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      sourceNote: 'MiMoCode exposes provider-specific reasoning via `--variant`; hopper maps `--reasoning xhigh` to MiMo `--variant max` and forwards the other levels verbatim.',
    },
    features: {
      sessionResume: { supported: true, mechanism: '`mimo run --session <id>` / `--continue` / `--fork`' },
      fileOutput: { supported: false, mechanism: 'stdout only; use `--format json` + shell redirect.' },
      streaming: { supported: true, mechanism: '`mimo run --format json` emits newline-delimited JSON events; text events carry `part.text`.' },
      permissions: { supported: true, mechanism: 'Default hopper dispatch uses `--agent build --dangerously-skip-permissions`; explicit read-only dispatch uses `--agent plan` and does not skip permissions.' },
    },
    webSearch: { headless: true, hopperEnabled: false, how: 'Exa websearch; set MIMOCODE_ENABLE_EXA=1 or use the MiMo provider (not auto-forwarded)' },
    staleAfter: '2026-09-11',
  },

  args(input, opts) {
    const sandbox = opts.sandbox ?? 'danger-full-access';
    const variant = reasoningVariant(opts.reasoning);
    const agent = sandbox === 'read-only' ? 'plan' : 'build';
    const argv = [
      'run',
      // STDIN MODE (win-cmd-shim): omit the positional so `mimo run` (no message) reads
      // the FULL prompt from stdin — bypassing the cmd.exe argv newline truncation.
      ...(opts.promptViaStdin ? [] : [input]),
      ...(opts.cwd ? ['--dir', opts.cwd] : []),
      ...(opts.model ? ['--model', opts.model] : []),
      ...(opts.conversationId ? ['--session', opts.conversationId] : []),
      '--agent', agent,
      '--format', 'json',
      '--pure',
      '--print-logs',
      ...(variant ? ['--variant', variant] : []),
    ];

    if (sandbox === 'danger-full-access') argv.push('--dangerously-skip-permissions');
    return argv;
  },

  envPreflight() {
    const candidates = [
      join(homedir(), '.local', 'share', 'mimocode', 'auth.json'),
      join(homedir(), '.config', 'mimocode', 'mimocode.json'),
      join(homedir(), '.mimocode', 'mimocode.json'),
      join(process.cwd(), '.mimocode', 'mimocode.json'),
    ];
    if (candidates.some((p) => existsSync(p))) return { ok: true, missing: [] };
    if (process.env.MIMO_API_KEY || process.env.XIAOMI_MIMO_API_KEY) {
      return { ok: true, missing: [] };
    }
    return {
      ok: true,
      missing: ['Note: no obvious MiMoCode auth/config found. If smoke fails, run `mimo` for first-launch setup or configure MiMo Auto / Xiaomi MiMo Platform credentials.'],
    };
  },

  timeoutMs(opts) {
    return applyTaskTypeFloor(180_000, opts);
  },

  parseResult(raw) {
    if (raw.timedOut) {
      // mimo background-exit hang: mimo can deliver the FULL answer and then never exit (its
      // session-status poller keeps the process alive with no terminal JSON event). The runner's
      // heartbeat-aware idle detector reaps it (timeoutReason='idle') once SUBSTANTIVE output has
      // been silent for idleMs. If the answer actually COMPLETED (a step_finish event + non-empty
      // extracted text), that reap is graceful — classify it success with the delivered answer,
      // NOT a failure. A genuine timeout (ceiling budget, or idle with no completed answer) stays
      // a timeout. (timeoutReason is threaded by hopper-runner; absent on the sync path.)
      const log = raw.logFileContent || raw.stdout || '';
      const parsed = extractMimoJsonText(log);
      // Only a TERMINAL step_finish (part.reason !== 'tool-calls' — i.e. the model actually
      // stopped generating: 'stop'/'end_turn'/'length'/…) means the answer finished. A
      // 'tool-calls' step_finish is just a mid-turn tool boundary, so gating on "any step_finish"
      // would let a mid-task idle reap be mislabeled success with a PARTIAL answer (codex review).
      const completed = mimoAnswerCompleted(log);
      if (raw.timeoutReason === 'idle' && completed && parsed.text) {
        return {
          text: parsed.text,
          status: 'success',
          usage: parsed.totalTokens ? { totalTokens: parsed.totalTokens } : undefined,
        };
      }
      return { text: parsed.text || raw.stdout, status: 'timeout', error: `mimo run timed out after ${raw.durationMs}ms` };
    }
    // Exit 127 is the shell's own verdict and is proof. The `not found` substring
    // test that used to sit beside it was not: in background mode the runner hands
    // over one interleaved transcript, so it matched the assistant's own prose.
    // A binary that is missing cannot also have produced output.
    if (raw.exitCode === 127) {
      return {
        text: '',
        status: 'permission-fail',
        error: 'mimo binary not found in PATH. Install: curl -fsSL https://mimo.xiaomi.com/install | bash OR npm install -g @mimo-ai/cli.',
      };
    }

    const { text: signal } = diagnosticSignal(raw);
    if (raw.exitCode !== 0
      && (/unauthoriz|invalid\s+(?:api[\s-]*key|credential)|api[\s-]*key\s*(?:is\s*)?(?:invalid|expired|missing|not set)|not logged in|credential(?:s)?\s*(?:invalid|expired|missing|not found)/i.test(signal)
        || /\bHTTP\s*(?:401|403)\b|\bstatus(?:\s*code)?[:=]?\s*(?:401|403)\b/i.test(signal))) {
      return {
        text: '',
        status: 'auth-fail',
        error: 'MiMo auth error. Run `mimo` for first-launch setup, or configure Xiaomi MiMo Platform credentials.',
      };
    }
    if (/permission denied|operation not permitted|\bEPERM\b|not allowed/i.test(signal)) {
      return {
        text: raw.stdout,
        status: 'permission-fail',
        error: `mimo permission error: ${(raw.stderr || raw.stdout || '').slice(0, 500)}`,
      };
    }

    if (raw.exitCode === 0) {
      const parsed = extractMimoJsonText(raw.stdout);
      return {
        text: parsed.text,
        status: 'success',
        usage: parsed.totalTokens ? { totalTokens: parsed.totalTokens } : undefined,
      };
    }

    return {
      text: raw.stdout,
      status: 'unknown-fail',
      error: `mimo exited ${raw.exitCode}: ${(raw.stderr || '').slice(0, 500)}`,
    };
  },
};

/**
 * True iff the mimo JSON stream contains a TERMINAL step_finish — one whose `part.reason` is a
 * generation-stop ('stop' / 'end_turn' / 'length' / 'completed' / …), NOT a 'tool-calls' step
 * boundary (which only means "ran a tool, another turn is coming"). Distinguishes a completed
 * answer from a mid-task idle reap, so parseResult classifies an idle reap as success ONLY when
 * the answer actually finished. Exported for tests. Coupled to mimo's `--format json` event
 * schema (reason at part.reason); revisit on mimo upgrades (see adapter staleAfter).
 * @param {string} log  full mimo stdout/log
 * @returns {boolean}
 */
export function mimoAnswerCompleted(log) {
  if (!log) return false;
  for (const line of String(log).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.includes('"step_finish"')) continue;
    let ev;
    try { ev = JSON.parse(t); } catch (_) { continue; }
    if (!ev || ev.type !== 'step_finish') continue;
    const reason = String(ev.part?.reason ?? ev.reason ?? '').toLowerCase();
    if (reason !== 'tool-calls' && reason !== 'tool_calls' && reason !== 'tool_use') return true;
  }
  return false;
}

export function extractMimoJsonText(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) return { text: '', totalTokens: undefined };

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  const chunks = [];
  let parsedJson = false;
  let totalTokens;

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      parsedJson = true;
      const text = extractMimoEventText(event);
      if (text) chunks.push(text);
      const tokens = event?.part?.tokens?.total ?? event?.tokens?.total;
      if (typeof tokens === 'number') totalTokens = tokens;
    } catch (_) {
      // Mixed output is possible; fall back to raw text if nothing parsed.
    }
  }

  if (parsedJson) return { text: chunks.join('').trim(), totalTokens };
  return { text: trimmed, totalTokens: undefined };
}

function extractMimoEventText(event) {
  if (!event || typeof event !== 'object') return '';
  if (event.type === 'text' && typeof event.text === 'string') return event.text;
  if (event.type === 'text' && typeof event.part?.text === 'string') return event.part.text;
  if (typeof event.delta === 'string') return event.delta;
  if (typeof event.part?.delta === 'string') return event.part.delta;
  if (event.type === 'message.part.delta' && typeof event.delta === 'string') return event.delta;
  if (event.type === 'message.part.delta' && typeof event.part?.text === 'string') return event.part.text;
  return '';
}
