// executeWithAdapter single-spawn proof (codex Phase 2 audit F3 fix)
// Anchor: tests/integration/execute-dispatch-e2e.test.js
//
// SCOPE (per codex final strict audit P1 Category B correction):
// This test exercises executeWithAdapter → runSubprocessOnce → parseResult
// — the subset of the dispatch chain AFTER resolveDispatch returns. It does
// NOT exercise the full resolveDispatch resolution (queue parsing + AGENTS.md
// lookup + frame loading); those are covered by tests/integration/real-fixtures.test.js.
//
// Why partial: the prior wording over-claimed full E2E. The single-spawn
// invariant we actually need to prove is "one executeWithAdapter call = one
// subprocess spawn", which IS this test's strict scope.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { executeDispatch, executeWithAdapter } from '../../cli/src/dispatch.js';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * Build a fake adapter that increments a counter file on every spawn.
 * Uses process.execPath (node) as the command + an inline script.
 */
function makeCounterAdapter(counterFile, options = {}) {
  const { exitCode = 0, stdoutPrefix = 'OK' } = options;
  return {
    name: 'fake-counter',
    command: process.execPath,
    stdinMode: 'none',
    args: (input, _opts) => [
      '-e',
      `
        const fs = require('node:fs');
        const file = ${JSON.stringify(counterFile)};
        const n = parseInt(fs.readFileSync(file, 'utf-8')) + 1;
        fs.writeFileSync(file, String(n));
        console.log(${JSON.stringify(stdoutPrefix)} + ":invocation " + n);
        console.log("INPUT:" + ${JSON.stringify(input.slice(0, 50))});
        process.exit(${exitCode});
      `,
    ],
    envPreflight: () => ({ ok: true, missing: [] }),
    timeoutMs: () => 30_000,
    parseResult: (raw) => {
      if (raw.exitCode === 0 && raw.stdout) {
        return { text: raw.stdout, status: 'success' };
      }
      return { text: raw.stdout, status: 'unknown-fail', error: `exit ${raw.exitCode}` };
    },
  };
}

function makeKimiPublicFixture() {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-kimi-public-'));
  const hopperDir = join(tmp, '.hopper');
  const handoffsDir = join(hopperDir, 'handoffs');
  const binDir = join(tmp, 'fake-bin');
  const counterFile = join(tmp, 'kimi-count.txt');
  const fakeScript = join(tmp, 'fake-kimi.js');
  mkdirSync(join(hopperDir, 'tasks'), { recursive: true });
  mkdirSync(handoffsDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(counterFile, '0');
  writeFileSync(join(hopperDir, 'queue.md'), [
    '| ID | Task-type | Status | Depends | Brief |',
    '|----|-----------|--------|---------|-------|',
    '| T-KIMI-PUBLIC | code-impl | pending | | read-only audit of routing |',
    '',
  ].join('\n'));
  writeFileSync(join(hopperDir, 'tasks', 'code-impl.md'), '# code-impl\n');
  writeFileSync(join(hopperDir, 'AGENTS.md'), [
    '## Active Agent Instances',
    '',
    '| Nickname | UUID | Vendor | Default invocation |',
    '|----------|------|--------|--------------------|',
    '| `builder` | `1` | kimi | `kimi` |',
    '',
    '## Task-type → vendor default preference',
    '',
    '| Task-type | Default vendor |',
    '|---|---|',
    '| `code-impl` | builder |',
    '',
    // v0.40.0 made this section a fail-closed gate: without it, EVERY dispatch is
    // refused with E_APPROVED_VENDORS_SECTION_MISSING. This fixture predates that
    // release and was not migrated with it, so these tests sat red from 2026-07-31
    // until 2026-08-03 — unnoticed because `npm test` only globs tests/unit/, so
    // nothing ever ran them. (The same release broke this repo's own dogfood
    // .hopper/AGENTS.md for the same reason: nothing exercised it either.)
    '## Approved Vendors',
    '',
    '| Vendor | Approved | Approved by | Date | Scope / Notes |',
    '|---|---|---|---|---|',
    '| `kimi` | yes | fixture | 2026-08-03 | the only vendor this fixture dispatches to |',
    '',
  ].join('\n'));
  writeFileSync(fakeScript, [
    "const fs = require('node:fs');",
    'const file = process.env.HOPPER_TEST_KIMI_COUNTER;',
    "const n = Number.parseInt(fs.readFileSync(file, 'utf-8'), 10) + 1;",
    "fs.writeFileSync(file, String(n));",
    "process.stdout.write('FAKE_KIMI_OK\\n');",
    '',
  ].join('\n'));
  if (process.platform === 'win32') {
    writeFileSync(join(binDir, 'kimi.cmd'), '@echo off\r\n"%HOPPER_TEST_NODE%" "%HOPPER_TEST_KIMI_SCRIPT%" %*\r\n');
  } else {
    const fake = join(binDir, 'kimi');
    writeFileSync(fake, '#!/bin/sh\n"$HOPPER_TEST_NODE" "$HOPPER_TEST_KIMI_SCRIPT" "$@"\n');
    chmodSync(fake, 0o755);
  }
  return { tmp, hopperDir, handoffsDir, binDir, counterFile, fakeScript };
}

async function withFakeKimiOnPath(fixture, fn) {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  const previous = {
    path: process.env[pathKey],
    counter: process.env.HOPPER_TEST_KIMI_COUNTER,
    node: process.env.HOPPER_TEST_NODE,
    script: process.env.HOPPER_TEST_KIMI_SCRIPT,
  };
  process.env[pathKey] = `${fixture.binDir}${delimiter}${previous.path || ''}`;
  process.env.HOPPER_TEST_KIMI_COUNTER = fixture.counterFile;
  process.env.HOPPER_TEST_NODE = process.execPath;
  process.env.HOPPER_TEST_KIMI_SCRIPT = fixture.fakeScript;
  try {
    return await fn();
  } finally {
    if (previous.path === undefined) delete process.env[pathKey]; else process.env[pathKey] = previous.path;
    if (previous.counter === undefined) delete process.env.HOPPER_TEST_KIMI_COUNTER; else process.env.HOPPER_TEST_KIMI_COUNTER = previous.counter;
    if (previous.node === undefined) delete process.env.HOPPER_TEST_NODE; else process.env.HOPPER_TEST_NODE = previous.node;
    if (previous.script === undefined) delete process.env.HOPPER_TEST_KIMI_SCRIPT; else process.env.HOPPER_TEST_KIMI_SCRIPT = previous.script;
  }
}

test('executeDispatch public sync entry rejects effective Kimi read-only before spawn or artifact', async () => {
  const fixture = makeKimiPublicFixture();
  try {
    await withFakeKimiOnPath(fixture, async () => {
      await assert.rejects(
        () => executeDispatch({ hopperDir: fixture.hopperDir, taskId: 'T-KIMI-PUBLIC' }),
        (err) => err.code === 'E_KIMI_READ_ONLY_UNENFORCEABLE' && err.exitCode === 2,
      );
    });
    assert.equal(readFileSync(fixture.counterFile, 'utf-8'), '0', 'fake kimi must not spawn');
    assert.deepEqual(readdirSync(fixture.handoffsDir), [], 'public sync refusal must not create handoff artifacts');
  } finally {
    rmSync(fixture.tmp, { recursive: true, force: true });
  }
});

test('executeDispatch public sync entry permits explicit danger-full-access for Kimi', async () => {
  const fixture = makeKimiPublicFixture();
  try {
    const result = await withFakeKimiOnPath(fixture, () => executeDispatch({
      hopperDir: fixture.hopperDir,
      taskId: 'T-KIMI-PUBLIC',
      adapterOpts: { sandbox: 'danger-full-access' },
    }));
    assert.equal(result.output.status, 'success');
    assert.match(result.output.text, /FAKE_KIMI_OK/);
    assert.equal(readFileSync(fixture.counterFile, 'utf-8'), '1', 'explicit full-access should spawn fake kimi exactly once');
    assert.deepEqual(readdirSync(fixture.handoffsDir), [], 'successful sync call without --write creates no handoff artifact');
  } finally {
    rmSync(fixture.tmp, { recursive: true, force: true });
  }
});

test('executeWithAdapter spawns subprocess EXACTLY ONCE on success path (E2E)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-e2e-success-'));
  try {
    const counterFile = join(tmp, 'count.txt');
    writeFileSync(counterFile, '0');

    const fakeAdapter = makeCounterAdapter(counterFile, { exitCode: 0, stdoutPrefix: 'OK' });

    // Build a minimal "resolved" object (skipping full resolveDispatch which would
    // need temp .hopper/ scaffolding; this directly tests the executeWithAdapter chain)
    const resolved = {
      task: { id: 'T-fake-e2e', taskType: 'code-impl', status: 'pending', depends: [], priority: 'normal', brief: 'e2e', vendor: null },
      vendor: 'fake-counter',
      composedPrompt: 'pretend this is a real task spec',
      frame: '',
      taskSpec: '',
    };

    const result = await executeWithAdapter({ resolved, adapter: fakeAdapter });

    assert.equal(result.output.status, 'success');
    assert.match(result.output.text, /OK:invocation 1/);

    // CRITICAL: counter MUST be exactly 1
    const finalCount = parseInt(readFileSync(counterFile, 'utf-8'));
    assert.equal(finalCount, 1,
      `executeWithAdapter must spawn EXACTLY ONCE; counter == ${finalCount}. ` +
      `If >1, hidden retry/respawn logic exists somewhere in dispatch chain.`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('executeWithAdapter spawns subprocess EXACTLY ONCE on failure path (E2E)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-e2e-fail-'));
  try {
    const counterFile = join(tmp, 'count.txt');
    writeFileSync(counterFile, '0');

    const fakeAdapter = makeCounterAdapter(counterFile, { exitCode: 1, stdoutPrefix: 'FAIL' });

    const resolved = {
      task: { id: 'T-fake-fail', taskType: 'code-impl', status: 'pending', depends: [], priority: 'normal', brief: 'e2e fail', vendor: null },
      vendor: 'fake-counter',
      composedPrompt: 'pretend this fails',
      frame: '',
      taskSpec: '',
    };

    const result = await executeWithAdapter({ resolved, adapter: fakeAdapter });

    assert.notEqual(result.output.status, 'success', 'fake adapter exits 1; must not be classified success');

    // CRITICAL: counter MUST still be exactly 1 even though subprocess failed
    // If executeWithAdapter had retry logic, counter would be > 1
    const finalCount = parseInt(readFileSync(counterFile, 'utf-8'));
    assert.equal(finalCount, 1,
      `executeWithAdapter must NOT retry on failure; counter == ${finalCount}. ` +
      `Per spec §3 #4: one dispatch = one subprocess attempt.`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('executeWithAdapter aborts BEFORE spawn when envPreflight returns ok=false', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-e2e-preflight-'));
  try {
    const counterFile = join(tmp, 'count.txt');
    writeFileSync(counterFile, '0');

    const fakeAdapter = makeCounterAdapter(counterFile);
    // Override envPreflight to return not-ok
    fakeAdapter.envPreflight = () => ({ ok: false, missing: ['SIMULATED_PREFLIGHT_FAIL'] });

    const resolved = {
      task: { id: 'T-fake-preflight-fail', taskType: 'code-impl', status: 'pending', depends: [], priority: 'normal', brief: '', vendor: null },
      vendor: 'fake-counter',
      composedPrompt: 'should not be sent',
      frame: '',
      taskSpec: '',
    };

    const result = await executeWithAdapter({ resolved, adapter: fakeAdapter });

    assert.equal(result.output.status, 'auth-fail');
    assert.match(result.output.error, /SIMULATED_PREFLIGHT_FAIL/);

    // CRITICAL: counter MUST be 0 — subprocess never spawned
    const finalCount = parseInt(readFileSync(counterFile, 'utf-8'));
    assert.equal(finalCount, 0,
      `executeWithAdapter must abort BEFORE spawn on preflight fail; counter == ${finalCount}. ` +
      `If >0, the preflight gate is broken.`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('executeWithAdapter aborts BEFORE vendor spawn when subject-root is not effectively read-only', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-e2e-subject-sandbox-'));
  try {
    const counterFile = join(tmp, 'count.txt');
    const subject = join(tmp, 'subject');
    writeFileSync(counterFile, '0');
    mkdirSync(subject);
    const adapter = makeCounterAdapter(counterFile);
    const resolved = {
      task: { id: 'T-fake-subject-sandbox', taskType: 'code-impl', status: 'pending', depends: [], priority: 'normal', brief: 'e2e', vendor: null },
      vendor: 'fake-counter', composedPrompt: 'must not run', frame: '', taskSpec: '',
    };
    await assert.rejects(
      () => executeWithAdapter({ resolved, adapter, adapterOpts: { sandbox: 'workspace-write', subjectRoot: subject } }),
      /effective sandbox.*read-only/i,
    );
    assert.equal(readFileSync(counterFile, 'utf-8'), '0');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('multiple executeWithAdapter calls each spawn independently (no cross-call state)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-e2e-multi-'));
  try {
    const counterFile = join(tmp, 'count.txt');
    writeFileSync(counterFile, '0');

    const fakeAdapter = makeCounterAdapter(counterFile);
    const resolved = {
      task: { id: 'T-fake-multi', taskType: 'code-impl', status: 'pending', depends: [], priority: 'normal', brief: '', vendor: null },
      vendor: 'fake-counter',
      composedPrompt: 'task',
      frame: '',
      taskSpec: '',
    };

    // 5 sequential executeWithAdapter calls
    for (let i = 0; i < 5; i++) {
      await executeWithAdapter({ resolved, adapter: fakeAdapter });
    }

    const finalCount = parseInt(readFileSync(counterFile, 'utf-8'));
    assert.equal(finalCount, 5,
      `5 calls must produce 5 invocations; got ${finalCount}. ` +
      `If <5, there is hidden memoization/caching in the dispatch chain.`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
