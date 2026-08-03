// ISSUE-resolve-ignores-vendor-override.md fix.
// Anchor: tests/unit/resolve-vendor-override.test.js
//
// `--resolve <task-id> --vendor <v>` used to silently ignore --vendor and print
// the AGENTS.md/queue.md routing result instead of the override (confirmed for
// BOTH argv orders — --vendor before AND after --resolve). Root cause: the
// --resolve branch in cli/bin/hopper-dispatch called runResolve(hopperDir,
// taskId) without ever reading --vendor. The fix threads vendorOverride into
// resolveDispatch() — the same resolution formula (dispatch.js:72
// `vendorOverride || resolveVendor(...)`) and the same assertVendorApproved
// gate (dispatch.js:77) a real dispatch applies — plus the host!=vendor family
// separation guard runDispatch/runBackgroundDispatch apply right after
// resolveDispatch returns (cli/src/validation.js's validateHostVendorSeparation).
//
// All tests here pin HOPPER_HOST_VENDOR to an unrecognized, family-less value
// so the host!=vendor guard stays a no-op notice regardless of the ambient
// environment these tests happen to run under (e.g. inside a Claude Code
// session, which sets CLAUDECODE=1 and would otherwise make resolveHostIdentity()
// self-detect 'claude-code' / the 'anthropic' family).

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
const NEUTRAL_HOST_ENV = { HOPPER_HOST_VENDOR: 'test-harness-neutral-host' };

function runCli(args, { hopperDir, env = {} } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [DISPATCH, ...args], {
      env: { ...process.env, HOPPER_DIR: hopperDir, ...NEUTRAL_HOST_ENV, ...env },
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

/**
 * routedVendor: what queue.md's Vendor column names (what a plain --resolve
 * with no override would print). approvedVendors: the full Approved Vendors
 * table contents — deliberately does NOT always include every registered
 * adapter, so the "override to an unapproved vendor" test can omit one.
 */
function makeHopper({ routedVendor = 'codex', approvedVendors = ['codex', 'grok'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hopper-resolve-override-'));
  const hopperDir = join(root, '.hopper');
  mkdirSync(join(hopperDir, 'tasks'), { recursive: true });
  mkdirSync(join(hopperDir, 'handoffs'), { recursive: true });
  writeFileSync(join(hopperDir, 'queue.md'), [
    '| ID | Task-type | Status | Vendor |',
    '|----|-----------|--------|--------|',
    `| T-RVO | code-impl | pending | ${routedVendor} |`,
    '',
  ].join('\n'));
  writeFileSync(join(hopperDir, 'tasks', 'code-impl.md'), '# code-impl\n\nDo the work described in the spec.\n');
  const approvedRows = approvedVendors.map((v) => `| \`${v}\` | yes |`).join('\n');
  writeFileSync(join(hopperDir, 'AGENTS.md'), [
    '## Approved Vendors',
    '',
    '| Vendor | Approved |',
    '|---|---|',
    approvedRows,
    '',
    '## Task-type → vendor default preference',
    '',
    '| Task-type | Default vendor |',
    '|---|---|',
    `| \`code-impl\` | ${routedVendor} |`,
    '',
  ].join('\n'));
  return { root, hopperDir };
}

// ─── 1. override to an APPROVED vendor wins over routing ──────────────────

test('--resolve <id> --vendor <approved-other> prints the OVERRIDE, not the routed vendor (vendor AFTER task-id)', () => {
  const { root, hopperDir } = makeHopper({ routedVendor: 'codex', approvedVendors: ['codex', 'grok'] });
  try {
    const r = runCli(['--resolve', 'T-RVO', '--vendor', 'grok'], { hopperDir });
    assert.equal(r.exitCode, 0, `expected success, got stderr: ${r.stderr}`);
    assert.match(r.stdout, /Vendor:\s+grok\b/);
    assert.doesNotMatch(r.stdout, /Vendor:\s+codex\b/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--vendor <approved-other> --resolve <id> also applies the override (vendor BEFORE task-id) — both broken positions from the issue', () => {
  const { root, hopperDir } = makeHopper({ routedVendor: 'codex', approvedVendors: ['codex', 'grok'] });
  try {
    const r = runCli(['--vendor', 'grok', '--resolve', 'T-RVO'], { hopperDir });
    assert.equal(r.exitCode, 0, `expected success, got stderr: ${r.stderr}`);
    assert.match(r.stdout, /Vendor:\s+grok\b/);
    assert.doesNotMatch(r.stdout, /Vendor:\s+codex\b/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── 2. override to an UNAPPROVED (but registered) vendor is rejected ─────

test('--resolve <id> --vendor <unapproved> is rejected with E_VENDOR_NOT_APPROVED (vendor AFTER task-id)', () => {
  // 'kimi' is a real registered adapter but is NOT in the Approved Vendors table below —
  // this must fail the SAME Approved Vendors gate a real dispatch would hit, not a
  // registered-adapter check (kimi is perfectly valid as an adapter id).
  const { root, hopperDir } = makeHopper({ routedVendor: 'codex', approvedVendors: ['codex', 'grok'] });
  try {
    const r = runCli(['--resolve', 'T-RVO', '--vendor', 'kimi'], { hopperDir });
    assert.notEqual(r.exitCode, 0);
    assert.match(r.stderr, /E_VENDOR_NOT_APPROVED/);
    assert.match(r.stderr, /kimi/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--vendor <unapproved> --resolve <id> is also rejected with E_VENDOR_NOT_APPROVED (vendor BEFORE task-id)', () => {
  const { root, hopperDir } = makeHopper({ routedVendor: 'codex', approvedVendors: ['codex', 'grok'] });
  try {
    const r = runCli(['--vendor', 'kimi', '--resolve', 'T-RVO'], { hopperDir });
    assert.notEqual(r.exitCode, 0);
    assert.match(r.stderr, /E_VENDOR_NOT_APPROVED/);
    assert.match(r.stderr, /kimi/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--resolve <id> --vendor <unregistered-adapter> is rejected before any Approved Vendors lookup', () => {
  // Distinguishes the registered-adapter gate (CLI-level, exit 2, plain "unknown
  // vendor" message) from the Approved Vendors gate (exit 1, E_VENDOR_NOT_APPROVED)
  // — real dispatch (--vendor on the sync/background path) checks registration
  // FIRST, before resolveDispatch/assertVendorApproved ever run; --resolve must
  // mirror that order.
  const { root, hopperDir } = makeHopper({ routedVendor: 'codex', approvedVendors: ['codex', 'grok'] });
  try {
    const r = runCli(['--resolve', 'T-RVO', '--vendor', 'not-a-real-vendor'], { hopperDir });
    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /unknown vendor 'not-a-real-vendor'/);
    assert.doesNotMatch(r.stderr, /E_VENDOR_NOT_APPROVED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── 3. no override: unchanged regression behavior ────────────────────────

test('--resolve <id> with NO --vendor still prints the routed vendor (regression: pre-fix behavior preserved)', () => {
  const { root, hopperDir } = makeHopper({ routedVendor: 'codex', approvedVendors: ['codex', 'grok'] });
  try {
    const r = runCli(['--resolve', 'T-RVO'], { hopperDir });
    assert.equal(r.exitCode, 0, `expected success, got stderr: ${r.stderr}`);
    assert.match(r.stdout, /Vendor:\s+codex\b/);
    // No override marker when there was no override.
    assert.doesNotMatch(r.stdout, /override/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
