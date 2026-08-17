// Classifier discipline + the grok false-auth regression.
// Anchor: tests/unit/vendor-signal.test.js
//
// Guards the 2026-08-05 incident: two completed, paid grok reviews (end_turn,
// 16854 chars, $0.32 each) recorded as `auth-fail`. Three defects had to line up,
// so each gets its own test — fixing any one alone would still have lost the run.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  diagnosticSignal, heuristicsAllowed,
  normalizeTerminalReason, isSuccessfulTerminalReason, isUnsuccessfulTerminalReason,
} from '../../cli/src/vendor-signal.js';
import { getAdapter } from '../../cli/src/vendors/index.js';

// ─── provenance ──────────────────────────────────────────────────────────────

test('diagnosticSignal: an unseparated transcript is reported as unseparated', () => {
  // The runner cannot split the streams in background mode. It used to hand the
  // same transcript over as BOTH stdout and stderr, so "scan stderr for trouble"
  // silently meant "scan the assistant's prose for trouble".
  const r = diagnosticSignal({ stdout: 'x', stderr: '', combined: 'x\ny', streamsSeparated: false });
  assert.equal(r.separated, false);
  assert.equal(r.text, 'x\ny');
});

test('diagnosticSignal: genuinely separate streams are joined and marked separated', () => {
  const r = diagnosticSignal({ stdout: 'out', stderr: 'err' });
  assert.equal(r.separated, true);
  assert.match(r.text, /out/);
  assert.match(r.text, /err/);
});

// ─── the veto ────────────────────────────────────────────────────────────────

test('heuristicsAllowed: a completed run vetoes text heuristics', () => {
  assert.equal(heuristicsAllowed({ exitCode: 0, hasAnswer: true, terminalSuccess: true }), false);
});

test('heuristicsAllowed: the veto is narrow — every weakened condition re-allows them', () => {
  // Deliberately NOT "a parseable envelope can never be overridden". Infrastructure
  // failures are established by the harness and must still win.
  assert.equal(heuristicsAllowed({ exitCode: 1, hasAnswer: true, terminalSuccess: true }), true);
  assert.equal(heuristicsAllowed({ exitCode: 0, hasAnswer: false, terminalSuccess: true }), true);
  assert.equal(heuristicsAllowed({ exitCode: 0, hasAnswer: true, terminalSuccess: false }), true);
});

// ─── terminal reasons ────────────────────────────────────────────────────────

test('terminal reasons compare normalized (end_turn === EndTurn)', () => {
  // grok's real envelopes say `end_turn`; the adapter recognized only `EndTurn`, so
  // a verified-complete run was filed `unknown-completeness` on casing alone — and
  // every existing fixture used the capitalized spelling, so nothing caught it.
  assert.equal(normalizeTerminalReason('end_turn'), 'endturn');
  assert.equal(normalizeTerminalReason('EndTurn'), 'endturn');
  assert.equal(normalizeTerminalReason('End-Turn'), 'endturn');
  for (const r of ['end_turn', 'EndTurn', 'END TURN', 'stop', 'completed']) {
    assert.equal(isSuccessfulTerminalReason(r), true, `${r} should read as success`);
  }
});

test('an unrecognized terminal reason is unknown, not failure', () => {
  assert.equal(isSuccessfulTerminalReason('something_new'), false);
  assert.equal(isUnsuccessfulTerminalReason('something_new'), false, 'unknown must not be read as failure');
  assert.equal(isUnsuccessfulTerminalReason('cancelled'), true);
  assert.equal(isUnsuccessfulTerminalReason('refusal'), true);
});

// ─── grok adapter regression ─────────────────────────────────────────────────

const grok = getAdapter('grok');

/** The shape the incident produced: brace-bearing preamble, then the real envelope. */
function transcriptWithPreamble(envelope) {
  return [
    'hopper-runner: idle watchdog disabled (bufferedOutput vendor)',
    '2026-08-05T13:29:58Z  WARN hook loading error error=ParseFile { path: "C:\\\\Users\\\\u\\\\.cursor\\\\hooks.json", detail: "invalid matcher groups for event \'postToolUse\': missing field `hooks`" }',
    '2026-08-05T13:29:58Z ERROR Failed to spawn MCP server \'gitnexus\': %1 is not a valid Win32 application. (os error 193)',
    JSON.stringify(envelope, null, 2),
  ].join('\n');
}

const ENVELOPE = {
  text: 'The review findings go here.',
  stopReason: 'end_turn',
  usage: { input_tokens: 97145, output_tokens: 7978 },
  num_turns: 5,
};

test('grok: a brace-bearing preamble no longer shadows the envelope', () => {
  // The framed candidate used to slice from the FIRST '{' — which the tracing-style
  // `ParseFile { ... }` warning owns — producing garbage and a false failure.
  const res = grok.parseResult({ exitCode: 0, stdout: transcriptWithPreamble(ENVELOPE), stderr: '', timedOut: false });
  assert.equal(res.status, 'success');
  assert.equal(res.diagnosticCode, 'none');
  assert.equal(res.text, ENVELOPE.text);
});

test('grok: lowercase end_turn counts as verified-complete', () => {
  const res = grok.parseResult({ exitCode: 0, stdout: transcriptWithPreamble(ENVELOPE), stderr: '', timedOut: false });
  assert.equal(res.outputEvidence.completeness, 'verified-complete');
  assert.equal(res.outputEvidence.terminalMarker, 'grok-end-turn');
});

test('grok: a bare "invalid" in vendor noise is NOT an auth failure', () => {
  // The exact trigger: a warning that ~/.cursor/hooks.json had "invalid matcher
  // groups". The qualifier in `invalid(?:\s+(?:api\s*)?key)?` was optional.
  const noisy = transcriptWithPreamble(ENVELOPE);
  assert.match(noisy, /invalid/, 'fixture really does contain the trigger word');
  assert.notEqual(grok.parseResult({ exitCode: 0, stdout: noisy, stderr: '', timedOut: false }).status, 'auth-fail');
});

test('grok: a bare 401/403 in prose is NOT an auth failure', () => {
  const prose = transcriptWithPreamble({ ...ENVELOPE, text: 'See line 401 and byte 403 of the handler.' });
  assert.equal(grok.parseResult({ exitCode: 0, stdout: prose, stderr: '', timedOut: false }).status, 'success');
});

test('grok: a REAL auth failure is still detected', () => {
  // Narrowing must not blind it. No envelope, non-zero exit, explicit HTTP status.
  const res = grok.parseResult({
    exitCode: 1,
    stdout: 'HTTP 401 Unauthorized\nlogin required',
    stderr: '',
    timedOut: false,
  });
  assert.equal(res.status, 'auth-fail');
  assert.equal(res.diagnosticCode, 'adapter-auth-failed');
});

test('grok: "not found" in review prose is NOT a missing binary', () => {
  // The 0.47.0-era defect, still live until now: the substring beside exit 127
  // scanned the whole transcript, and "element not found" is ordinary review prose.
  const res = grok.parseResult({
    exitCode: 0,
    stdout: transcriptWithPreamble({ ...ENVELOPE, text: 'flip to true, which is what we want for "element not found" negation.' }),
    stderr: '',
    timedOut: false,
  });
  assert.equal(res.status, 'success');
});

test('grok: exit 127 still reports a missing binary', () => {
  const res = grok.parseResult({ exitCode: 127, stdout: '', stderr: '', timedOut: false });
  assert.equal(res.diagnosticCode, 'adapter-binary-missing');
});

test('grok: infrastructure failures still override a complete envelope', () => {
  // The veto covers vendor-reported outcomes only. A timeout is established by the
  // harness and must win even with a parseable end_turn envelope present.
  const res = grok.parseResult({ exitCode: 0, stdout: transcriptWithPreamble(ENVELOPE), stderr: '', timedOut: true });
  assert.equal(res.status, 'timeout');
  assert.equal(res.diagnosticCode, 'adapter-timeout');
});

test('grok: an explicit failure stopReason still fails despite text', () => {
  const res = grok.parseResult({
    exitCode: 0,
    stdout: transcriptWithPreamble({ ...ENVELOPE, stopReason: 'cancelled' }),
    stderr: '',
    timedOut: false,
  });
  assert.notEqual(res.status, 'success');
});

// ─── cross-adapter: the family is closed ─────────────────────────────────────

test('no adapter treats a bare "not found" as a missing binary any more', async () => {
  // Whole-transcript substring classification for a condition that exit codes
  // already prove. Each of these fired on assistant prose in background mode.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join } = await import('node:path');
  const dir = fileURLToPath(new URL('../../cli/src/vendors/', import.meta.url));
  for (const f of ['grok.js', 'claude.js', 'kimi.js', 'mimo.js']) {
    const src = readFileSync(join(dir, f), 'utf-8');
    assert.ok(
      !/exitCode === 127 \|\| \/not found\|command not found\/i\.test/.test(src),
      `${f} still pairs exit 127 with a whole-stream "not found" substring test`,
    );
  }
});
