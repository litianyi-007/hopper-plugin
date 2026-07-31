// Host self-detection + family-based host!=vendor isomorphism guard.
// Anchor: tests/unit/host-detect.test.js
//
// Covers cli/src/host-detect.js (detectHost / resolveHostIdentity) and the
// VENDOR_FAMILY-based rewrite of validateHostVendorSeparation in
// cli/src/validation.js. Background: Tier B (Claude Code) has NO Tier-C-style
// bash wrapper (hosts/claude-code/bin does not exist), so HOPPER_HOST_VENDOR
// was never set under Claude Code and the old pure-string-equality guard
// silently never ran for it — see cli/src/host-detect.js header for the full
// empirically-confirmed trail (including the CODEX_COMPANION_* trap this suite
// specifically guards against).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectHost, resolveHostIdentity, HOST_CLAUDE_CODE, HOST_UNKNOWN } from '../../cli/src/host-detect.js';
import { validateHostVendorSeparation, VENDOR_FAMILY } from '../../cli/src/validation.js';
import { resolveDispatch } from '../../cli/src/dispatch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const DISPATCH = join(REPO_ROOT, 'cli', 'bin', 'hopper-dispatch');

// ─── detectHost(): pure, fabricated-env unit tests (no ambient-environment risk) ──

test('detectHost: CLAUDECODE marker alone is detected as claude-code', () => {
  assert.equal(detectHost({ CLAUDECODE: '1' }), HOST_CLAUDE_CODE);
});

test('detectHost: CLAUDE_CODE_ENTRYPOINT or CLAUDE_CODE_SESSION_ID alone is also detected as claude-code', () => {
  assert.equal(detectHost({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), HOST_CLAUDE_CODE);
  assert.equal(detectHost({ CLAUDE_CODE_SESSION_ID: 'abc-123' }), HOST_CLAUDE_CODE);
});

test('detectHost: empty/unrelated env is unknown (never guesses)', () => {
  assert.equal(detectHost({}), HOST_UNKNOWN);
  assert.equal(detectHost({ PATH: '/usr/bin', HOME: '/home/x' }), HOST_UNKNOWN);
});

test('detectHost: CODEX_COMPANION_SESSION_ID ALONE must be judged unknown, NOT codex (the trap)', () => {
  // A Codex Claude-Code-plugin sets CODEX_COMPANION_SESSION_ID / _TRANSCRIPT_PATH
  // INSIDE a Claude Code session. This function must never treat "a CODEX_* var
  // exists" as "host is codex" — it doesn't even attempt to self-detect codex
  // (that host has its own deliberate Tier-C wrapper). Absent a Claude Code
  // marker, this must fall through to unknown.
  assert.equal(
    detectHost({ CODEX_COMPANION_SESSION_ID: 'b39f5bf8-f328-41b3-b5fd-eb01a465a399', CODEX_COMPANION_TRANSCRIPT_PATH: '/x.jsonl' }),
    HOST_UNKNOWN
  );
});

test('detectHost: real-world co-occurrence — CLAUDECODE + CODEX_COMPANION_* together still resolves to claude-code', () => {
  // Empirically confirmed live session state (2026-07-31): both var families are
  // present simultaneously (a Codex plugin running inside Claude Code). The
  // Claude Code markers must win because they ARE the ground truth here — the
  // detector must not get confused by the co-occurring CODEX_* noise.
  assert.equal(
    detectHost({
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SESSION_ID: 'b39f5bf8-f328-41b3-b5fd-eb01a465a399',
      CODEX_COMPANION_SESSION_ID: 'b39f5bf8-f328-41b3-b5fd-eb01a465a399',
      CODEX_COMPANION_TRANSCRIPT_PATH: '/x.jsonl',
    }),
    HOST_CLAUDE_CODE
  );
});

// ─── resolveHostIdentity(): explicit env wins over detection ─────────────────

test('resolveHostIdentity: HOPPER_HOST_VENDOR explicit value wins over a co-present CLAUDECODE marker', () => {
  const r = resolveHostIdentity({ HOPPER_HOST_VENDOR: 'codex', CLAUDECODE: '1' });
  assert.deepEqual(r, { id: 'codex', source: 'env' });
});

test('resolveHostIdentity: falls back to self-detection when HOPPER_HOST_VENDOR is unset/empty', () => {
  assert.deepEqual(resolveHostIdentity({ CLAUDECODE: '1' }), { id: HOST_CLAUDE_CODE, source: 'detected' });
  assert.deepEqual(resolveHostIdentity({ HOPPER_HOST_VENDOR: '', CLAUDECODE: '1' }), { id: HOST_CLAUDE_CODE, source: 'detected' });
  assert.deepEqual(resolveHostIdentity({}), { id: HOST_UNKNOWN, source: 'detected' });
});

// ─── validateHostVendorSeparation: family-based comparison ────────────────────

test('VENDOR_FAMILY: claude and the self-detected claude-code host id share the anthropic family', () => {
  assert.equal(VENDOR_FAMILY.claude, 'anthropic');
  assert.equal(VENDOR_FAMILY['claude-code'], 'anthropic');
});

test('host=claude-code + vendor=claude is REJECTED (the case string-equality could never catch)', () => {
  assert.throws(
    () => validateHostVendorSeparation(HOST_CLAUDE_CODE, 'claude'),
    /host != vendor/i
  );
  assert.throws(
    () => validateHostVendorSeparation(HOST_CLAUDE_CODE, 'claude'),
    /cannot dispatch to the same vendor/i
  );
});

test('host=claude-code + vendor=codex is ALLOWED (different family; reverse of the rejection above)', () => {
  const result = validateHostVendorSeparation(HOST_CLAUDE_CODE, 'codex');
  assert.deepEqual(result, { enforced: true });
});

test('host=codex + vendor=claude is ALLOWED (user-preserved case: claude stays a legal vendor for non-Claude-Code hosts)', () => {
  const result = validateHostVendorSeparation('codex', 'claude');
  assert.deepEqual(result, { enforced: true });
});

test('host=unknown + vendor=<anything> is ALLOWED but the output MUST say the check did not run (never silent)', () => {
  const result = validateHostVendorSeparation(HOST_UNKNOWN, 'kimi');
  assert.equal(result.enforced, false);
  assert.match(result.notice, /not recognized/i);
  assert.match(result.notice, /not run/i);
});

test('a host string with no family mapping at all behaves the same as HOST_UNKNOWN (never silently skipped)', () => {
  const result = validateHostVendorSeparation('some-future-host-nobody-mapped-yet', 'codex');
  assert.equal(result.enforced, false);
  assert.match(result.notice, /not recognized/i);
  assert.match(result.notice, /not run/i);
});

test('hostVendor entirely absent (undefined) stays the pre-existing silent standalone path (backward compat)', () => {
  assert.deepEqual(validateHostVendorSeparation(undefined, 'kimi'), { enforced: false });
});

// ─── Composition with the Approved Vendors whitelist (TH-approved-vendors,
// 2026-07-31) — teeth #5: the two gates are independent and neither
// short-circuits the other. Approving `claude` in a project's AGENTS.md must
// NOT exempt it from the host!=vendor isomorphism guard. In-process (not a
// CLI subprocess spawn) so the composition is proven directly against
// resolveDispatch + validateHostVendorSeparation.

test('composition: claude approved in AGENTS.md STILL rejected by host!=vendor for a claude-code host — teeth #5', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hopper-composition-'));
  try {
    const hopperDir = join(root, '.hopper');
    mkdirSync(join(hopperDir, 'tasks'), { recursive: true });
    mkdirSync(join(hopperDir, 'handoffs'), { recursive: true });
    writeFileSync(join(hopperDir, 'queue.md'), [
      '| ID | Task-type | Status | Depends | Brief |',
      '|----|-----------|--------|---------|-------|',
      '| T-SAME | code-impl | pending | | test |',
      '',
    ].join('\n'));
    writeFileSync(join(hopperDir, 'tasks', 'code-impl.md'), '# code-impl\n');
    writeFileSync(join(hopperDir, 'AGENTS.md'), [
      '## Approved Vendors',
      '',
      '| Vendor | Approved |',
      '|---|---|',
      '| `claude` | yes |',   // approved at the project-whitelist layer
      '',
      '## Task-type → vendor default preference',
      '',
      '| Task-type | Default vendor |',
      '|---|---|',
      '| `code-impl` | claude |',
      '',
    ].join('\n'));

    // Layer 1 (Approved Vendors) passes — resolveDispatch does not throw.
    const resolved = await resolveDispatch({ hopperDir, taskId: 'T-SAME' });
    assert.equal(resolved.vendor, 'claude');

    // Layer 2 (host!=vendor isomorphism) is a SEPARATE gate, applied downstream
    // by the caller (hopper-dispatch's runDispatch) using the same resolved
    // vendor. It must still reject a claude-code host — approval at layer 1
    // does not exempt it from layer 2.
    assert.throws(
      () => validateHostVendorSeparation(HOST_CLAUDE_CODE, resolved.vendor),
      /cannot dispatch to the same vendor/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── CLI-level wiring proof (blocking cases only — these throw BEFORE any vendor
// subprocess spawn, so they cannot accidentally invoke a real vendor CLI). ──────

function runCli(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [DISPATCH, ...args], {
      env: { ...process.env, ...(opts.env || {}), HOPPER_DIR: opts.hopperDir },
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

function makeMinimalHopper(vendor) {
  const root = mkdtempSync(join(tmpdir(), 'hopper-host-detect-'));
  const hopperDir = join(root, '.hopper');
  mkdirSync(join(hopperDir, 'tasks'), { recursive: true });
  mkdirSync(join(hopperDir, 'handoffs'), { recursive: true });
  writeFileSync(join(hopperDir, 'queue.md'), [
    '| ID | Task-type | Status | Depends | Brief |',
    '|----|-----------|--------|---------|-------|',
    '| T-SAME | code-impl | pending | | test |',
    '',
  ].join('\n'));
  writeFileSync(join(hopperDir, 'tasks', 'code-impl.md'), '# code-impl\n');
  writeFileSync(join(hopperDir, 'AGENTS.md'), [
    '## Active Agent Instances',
    '',
    '| Nickname | UUID | Vendor | Default invocation |',
    '|----------|------|--------|--------------------|',
    `| \`builder\` | \`1\` | ${vendor} | \`x\` |`,
    '',
    // Approve the vendor under test so these CLI tests exercise ONLY the
    // host!=vendor isomorphism guard, not the separate Approved Vendors gate —
    // this also doubles as the "two gates don't short-circuit each other"
    // proof: `claude` is approved here yet still rejected below by
    // validateHostVendorSeparation for a claude-code host.
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
    '| `code-impl` | builder |',
    '',
  ].join('\n'));
  return { root, hopperDir };
}

test('CLI: explicit HOPPER_HOST_VENDOR=claude-code (simulating self-detection) blocks dispatch to the claude vendor', () => {
  const { root, hopperDir } = makeMinimalHopper('claude');
  try {
    const r = runCli(['T-SAME'], { hopperDir, env: { HOPPER_HOST_VENDOR: 'claude-code' } });
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /host != vendor/i);
    assert.match(r.stderr, /cannot dispatch to the same vendor/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: self-detection wiring — CLAUDECODE marker with NO HOPPER_HOST_VENDOR set also blocks dispatch to claude', () => {
  // Deterministic regardless of the ambient test-runner environment: HOPPER_HOST_VENDOR
  // is forced empty (clearing anything inherited), and CLAUDECODE is forced to '1' so the
  // outcome does not depend on whether this suite happens to be running inside a real
  // Claude Code session or a plain CI shell.
  const { root, hopperDir } = makeMinimalHopper('claude');
  try {
    const r = runCli(['T-SAME'], {
      hopperDir,
      env: { HOPPER_HOST_VENDOR: '', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: '', CLAUDE_CODE_SESSION_ID: '' },
    });
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /host != vendor/i);
    assert.match(r.stderr, /cannot dispatch to the same vendor/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
