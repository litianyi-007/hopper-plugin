// Regression coverage for ISSUE-grok-claude-buffered-output-idle-falsekill on
// the SYNC dispatch path.
// Anchor: tests/unit/dispatch-buffered-output.test.js
//
// cli/bin/hopper-runner (the BACKGROUND path, `hopper-dispatch <id> --background`)
// already skipped arming its idle poll for an adapter declaring
// `bufferedOutput: true` (grok at cli/src/vendors/grok.js:85, claude at
// cli/src/vendors/claude.js:78 — both use an end-buffered `--output-format
// json` that writes stdout/stderr exactly ONCE, at process exit). The SYNC
// path (plain `hopper-dispatch <id>`, no --background) calls the SAME
// idle-timer primitive — cli/src/dispatch.js executeWithAdapter ->
// cli/src/subprocess.js runSubprocessOnce — but never read the flag at all,
// so a fully end-buffered vendor dispatched synchronously was idle-killed
// ~idleMs after spawn, before it ever wrote its single trailing blob. Three
// real hopper-dispatch reviews of grok in this project timed out at exactly
// 180024ms (DEFAULT_IDLE_TIMEOUT_MS=180_000) before this fix; the most recent
// produced no artifact at all.
//
// These tests exercise the REAL production wiring (executeWithAdapter reading
// adapter.bufferedOutput off the resolved adapter and threading it into
// runSubprocessOnce) rather than calling runSubprocessOnce directly — that
// lower-level primitive has its own focused coverage in
// tests/unit/subprocess.test.js. A fix to subprocess.js alone, without also
// wiring dispatch.js to pass the flag through, would leave this file red.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { executeWithAdapter } from '../../cli/src/dispatch.js';

/**
 * Fake adapter using process.execPath (node) as the "vendor" binary: stays
 * completely silent for `silentMs` (no stdout/stderr at all), then writes ONE
 * trailing blob and exits 0 — the same end-buffered shape as grok/claude's
 * `--output-format json`.
 */
function makeBufferedStubAdapter({ name, bufferedOutput, silentMs, answerText }) {
  return {
    name,
    command: process.execPath,
    stdinMode: 'none',
    args: () => [
      '-e',
      `setTimeout(() => { process.stdout.write(${JSON.stringify(answerText)}); process.exit(0); }, ${silentMs})`,
    ],
    ...(bufferedOutput ? { bufferedOutput: true } : {}),
    envPreflight: () => ({ ok: true, missing: [] }),
    timeoutMs: () => 30_000,
    parseResult: (raw) => (raw.exitCode === 0 && raw.stdout.includes(answerText)
      ? { text: raw.stdout, status: 'success' }
      : { text: raw.stdout, status: raw.timedOut ? 'timeout' : 'unknown-fail', error: `exit ${raw.exitCode}` }),
  };
}

function makeResolved(vendor, taskId) {
  return {
    task: { id: taskId, taskType: 'code-impl', status: 'pending', depends: [], priority: 'normal', brief: 'buffered-output regression', vendor: null },
    vendor,
    composedPrompt: 'pretend this is a real dispatched task',
    frame: '',
    taskSpec: '',
  };
}

/** Set env vars for the duration of an async fn, always restoring afterward. */
async function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test('executeWithAdapter: a bufferedOutput:true adapter dispatched through the sync path is NOT idle-killed (the fix)', async () => {
  await withEnv({ HOPPER_IDLE_TIMEOUT_MS: '150' }, async () => {
    // 400ms of total silence, idle=150ms: under the pre-fix behavior this
    // dispatch would have been idle-killed at ~150ms, long before the vendor
    // could write its single trailing blob at 400ms.
    const adapter = makeBufferedStubAdapter({
      name: 'fake-buffered-fixed', bufferedOutput: true, silentMs: 400, answerText: 'BUFFERED_SYNC_OK',
    });
    const result = await executeWithAdapter({
      resolved: makeResolved('fake-buffered-fixed', 'T-buffered-sync-fix'),
      adapter,
    });
    assert.equal(result.output.status, 'success', `expected success, got ${JSON.stringify(result.output)}`);
    assert.match(result.output.text, /BUFFERED_SYNC_OK/);
    assert.notEqual(result.raw.timedOut, true, 'must not have been idle-killed');
  });
});

test('executeWithAdapter: WITHOUT bufferedOutput, the identical dispatch IS idle-killed (pre-fix baseline)', async () => {
  await withEnv({ HOPPER_IDLE_TIMEOUT_MS: '150' }, async () => {
    const adapter = makeBufferedStubAdapter({
      name: 'fake-buffered-unfixed', bufferedOutput: false, silentMs: 400, answerText: 'BUFFERED_SYNC_OK',
    });
    const result = await executeWithAdapter({
      resolved: makeResolved('fake-buffered-unfixed', 'T-buffered-sync-baseline'),
      adapter,
    });
    assert.equal(result.raw.timedOut, true, 'without the flag, the sync path must still idle-kill a silent buffered vendor');
    assert.equal(result.raw.timeoutReason, 'idle');
    assert.notEqual(result.output.status, 'success', 'a process killed before writing cannot be classified success');
  });
});

test('executeWithAdapter: bufferedOutput:true still lets the absolute ceiling kill a genuinely hung vendor', async () => {
  await withEnv({ HOPPER_IDLE_TIMEOUT_MS: '100', HOPPER_DISPATCH_TIMEOUT_MS: '500' }, async () => {
    const adapter = {
      name: 'fake-buffered-hung',
      command: process.execPath,
      stdinMode: 'none',
      args: () => ['-e', 'setInterval(() => {}, 1000000)'], // never writes, never exits
      bufferedOutput: true,
      envPreflight: () => ({ ok: true, missing: [] }),
      timeoutMs: () => 30_000, // overridden by HOPPER_DISPATCH_TIMEOUT_MS above
      parseResult: (raw) => ({ text: raw.stdout, status: raw.timedOut ? 'timeout' : 'unknown-fail' }),
    };
    const result = await executeWithAdapter({
      resolved: makeResolved('fake-buffered-hung', 'T-buffered-sync-ceiling'),
      adapter,
    });
    assert.equal(result.raw.timedOut, true, 'bufferedOutput must not disable the safety net for a truly hung process');
    assert.equal(result.raw.timeoutReason, 'ceiling', 'with idle-arming skipped, only the ceiling timer can be the cause');
    assert.equal(result.output.status, 'timeout');
  });
});
