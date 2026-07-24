// Grok adapter parseResult: framed multi-line JSON envelope recovery
// (ISSUE-grok-adapter-protocol-invalid-false-fail).
// Anchor: tests/unit/grok-adapter.test.js
//
// grok `--output-format json` pretty-prints the result envelope across MANY
// lines, and hopper's runner prepends its own log lines to captured stdout
// (e.g. the idle-watchdog notice). The old extractor only tried the WHOLE
// stdout or the single TRAILING line, so a genuinely successful run
// (exit 0, full "text", EndTurn, usage stats) was misclassified as
// unknown-fail / adapter-protocol-invalid.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { grokAdapter } from '../../cli/src/vendors/grok.js';

// Shape mirrors the real REV-GRK-001-output.log evidence (hawk-clawhive,
// 2026-07-24): runner notice line, then a pretty-printed multi-line envelope.
const FRAMED_SUCCESS_STDOUT = [
  'hopper-runner: idle watchdog disabled (bufferedOutput vendor) — ceiling-only timeout applies (1800000ms)',
  '{',
  '  "text": "The task is complete. Findings written to the output file.",',
  '  "stopReason": "EndTurn",',
  '  "sessionId": "sess-123",',
  '  "usage": {',
  '    "input_tokens": 54207,',
  '    "output_tokens": 9178,',
  '    "total_tokens": 610073',
  '  },',
  '  "num_turns": 13,',
  '  "total_cost_usd": 0.3274884,',
  '  "modelUsage": {',
  '    "grok-4.5-build": { "modelCalls": 13, "costUSD": 0.3274884 }',
  '  }',
  '}',
  '',
].join('\n');

test('parseResult: framed multi-line pretty-printed envelope after runner log lines is SUCCESS (the false-fail bug)', () => {
  const res = grokAdapter.parseResult({ stdout: FRAMED_SUCCESS_STDOUT, stderr: '', exitCode: 0, timedOut: false });
  assert.equal(res.status, 'success', 'a real successful grok run must not be adapter-protocol-invalid');
  assert.equal(res.diagnosticCode, 'none');
  assert.ok(res.text.includes('The task is complete'), 'answer text recovered from the framed envelope');
  assert.ok(res.usage && res.usage.total_tokens === 610073, 'usage stats recovered');
  assert.equal(res.outputEvidence?.terminalMarker, 'grok-end-turn', 'EndTurn terminal marker recognized');
});

test('parseResult: single-line trailing JSON after warnings still works (existing behavior)', () => {
  const stdout = 'some warning line\n{"text":"done","stopReason":"EndTurn","usage":{"total_tokens":5}}';
  const res = grokAdapter.parseResult({ stdout, stderr: '', exitCode: 0, timedOut: false });
  assert.equal(res.status, 'success');
  assert.equal(res.text, 'done');
});

test('parseResult: whole-stdout single-line JSON still works (existing behavior)', () => {
  const stdout = '{"text":"done","stopReason":"EndTurn"}';
  const res = grokAdapter.parseResult({ stdout, stderr: '', exitCode: 0, timedOut: false });
  assert.equal(res.status, 'success');
});

test('parseResult: non-JSON stdout on exit 0 stays adapter-protocol-invalid (guard unchanged)', () => {
  const res = grokAdapter.parseResult({ stdout: 'plain human-readable output, no envelope', stderr: '', exitCode: 0, timedOut: false });
  assert.equal(res.status, 'unknown-fail');
  assert.equal(res.diagnosticCode, 'adapter-protocol-invalid');
});

test('parseResult: framed envelope with a cancel stopReason is NOT a success', () => {
  const stdout = 'runner noise\n{\n  "text": "",\n  "stopReason": "Cancelled"\n}';
  const res = grokAdapter.parseResult({ stdout, stderr: '', exitCode: 0, timedOut: false });
  assert.notEqual(res.status, 'success');
});

test('parseResult: framed envelope with error field is NOT a success', () => {
  const stdout = 'runner noise\n{\n  "text": "partial",\n  "error": "boom"\n}';
  const res = grokAdapter.parseResult({ stdout, stderr: '', exitCode: 0, timedOut: false });
  assert.notEqual(res.status, 'success');
});
