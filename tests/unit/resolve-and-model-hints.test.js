// HOPPER-1 + HOPPER-2 feedback fixes.
// Anchor: tests/unit/resolve-and-model-hints.test.js
//
// HOPPER-1: `--resolve` distinguishes an unregistered adapter from a model name
//           accidentally placed in the queue.md Vendor column.
// HOPPER-2: `--model` with no probe cache prints a clear, actionable hint
//           instead of silently saying nothing.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DISPATCH = join(REPO_ROOT, 'cli', 'bin', 'hopper-dispatch');

function runCli(args, { hopperDir, env = {} } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [DISPATCH, ...args], {
      env: { ...process.env, HOPPER_DIR: hopperDir, ...env },
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

function makeHopper({ vendorCell = '', preferenceVendor = 'codex' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hopper-fb-'));
  const hopperDir = join(root, '.hopper');
  mkdirSync(join(hopperDir, 'tasks'), { recursive: true });
  mkdirSync(join(hopperDir, 'handoffs'), { recursive: true });
  // The Brief cell is load-bearing even though these tests are about vendor/model
  // diagnostics: a queued task with an empty Brief AND no leader-tasklist.md entry
  // has no task content at all, and dispatch fails closed on it rather than
  // composing a content-free prompt. Keep a real brief so these fixtures exercise
  // the diagnostics they are named for, not the empty-task guard.
  writeFileSync(join(hopperDir, 'queue.md'), [
    '| ID | Task-type | Status | Vendor | Brief |',
    '|----|-----------|--------|--------|-------|',
    `| T-FB | code-impl | pending | ${vendorCell} | wire the feedback fixes |`,
    '',
  ].join('\n'));
  writeFileSync(join(hopperDir, 'tasks', 'code-impl.md'), '# code-impl\n\nDo the work described in the spec.\n');
  // Approve whichever vendor actually resolves (the row-level Vendor column wins
  // over the AGENTS.md preference when present — same precedence as resolveVendor)
  // so these tests exercise the registered-adapter / model-cache diagnostics
  // downstream, not the separate Approved Vendors gate.
  const resolvedVendor = vendorCell || preferenceVendor;
  writeFileSync(join(hopperDir, 'AGENTS.md'), [
    '## Approved Vendors',
    '',
    '| Vendor | Approved |',
    '|---|---|',
    `| \`${resolvedVendor}\` | yes |`,
    '',
    '## Task-type → vendor default preference',
    '',
    '| Task-type | Default vendor |',
    '|---|---|',
    `| \`code-impl\` | ${preferenceVendor} |`,
    '',
  ].join('\n'));
  return { root, hopperDir };
}

// ─── HOPPER-1 ─────────────────────────────────────────────────────────

test('HOPPER-1: --resolve flags a MODEL name placed in the Vendor column', () => {
  const { root, hopperDir } = makeHopper({ vendorCell: 'gpt-5.5' });
  try {
    const r = runCli(['--resolve', 'T-FB'], { hopperDir });
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /not a registered adapter/i);
    assert.match(r.stderr, /looks like a MODEL/i);
    assert.match(r.stderr, /--model gpt-5\.5/);
    // Resolution detail still printed before the diagnostic.
    assert.match(r.stdout, /Vendor:\s+gpt-5\.5/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('HOPPER-1: --resolve flags a typo (non-model-shaped) adapter name', () => {
  const { root, hopperDir } = makeHopper({ vendorCell: 'codx' });
  try {
    const r = runCli(['--resolve', 'T-FB'], { hopperDir });
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /not a known adapter — likely a typo/i);
    assert.match(r.stderr, /codex/);  // the registered-adapter list is offered
    assert.doesNotMatch(r.stderr, /looks like a MODEL/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('HOPPER-1: --resolve succeeds for a real adapter (no false positive)', () => {
  const { root, hopperDir } = makeHopper({ vendorCell: 'codex' });
  try {
    const r = runCli(['--resolve', 'T-FB'], { hopperDir });
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /Vendor:\s+codex/);
    assert.doesNotMatch(r.stderr, /not a registered adapter/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── HOPPER-2 ─────────────────────────────────────────────────────────

test('HOPPER-2: --model with no probe cache prints a clear hint', () => {
  const { root, hopperDir } = makeHopper({ vendorCell: 'codex' });
  const cacheRoot = mkdtempSync(join(tmpdir(), 'hopper-cache-empty-'));
  try {
    // Empty HOPPER_CACHE_DIR → no cache for codex. Empty PATH → the codex
    // binary won't be found, so dispatch fails fast (exit 127) AFTER the hint
    // is printed — no real vendor is launched and nothing hangs.
    const r = runCli(['T-FB', '--model', 'gpt-9-imaginary'], {
      hopperDir,
      env: { HOPPER_CACHE_DIR: cacheRoot, PATH: '', Path: '' },
    });
    assert.match(r.stderr, /no probed model cache for codex/i);
    assert.match(r.stderr, /--probe codex/);
    assert.match(r.stderr, /omit --model/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});
