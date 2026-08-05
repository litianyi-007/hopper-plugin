// Direct-execution guard tests.
// Anchor: tests/unit/entry-guard.test.js
//
// The guard decides whether `main()` runs. Both ways of getting it wrong exit 0
// with ZERO output, which automation reads as success — so this file exists to
// make sure the next edit to that one-liner cannot ship silently. It is the test
// coverage whose absence let the bug survive from before 0.37.0 to 0.46.0.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDirectInvocation } from '../../cli/src/path-resolve.js';

const BIN = fileURLToPath(new URL('../../cli/bin/hopper-dispatch', import.meta.url));

// ─── unit: the predicate ─────────────────────────────────────────────────────

test('isDirectInvocation: same file compares true', () => {
  assert.equal(isDirectInvocation(BIN, BIN), true);
});

test('isDirectInvocation: different files compare false (must stay strict)', () => {
  // cli/bin/hopper-dispatch is IMPORTED by model-attestation-contract.test.js for
  // parseProbeCacheRecoveryArgs. A false positive here would run main() inside the
  // test process, so this direction matters more than the permissive one.
  const other = fileURLToPath(new URL('../../cli/src/setup.js', import.meta.url));
  assert.equal(isDirectInvocation(other, BIN), false);
  assert.equal(isDirectInvocation(BIN, other), false);
});

test('isDirectInvocation: missing argv[1] or filename is never direct', () => {
  assert.equal(isDirectInvocation(undefined, BIN), false);
  assert.equal(isDirectInvocation('', BIN), false);
  assert.equal(isDirectInvocation(BIN, undefined), false);
});

test('isDirectInvocation: a link resolving to the module file compares true', () => {
  // Failure mode 1 — the shipped 0.46.0 bug. argv[1] is the link, import.meta.url
  // is already realpath-resolved, and path.resolve() does not follow links.
  const realpath = (p) => (p.includes('linked') ? BIN : p);
  assert.equal(isDirectInvocation('/somewhere/linked-dispatch', BIN, { realpath }), true);
});

test('isDirectInvocation: win32 folds path case; POSIX does not', () => {
  // Failure mode 2. realpathSync on win32 does NOT normalize casing — it echoes back
  // the caller's casing per directory component (verified against the real FS). Two
  // launchers can therefore hand over the same file under different casing.
  const upper = BIN.toUpperCase();
  const identity = (p) => p;

  assert.equal(
    isDirectInvocation(upper, BIN, { realpath: identity, platform: 'win32' }), true,
    'win32 must treat case-differing paths as the same file',
  );
  assert.equal(
    isDirectInvocation(upper, BIN, { realpath: identity, platform: 'linux' }), false,
    'POSIX filesystems are genuinely case-sensitive — folding there would risk running main() on a different file',
  );
});

test('isDirectInvocation: a throwing realpath degrades to lexical compare, never throws', () => {
  // Both realpath calls are individually guarded. An unguarded one would throw at
  // module top level and kill the CLI with a bare stack trace, bypassing its own
  // error handling entirely.
  const boom = () => { throw new Error('EACCES'); };
  assert.doesNotThrow(() => isDirectInvocation(BIN, BIN, { realpath: boom }));
  assert.equal(isDirectInvocation(BIN, BIN, { realpath: boom }), true, 'lexical fallback still matches identical paths');
  assert.equal(isDirectInvocation('/a/x', '/b/y', { realpath: boom }), false, 'and still separates different ones');
});

test('isDirectInvocation: realpath failing on only one side does not throw', () => {
  const halfBoom = (p) => { if (p.includes('bin')) throw new Error('ENOENT'); return p; };
  assert.doesNotThrow(() => isDirectInvocation(BIN, BIN, { realpath: halfBoom }));
});

// ─── integration: the real CLI ───────────────────────────────────────────────

test('CLI: direct invocation produces output (not a silent exit 0)', () => {
  const out = execFileSync(process.execPath, [BIN, '--help'], { encoding: 'utf-8', timeout: 60_000 });
  assert.match(out, /hopper-dispatch v/, 'direct invocation must print the usage banner');
});

test('CLI: invocation through a symlink produces output', (t) => {
  // THE regression. Live-reproduced on the shipped 0.46.0: calling through the
  // npm-global link printed nothing and exited 0, while the same call through the
  // realpath printed the banner. Windows needs Developer Mode or admin to create a
  // file symlink, so skip rather than fail where the OS forbids it.
  const dir = mkdtempSync(join(tmpdir(), 'hopper-entry-guard-'));
  const link = join(dir, 'linked-dispatch');
  try {
    try {
      symlinkSync(BIN, link, 'file');
    } catch (err) {
      t.skip(`cannot create a symlink here (${err.code})`);
      return;
    }
    const out = execFileSync(process.execPath, [link, '--help'], { encoding: 'utf-8', timeout: 60_000 });
    assert.ok(out.trim().length > 0, 'symlink invocation must not be a silent no-op');
    assert.match(out, /hopper-dispatch v/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: importing the bin does NOT run main()', async () => {
  // The permissive fixes above must not make the guard fire on import.
  const mod = await import('../../cli/bin/hopper-dispatch');
  assert.equal(typeof mod.parseProbeCacheRecoveryArgs, 'function', 'the bin still exports its testable helper');
});
