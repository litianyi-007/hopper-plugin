// Vendor contract conformance tests (Phase 2)
// Anchor: tests/unit/vendors-contract.test.js
//
// Verifies all vendor adapters conform to the VendorAdapter contract from
// cli/src/types.js. Catches drift in adapter shape without invoking vendors.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listAdapters, getAdapter } from '../../cli/src/vendors/index.js';
import { mimoAnswerCompleted } from '../../cli/src/vendors/mimo.js';
import { ADAPTER_DIAGNOSTIC_CODES, adapterDiagnostic } from '../../cli/src/adapter-diagnostics.js';

const VENDORS = ['codex', 'kimi', 'opencode', 'copilot', 'agy', 'grok', 'mimo', 'claude'];

test('registry lists exactly the 8 functional vendors', () => {
  const names = listAdapters().sort();
  assert.deepEqual(names, [...VENDORS].sort(),
    `expected ${VENDORS.join(',')}; got ${names.join(',')}`);
});

test('adapter diagnostics are a frozen closed vocabulary', () => {
  assert.equal(Object.isFrozen(ADAPTER_DIAGNOSTIC_CODES), true);
  assert.deepEqual([...ADAPTER_DIAGNOSTIC_CODES].sort(), [
    'adapter-auth-failed', 'adapter-binary-missing', 'adapter-permission-failed',
    'adapter-protocol-invalid', 'adapter-timeout', 'adapter-unknown-failed', 'none',
  ]);
  assert.equal(adapterDiagnostic('adapter-timeout'), 'adapter-timeout');
  assert.equal(adapterDiagnostic('RAW_DIAGNOSTIC_PRIVATE'), 'adapter-unknown-failed');
});

for (const name of VENDORS) {
  test(`${name} adapter implements full VendorAdapter contract`, () => {
    const a = getAdapter(name);
    assert.equal(typeof a.name, 'string', `${name}: name`);
    assert.equal(a.name, name, `${name}: name matches registry key`);
    assert.equal(typeof a.command, 'string', `${name}: command`);
    assert.equal(typeof a.args, 'function', `${name}: args is function`);
    assert.equal(typeof a.envPreflight, 'function', `${name}: envPreflight is function`);
    assert.equal(typeof a.timeoutMs, 'function', `${name}: timeoutMs is function`);
    assert.equal(typeof a.parseResult, 'function', `${name}: parseResult is function`);
  });

  test(`${name} adapter args() returns string array`, () => {
    const a = getAdapter(name);
    const argv = a.args('test prompt', {});
    assert.ok(Array.isArray(argv), `${name}: args() must return array`);
    for (const arg of argv) {
      assert.equal(typeof arg, 'string', `${name}: every arg must be string; got ${typeof arg}`);
    }
  });

  test(`${name} adapter timeoutMs() returns positive number`, () => {
    const a = getAdapter(name);
    const t = a.timeoutMs({});
    assert.equal(typeof t, 'number');
    assert.ok(t > 0, `${name}: timeoutMs must be > 0; got ${t}`);
    assert.ok(t < 1_800_000, `${name}: timeoutMs must be < 30 min sanity; got ${t}`);
  });

  test(`${name} adapter envPreflight() returns {ok, missing}`, () => {
    const a = getAdapter(name);
    const result = a.envPreflight();
    assert.equal(typeof result.ok, 'boolean', `${name}: preflight.ok must be boolean`);
    assert.ok(Array.isArray(result.missing), `${name}: preflight.missing must be array`);
  });

  test(`${name} adapter parseResult() handles timeout case`, () => {
    const a = getAdapter(name);
    const result = a.parseResult({
      exitCode: -1,
      stdout: '',
      stderr: '',
      timedOut: true,
      durationMs: 30000,
    });
    assert.equal(result.status, 'timeout', `${name}: timeout case must map to status='timeout'`);
    if (['kimi', 'opencode', 'claude', 'grok'].includes(name)) {
      assert.equal(result.diagnosticCode, 'adapter-timeout', `${name}: timeout must carry a closed diagnostic`);
      assert.equal(result.error, 'adapter-timeout', `${name}: timeout error is the closed diagnostic`);
    }
  });

  test(`${name} adapter parseResult() handles command-not-found (exit 127)`, () => {
    const a = getAdapter(name);
    const result = a.parseResult({
      exitCode: 127,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 50,
    });
    assert.equal(result.status, 'permission-fail', `${name}: 127 must map to permission-fail`);
    if (['kimi', 'opencode', 'claude', 'grok'].includes(name)) {
      assert.equal(result.diagnosticCode, 'adapter-binary-missing', `${name}: missing binary must carry a closed diagnostic`);
      assert.equal(result.error, 'adapter-binary-missing', `${name}: binary error is the closed diagnostic`);
    } else {
      assert.ok(/not found|install/i.test(result.error || ''), `${name}: error must mention install`);
    }
  });

  test(`${name} adapter parseResult() handles success (exit 0 + stdout)`, () => {
    const a = getAdapter(name);
    const stdout = name === 'opencode'
      ? [
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'HELLO_RESPONSE' } }),
        JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } }),
      ].join('\n')
      : name === 'grok'
        ? JSON.stringify({ text: 'HELLO_RESPONSE', stopReason: 'EndTurn' })
      : 'HELLO_RESPONSE';
    const result = a.parseResult({
      exitCode: 0,
      stdout,
      stderr: '',
      timedOut: false,
      durationMs: 200,
    });
    assert.equal(result.status, 'success', `${name}: 0+stdout must map to success`);
    if (name !== 'opencode') assert.match(result.text, /HELLO_RESPONSE/);
  });
}

test('codex adapter args() builds expected invocation', () => {
  const a = getAdapter('codex');
  const argv = a.args('test prompt', { reasoning: 'high' });
  assert.ok(argv.includes('exec'));
  // danger-full-access default bypasses the sandbox (Windows 1326 fix) instead of
  // `-s danger-full-access`, and disables codex's global orchestration.
  assert.ok(argv.includes('--dangerously-bypass-approvals-and-sandbox'), 'danger-full-access bypasses the sandbox');
  assert.ok(!argv.includes('-s'), 'no -s when the sandbox is bypassed');
  assert.ok(argv.includes('--disable') && argv.includes('multi_agent'), 'disables multi-agent sub-spawns');
  assert.ok(argv.includes('-c'));
  assert.ok(argv.some((x) => x.includes('model_reasoning_effort="high"')));
  assert.ok(argv.includes('test prompt'));

  // codex has no read-only scenario: its -s sandbox is broken on Windows (1326), so read-only
  // also bypasses (full-access). The read-only INTENT rides in the prompt frame, not the OS sandbox.
  const ro = a.args('test prompt', { sandbox: 'read-only' });
  assert.ok(!ro.includes('-s'), 'codex emits no -s (always bypasses)');
  assert.ok(ro.includes('--dangerously-bypass-approvals-and-sandbox'), 'codex read-only also bypasses');
});

test('kimi adapter args() uses Kimi Code 0.x headless form (no removed legacy flags)', () => {
  const a = getAdapter('kimi');
  const argv = a.args('test', {});
  assert.ok(argv.includes('-p'));
  assert.ok(argv.includes('test'));
  // Kimi Code 0.x removed these (Commander allowUnknownOption(false) → would error out)
  assert.ok(!argv.includes('--afk'), '--afk removed in 0.x');
  assert.ok(!argv.includes('--print'), '--print removed in 0.x');
  assert.ok(!argv.includes('--final-message-only'), '--final-message-only removed in 0.x');
  assert.ok(!argv.includes('--thinking') && !argv.includes('--no-thinking'), 'reasoning is config-driven in 0.x, not argv');
  assert.ok(!argv.includes('--yolo') && !argv.includes('--auto') && !argv.includes('--plan'),
    'Kimi 0.14 rejects prompt mode combined with permission/plan flags');
  // -m only when model given; --session only when conversationId given
  assert.ok(!argv.includes('-m'), 'no -m without opts.model');
  const withModel = a.args('test', { model: 'kimi-code/kimi-for-coding' });
  assert.ok(withModel.includes('-m') && withModel.includes('kimi-code/kimi-for-coding'));
  const withSession = a.args('test', { conversationId: 'sess-1' });
  assert.ok(withSession.includes('--session') && withSession.includes('sess-1'));
  const danger = a.args('test', { sandbox: 'danger-full-access' });
  const readOnly = a.args('test', { sandbox: 'read-only' });
  assert.deepEqual(danger, argv, 'sandbox opts are not argv-enforceable for kimi -p');
  assert.deepEqual(readOnly, argv, 'read-only cannot be enforced by a kimi -p argv flag');
});

test('opencode adapter args() uses run subcommand', () => {
  const a = getAdapter('opencode');
  const argv = a.args('test', {});
  assert.equal(argv[0], 'run');
  // --print-logs removed (ISSUE-opencode-ansi-log-output-not-parsed): stdout
  // must stay a clean NDJSON event stream for the JSON event parser.
  assert.ok(!argv.includes('--print-logs'));
  assert.ok(argv.includes('--format'));
  assert.ok(argv.includes('json'));
  assert.ok(argv.includes('--pure'));
  assert.ok(argv.includes('--dangerously-skip-permissions'), 'default sandbox is danger-full-access');

  const ro = a.args('test', { sandbox: 'read-only' });
  assert.ok(!ro.includes('--dangerously-skip-permissions'), 'read-only tasks must not skip permissions');
});

test('opencode adapter parseResult() reconstructs assistant text from json event stream', () => {
  const a = getAdapter('opencode');
  const result = a.parseResult({
    exitCode: 0,
    stdout: [
      JSON.stringify({ type: 'session.started', session: 's-1' }),
      JSON.stringify({ type: 'message.part.delta', delta: 'HELLO_' }),
      JSON.stringify({ type: 'message.part.delta', delta: 'WORLD' }),
      JSON.stringify({ type: 'message.completed' }),
      JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } }),
    ].join('\n'),
    stderr: '',
    timedOut: false,
    durationMs: 200,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.text, 'HELLO_WORLD');
});

test('opencode adapter parseResult() reconstructs text from opencode 1.17+ {type:"text", part:{text}} events', () => {
  // Regression: opencode 1.17.7 changed its --format json schema to emit
  // `{type:"text", part:{text:"..."}}` (the mimo-fork shape), which the old
  // kind allow-list rejected → the parser dumped raw JSON as the "result" and a
  // dispatch looked failed. Captured from a real `opencode run --format json`.
  const a = getAdapter('opencode');
  const result = a.parseResult({
    exitCode: 0,
    stdout: [
      JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'OK_' } }),
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'DONE' } }),
      JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop', tokens: { total: 19834 } } }),
    ].join('\n'),
    stderr: '', timedOut: false, durationMs: 200,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.text, 'OK_DONE', 'must extract clean assistant text');
  assert.ok(!result.text.includes('step_start'), 'must NOT fall back to dumping raw JSON');
});

test('OpenCode evidence is event-stream text with an exact terminal marker only when completed', () => {
  const a = getAdapter('opencode');
  const cases = [
    ['opencode-step-finish', { type: 'step_finish', part: { reason: 'stop' } }],
    ['opencode-message-completed', { type: 'message.completed' }],
    ['opencode-result-success', { type: 'result', status: 'success', is_error: false }],
  ];
  for (const [marker, terminal] of cases) {
    const result = a.parseResult({
      exitCode: 0, timedOut: false, durationMs: 1, stderr: '', stdout: [
        JSON.stringify({ type: 'text', part: { text: `SAFE_${marker}` } }), JSON.stringify(terminal),
      ].join('\n'),
    });
    assert.equal(result.status, 'success');
    assert.deepEqual(result.outputEvidence, {
      completeness: 'verified-complete', source: 'event-stream', terminalMarker: marker,
    });
  }
  const partial = a.parseResult({
    exitCode: 1, timedOut: false, durationMs: 1, stderr: 'permission denied', stdout: [
      JSON.stringify({ type: 'text', part: { text: 'SAFE_PARTIAL' } }),
      JSON.stringify({ type: 'tool-calls', tool: 'read' }),
    ].join('\n'),
  });
  assert.equal(partial.status, 'unknown-fail');
  assert.equal(partial.text, 'SAFE_PARTIAL');
  assert.deepEqual(partial.outputEvidence, {
    completeness: 'unknown-completeness', source: 'event-stream', terminalMarker: 'none',
  });
});

test('Claude preserves only selected .result text from a failed structured envelope', () => {
  const a = getAdapter('claude');
  const partial = a.parseResult({
    exitCode: 1, timedOut: false, durationMs: 1, stderr: 'permission denied', stdout: JSON.stringify({
      type: 'result', subtype: 'error_max_turns', is_error: true, result: 'SAFE_CLAUDE_PARTIAL',
    }),
  });
  assert.equal(partial.status, 'unknown-fail');
  assert.equal(partial.text, 'SAFE_CLAUDE_PARTIAL');
  assert.deepEqual(partial.outputEvidence, {
    completeness: 'unknown-completeness', source: 'structured-envelope', terminalMarker: 'none',
  });

  const fallback = a.parseResult({
    exitCode: 1, timedOut: false, durationMs: 1, stderr: '', stdout: JSON.stringify({ text: 'RAW_TEXT_FALLBACK' }),
  });
  assert.equal(fallback.text, '');
  assert.equal(fallback.outputEvidence, undefined);
});

test('Claude successful result carries its only verified-complete marker', () => {
  const result = getAdapter('claude').parseResult({
    exitCode: 0, timedOut: false, durationMs: 1, stderr: '', stdout: JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: 'SAFE_FINAL',
    }),
  });
  assert.deepEqual(result.outputEvidence, {
    completeness: 'verified-complete', source: 'structured-envelope', terminalMarker: 'claude-result-success',
  });
});

test('Kimi, OpenCode, and Claude failure parsers return only closed diagnostics', () => {
  const raw = {
    stdout: 'RAW_STDOUT_PRIVATE C:\\PRIVATE\\vendor.log sk-private-vendor-token',
    stderr: 'RAW_STDERR_PRIVATE PRIVATE_PROVIDER https://private.example.invalid',
    timedOut: false,
    durationMs: 42,
  };
  const cases = [
    ['kimi', { ...raw, exitCode: 1 }, 'unknown-fail', 'adapter-unknown-failed'],
    ['kimi', { ...raw, exitCode: 0, stdout: `Error code: 402 {'error': {'message': "RAW_STDOUT_PRIVATE"}}` }, 'auth-fail', 'adapter-auth-failed'],
    ['opencode', { ...raw, exitCode: 1 }, 'unknown-fail', 'adapter-unknown-failed'],
    ['opencode', { ...raw, exitCode: 0 }, 'unknown-fail', 'adapter-protocol-invalid'],
    ['claude', { ...raw, exitCode: 1 }, 'unknown-fail', 'adapter-unknown-failed'],
    ['claude', { ...raw, exitCode: 0, stdout: JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }) }, 'unknown-fail', 'adapter-protocol-invalid'],
  ];
  for (const [vendor, fixture, status, diagnosticCode] of cases) {
    const result = getAdapter(vendor).parseResult(fixture);
    assert.equal(result.status, status, vendor);
    assert.equal(result.diagnosticCode, diagnosticCode, vendor);
    assert.equal(result.error, diagnosticCode, vendor);
    assert.equal(result.text, '', `${vendor} raw/private failure text must not become parser evidence`);
    assert.equal(result.outputEvidence, undefined, `${vendor} raw/private failure must not declare evidence`);
    assert.equal(JSON.stringify(result).includes('RAW_'), false, vendor);
    assert.equal(JSON.stringify(result).includes('PRIVATE_PROVIDER'), false, vendor);
  }
});

test('OpenCode remains fail-closed without both completion and reconstructed text', () => {
  const a = getAdapter('opencode');
  const noCompletion = a.parseResult({
    exitCode: 0,
    stdout: JSON.stringify({ type: 'text', part: { type: 'text', text: 'SAFE_TEXT' } }),
    stderr: 'RAW_STDERR_PRIVATE', timedOut: false, durationMs: 42,
  });
  const noText = a.parseResult({
    exitCode: 0,
    stdout: JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } }),
    stderr: 'RAW_STDERR_PRIVATE', timedOut: false, durationMs: 42,
  });
  assert.equal(noCompletion.status, 'unknown-fail');
  assert.equal(noCompletion.diagnosticCode, 'adapter-protocol-invalid');
  assert.equal(noCompletion.error, 'adapter-protocol-invalid');
  assert.equal(noCompletion.text, 'SAFE_TEXT');
  assert.deepEqual(noCompletion.outputEvidence, {
    completeness: 'unknown-completeness', source: 'event-stream', terminalMarker: 'none',
  });
  assert.equal(noText.status, 'unknown-fail');
  assert.equal(noText.diagnosticCode, 'adapter-protocol-invalid');
  assert.equal(noText.error, 'adapter-protocol-invalid');
  assert.equal(noText.text, '');
  assert.equal(noText.outputEvidence, undefined);
});

test('Claude fable stays a dynamic, non-gating alias even when runtime identity is different', () => {
  const a = getAdapter('claude');
  const argv = a.args('test prompt', { model: 'fable' });
  assert.ok(argv.includes('--model'));
  assert.equal(argv[argv.indexOf('--model') + 1], 'fable');
  const result = a.parseResult({
    exitCode: 0,
    stdout: JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: 'SAFE_RESULT',
      usage: { modelUsage: { 'claude-actual-backend': {} } },
    }),
    stderr: 'RAW_STDERR_PRIVATE', timedOut: false, durationMs: 42,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.text, 'SAFE_RESULT');
  assert.notEqual(result.diagnosticCode, 'adapter-protocol-invalid');
});

test('mimo adapter args() maps sandbox and reasoning to MiMoCode run flags', () => {
  const a = getAdapter('mimo');
  const argv = a.args('test', { cwd: '/tmp/project', model: 'xiaomi/mimo-v2.5-pro', reasoning: 'xhigh' });
  assert.equal(argv[0], 'run');
  assert.ok(argv.includes('test'));
  assert.ok(argv.includes('--dir') && argv.includes('/tmp/project'));
  assert.ok(argv.includes('--model') && argv.includes('xiaomi/mimo-v2.5-pro'));
  assert.ok(argv.includes('--agent'));
  assert.equal(argv[argv.indexOf('--agent') + 1], 'build');
  assert.ok(argv.includes('--format') && argv.includes('json'));
  assert.ok(argv.includes('--pure'));
  assert.ok(argv.includes('--print-logs'));
  assert.ok(argv.includes('--variant'));
  assert.equal(argv[argv.indexOf('--variant') + 1], 'max', 'xhigh maps to MiMo variant max');
  assert.ok(argv.includes('--dangerously-skip-permissions'), 'default sandbox is danger-full-access');

  const ro = a.args('test', { sandbox: 'read-only', reasoning: 'high' });
  assert.equal(ro[ro.indexOf('--agent') + 1], 'plan');
  assert.ok(ro.includes('--variant') && ro.includes('high'));
  assert.ok(!ro.includes('--dangerously-skip-permissions'), 'read-only tasks must not auto-approve tool calls');
});

test('mimo adapter parseResult() reconstructs text and token usage from json events', () => {
  const a = getAdapter('mimo');
  const result = a.parseResult({
    exitCode: 0,
    stdout: [
      JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'HELLO_' } }),
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'MIMO' } }),
      JSON.stringify({ type: 'step_finish', part: { tokens: { total: 1234 } } }),
    ].join('\n'),
    stderr: '',
    timedOut: false,
    durationMs: 200,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.text, 'HELLO_MIMO');
  assert.deepEqual(result.usage, { totalTokens: 1234 });
});

// mimo background-exit hang: an idle reap AFTER the answer completed must be success, not timeout.
const MIMO_COMPLETED_LOG = [
  'INFO  2026-06-25T10:24:04 service=server method=GET path=/session/status request',
  JSON.stringify({ type: 'text', part: { type: 'text', text: 'ANSWER_' } }),
  JSON.stringify({ type: 'text', part: { type: 'text', text: 'OK' } }),
  JSON.stringify({ type: 'step_finish', part: { reason: 'stop', tokens: { total: 99 } } }),
  'INFO  2026-06-25T10:24:05 service=server method=GET path=/session/status request',
  'INFO  2026-06-25T10:24:06 service=server method=GET path=/session/status request',
].join('\n');

test('mimo parseResult: idle reap after completion (step_finish + text) is success, not timeout', () => {
  const a = getAdapter('mimo');
  const r = a.parseResult({
    exitCode: -1, stdout: MIMO_COMPLETED_LOG, stderr: MIMO_COMPLETED_LOG, logFileContent: MIMO_COMPLETED_LOG,
    timedOut: true, timeoutReason: 'idle', durationMs: 200000,
  });
  assert.equal(r.status, 'success');
  assert.equal(r.text, 'ANSWER_OK');
  assert.deepEqual(r.usage, { totalTokens: 99 });
});

test('mimo parseResult: a ceiling timeout stays a timeout even with a completed answer present', () => {
  const a = getAdapter('mimo');
  const r = a.parseResult({
    exitCode: -1, stdout: MIMO_COMPLETED_LOG, stderr: MIMO_COMPLETED_LOG, logFileContent: MIMO_COMPLETED_LOG,
    timedOut: true, timeoutReason: 'ceiling', durationMs: 1800000,
  });
  assert.equal(r.status, 'timeout');
});

test('mimo parseResult: idle reap with NO completed answer (no step_finish) stays a timeout', () => {
  const a = getAdapter('mimo');
  const log = [
    JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
    JSON.stringify({ type: 'text', part: { type: 'text', text: 'thinking...' } }),
    'INFO  service=server method=GET path=/session/status request',
  ].join('\n');
  const r = a.parseResult({
    exitCode: -1, stdout: log, stderr: log, logFileContent: log,
    timedOut: true, timeoutReason: 'idle', durationMs: 200000,
  });
  assert.equal(r.status, 'timeout');
});

test('mimo parseResult: idle reap after only a TOOL-CALLS step_finish (mid-task) stays a timeout, not a partial-answer success', () => {
  // codex review MAJOR: a 'tool-calls' step_finish is a mid-turn tool boundary, NOT a finished
  // answer. An idle reap here must NOT be classified success with the partial text so far.
  const a = getAdapter('mimo');
  const log = [
    JSON.stringify({ type: 'text', part: { type: 'text', text: 'partial...' } }),
    JSON.stringify({ type: 'step_finish', part: { reason: 'tool-calls', tokens: { total: 7 } } }),
    'INFO  service=server method=GET path=/session/status request',
    'INFO  service=server method=GET path=/session/status request',
  ].join('\n');
  const r = a.parseResult({
    exitCode: -1, stdout: log, stderr: log, logFileContent: log,
    timedOut: true, timeoutReason: 'idle', durationMs: 200000,
  });
  assert.equal(r.status, 'timeout');
});

test('mimoAnswerCompleted: true only on a terminal step_finish (reason!=tool-calls)', () => {
  const tool = JSON.stringify({ type: 'step_finish', part: { reason: 'tool-calls' } });
  const stop = JSON.stringify({ type: 'step_finish', part: { reason: 'stop' } });
  assert.equal(mimoAnswerCompleted(`${tool}\n`), false, 'only a tool-calls step is not completion');
  assert.equal(mimoAnswerCompleted(`${tool}\n${stop}\n`), true, 'a stop step is completion');
  assert.equal(mimoAnswerCompleted(''), false);
  assert.equal(mimoAnswerCompleted('INFO path=/session/status request'), false);
});

test('mimo declares an idleHeartbeatRe matching the /session/status poll but NOT json events', () => {
  const a = getAdapter('mimo');
  assert.ok(a.idleHeartbeatRe instanceof RegExp, 'mimo must declare idleHeartbeatRe');
  assert.ok(a.idleHeartbeatRe.test('INFO 2026 service=server method=GET path=/session/status request'));
  assert.ok(!a.idleHeartbeatRe.test('{"type":"step_finish","part":{}}'));
});

// ISSUE-grok-claude-buffered-output-idle-falsekill: grok/claude `--output-format
// json` write stdout ONCE at completion, so hopper-runner's log-growth idle poll
// must never be armed for them (mirrors the idleHeartbeatRe hook above — a
// different adapter-declared hint consumed by the same runner idle-detector).
test('grok and claude declare bufferedOutput:true (end-buffered --output-format json)', () => {
  assert.equal(getAdapter('grok').bufferedOutput, true, 'grok must declare bufferedOutput');
  assert.equal(getAdapter('claude').bufferedOutput, true, 'claude must declare bufferedOutput');
});

test('other adapters do NOT declare bufferedOutput (streaming/incremental vendors keep the idle poll armed)', () => {
  for (const name of ['codex', 'kimi', 'opencode', 'copilot', 'agy', 'mimo']) {
    assert.notEqual(getAdapter(name).bufferedOutput, true, `${name} must NOT declare bufferedOutput`);
  }
});

test('copilot adapter soft-warns (mentioning GH_TOKEN) only when NO auth source is detectable', () => {
  // copilot can auth via an env token, the gh CLI cache, OR its own ~/.copilot login
  // profile. With NONE of those present it SOFT-WARNS (ok:true + a note naming the
  // sources) — it must never hard-fail. Point homedir() at an empty temp dir so the
  // gh/profile file checks deterministically miss regardless of the test host.
  const saved = {
    GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    COPILOT_GITHUB_TOKEN: process.env.COPILOT_GITHUB_TOKEN,
    HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
  };
  const emptyHome = mkdtempSync(join(tmpdir(), 'hopper-emptyhome-'));
  try {
    delete process.env.GH_TOKEN; delete process.env.GITHUB_TOKEN; delete process.env.COPILOT_GITHUB_TOKEN;
    process.env.HOME = emptyHome; process.env.USERPROFILE = emptyHome;
    const result = getAdapter('copilot').envPreflight();
    assert.equal(result.ok, true, 'soft-warn: ok=true even with no detectable auth (never a hard fail)');
    assert.ok(result.missing.some((m) => /GH_TOKEN/i.test(m)), 'note must mention GH_TOKEN so the user can fix it');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(emptyHome, { recursive: true, force: true });
  }
});

test('copilot adapter maps sandbox to allow-all permission flags', () => {
  const a = getAdapter('copilot');
  const argv = a.args('test', {});
  assert.ok(argv.includes('--allow-all-tools'));
  assert.ok(argv.includes('--allow-all-paths'));
  const ro = a.args('test', { sandbox: 'read-only' });
  assert.ok(!ro.includes('--allow-all-tools'));
  assert.ok(!ro.includes('--allow-all-paths'));
});

test('agy adapter has prepareLog() method (codex F2 silent-fail detection)', () => {
  const a = getAdapter('agy');
  assert.equal(typeof a.prepareLog, 'function', 'agy must have prepareLog');
  const hint = a.prepareLog('T-test', 'agy');
  assert.equal(typeof hint.logPath, 'string');
  assert.match(hint.logPath, /agy/);
});

test('agy adapter args() includes --dangerously-skip-permissions for headless', () => {
  const a = getAdapter('agy');
  const argv = a.args('test', {});
  assert.ok(argv.includes('--dangerously-skip-permissions'));
  const ro = a.args('test', { sandbox: 'read-only' });
  assert.ok(!ro.includes('--dangerously-skip-permissions'), 'read-only tasks must not skip permissions');
});

test('grok adapter args() builds headless json invocation with explicit default model', () => {
  const a = getAdapter('grok');
  // Use background:true so headless detection is deterministic regardless of TTY.
  const argv = a.args('test prompt', { background: true });
  assert.ok(argv.includes('-p'));
  assert.ok(argv.includes('test prompt'));
  assert.ok(argv.includes('--output-format'));
  assert.ok(argv.includes('json'));
  assert.ok(argv.includes('--no-auto-update'));
  // Always passes explicit -m (avoids retired-slug grok-4.3 billing redirect)
  assert.ok(argv.includes('-m'));
  // ISSUE-grok-model-line-rotation-stale-knownGood.md: grok-build retired
  // ("unknown model id"); default moved to grok-4.5 (V-verified 2026-07-18).
  assert.ok(argv.includes('grok-4.5'), 'default model must be grok-4.5');
  // Headless dispatch needs an explicit permission mode (and --always-approve for
  // full-access) or grok stalls with stopReason:"Cancelled" (vendor-preset
  // feedback 2026-06-15).
  assert.ok(argv.includes('--permission-mode'), '--permission-mode required for headless');
  assert.ok(argv.includes('bypassPermissions'));
  assert.ok(argv.includes('--always-approve'), 'default sandbox is danger-full-access → auto-approve');
  // read-only sandbox: still gets a permission mode, but NOT --always-approve.
  const ro = a.args('test', { sandbox: 'read-only', background: true });
  assert.ok(!ro.includes('--always-approve'), 'read-only tasks must not auto-approve tool calls');
  assert.ok(ro.includes('--permission-mode'), 'read-only headless still needs a permission mode (avoids the Cancelled stall)');
  // honors explicit --model override
  const custom = a.args('test', { model: 'grok-4.3', background: true });
  assert.ok(custom.includes('grok-4.3') && !custom.includes('grok-build'));
});

test('grok adapter parseResult() detects auth-fail from unauthorized signal', () => {
  const a = getAdapter('grok');
  const result = a.parseResult({
    exitCode: 1,
    stdout: '',
    stderr: 'Error: unauthorized (401) — set XAI_API_KEY',
    timedOut: false,
    durationMs: 120,
  });
  assert.equal(result.status, 'auth-fail');
  assert.equal(result.error, 'adapter-auth-failed');
});

test('grok adapter parseResult() extracts text from --output-format json object', () => {
  const a = getAdapter('grok');
  const result = a.parseResult({
    exitCode: 0,
    stdout: JSON.stringify({ text: 'GROK_ANSWER', usage: { total_tokens: 42 } }),
    stderr: '',
    timedOut: false,
    durationMs: 200,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.text, 'GROK_ANSWER');
  assert.deepEqual(result.usage, { total_tokens: 42 });
});

test('Grok emits vendor-result-field evidence only from a selected JSON object', () => {
  const a = getAdapter('grok');
  const verified = a.parseResult({
    exitCode: 0, timedOut: false, durationMs: 1, stderr: '',
    stdout: JSON.stringify({ text: 'SAFE_FINAL', stopReason: 'EndTurn' }),
  });
  assert.equal(verified.status, 'success');
  assert.deepEqual(verified.outputEvidence, {
    completeness: 'verified-complete', source: 'vendor-result-field', terminalMarker: 'grok-end-turn',
  });

  const partial = a.parseResult({
    exitCode: 1, timedOut: false, durationMs: 1, stderr: 'transport channel closed',
    stdout: JSON.stringify({ text: 'SAFE_PARTIAL', stopReason: 'Cancelled' }),
  });
  assert.equal(partial.status, 'unknown-fail');
  assert.equal(partial.text, 'SAFE_PARTIAL');
  assert.deepEqual(partial.outputEvidence, {
    completeness: 'unknown-completeness', source: 'vendor-result-field', terminalMarker: 'none',
  });
});

test('Grok never promotes timeout or nonzero raw stdout and does not return raw diagnostics', () => {
  const a = getAdapter('grok');
  for (const raw of [
    { exitCode: -1, timedOut: true, stdout: 'RAW_TIMEOUT_PRIVATE', stderr: '' },
    { exitCode: 1, timedOut: false, stdout: 'RAW_NONZERO_PRIVATE', stderr: 'worker quit with fatal' },
  ]) {
    const result = a.parseResult({ ...raw, durationMs: 1 });
    assert.equal(result.text, '');
    assert.equal(result.outputEvidence, undefined);
    assert.equal(result.status, raw.timedOut ? 'timeout' : 'unknown-fail');
    assert.doesNotMatch(result.error || '', /RAW_|worker quit/i);
  }
});

test('Grok reserves auth-fail for independently specific evidence', () => {
  const a = getAdapter('grok');
  assert.equal(a.parseResult({ exitCode: 1, timedOut: false, durationMs: 1, stdout: '', stderr: 'transport channel closed' }).status, 'unknown-fail');
  assert.equal(a.parseResult({ exitCode: 1, timedOut: false, durationMs: 1, stdout: '', stderr: 'HTTP 401 Unauthorized' }).status, 'auth-fail');
  assert.equal(a.parseResult({ exitCode: 1, timedOut: false, durationMs: 1, stdout: '', stderr: 'worker quit with fatal; AuthorizationRequired' }).status, 'auth-fail');
});

test('grok adapter envPreflight() never checks GROK_API_KEY (third-party collision)', () => {
  const savedXai = process.env.XAI_API_KEY;
  const savedGrok = process.env.GROK_API_KEY;
  const savedHome = process.env.HOME;
  const savedUserProfile = process.env.USERPROFILE;
  const savedHomeDrive = process.env.HOMEDRIVE;
  const savedHomePath = process.env.HOMEPATH;
  const fakeHome = mkdtempSync(join(tmpdir(), 'hopper-grok-home-'));
  delete process.env.XAI_API_KEY;
  process.env.GROK_API_KEY = 'should-be-ignored';
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  delete process.env.HOMEDRIVE;
  delete process.env.HOMEPATH;
  try {
    const a = getAdapter('grok');
    const result = a.envPreflight();
    assert.equal(result.ok, true, 'soft-warn ok=true');
    // GROK_API_KEY set but XAI_API_KEY absent → must still warn (does not treat GROK_API_KEY as auth)
    assert.ok(result.missing.some((m) => /XAI_API_KEY/.test(m)),
      'must guide user to XAI_API_KEY, not accept GROK_API_KEY');
  } finally {
    if (savedXai !== undefined) process.env.XAI_API_KEY = savedXai;
    if (savedGrok !== undefined) process.env.GROK_API_KEY = savedGrok; else delete process.env.GROK_API_KEY;
    if (savedHome !== undefined) process.env.HOME = savedHome; else delete process.env.HOME;
    if (savedUserProfile !== undefined) process.env.USERPROFILE = savedUserProfile; else delete process.env.USERPROFILE;
    if (savedHomeDrive !== undefined) process.env.HOMEDRIVE = savedHomeDrive; else delete process.env.HOMEDRIVE;
    if (savedHomePath !== undefined) process.env.HOMEPATH = savedHomePath; else delete process.env.HOMEPATH;
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('claude adapter args() builds headless json invocation, default skips permissions', () => {
  const a = getAdapter('claude');
  const argv = a.args('test prompt', {});
  assert.ok(argv.includes('-p'));
  assert.ok(argv.includes('test prompt'));
  assert.ok(argv.includes('--output-format'));
  assert.ok(argv.includes('json'));
  // Default sandbox is danger-full-access → headless full-access path.
  assert.ok(argv.includes('--dangerously-skip-permissions'));
  assert.ok(!argv.includes('--permission-mode'), 'danger-full-access uses the skip flag, not --permission-mode');
  // No --model unless asked (account default, like codex).
  assert.ok(!argv.includes('--model'), 'no --model without opts.model');
  const withModel = a.args('test', { model: 'opus' });
  assert.ok(withModel.includes('--model') && withModel.includes('opus'));
  // cwd → --add-dir; conversationId → --resume
  const withCwd = a.args('test', { cwd: '/tmp/project' });
  assert.ok(withCwd.includes('--add-dir') && withCwd.includes('/tmp/project'));
  const withSession = a.args('test', { conversationId: 'sess-1' });
  assert.ok(withSession.includes('--resume') && withSession.includes('sess-1'));
});

test('claude adapter args() maps non-danger sandboxes to native permission modes', () => {
  const a = getAdapter('claude');
  const ro = a.args('test', { sandbox: 'read-only' });
  assert.ok(!ro.includes('--dangerously-skip-permissions'), 'read-only must not skip permissions');
  assert.equal(ro[ro.indexOf('--permission-mode') + 1], 'dontAsk', 'read-only → dontAsk (locked-down, no prompt-hang)');
  const ww = a.args('test', { sandbox: 'workspace-write' });
  assert.equal(ww[ww.indexOf('--permission-mode') + 1], 'acceptEdits', 'workspace-write → acceptEdits');
});

test('claude adapter HOPPER_CLAUDE_PERMISSION_MODE overrides the mode for non-danger sandboxes', () => {
  const saved = process.env.HOPPER_CLAUDE_PERMISSION_MODE;
  process.env.HOPPER_CLAUDE_PERMISSION_MODE = 'plan';
  try {
    const a = getAdapter('claude');
    const argv = a.args('test', { sandbox: 'read-only' });
    assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'plan');
  } finally {
    if (saved === undefined) delete process.env.HOPPER_CLAUDE_PERMISSION_MODE;
    else process.env.HOPPER_CLAUDE_PERMISSION_MODE = saved;
  }
});

test('claude adapter HOPPER_CLAUDE_BARE=1 prepends --bare for CI isolation', () => {
  const saved = process.env.HOPPER_CLAUDE_BARE;
  process.env.HOPPER_CLAUDE_BARE = '1';
  try {
    const a = getAdapter('claude');
    const argv = a.args('test', {});
    assert.equal(argv[0], '--bare', '--bare must lead so it applies as a global flag');
  } finally {
    if (saved === undefined) delete process.env.HOPPER_CLAUDE_BARE;
    else process.env.HOPPER_CLAUDE_BARE = saved;
  }
});

test('claude adapter parseResult() extracts .result from --output-format json object', () => {
  const a = getAdapter('claude');
  const result = a.parseResult({
    exitCode: 0,
    stdout: JSON.stringify({
      type: 'result', subtype: 'success', is_error: false,
      result: 'CLAUDE_ANSWER', session_id: 's-1', total_cost_usd: 0.012,
    }),
    stderr: '',
    timedOut: false,
    durationMs: 200,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.text, 'CLAUDE_ANSWER');
  assert.equal(result.usage.totalCostUsd, 0.012);
});

test('claude adapter parseResult() fails fast on is_error / empty result (no silent success)', () => {
  const a = getAdapter('claude');
  const errResult = a.parseResult({
    exitCode: 0,
    stdout: JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: '' }),
    stderr: '',
    timedOut: false,
    durationMs: 100,
  });
  assert.equal(errResult.status, 'unknown-fail');
  assert.equal(errResult.diagnosticCode, 'adapter-protocol-invalid');
  assert.equal(errResult.error, 'adapter-protocol-invalid');
});

test('claude adapter parseResult() detects auth-fail and billing/credit block', () => {
  const a = getAdapter('claude');
  const auth = a.parseResult({
    exitCode: 1, stdout: '', stderr: 'authentication_failed: please run /login', timedOut: false, durationMs: 90,
  });
  assert.equal(auth.status, 'auth-fail');
  assert.equal(auth.error, 'adapter-auth-failed');
  const billing = a.parseResult({
    exitCode: 1, stdout: '', stderr: 'billing_error: usage limit reached', timedOut: false, durationMs: 90,
  });
  assert.equal(billing.status, 'auth-fail');
  assert.equal(billing.error, 'adapter-auth-failed');
});

test('getAdapter throws clear error for unknown vendor', () => {
  assert.throws(
    () => getAdapter('not-a-real-vendor'),
    /No vendor adapter registered/,
  );
});
