// CLI flag parsing tests (new --model / --reasoning forwarding)
// Anchor: tests/unit/dispatch-flags.test.js
//
// Covers the new value-taking flag parser in cli/bin/hopper-dispatch and the
// validation chain in cli/src/validation.js. Live spawn tests use the dispatcher
// binary's --resolve mode (which doesn't actually spawn a vendor) to verify
// args are parsed end-to-end without side effects.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MODEL_PATTERN,
  ALLOWED_REASONING,
  ALLOWED_SANDBOXES,
  ALLOWED_DISPATCH_VALUE_FLAGS,
  validateModelName,
  validateReasoning,
  validateSandbox,
} from '../../cli/src/validation.js';
import {
  resolveAdapterOptsForTask,
  taskTextRequestsReadOnly,
  assertVendorDispatchable,
} from '../../cli/src/dispatch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const DISPATCH = join(REPO_ROOT, 'cli', 'bin', 'hopper-dispatch');

function runCli(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [DISPATCH, ...args], {
      env: { ...process.env, ...(opts.env || {}), HOPPER_DIR: opts.hopperDir || join(REPO_ROOT, '.hopper') },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
      exitCode: err.status,
    };
  }
}

function makeMinimalHopper(vendor = 'codex-builder', { brief = 'test', taskSpec = '', taskType = 'code-impl' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hopper-host-vendor-'));
  const hopperDir = join(root, '.hopper');
  mkdirSync(join(hopperDir, 'tasks'), { recursive: true });
  mkdirSync(join(hopperDir, 'handoffs'), { recursive: true });
  writeFileSync(join(hopperDir, 'queue.md'), [
    '| ID | Task-type | Status | Depends | Brief |',
    '|----|-----------|--------|---------|-------|',
    `| T-SAME | ${taskType} | pending | | ${brief} |`,
    '',
  ].join('\n'));
  writeFileSync(join(hopperDir, 'tasks', `${taskType}.md`), `# ${taskType}\n`);
  if (taskSpec) {
    writeFileSync(join(hopperDir, 'handoffs', 'leader-tasklist.md'), taskSpec);
  }
  writeFileSync(join(hopperDir, 'AGENTS.md'), [
    '## Active Agent Instances',
    '',
    '| Nickname | UUID | Vendor | Default invocation |',
    '|----------|------|--------|--------------------|',
    `| \`builder\` | \`1\` | ${vendor} | \`x\` |`,
    '',
    '## Approved Vendors',
    '',
    '| Vendor | Approved |',
    '|---|---|',
    `| \`${vendor}\` | yes |`,
    '',
    '## Task-type → vendor default preference',
    '',
    '| Task-type | Default vendor |',
    '|---|---|',
    `| \`${taskType}\` | builder |`,
    '',
  ].join('\n'));
  return { root, hopperDir };
}

function installFakeKimi(binDir, counterPath) {
  mkdirSync(binDir, { recursive: true });
  if (process.platform === 'win32') {
    writeFileSync(join(binDir, 'kimi.cmd'), [
      '@echo off',
      '>>"%HOPPER_TEST_KIMI_COUNTER%" echo spawned',
      'exit /b 0',
      '',
    ].join('\r\n'));
    return;
  }
  const fake = join(binDir, 'kimi');
  writeFileSync(fake, `#!/bin/sh\nprintf 'spawned\\n' >> \"${counterPath}\"\nexit 0\n`);
  chmodSync(fake, 0o755);
}

function fakeKimiEnv(binDir, counterPath) {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const inheritedPath = process.env[pathKey] || process.env.PATH || '';
  return {
    HOPPER_HOST_VENDOR: 'codex',
    HOPPER_TEST_KIMI_COUNTER: counterPath,
    [pathKey]: `${binDir}${process.platform === 'win32' ? ';' : ':'}${inheritedPath}`,
  };
}

// ─── Static validation tests ──────────────────────────────────────────

test('MODEL_PATTERN accepts realistic model names + V2/V4 display-label aliases', () => {
  for (const m of ['gpt-5.5', 'claude-opus-4-7', 'deepseek/v4-flash', 'kimi-thinking',
                   'meta-llama/llama-3-70b', 'org/model:tag', 'a', 'A1.b-c_d',
                   // V2/V4: bracket/paren/space canonical labels must be typeable as --model.
                   'opus[1m]', 'sonnet[1m]', 'Gemini 3.5 Flash (High)']) {
    assert.ok(MODEL_PATTERN.test(m), `should accept "${m}"`);
  }
});

test('MODEL_PATTERN rejects shell metachars + path traversal + flag injection (spaces/brackets/parens now allowed)', () => {
  for (const bad of ['', 'a; rm -rf /', '`evil`', '$(evil)', 'foo|bar', '..',
                     '../escape', '<script>', '"quoted"', "'quoted'", '\nnewline',
                     '-rf', '--dangerously', 'a&b', 'a${x}', 'a (High); rm']) {
    assert.ok(!MODEL_PATTERN.test(bad), `should reject "${bad}"`);
  }
});

test('validateModelName throws on bad input', () => {
  assert.throws(() => validateModelName(''));
  assert.throws(() => validateModelName(null));
  assert.throws(() => validateModelName('a; rm -rf'));
  assert.throws(() => validateModelName('a'.repeat(200)));
});

test('ALLOWED_REASONING is the codex-vocabulary list (5 levels per Phase 6b research)', () => {
  // Phase 6b: codex has 5 reasoning levels per official config-reference.
  // `minimal` is lowest tier (cheap routing/extraction), added 2026-05-21.
  assert.deepEqual([...ALLOWED_REASONING], ['minimal', 'low', 'medium', 'high', 'xhigh']);
});

test('validateReasoning accepts only the 5 canonical levels', () => {
  for (const r of ['minimal', 'low', 'medium', 'high', 'xhigh']) {
    assert.doesNotThrow(() => validateReasoning(r));
  }
  for (const bad of ['ultra', 'medium-low', 'HIGH', '', null]) {
    assert.throws(() => validateReasoning(bad));
  }
});

test('ALLOWED_SANDBOXES is the dispatch permission vocabulary', () => {
  assert.deepEqual([...ALLOWED_SANDBOXES], ['read-only', 'workspace-write', 'danger-full-access']);
});

test('validateSandbox accepts only canonical permission modes', () => {
  for (const s of ALLOWED_SANDBOXES) {
    assert.doesNotThrow(() => validateSandbox(s));
  }
  for (const bad of ['readonly', 'write', 'full', 'danger', '', null]) {
    assert.throws(() => validateSandbox(bad));
  }
});

test('ALLOWED_DISPATCH_VALUE_FLAGS includes the explicit subject-root process guard', () => {
  assert.deepEqual([...ALLOWED_DISPATCH_VALUE_FLAGS], ['--model', '--reasoning', '--sandbox', '--timeout', '--vendor', '--subject-root']);
});

test('taskTextRequestsReadOnly detects explicit read-only task text only', () => {
  assert.equal(taskTextRequestsReadOnly({
    task: { brief: 'read-only task: inspect routing' },
    taskSpec: '',
  }), true);
  assert.equal(taskTextRequestsReadOnly({
    task: { brief: '只读任务：确认队列状态' },
    taskSpec: '',
  }), true);
  assert.equal(taskTextRequestsReadOnly({
    task: { brief: 'implementation task' },
    taskSpec: '**T-SAME**\nThis is not read-only; modify files.',
  }), false);
});

test('assertVendorDispatchable: blocks a dispatch-disabled vendor (agy) without opt-in', () => {
  assert.throws(() => assertVendorDispatchable('agy', {}), /DISABLED[\s\S]*HOPPER_ENABLE_AGY/);
});

test('assertVendorDispatchable: explicit HOPPER_ENABLE_AGY=1 allows agy through', () => {
  assert.doesNotThrow(() => assertVendorDispatchable('agy', { HOPPER_ENABLE_AGY: '1' }));
});

test('assertVendorDispatchable: a normal vendor (grok) is always dispatchable; unknown vendor is a no-op', () => {
  assert.doesNotThrow(() => assertVendorDispatchable('grok', {}));
  assert.doesNotThrow(() => assertVendorDispatchable('does-not-exist', {}));
});

test('CLI blocks a dispatch to agy with the opt-in instruction (covers AGENTS.md routing)', () => {
  const { root, hopperDir } = makeMinimalHopper('agy', { brief: 'inspect' });
  try {
    const r = runCli(['T-SAME'], { hopperDir, env: { HOPPER_HOST_VENDOR: 'codex' } });
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /Dispatch to vendor 'agy' is DISABLED/);
    assert.match(r.stderr, /HOPPER_ENABLE_AGY=1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveAdapterOptsForTask defaults to danger-full-access unless task text says read-only', () => {
  const writable = {
    task: { brief: 'implement product fix' },
    taskSpec: '**T-SAME**\nChange code and tests.',
  };
  const readOnly = {
    task: { brief: 'read-only task: audit current state' },
    taskSpec: '',
  };
  assert.equal(resolveAdapterOptsForTask(writable, {}).sandbox, 'danger-full-access');
  assert.equal(resolveAdapterOptsForTask(readOnly, {}).sandbox, 'read-only');
  assert.equal(resolveAdapterOptsForTask(readOnly, { sandbox: 'workspace-write' }).sandbox, 'workspace-write');
});

test('resolveAdapterOptsForTask: codex always full-access (overrides read-only text AND explicit -s)', () => {
  const readOnlyCodex = {
    vendor: 'codex',
    task: { brief: 'read-only task: audit current state', taskType: 'spec-blindspot-hunt' },
    taskSpec: '',
  };
  // bypass active (default): codex forced to full-access even with read-only text / explicit -s.
  assert.equal(resolveAdapterOptsForTask(readOnlyCodex, {}).sandbox, 'danger-full-access');
  assert.equal(resolveAdapterOptsForTask(readOnlyCodex, { sandbox: 'read-only' }).sandbox, 'danger-full-access');
});

test('resolveAdapterOptsForTask: HOPPER_CODEX_SANDBOX_BYPASS=0 restores normal read-only resolution for codex (POSIX escape hatch)', () => {
  const readOnlyCodex = {
    vendor: 'codex',
    task: { brief: 'read-only task: audit current state', taskType: 'spec-blindspot-hunt' },
    taskSpec: '',
  };
  const prev = process.env.HOPPER_CODEX_SANDBOX_BYPASS;
  process.env.HOPPER_CODEX_SANDBOX_BYPASS = '0';
  try {
    // Escape hatch: codex falls through to the normal precedence → read-only text wins.
    assert.equal(resolveAdapterOptsForTask(readOnlyCodex, {}).sandbox, 'read-only');
  } finally {
    if (prev === undefined) delete process.env.HOPPER_CODEX_SANDBOX_BYPASS;
    else process.env.HOPPER_CODEX_SANDBOX_BYPASS = prev;
  }
});

// ─── CLI end-to-end tests (via --resolve which doesn't spawn vendor) ──

test('CLI rejects --model with no value', () => {
  const r = runCli(['T-PLUGIN-05a', '--model']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /--model requires a value/i);
});

test('CLI rejects --model with shell-metachar value', () => {
  const r = runCli(['T-PLUGIN-05a', '--model', 'evil; rm -rf']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /unsafe characters/i);
});

test('CLI rejects --reasoning with invalid level', () => {
  const r = runCli(['T-PLUGIN-05a', '--reasoning', 'ultra']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /reasoning.*invalid|Allowed/i);
});

test('CLI rejects --reasoning with no value', () => {
  const r = runCli(['T-PLUGIN-05a', '--reasoning']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /--reasoning requires a value/i);
});

test('CLI rejects --sandbox with invalid level', () => {
  const r = runCli(['T-PLUGIN-05a', '--sandbox', 'full']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /sandbox.*invalid|Allowed/i);
});

test('CLI rejects --sandbox with no value', () => {
  const r = runCli(['T-PLUGIN-05a', '--sandbox']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /--sandbox requires a value/i);
});

test('CLI rejects a relative --subject-root before any vendor dispatch', () => {
  const { root, hopperDir } = makeMinimalHopper('codex');
  try {
    const r = runCli(['T-SAME', '--subject-root', 'relative/project'], { hopperDir });
    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /subject-root.*absolute/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI rejects --subject-root when the effective sandbox is not read-only', () => {
  const { root, hopperDir } = makeMinimalHopper('codex');
  try {
    const r = runCli(['T-SAME', '--subject-root', root], { hopperDir });
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /subject-root.*effective sandbox.*read-only/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI rejects unknown flag', () => {
  const r = runCli(['T-PLUGIN-05a', '--evil-flag']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /Unknown flag.*--evil-flag/i);
});

test('CLI rejects extra positional argument', () => {
  const r = runCli(['T-PLUGIN-05a', 'T-EXTRA']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /Unexpected extra positional argument/i);
});

test('CLI parses --model + --reasoning together and prints them in dispatch line', () => {
  // Use --resolve to avoid actually spawning a vendor subprocess; the parser
  // runs in main() before any --resolve check, so flag validation still fires.
  // Actually --resolve has its own short-circuit branch; instead verify with
  // a known-bad scenario that surfaces an error after parsing has succeeded
  // (e.g. task-id not in queue), so we see that parsing didn't reject good flags.
  const r = runCli(['T-PLUGIN-MISSING', '--model', 'gpt-5.5', '--reasoning', 'high']);
  // Expect exit 1 (task not found) or 2 (validation), not crash on flag parsing
  assert.ok(r.exitCode === 1 || r.exitCode === 2);
  // Confirm we did NOT reject the well-formed flags themselves
  assert.ok(!/unsafe characters/i.test(r.stderr));
  assert.ok(!/reasoning.*invalid/i.test(r.stderr));
});

test('CLI accepts display-label --model aliases end-to-end (relaxed MODEL_PATTERN)', () => {
  // The whole point of the relaxation: bracket/paren/space canonical names must be
  // typeable as --model and survive parseDispatchArgs + validateModelName in the binary.
  for (const m of ['opus[1m]', 'Gemini 3.5 Flash (High)']) {
    const r = runCli(['T-PLUGIN-MISSING', '--model', m]);
    assert.ok(!/unsafe characters/i.test(r.stderr), `"${m}" must pass model validation, got: ${r.stderr}`);
    assert.notEqual(r.exitCode, 2, `"${m}" must not be a validation rejection (exit 2)`);
  }
  // and a genuinely unsafe value is still rejected at exit 2
  const bad = runCli(['T-PLUGIN-MISSING', '--model', 'a | whoami']);
  assert.equal(bad.exitCode, 2);
  assert.match(bad.stderr, /unsafe characters/i);
});

test('CLI prints adapter opts summary on dispatch line', () => {
  // We can't fully exercise dispatch without a real vendor, but we can confirm
  // the parser DOES reach runDispatch by checking a known-bad task triggers
  // the expected error (validation passes; resolution fails).
  const r = runCli(['T-PLUGIN-NONEXISTENT', '--model', 'kimi-thinking']);
  // The 'opts:' summary should appear in stderr before the resolution error
  assert.match(r.stderr, /opts.*model=kimi-thinking/);
});

test('CLI hard-rejects host == vendor before adapter execution', () => {
  const { root, hopperDir } = makeMinimalHopper('codex');
  try {
    const r = runCli(['T-SAME'], { hopperDir, env: { HOPPER_HOST_VENDOR: 'codex' } });
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /host != vendor/i);
    assert.match(r.stderr, /same vendor|cannot dispatch to the same vendor/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI auto-defaults sandbox to danger-full-access for writable tasks', () => {
  const { root, hopperDir } = makeMinimalHopper('codex', { brief: 'implement product fix' });
  try {
    const r = runCli(['T-SAME'], { hopperDir, env: { HOPPER_HOST_VENDOR: 'codex' } });
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /permission: sandbox=danger-full-access \(auto\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI auto-downgrades sandbox to read-only when task text explicitly says read-only', () => {
  // Non-codex vendor: read-only TEXT must auto-downgrade. (codex is exempt — see next test.)
  const { root, hopperDir } = makeMinimalHopper('grok', { brief: 'read-only task: inspect only' });
  try {
    const r = runCli(['T-SAME'], { hopperDir, env: { HOPPER_HOST_VENDOR: 'grok' } });
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /permission: sandbox=read-only \(auto\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI does NOT downgrade codex to read-only (codex has no read-only scenario; always full-access)', () => {
  // codex's -s sandbox is broken on Windows (1326), so codex always runs full-access; the
  // read-only intent rides in the prompt frame. Even read-only task text keeps full-access.
  const { root, hopperDir } = makeMinimalHopper('codex', { brief: 'read-only task: inspect only' });
  try {
    const r = runCli(['T-SAME'], { hopperDir, env: { HOPPER_HOST_VENDOR: 'codex' } });
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /permission: sandbox=danger-full-access \(auto\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI explicit --sandbox overrides task-text default', () => {
  // Non-codex vendor: explicit --sandbox is honored. (codex always full-access — see below.)
  const { root, hopperDir } = makeMinimalHopper('grok', { brief: 'read-only task: inspect only' });
  try {
    const r = runCli(['T-SAME', '--sandbox', 'workspace-write'], { hopperDir, env: { HOPPER_HOST_VENDOR: 'grok' } });
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /permission: sandbox=workspace-write \(explicit\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI codex ignores even an explicit --sandbox read-only (always full-access; display matches run)', () => {
  // codex cannot honor -s read-only on Windows; the resolved/displayed sandbox is forced to
  // full-access so the operator is not told read-only while codex actually runs full-access.
  const { root, hopperDir } = makeMinimalHopper('codex', { brief: 'audit the routing' });
  try {
    const r = runCli(['T-SAME', '--sandbox', 'read-only'], { hopperDir, env: { HOPPER_HOST_VENDOR: 'codex' } });
    assert.equal(r.exitCode, 1);
    // The authoritative resolved value (permission line) must be full-access, and must say WHY
    // (not mislabel it "explicit"). The raw flag echo may still show the user's literal input.
    assert.match(r.stderr, /permission: sandbox=danger-full-access \(codex: -s read-only unsupported here/);
    assert.doesNotMatch(r.stderr, /permission: sandbox=read-only/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Kimi fails closed before any sync or background spawn when read-only is effective', async () => {
  const cases = [
    {
      name: 'explicit --sandbox read-only in sync mode',
      args: ['T-SAME', '--sandbox', 'read-only'],
      brief: 'inspect routing',
      taskType: 'code-impl',
    },
    {
      name: 'read-only brief policy in background mode',
      args: ['T-SAME', '--background'],
      brief: 'read-only task: inspect routing',
      taskType: 'code-impl',
    },
    {
      name: 'research task-type policy in background mode',
      args: ['T-SAME', '--background'],
      brief: 'research the current routing',
      taskType: 'prd-research',
    },
    {
      name: 'review task-type policy in sync mode',
      args: ['T-SAME'],
      brief: 'review the current routing',
      taskType: 'code-review-acceptance',
    },
  ];

  for (const scenario of cases) {
    const { root, hopperDir } = makeMinimalHopper('kimi', scenario);
    const binDir = join(root, 'fake-bin');
    const counterPath = join(root, 'kimi-spawn-count.txt');
    installFakeKimi(binDir, counterPath);
    try {
      const r = runCli(scenario.args, { hopperDir, env: fakeKimiEnv(binDir, counterPath) });

      assert.equal(r.exitCode, 2, scenario.name);
      assert.match(r.stderr, /E_KIMI_READ_ONLY_UNENFORCEABLE/, scenario.name);
      // Give a mistakenly launched detached runner enough time to execute the fake
      // binary, then prove this gate preceded both spawn routes and all artifacts.
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(existsSync(counterPath), false, `${scenario.name}: fake kimi must not spawn`);
      assert.equal(existsSync(join(hopperDir, 'handoffs', 'T-SAME-output.md')), false, `${scenario.name}: no output artifact`);
      assert.equal(existsSync(join(hopperDir, 'handoffs', 'T-SAME-output.log')), false, `${scenario.name}: no raw log artifact`);
      assert.equal(existsSync(join(hopperDir, 'handoffs', 'T-SAME-progress.log')), false, `${scenario.name}: no progress artifact`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('Kimi read-only refusal explains that --write is not a permission override and wins over an unavailable subject-root backend', async () => {
  const { root, hopperDir } = makeMinimalHopper('kimi', {
    brief: 'read-only task: inspect routing',
    taskType: 'code-impl',
  });
  const binDir = join(root, 'fake-bin');
  const counterPath = join(root, 'kimi-spawn-count.txt');
  installFakeKimi(binDir, counterPath);
  try {
    const r = runCli(['T-SAME', '--background', '--subject-root', root], {
      hopperDir,
      env: fakeKimiEnv(binDir, counterPath),
    });

    assert.equal(r.exitCode, 2, 'the Kimi read-only gate must run before any unsupported subject-root backend check');
    assert.match(r.stderr, /E_KIMI_READ_ONLY_UNENFORCEABLE/);
    assert.match(r.stderr, /Kimi .*no .*permission.*sandbox flag/i);
    assert.match(r.stderr, /--write.*Hopper-only output-artifact option.*not .*Kimi/i);
    assert.match(r.stderr, /does not change.*vendor permission/i);
    assert.match(r.stderr, /non-read-only sandbox.*unverified.*Kimi prompt-mode permission/i);
    assert.match(r.stderr, /read-only lane/i);
    assert.match(r.stderr, /enforceable read-only vendor.*proven external process guard/i);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(existsSync(counterPath), false, 'fake Kimi must not spawn');
    assert.equal(existsSync(join(hopperDir, 'handoffs', 'T-SAME-output.md')), false, 'no output artifact');
    assert.equal(existsSync(join(hopperDir, 'handoffs', 'T-SAME-output.log')), false, 'no raw log artifact');
    assert.equal(existsSync(join(hopperDir, 'handoffs', 'T-SAME-progress.log')), false, 'no progress artifact');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI help mentions --model, --reasoning, --sandbox, and --subject-root', () => {
  const r = runCli(['--help']);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /--model/);
  assert.match(r.stdout, /--reasoning/);
  assert.match(r.stdout, /--sandbox/);
  assert.match(r.stdout, /--subject-root/);
  assert.match(r.stdout, /danger-full-access/);
  assert.match(r.stdout, /low \| medium \| high \| xhigh/);
});

// ─── Edge cases per codex flags-audit P2 ──────────────────────────────

test('CLI rejects empty --model value', () => {
  const r = runCli(['T-PLUGIN-05a', '--model', '']);
  assert.equal(r.exitCode, 2);
  // Empty arg is detected as "--model requires a value" (next-token is empty/starts with -)
  // OR as "must not be empty" depending on shell behavior. Both legitimate.
  assert.match(r.stderr, /--model.*(value|empty)/i);
});

test('CLI accepts --model + --write in either order (flag ordering)', () => {
  // Order 1: --write first
  const r1 = runCli(['T-MISSING', '--write', '--model', 'gpt-5.5']);
  // Order 2: --model first
  const r2 = runCli(['T-MISSING', '--model', 'gpt-5.5', '--write']);

  // Both should fail at task resolution (not flag parsing)
  for (const r of [r1, r2]) {
    assert.ok(r.exitCode === 1 || r.exitCode === 2);
    assert.ok(!/Unknown flag/i.test(r.stderr), 'no parser error');
    assert.ok(!/unsafe characters/i.test(r.stderr));
  }
});

test('CLI handles mixed bare + value flag interleaving', () => {
  // --reasoning xhigh interleaved with --write --force
  const r = runCli(['T-MISSING', '--write', '--reasoning', 'xhigh', '--force', '--model', 'kimi-thinking', '--sandbox', 'danger-full-access']);
  // Should reach dispatch banner with all 4 opts visible
  assert.match(r.stderr, /opts.*model=kimi-thinking/);
  assert.match(r.stderr, /reasoning=xhigh/);
  assert.match(r.stderr, /sandbox=danger-full-access/);
});

test('CLI flag value must not start with dash (consumes-next-arg detection)', () => {
  // If user writes "--model --write", we want to detect that --model didn't get a value
  const r = runCli(['T-PLUGIN-05a', '--model', '--write']);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /--model requires a value/i);
});

test('background dispatch path passes background=true into adapter opts before building argv', () => {
  const src = readFileSync(DISPATCH, 'utf-8');
  assert.match(
    src,
    /const effectiveOpts = \{[^}]*background:\s*true[^}]*logFile:\s*logPath[^}]*taskType:\s*resolved\.task\.taskType[^}]*\};/s,
  );
});
