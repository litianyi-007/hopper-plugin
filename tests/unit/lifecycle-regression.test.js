// Completion and classification regressions reconstructed from the 2026-07-21
// Hopper incidents. Fixtures deliberately contain only protocol fields.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import * as progress from '../../cli/src/progress.js';
import * as subprocess from '../../cli/src/subprocess.js';
import { readFrontmatter } from '../../cli/src/background.js';

import { getAdapter } from '../../cli/src/vendors/index.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(REPO_ROOT, 'cli', 'bin', 'hopper-runner');
const DISPATCH = join(REPO_ROOT, 'cli', 'bin', 'hopper-dispatch');

function installSlowFakeKimi(binDir, sleepScriptPath) {
  mkdirSync(binDir, { recursive: true });
  if (process.platform === 'win32') {
    writeFileSync(join(binDir, 'kimi.cmd'), [
      '@echo off',
      '>>"%HOPPER_TEST_KIMI_COUNTER%" echo spawned',
      'echo HOSTILE_KIMI_STDOUT_SENTINEL',
      'echo HOSTILE_KIMI_STDERR_SENTINEL 1>&2',
      '"%HOPPER_TEST_NODE%" "%HOPPER_TEST_KIMI_SLEEP_SCRIPT%"',
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n'));
    return;
  }
  const fake = join(binDir, 'kimi');
  writeFileSync(fake, [
    '#!/bin/sh',
    'printf "spawned\\n" >> "$HOPPER_TEST_KIMI_COUNTER"',
    'printf "HOSTILE_KIMI_STDOUT_SENTINEL\\n"',
    'printf "HOSTILE_KIMI_STDERR_SENTINEL\\n" >&2',
    '"$HOPPER_TEST_NODE" "$HOPPER_TEST_KIMI_SLEEP_SCRIPT"',
    '',
  ].join('\n'));
  chmodSync(fake, 0o755);
}

async function waitFor(check, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

const OPENCODE_STOP_STREAM = [
  JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
  JSON.stringify({ type: 'text', part: { type: 'text', text: 'COMPLETE' } }),
  JSON.stringify({
    type: 'step_finish',
    part: { type: 'step-finish', reason: 'stop' },
  }),
].join('\n');

test('opencode recognizes a nested step_finish/step-finish stop as authoritative completion', () => {
  const result = getAdapter('opencode').parseResult({
    exitCode: 0,
    stdout: OPENCODE_STOP_STREAM,
    stderr: '',
    timedOut: false,
    durationMs: 25,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.text, 'COMPLETE');
});

test('opencode accepts an authoritative reasonless step_finish with usable text', () => {
  const result = getAdapter('opencode').parseResult({
    exitCode: 0,
    stdout: [
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'REASONLESS_COMPLETE' } }),
      JSON.stringify({ type: 'step_finish', part: { type: 'step-finish' } }),
    ].join('\n'),
    stderr: '',
    timedOut: false,
    durationMs: 25,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.text, 'REASONLESS_COMPLETE');
});

test('opencode accepts message.completed with usable assistant text', () => {
  const result = getAdapter('opencode').parseResult({
    exitCode: 0,
    stdout: [
      JSON.stringify({ type: 'message.part.delta', delta: 'MESSAGE_' }),
      JSON.stringify({ type: 'message.part.delta', delta: 'COMPLETE' }),
      JSON.stringify({ type: 'message.completed' }),
    ].join('\n'),
    stderr: '',
    timedOut: false,
    durationMs: 25,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.text, 'MESSAGE_COMPLETE');
});

test('opencode accepts an explicit successful result envelope with usable text', () => {
  const result = getAdapter('opencode').parseResult({
    exitCode: 0,
    stdout: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'RESULT_COMPLETE',
    }),
    stderr: '',
    timedOut: false,
    durationMs: 25,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.text, 'RESULT_COMPLETE');
});

test('opencode rejects a tool_calls step boundary with only partial text', () => {
  const result = getAdapter('opencode').parseResult({
    exitCode: 0,
    stdout: [
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'PARTIAL_TOOL_TEXT' } }),
      JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'tool_calls' } }),
    ].join('\n'),
    stderr: '',
    timedOut: false,
    durationMs: 25,
  });

  assert.equal(result.status, 'unknown-fail');
  assert.equal(result.diagnosticCode, 'adapter-protocol-invalid');
  assert.equal(result.error, 'adapter-protocol-invalid');
  assert.equal(result.text, 'PARTIAL_TOOL_TEXT');
  assert.deepEqual(result.outputEvidence, {
    completeness: 'unknown-completeness',
    source: 'event-stream',
    terminalMarker: 'none',
  });
});

test('opencode rejects explicit error and cancelled result envelopes', () => {
  const rejected = [
    { type: 'result', subtype: 'error', is_error: true, result: 'ERROR_PARTIAL' },
    { type: 'result', status: 'cancelled', is_error: false, result: 'CANCELLED_PARTIAL' },
  ];

  for (const envelope of rejected) {
    const result = getAdapter('opencode').parseResult({
      exitCode: 0,
      stdout: JSON.stringify(envelope),
      stderr: '',
      timedOut: false,
      durationMs: 25,
    });
    assert.equal(result.status, 'unknown-fail', JSON.stringify(envelope));
    assert.equal(result.diagnosticCode, 'adapter-protocol-invalid');
    assert.equal(result.error, 'adapter-protocol-invalid');
    assert.equal(result.text, envelope.result);
    assert.deepEqual(result.outputEvidence, {
      completeness: 'unknown-completeness',
      source: 'event-stream',
      terminalMarker: 'none',
    });
  }
});

test('opencode does not report exit 0 with no completion evidence as success', () => {
  const result = getAdapter('opencode').parseResult({
    exitCode: 0,
    stdout: JSON.stringify({ type: 'text', part: { type: 'text', text: 'partial' } }),
    stderr: '',
    timedOut: false,
    durationMs: 25,
  });

  assert.equal(result.status, 'unknown-fail');
  assert.equal(result.diagnosticCode, 'adapter-protocol-invalid');
  assert.equal(result.error, 'adapter-protocol-invalid');
  assert.equal(result.text, 'partial');
  assert.deepEqual(result.outputEvidence, {
    completeness: 'unknown-completeness',
    source: 'event-stream',
    terminalMarker: 'none',
  });
});

test('opencode does not treat an empty clean exit as a successful task', () => {
  const result = getAdapter('opencode').parseResult({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    durationMs: 25,
  });

  assert.equal(result.status, 'unknown-fail');
  assert.equal(result.diagnosticCode, 'adapter-protocol-invalid');
  assert.equal(result.error, 'adapter-protocol-invalid');
  assert.equal(result.text, '');
});

test('claude authoritative success result wins over unrelated auth-shaped log text', () => {
  const result = getAdapter('claude').parseResult({
    exitCode: 0,
    stdout: [
      'warning: ANTHROPIC_API_KEY takes precedence over another auth source',
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        stop_reason: 'end_turn',
        result: 'AUTHORITATIVE_RESULT',
      }),
    ].join('\n'),
    stderr: '',
    timedOut: false,
    durationMs: 25,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.text, 'AUTHORITATIVE_RESULT');
});

test('claude still classifies a real authentication error as auth-fail', () => {
  const result = getAdapter('claude').parseResult({
    exitCode: 1,
    stdout: '',
    stderr: 'authentication_failed: please run login',
    timedOut: false,
    durationMs: 25,
  });

  assert.equal(result.status, 'auth-fail');
});

test('runner waits for child close before reading the final file-backed stream', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const runner = readFileSync(resolve(testDir, '..', '..', 'cli', 'bin', 'hopper-runner'), 'utf-8');

  assert.match(runner, /vendor\.on\('close', \(code, signal\) =>/);
  assert.doesNotMatch(runner, /vendor\.on\('exit', \(code, signal\) =>/);
});

test('stream lifecycle extraction records only safe event metadata', () => {
  assert.equal(typeof progress.findLatestVendorProgressEvent, 'function');

  const event = progress.findLatestVendorProgressEvent([
    JSON.stringify({ type: 'text', part: { text: 'do not copy this model output' } }),
    JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } }),
  ].join('\n'));

  assert.deepEqual(event, { event: 'step_finish', reason: 'stop' });

  const testDir = dirname(fileURLToPath(import.meta.url));
  const runner = readFileSync(resolve(testDir, '..', '..', 'cli', 'bin', 'hopper-runner'), 'utf-8');
  assert.match(runner, /findLatestVendorProgressEvent/);
  assert.match(runner, /appendVendorHeartbeat/);
});

test('Kimi runner emits content-free process_alive liveness while text output is live', { timeout: 12_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'hopper-kimi-liveness-'));
  const hopperDir = join(root, '.hopper');
  const handoffs = join(hopperDir, 'handoffs');
  const taskId = 'T-kimi-live';
  const outputMdPath = join(handoffs, `${taskId}-output.md`);
  const logPath = join(handoffs, `${taskId}-output.log`);
  const binDir = join(root, 'fake-bin');
  const counterPath = join(root, 'kimi-spawn-count.txt');
  const releasePath = join(root, 'release-kimi.txt');
  const sleepScriptPath = join(root, 'slow-kimi.js');
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  let runner = null;
  let runnerClosed = null;
  try {
    mkdirSync(handoffs, { recursive: true });
    writeFileSync(sleepScriptPath, [
      "process.stdout.write(JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'HOSTILE_KIMI_REASON_SENTINEL' } }) + '\\n');",
      "process.stdout.write('HOSTILE_KIMI_STDOUT_SENTINEL\\n');",
      "process.stderr.write('HOSTILE_KIMI_STDERR_SENTINEL\\n');",
      "const { existsSync } = require('node:fs');",
      "const releasePath = process.env.HOPPER_TEST_KIMI_RELEASE;",
      'const releasePoll = setInterval(() => {',
      '  if (existsSync(releasePath)) { clearInterval(releasePoll); process.exit(0); }',
      '}, 10);',
      '',
    ].join('\n'));
    installSlowFakeKimi(binDir, sleepScriptPath);
    writeFileSync(outputMdPath, [
      '---',
      `task_id: ${taskId}`,
      'adapter: kimi',
      'status: in-progress',
      'terminal_event_emitted: false',
      `start_time: ${new Date().toISOString()}`,
      '---',
      `# ${taskId} — kimi (background, in-progress)`,
      '',
    ].join('\n'));
    const env = {
      ...process.env,
      [pathKey]: `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env[pathKey] || process.env.PATH || ''}`,
      HOPPER_TEST_KIMI_COUNTER: counterPath,
      HOPPER_TEST_KIMI_SLEEP_SCRIPT: sleepScriptPath,
      HOPPER_TEST_KIMI_RELEASE: releasePath,
      HOPPER_TEST_NODE: process.execPath,
      HOPPER_TEST_ONLY_LIVENESS_INTERVAL_MS: '25',
      HOPPER_IDLE_TIMEOUT_MS: '1200',
    };
    runner = spawn(process.execPath, [
      RUNNER,
      '--task-id', taskId,
      '--hopper-dir', hopperDir,
      '--adapter', 'kimi',
      '--output-md', outputMdPath,
      '--log', logPath,
      '--cwd', root,
      '--', '-p', 'HOSTILE_KIMI_PROMPT_SENTINEL',
    ], { cwd: root, env, stdio: 'ignore' });
    runnerClosed = new Promise((resolve) => runner.once('close', resolve));

    await waitFor(() => existsSync(counterPath));
    // The fake kimi wrapper writes its stdout and stderr sentinels as two
    // independent OS pipes; the runner tees each stream to the shared log
    // file as its own 'data' events arrive (cli/bin/hopper-runner's
    // teeToLog), with no guaranteed ordering between the two streams. A
    // readiness check that only waits for the log file to become non-empty
    // races: it can observe the log right after ONE sentinel has landed and
    // before the other stream's chunk has been written, asserting on partial
    // content depending on which stream happened to arrive first (reproduced
    // locally, on macOS, on both Node 22 and Node 24 — this is a stream
    // arrival-order race, not a Windows- or Node-24-specific behavior
    // change). Wait for BOTH sentinels' content to be present — assert on
    // content, not on arrival order.
    const rawLog = await waitFor(() => {
      if (!existsSync(logPath)) return false;
      const content = readFileSync(logPath, 'utf-8');
      const hasBoth = /HOSTILE_KIMI_STDOUT_SENTINEL/.test(content)
        && /HOSTILE_KIMI_STDERR_SENTINEL/.test(content);
      return hasBoth ? content : false;
    });
    assert.match(rawLog, /HOSTILE_KIMI_STDOUT_SENTINEL/);
    assert.match(rawLog, /HOSTILE_KIMI_STDERR_SENTINEL/);
    const liveness = await waitFor(() => progress.readProgressEvents({ hopperDir, taskId })
      .find((event) => event.kind === 'process_alive'));
    assert.deepEqual({
      phase: liveness.phase,
      kind: liveness.kind,
      message: liveness.message,
      source: liveness.source,
      terminal: liveness.terminal,
      last_stream_event: liveness.last_stream_event,
    }, {
      phase: 'running',
      kind: 'process_alive',
      message: 'Vendor process is still running.',
      source: 'runner',
      terminal: false,
      last_stream_event: 'process_alive',
    });
    assert.deepEqual(Object.keys(liveness).sort(), [
      'kind', 'last_stream_event', 'last_update', 'message', 'phase', 'seq', 'source', 'task_id', 'terminal', 'ts', 'vendor',
    ]);
    assert.match(liveness.last_update, /^\d{4}-\d{2}-\d{2}T/);

    const runningEvents = progress.readProgressEvents({ hopperDir, taskId })
      .filter((event) => event.phase === 'running');
    assert.ok(runningEvents.length > 0);
    assert.ok(runningEvents.every((event) => event.kind === 'process_alive'));
    assert.ok(runningEvents.every((event) => event.last_stream_event === 'process_alive'));
    assert.ok(runningEvents.every((event) => event.last_reason === undefined));
    assert.equal(readFrontmatter(outputMdPath).status, 'in-progress', 'the explicit release has not occurred yet');

    writeFileSync(releasePath, 'release\n');
    await runnerClosed;

    const progressJsonl = readFileSync(join(handoffs, `${taskId}-progress.log`), 'utf-8');
    const frontmatter = readFrontmatter(outputMdPath);
    const { _body, ...frontmatterSurface } = frontmatter;
    const defaultSurface = execFileSync(process.execPath, [DISPATCH, '--progress', taskId], {
      cwd: root,
      env: { ...env, HOPPER_DIR: hopperDir },
      encoding: 'utf-8',
    });
    const safeSurfaces = `${progressJsonl}\n${JSON.stringify(frontmatterSurface)}\n${defaultSurface}`;
    for (const sentinel of [
      'HOSTILE_KIMI_STDOUT_SENTINEL',
      'HOSTILE_KIMI_STDERR_SENTINEL',
      'HOSTILE_KIMI_PROMPT_SENTINEL',
      'HOSTILE_KIMI_REASON_SENTINEL',
      'step_finish',
    ]) {
      assert.doesNotMatch(safeSurfaces, new RegExp(sentinel));
    }
  } finally {
    if (runnerClosed) {
      try { writeFileSync(releasePath, 'release\n'); } catch (_) {}
      await runnerClosed;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('progress events preserve lifecycle metadata', async () => {
  const tmp = process.env.TEMP || process.env.TMP || '.';
  const hopperDir = `${tmp}/hopper-lifecycle-progress-${process.pid}-${Date.now()}`;
  try {
    const event = progress.appendProgressEvent({
      hopperDir,
      taskId: 'T-life-progress',
      event: {
        vendor: 'opencode',
        phase: 'running',
        kind: 'heartbeat',
        message: 'Vendor step_finish (stop).',
        source: 'runner',
        terminal: false,
        last_stream_event: 'step_finish',
        last_reason: 'stop',
        last_update: '2026-07-21T00:00:00.000Z',
      },
    });

    assert.equal(event.last_stream_event, 'step_finish');
    assert.equal(event.last_reason, 'stop');
    assert.equal(event.last_update, '2026-07-21T00:00:00.000Z');
  } finally {
    // This probe is intentionally best-effort; the behavior under test is the JSONL schema.
    try { (await import('node:fs')).rmSync(hopperDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('progress events preserve timeout cleanup diagnostics', async () => {
  const tmp = process.env.TEMP || process.env.TMP || '.';
  const hopperDir = `${tmp}/hopper-timeout-progress-${process.pid}-${Date.now()}`;
  try {
    const event = progress.appendProgressEvent({
      hopperDir,
      taskId: 'T-timeout-progress',
      event: {
        vendor: 'opencode',
        phase: 'timeout',
        kind: 'terminal',
        message: 'Task timed out.',
        source: 'runner',
        terminal: true,
        timeout_reason: 'idle',
        process_cleanup: 'succeeded',
      },
    });

    assert.equal(event.timeout_reason, 'idle');
    assert.equal(event.process_cleanup, 'succeeded');
  } finally {
    try { (await import('node:fs')).rmSync(hopperDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('process-tree cleanup reports whether a cleanup attempt was needed', () => {
  assert.deepEqual(subprocess.killProcessTree(0, true), {
    status: 'not-requested',
    method: null,
  });
});
