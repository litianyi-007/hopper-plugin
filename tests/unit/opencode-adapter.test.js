// OpenCode adapter parseResult: ANSI-stripped NDJSON parsing + conservative
// plain-text recovery (ISSUE-opencode-ansi-log-output-not-parsed).
// Anchor: tests/unit/opencode-adapter.test.js
//
// Observed failure (adhoc-code-review-adversarial-mryr4dsd, 2026-07-24): a
// background run's captured log contained ANSI-colored pretty log lines and
// ZERO NDJSON events; per-line JSON.parse all failed → exit 0 misclassified
// adapter-protocol-invalid. Fixes: (a) `--print-logs` removed from args() so
// stdout stays a clean NDJSON event stream; (b) the parser strips ANSI escape
// sequences before JSON.parse; (c) when zero JSON events parse, readable
// plain text is recovered as unverified text WITHOUT flipping the run to
// success.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { opencodeAdapter } from '../../cli/src/vendors/opencode.js';

const ESC = '\x1B';

// Real NDJSON shape observed from opencode 1.18.4 (`--format json --pure`).
const NDJSON_SUCCESS = [
  '{"type":"step_start","sessionID":"ses_1","part":{"type":"step-start"}}',
  '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"The answer is 42."}}',
  '{"type":"step_finish","sessionID":"ses_1","part":{"type":"step-finish","reason":"stop","tokens":{"total":10}}}',
].join('\n');

// Shape mirrors the real evidence log: banner, ANSI `→ Read` tool traces,
// <thinking> blocks, then the plain-text final answer. No JSON at all.
const ANSI_PRETTY_LOG = [
  `${ESC}[0m`,
  '> build · deepseek-v4-pro',
  `${ESC}[0m`,
  `${ESC}[0m→ ${ESC}[0mRead .hopper`,
  `${ESC}[0m→ ${ESC}[0mRead .hopper/handoffs/task-prompt.md`,
  '<thinking>Let me check the task brief.</thinking>',
  '<thinking>Multi-line',
  'thinking block</thinking>',
  `${ESC}[0m→ ${ESC}[0mRead .hopper/handoffs/evidence.md`,
  'The review found four real defects, including a high-severity OAuth race condition, with a REWORK verdict.',
  '',
].join('\n');

test('args(): --print-logs is REMOVED (log noise off the shared stdout+stderr capture)', () => {
  const argv = opencodeAdapter.args('prompt', { sandbox: 'read-only' });
  assert.ok(!argv.includes('--print-logs'), 'no --print-logs');
  assert.deepEqual(argv.slice(argv.indexOf('--format')), ['--format', 'json', '--pure'], 'json event stream flags intact');
});

test('parseResult: clean NDJSON event stream (no --print-logs normal flow) → success', () => {
  const res = opencodeAdapter.parseResult({ stdout: NDJSON_SUCCESS, stderr: '', exitCode: 0, timedOut: false });
  assert.equal(res.status, 'success');
  assert.equal(res.diagnosticCode, 'none');
  assert.equal(res.text, 'The answer is 42.');
  assert.equal(res.outputEvidence?.terminalMarker, 'opencode-step-finish');
});

test('parseResult: NDJSON lines wrapped in ANSI escapes + CR are parsed after stripping (mixed stdout)', () => {
  const ansiWrapped = NDJSON_SUCCESS.split('\n')
    .map((line) => `${ESC}[0m${line}\r`)
    .join('\n');
  const res = opencodeAdapter.parseResult({ stdout: ansiWrapped, stderr: '', exitCode: 0, timedOut: false });
  assert.equal(res.status, 'success', 'ANSI-wrapped JSON events must still parse');
  assert.equal(res.text, 'The answer is 42.');
});

test('parseResult: ANSI pretty log with NO JSON (the reported bug) → still a failure, but final answer recovered as text', () => {
  const res = opencodeAdapter.parseResult({ stdout: ANSI_PRETTY_LOG, stderr: '', exitCode: 0, timedOut: false });
  assert.notEqual(res.status, 'success', 'unverified plain text must NOT flip the classification to success');
  assert.equal(res.status, 'unknown-fail');
  assert.equal(res.diagnosticCode, 'adapter-protocol-invalid');
  assert.ok(res.text.includes('The review found four real defects'), 'readable final answer recovered from the ANSI log');
  assert.ok(!res.text.includes('→'), 'tool-trace lines excluded from recovered text');
  assert.ok(!/thinking/i.test(res.text), '<thinking> blocks excluded from recovered text');
  assert.ok(!res.text.includes('build ·'), 'banner excluded from recovered text');
  assert.equal(res.outputEvidence?.completeness, 'unknown-completeness');
  assert.equal(res.outputEvidence?.source, 'ansi-stripped-plain-text');
  assert.equal(res.outputEvidence?.terminalMarker, 'none');
});

test('parseResult: pure noise stdout (runner lines + INFO logs only) on exit 0 → protocol-invalid with NO recovered text', () => {
  const stdout = [
    'hopper-runner: idle watchdog disabled (bufferedOutput vendor)',
    'timestamp=2026-07-24T10:13:17Z level=INFO message="creating instance"',
    '> build · deepseek-v4-pro',
    `${ESC}[0m→ ${ESC}[0mRead .hopper`,
  ].join('\n');
  const res = opencodeAdapter.parseResult({ stdout, stderr: '', exitCode: 0, timedOut: false });
  assert.equal(res.status, 'unknown-fail');
  assert.equal(res.diagnosticCode, 'adapter-protocol-invalid');
  assert.ok(!res.text, 'noise-only stdout must not fabricate answer text');
});

test('parseResult: non-zero exit with ANSI error stream stays adapter-unknown-failed', () => {
  const res = opencodeAdapter.parseResult({ stdout: `${ESC}[31mError: provider exploded${ESC}[0m`, stderr: '', exitCode: 1, timedOut: false });
  assert.equal(res.status, 'unknown-fail');
  assert.equal(res.diagnosticCode, 'adapter-unknown-failed');
});

test('parseResult: timeout keeps timeout classification regardless of recovery', () => {
  const res = opencodeAdapter.parseResult({ stdout: ANSI_PRETTY_LOG, stderr: '', exitCode: null, timedOut: true });
  assert.equal(res.status, 'timeout');
  assert.equal(res.diagnosticCode, 'adapter-timeout');
});

test('parseResult: empty stdout → adapter-protocol-invalid, no text', () => {
  const res = opencodeAdapter.parseResult({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
  assert.equal(res.status, 'unknown-fail');
  assert.equal(res.diagnosticCode, 'adapter-protocol-invalid');
  assert.ok(!res.text);
});
