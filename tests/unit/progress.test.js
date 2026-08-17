import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendProgressEvent,
  nextProgressSeq,
  progressLogPath,
  readProgressEvents,
  rotateProgressLogIfNeeded,
} from '../../cli/src/progress.js';

function setup() {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-progress-'));
  const hopperDir = join(tmp, '.hopper');
  mkdirSync(join(hopperDir, 'handoffs'), { recursive: true });
  return { tmp, hopperDir };
}

test('progressLogPath maps output.md path to progress.log path', () => {
  const outputMdPath = join('x', '.hopper', 'handoffs', 'T-one-output.md');
  assert.equal(progressLogPath(outputMdPath), join('x', '.hopper', 'handoffs', 'T-one-progress.log'));
});

test('appendProgressEvent writes normalized JSONL and readProgressEvents returns recent events', () => {
  const { tmp, hopperDir } = setup();
  try {
    const first = appendProgressEvent({
      hopperDir,
      taskId: 'T-prog',
      event: {
        vendor: 'codex',
        phase: 'starting',
        kind: 'lifecycle',
        message: 'Task queued.',
        source: 'runner',
        terminal: false,
      },
    });
    const second = appendProgressEvent({
      hopperDir,
      taskId: 'T-prog',
      event: {
        vendor: 'codex',
        phase: 'running',
        kind: 'lifecycle',
        message: 'Task running.',
        source: 'runner',
        terminal: false,
      },
    });

    assert.equal(first.seq, 1);
    assert.equal(second.seq, 2);
    assert.match(first.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(nextProgressSeq({ hopperDir, taskId: 'T-prog' }), 3);

    const events = readProgressEvents({ hopperDir, taskId: 'T-prog', limit: 1 });
    assert.equal(events.length, 1);
    assert.equal(events[0].seq, 2);
    assert.equal(events[0].message, 'Task running.');

    const raw = readFileSync(join(hopperDir, 'handoffs', 'T-prog-progress.log'), 'utf-8');
    assert.equal(raw.trim().split(/\r?\n/).length, 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('readProgressEvents skips malformed JSONL lines', () => {
  const { tmp, hopperDir } = setup();
  try {
    const logPath = join(hopperDir, 'handoffs', 'T-malformed-progress.log');
    writeFileSync(logPath, '{"seq":1,"message":"ok"}\nnot json\n{"seq":2,"message":"ok2"}\n', 'utf-8');

    const events = readProgressEvents({ hopperDir, taskId: 'T-malformed' });
    assert.deepEqual(events.map((event) => event.seq), [1, 2]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('rotateProgressLogIfNeeded rotates to .1 when size exceeds limit', () => {
  const { tmp, hopperDir } = setup();
  try {
    const logPath = join(hopperDir, 'handoffs', 'T-rotate-progress.log');
    writeFileSync(logPath, '0123456789', 'utf-8');

    const rotated = rotateProgressLogIfNeeded(logPath, 5);

    assert.equal(rotated, true);
    assert.equal(existsSync(logPath), false);
    assert.equal(readFileSync(`${logPath}.1`, 'utf-8'), '0123456789');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('nextProgressSeq stays monotonic across rotate', () => {
  const { tmp, hopperDir } = setup();
  try {
    const taskId = 'T-rotate-seq';
    const event = (message) => ({
      vendor: 'codex',
      phase: 'running',
      kind: 'lifecycle',
      message,
      source: 'runner',
      terminal: false,
    });

    appendProgressEvent({ hopperDir, taskId, event: event('one') });
    appendProgressEvent({ hopperDir, taskId, event: event('two') });
    appendProgressEvent({ hopperDir, taskId, event: event('three') });

    const logPath = join(hopperDir, 'handoffs', `${taskId}-progress.log`);
    assert.equal(rotateProgressLogIfNeeded(logPath, 1), true);

    const afterRotate = appendProgressEvent({ hopperDir, taskId, event: event('four') });

    assert.equal(afterRotate.seq, 4);
    assert.equal(nextProgressSeq({ hopperDir, taskId }), 5);
    assert.deepEqual(readProgressEvents({ hopperDir, taskId }).map((item) => item.seq), [1, 2, 3, 4]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('readProgressEvents returns recent events across rotated and current logs', () => {
  const { tmp, hopperDir } = setup();
  try {
    const taskId = 'T-rotate-read';
    const event = (message) => ({
      vendor: 'codex',
      phase: 'running',
      kind: 'lifecycle',
      message,
      source: 'runner',
      terminal: false,
    });

    for (const message of ['one', 'two', 'three', 'four']) {
      appendProgressEvent({ hopperDir, taskId, event: event(message) });
    }
    const logPath = join(hopperDir, 'handoffs', `${taskId}-progress.log`);
    assert.equal(rotateProgressLogIfNeeded(logPath, 1), true);
    for (const message of ['five', 'six', 'seven']) {
      appendProgressEvent({ hopperDir, taskId, event: event(message) });
    }

    const events = readProgressEvents({ hopperDir, taskId, limit: 5 });
    assert.deepEqual(events.map((item) => item.seq), [3, 4, 5, 6, 7]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('appendProgressEvent rejects unsafe task ids before writing', () => {
  const { tmp, hopperDir } = setup();
  try {
    assert.throws(
      () => appendProgressEvent({
        hopperDir,
        taskId: '../bad',
        event: { vendor: 'codex', phase: 'starting', kind: 'x', message: 'x', source: 'runner' },
      }),
      /invalid task id/i
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('process_alive liveness keeps the progress schema content-free', () => {
  const { tmp, hopperDir } = setup();
  try {
    const event = appendProgressEvent({
      hopperDir,
      taskId: 'T-process-alive',
      event: {
        vendor: 'kimi',
        phase: 'running',
        kind: 'process_alive',
        message: 'Vendor process is still running.',
        source: 'runner',
        terminal: false,
        last_stream_event: 'process_alive',
        raw_chunk: 'HOSTILE_RAW_CHUNK_SENTINEL',
        stdout: 'HOSTILE_STDOUT_SENTINEL',
        stderr: 'HOSTILE_STDERR_SENTINEL',
        prompt: 'HOSTILE_PROMPT_SENTINEL',
        log_path: 'HOSTILE_LOG_PATH_SENTINEL',
        byte_count: 1234,
        model: 'HOSTILE_MODEL_SENTINEL',
      },
    });

    assert.deepEqual(Object.keys(event).sort(), [
      'kind', 'last_stream_event', 'message', 'phase', 'seq', 'source', 'task_id', 'terminal', 'ts', 'vendor',
    ]);
    assert.doesNotMatch(JSON.stringify(event), /HOSTILE_/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('terminal events retain the attestation optional-field allowlist exactly', () => {
  const { tmp, hopperDir } = setup();
  try {
    const event = appendProgressEvent({
      hopperDir,
      taskId: 'T-attested-progress',
      event: {
        vendor: 'claude', phase: 'done', kind: 'terminal', message: 'done', source: 'runner', terminal: true,
        requested_selector: 'fable', effective_selector: 'fable', effective_selector_source: 'user-argv',
        selector_kind: 'alias', observed_models: ['claude-opus-4-6'],
        model_attestation_source: 'claude.result.modelUsage.keys',
        model_attestation_observed_at: '2026-07-21T12:00:00.000Z',
        session_effective_reasoning_level: 'high',
        session_effective_reasoning_source: 'pi-cli-session-effective',
        session_effective_reasoning_observed_at: '2026-07-21T12:00:00.000Z',
        resolution_status: 'alias-resolved', resolution_detail: 'alias-runtime-resolved',
      },
    });
    assert.deepEqual(Object.fromEntries([
      'requested_selector', 'effective_selector', 'effective_selector_source', 'selector_kind', 'observed_models',
      'model_attestation_source', 'model_attestation_observed_at',
      'session_effective_reasoning_level', 'session_effective_reasoning_source', 'session_effective_reasoning_observed_at',
      'resolution_status', 'resolution_detail',
    ].map((key) => [key, event[key]])), {
      requested_selector: 'fable', effective_selector: 'fable', effective_selector_source: 'user-argv', selector_kind: 'alias',
      observed_models: ['claude-opus-4-6'], model_attestation_source: 'claude.result.modelUsage.keys',
      model_attestation_observed_at: '2026-07-21T12:00:00.000Z',
      session_effective_reasoning_level: 'high', session_effective_reasoning_source: 'pi-cli-session-effective',
      session_effective_reasoning_observed_at: '2026-07-21T12:00:00.000Z',
      resolution_status: 'alias-resolved', resolution_detail: 'alias-runtime-resolved',
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
