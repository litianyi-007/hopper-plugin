import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  OUTPUT_COMPLETENESS,
  OUTPUT_SOURCES,
  OUTPUT_TERMINAL_MARKERS,
  noTextOutputEvidence,
  selectTerminalOutput,
  validateOutputEvidence,
} from '../../cli/src/output-evidence.js';

const unknownEventText = {
  completeness: 'unknown-completeness',
  source: 'event-stream',
  terminalMarker: 'none',
};

test('valid evidence accepts only the closed unknown-completeness event-stream record', () => {
  assert.deepEqual(validateOutputEvidence('SAFE', unknownEventText), unknownEventText);
  assert.equal(validateOutputEvidence('SAFE', {
    completeness: 'verified-complete', source: 'event-stream', terminalMarker: 'none',
  }), null);
  assert.equal(validateOutputEvidence('SAFE', {
    completeness: 'unknown-completeness', source: 'raw-stdout', terminalMarker: 'none',
  }), null);
});

test('closed vocabulary reserves source none for a genuinely empty parser result', () => {
  assert.deepEqual(OUTPUT_COMPLETENESS, [
    'verified-complete', 'unknown-completeness', 'no-text',
  ]);
  assert.deepEqual(OUTPUT_SOURCES, [
    'structured-envelope', 'event-stream', 'vendor-result-field', 'none',
  ]);
  assert.deepEqual(OUTPUT_TERMINAL_MARKERS, [
    'opencode-step-finish', 'opencode-message-completed', 'opencode-result-success',
    'claude-result-success', 'grok-end-turn', 'pi-agent-settled', 'none',
  ]);
  assert.equal(validateOutputEvidence('SAFE', {
    completeness: 'unknown-completeness', source: 'none', terminalMarker: 'none',
  }), null);
  assert.deepEqual(validateOutputEvidence('', noTextOutputEvidence()), noTextOutputEvidence());
  assert.equal(validateOutputEvidence('SAFE', noTextOutputEvidence()), null);
  assert.deepEqual(validateOutputEvidence('SAFE', { ...unknownEventText, raw: 'PRIVATE' }), unknownEventText);
});

test('stdin delivery and parser-invalid states outrank otherwise eligible failed text', () => {
  for (const forced of [{ stdinDeliveryError: true }, { parserFailed: true }, { invalidTaskOutput: true }]) {
    assert.deepEqual(selectTerminalOutput({
      adapterStatus: 'unknown-fail',
      parsed: { text: 'SAFE', outputEvidence: unknownEventText },
      ...forced,
    }), {
      text: '', outputEvidence: noTextOutputEvidence(), recoveredOutput: false,
    });
  }
});

test('failed task preserves only valid parser-designated text and success is never recovered', () => {
  assert.deepEqual(selectTerminalOutput({
    adapterStatus: 'permission-fail',
    parsed: { text: 'SAFE', outputEvidence: unknownEventText },
  }), { text: 'SAFE', outputEvidence: unknownEventText, recoveredOutput: true });
  assert.deepEqual(selectTerminalOutput({
    adapterStatus: 'success',
    parsed: { text: 'SAFE', outputEvidence: unknownEventText },
  }), { text: 'SAFE', outputEvidence: unknownEventText, recoveredOutput: false });
});

test('whitespace and control-only parser text resolves to no-text', () => {
  assert.deepEqual(selectTerminalOutput({
    adapterStatus: 'unknown-fail',
    parsed: { text: ' \u0000\u001f\t\n', outputEvidence: unknownEventText },
  }), {
    text: '', outputEvidence: noTextOutputEvidence(), recoveredOutput: false,
  });
});

test('legacy failed output is not recovered while legacy success remains compatible', () => {
  assert.deepEqual(selectTerminalOutput({
    adapterStatus: 'unknown-fail',
    parsed: { text: 'SAFE' },
  }), {
    text: '', outputEvidence: noTextOutputEvidence(), recoveredOutput: false,
  });
  assert.deepEqual(selectTerminalOutput({
    adapterStatus: 'success',
    parsed: { text: 'SAFE' },
  }), {
    text: 'SAFE', outputEvidence: noTextOutputEvidence(), recoveredOutput: false,
  });
});
