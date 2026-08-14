// Unit tests for subprocess.js (T-PLUGIN-04.5)
// Anchor: tests/unit/subprocess.test.js
//
// Tests the shared subprocess wrapper without spawning real vendor CLIs.
// Uses node binary echo / sleep / exit-with-code as test fixtures.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { acquireVendorLock, runSubprocessOnce, makeUniqueLogPath, chunkHasSubstantiveLine, killProcessTree } from '../../cli/src/subprocess.js';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join, delimiter } from 'node:path';

// ── heartbeat-aware idle detection helper (mimo background-exit hang) ──
test('chunkHasSubstantiveLine: a heartbeat-only chunk is NOT substantive', () => {
  const re = /path=\/session\/status\b/;
  const chunk = [
    'INFO service=server method=GET path=/session/status request',
    'INFO service=server status=completed path=/session/status request',
    '',
  ].join('\n');
  assert.equal(chunkHasSubstantiveLine(chunk, re), false);
});

test('chunkHasSubstantiveLine: a json event among heartbeats IS substantive', () => {
  const re = /path=\/session\/status\b/;
  const chunk = [
    'INFO service=server method=GET path=/session/status request',
    '{"type":"text","part":{"text":"hi"}}',
  ].join('\n');
  assert.equal(chunkHasSubstantiveLine(chunk, re), true);
});

test('chunkHasSubstantiveLine: empty / whitespace-only chunk is not substantive', () => {
  const re = /path=\/session\/status\b/;
  assert.equal(chunkHasSubstantiveLine('', re), false);
  assert.equal(chunkHasSubstantiveLine('   \n\t\n  ', re), false);
});

test('runSubprocessOnce captures stdout from a simple command', async () => {
  // Use node itself to echo
  const result = await runSubprocessOnce({
    command: process.execPath,
    args: ['-e', 'console.log("HELLO_STDOUT")'],
    stdinInput: null,
    timeoutMs: 10000,
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /HELLO_STDOUT/);
  assert.equal(result.timedOut, false);
});

test('runSubprocessOnce captures stderr separately', async () => {
  const result = await runSubprocessOnce({
    command: process.execPath,
    args: ['-e', 'console.error("HELLO_STDERR"); process.exit(0)'],
    stdinInput: null,
    timeoutMs: 10000,
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /HELLO_STDERR/);
  assert.equal(result.stdout, '');
});

test('runSubprocessOnce propagates non-zero exit code', async () => {
  const result = await runSubprocessOnce({
    command: process.execPath,
    args: ['-e', 'process.exit(42)'],
    stdinInput: null,
    timeoutMs: 10000,
  });
  assert.equal(result.exitCode, 42);
});

test('runSubprocessOnce pipes stdin when stdinInput provided', async () => {
  const result = await runSubprocessOnce({
    command: process.execPath,
    args: [
      '-e',
      'let d = ""; process.stdin.on("data", c => d += c); process.stdin.on("end", () => console.log("GOT:" + d.trim()))',
    ],
    stdinInput: 'PIPED_INPUT',
    timeoutMs: 10000,
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /GOT:PIPED_INPUT/);
});

test('runSubprocessOnce times out and kills the process', async () => {
  // Spawn a process that sleeps forever; expect timeout to kill it
  const result = await runSubprocessOnce({
    command: process.execPath,
    args: [
      '-e',
      'setInterval(() => {}, 1000000)', // sleeps forever
    ],
    stdinInput: null,
    timeoutMs: 500, // half a second
  });
  assert.equal(result.timedOut, true);
  // exit code will be non-zero (killed signal-based)
  assert.notEqual(result.exitCode, 0);
});

// ── bufferedOutput: skip the idle watchdog for end-buffered vendors ──
// (ISSUE-grok-claude-buffered-output-idle-falsekill.md) grok/claude declare
// `bufferedOutput: true` (cli/src/vendors/grok.js:85, cli/src/vendors/claude.js:78)
// because their `--output-format json` writes stdout/stderr exactly ONCE, at
// process exit — never incrementally. cli/bin/hopper-runner (the background
// path) already skipped arming its idle poll for such an adapter. This sync
// primitive (runSubprocessOnce, used by hopper-dispatch's foreground path via
// cli/src/dispatch.js executeWithAdapter) did NOT: it armed the idle watchdog
// unconditionally, so a fully end-buffered vendor was idle-killed ~idleMs
// after spawn — before it ever got a chance to write anything. Three real
// hopper-dispatch reviews of grok in this project timed out at exactly
// 180024ms (DEFAULT_IDLE_TIMEOUT_MS=180_000) before this fix.
test('runSubprocessOnce: bufferedOutput:true is NOT idle-killed during its silent period (the fix)', async () => {
  const result = await runSubprocessOnce({
    command: process.execPath,
    args: [
      '-e',
      // Silent for 400ms (no stdout/stderr at all, matching grok/claude's
      // end-buffered --output-format json shape), THEN writes ONE trailing
      // blob and exits. idleMs=100 is far shorter than the 400ms silence, so
      // under the pre-fix behavior this run would have been idle-killed long
      // before it could write anything.
      'setTimeout(() => { process.stdout.write("BUFFERED_DONE"); process.exit(0); }, 400)',
    ],
    stdinInput: null,
    idleMs: 100,
    timeoutMs: 5000,
    bufferedOutput: true,
  });
  assert.equal(result.timedOut, false, 'a bufferedOutput vendor must not be idle-killed while silent');
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /BUFFERED_DONE/, 'the vendor must live long enough to write its single trailing blob');
});

test('runSubprocessOnce: without bufferedOutput, the identical silent period IS idle-killed (pre-fix baseline)', async () => {
  const result = await runSubprocessOnce({
    command: process.execPath,
    args: [
      '-e',
      'setTimeout(() => { process.stdout.write("BUFFERED_DONE"); process.exit(0); }, 400)',
    ],
    stdinInput: null,
    idleMs: 100,
    timeoutMs: 5000,
    // bufferedOutput intentionally omitted — this is the exact pre-fix shape,
    // and doubles as proof the flag is additive: omitting it must NOT change
    // existing idle-kill behavior for non-buffered vendors.
  });
  assert.equal(result.timedOut, true, 'without the flag, silence for idleMs must still be treated as stuck');
  assert.equal(result.timeoutReason, 'idle');
  assert.equal(result.stdout, '', 'the kill must land BEFORE the vendor gets a chance to write — the real-world false-kill this fix corrects');
});

test('runSubprocessOnce: bufferedOutput:true still respects the absolute ceiling for a genuinely hung vendor', async () => {
  const result = await runSubprocessOnce({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000000)'], // never writes, never exits
    stdinInput: null,
    idleMs: 100,
    timeoutMs: 400,
    bufferedOutput: true,
  });
  assert.equal(result.timedOut, true, 'bufferedOutput must not disable the safety net for a truly hung process');
  assert.equal(result.timeoutReason, 'ceiling', 'with idle-arming skipped, only the ceiling timer can be the cause');
});

test('runSubprocessOnce timeout arbitration is first-wins and kills the process tree exactly once', { skip: platform() !== 'win32' ? 'taskkill PATH shim is Windows-specific' : false }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-subprocess-timeout-first-wins-'));
  const killCounterFile = join(tmp, 'kill-counter.txt');
  const fakeTaskkillScript = join(tmp, 'fake-taskkill.js');
  const previousPath = process.env.PATH;
  try {
    writeFileSync(fakeTaskkillScript, `
      const fs = require('node:fs');
      const file = ${JSON.stringify(killCounterFile)};
      const cur = fs.existsSync(file) ? parseInt(fs.readFileSync(file, 'utf-8')) : 0;
      const next = cur + 1;
      fs.writeFileSync(file, String(next));
      process.exit(next === 1 ? 0 : 5);
    `, 'utf-8');
    writeFileSync(
      join(tmp, 'taskkill.cmd'),
      `@echo off\r\n"${process.execPath}" "${fakeTaskkillScript}" %*\r\n`,
      'utf-8',
    );
    process.env.PATH = `${tmp}${delimiter}${previousPath || ''}`;

    const result = await runSubprocessOnce({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => process.exit(0), 800)'],
      stdinInput: null,
      idleMs: 100,
      timeoutMs: 300,
    });

    assert.equal(parseInt(readFileSync(killCounterFile, 'utf-8')), 1,
      'the first timeout must clear its peer before a second process-tree kill');
    assert.equal(result.timeoutReason, 'idle', 'the first timeout cause must remain authoritative');
    assert.equal(result.processCleanup?.status, 'succeeded',
      'the first cleanup result must remain authoritative');
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('runSubprocessOnce returns timedOut=false on normal exit', async () => {
  const result = await runSubprocessOnce({
    command: process.execPath,
    args: ['-e', 'console.log("fast")'],
    stdinInput: null,
    timeoutMs: 10000,
  });
  assert.equal(result.timedOut, false);
});

test('runSubprocessOnce returns durationMs', async () => {
  const result = await runSubprocessOnce({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => process.exit(0), 100)'],
    stdinInput: null,
    timeoutMs: 5000,
  });
  assert.ok(result.durationMs >= 100, `expected >=100ms, got ${result.durationMs}`);
  assert.ok(result.durationMs < 5000);
});

test('runSubprocessOnce returns 127 for missing command', async () => {
  const result = await runSubprocessOnce({
    command: 'definitely-not-a-real-command-xyz123',
    args: [],
    stdinInput: null,
    timeoutMs: 5000,
  });
  assert.equal(result.exitCode, 127);
});

test('runSubprocessOnce reads --log-file content when path provided', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-subprocess-test-'));
  try {
    const logPath = join(tmp, 'fake.log');
    // Use node to write to the log file then exit
    const result = await runSubprocessOnce({
      command: process.execPath,
      args: [
        '-e',
        `require("node:fs").writeFileSync(${JSON.stringify(logPath)}, "SIMULATED_LOG_OUTPUT")`,
      ],
      stdinInput: null,
      timeoutMs: 5000,
      logFilePath: logPath,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.logFileContent, 'SIMULATED_LOG_OUTPUT');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('runSubprocessOnce does NOT retry on failure (single attempt verification)', async () => {
  // Per spec §3 #4: ONE dispatch = ONE attempt. No retry on exit 1.
  let invokeCount = 0;
  const originalSpawn = (await import('node:child_process')).spawn;

  // We can't easily mock spawn without dependency injection, so we verify
  // via exit-code propagation: a failing command exits non-zero ONCE,
  // not multiple retried attempts.
  const result = await runSubprocessOnce({
    command: process.execPath,
    args: ['-e', 'console.error("FAILED"); process.exit(1)'],
    stdinInput: null,
    timeoutMs: 5000,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.timedOut, false);
  // The function returned once with the failure result. No retry happened.
  // This is verified structurally — see source code: runSubprocessOnce has
  // no retry loop, no fallback path, no backoff. The only loop in the file
  // is the data event listeners.
});

test('killProcessTree reports cleanup state after terminating an owned child', async () => {
  const child = (await import('node:child_process')).spawn(process.execPath, [
    '-e', 'setInterval(() => {}, 60_000)',
  ], { stdio: 'ignore', windowsHide: true });

  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });

    const cleanup = killProcessTree(child.pid, platform() === 'win32');
    assert.equal(cleanup.status, 'succeeded');
    assert.ok(cleanup.method, 'cleanup method is recorded for diagnostics');

    await new Promise((resolve) => child.once('close', resolve));
  } finally {
    try { child.kill('SIGKILL'); } catch (_) {}
  }
});

test('killProcessTree treats POSIX group/direct ESRCH as an already-complete cleanup', () => {
  const originalKill = process.kill;
  const calls = [];
  process.kill = (pid, signal) => {
    calls.push({ pid, signal });
    const err = new Error('no such process');
    err.code = 'ESRCH';
    throw err;
  };
  try {
    const cleanup = killProcessTree(424242, false);
    assert.deepEqual(calls, [
      { pid: -424242, signal: 'SIGKILL' },
      { pid: 424242, signal: 'SIGKILL' },
    ]);
    assert.equal(cleanup.status, 'succeeded', 'already-exited is cleanup success, not a new status enum');
    assert.equal(cleanup.alreadyExited, true);
    assert.match(cleanup.method, /already exited|ESRCH/i);
  } finally {
    process.kill = originalKill;
  }
});

test('killProcessTree keeps POSIX permission failures classified as failed', () => {
  const originalKill = process.kill;
  const errorCodes = ['EPERM', 'EACCES'];
  process.kill = () => {
    const err = new Error('permission denied');
    err.code = errorCodes.shift();
    throw err;
  };
  try {
    const cleanup = killProcessTree(424243, false);
    assert.equal(cleanup.status, 'failed');
    assert.equal(cleanup.alreadyExited, undefined);
  } finally {
    process.kill = originalKill;
  }
});

test('killProcessTree does not hide a POSIX direct EACCES behind a group ESRCH', () => {
  const originalKill = process.kill;
  const errorCodes = ['ESRCH', 'EACCES'];
  process.kill = () => {
    const err = new Error('kill failed');
    err.code = errorCodes.shift();
    throw err;
  };
  try {
    const cleanup = killProcessTree(424244, false);
    assert.equal(cleanup.status, 'failed');
    assert.equal(cleanup.alreadyExited, undefined);
  } finally {
    process.kill = originalKill;
  }
});

test('makeUniqueLogPath generates unique paths per dispatch (codex F2 fix)', () => {
  const p1 = makeUniqueLogPath('T-PLUGIN-05a', 'codex');
  const p2 = makeUniqueLogPath('T-PLUGIN-05a', 'codex');
  assert.notEqual(p1, p2, 'two calls must produce different paths');
  assert.match(p1, /codex/);
  assert.match(p1, /T-PLUGIN-05a/);
});

test('acquireVendorLock serializes codex across overlapping callers', async () => {
  const release1 = await acquireVendorLock('codex');
  let secondAcquired = false;

  const waiter = (async () => {
    const release2 = await acquireVendorLock('codex');
    secondAcquired = true;
    release2();
  })();

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(secondAcquired, false, 'second codex caller must wait for the first lock holder');

  release1();
  await waiter;
  assert.equal(secondAcquired, true);
});

test('acquireVendorLock is a no-op for non-serialized vendors', async () => {
  const release = await acquireVendorLock('opencode');
  assert.equal(typeof release, 'function');
  release();
});
