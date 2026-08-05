// Vendor binary provenance tests — multi-install detection + the dead-`--setup` regression.
// Anchor: tests/unit/vendor-binaries.test.js
//
// Covers the 2026-08-05 incident (see cli/src/vendor-binaries.js header): a machine
// carrying two codex installs at 0.131.0 and 0.146.0, where hopper silently spawned
// the older one because it came first on PATH, and no hopper surface could show it.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, sep } from 'node:path';

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveCommandOnPath, resolveAllCommandsOnPath } from '../../cli/src/path-resolve.js';
import {
  enumerateVendorBinaries,
  probeBinaryVersions,
  summarizeBinaryDrift,
  formatBinaryReport,
  extractVersion,
} from '../../cli/src/vendor-binaries.js';
import { buildNextSteps, compareVersionDesc } from '../../cli/src/setup.js';

const isWindows = process.platform === 'win32';
// On Windows a PATH walk only matches names carrying a PATHEXT extension.
const EXT = isWindows ? '.CMD' : '';

/** Build a temp PATH with `dirs` fake dirs, each optionally holding `name`. */
function withFakePath(layout, fn) {
  const root = mkdtempSync(join(tmpdir(), 'hopper-binprov-'));
  const prevPath = process.env.PATH;
  const prevExt = process.env.PATHEXT;
  try {
    const dirs = [];
    for (const [dirName, files] of Object.entries(layout)) {
      const dir = join(root, dirName);
      mkdirSync(dir, { recursive: true });
      for (const f of files) {
        const p = join(dir, f);
        writeFileSync(p, '#!/bin/sh\necho fake\n', { mode: 0o755 });
      }
      dirs.push(dir);
    }
    if (isWindows) process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    process.env.PATH = dirs.join(delimiter);
    return fn({ root, dirs });
  } finally {
    process.env.PATH = prevPath;
    if (prevExt === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = prevExt;
    rmSync(root, { recursive: true, force: true });
  }
}

// ─── resolveAllCommandsOnPath ────────────────────────────────────────────────

test('resolveAllCommandsOnPath: first hit matches resolveCommandOnPath (shared-semantics guard)', () => {
  // resolveCommandOnPath sits on the SPAWN path and is deliberately NOT refactored
  // to share code with the walker. This test is what keeps the two from diverging.
  withFakePath({ a: [`tool${EXT}`], b: [`tool${EXT}`] }, () => {
    const all = resolveAllCommandsOnPath('tool');
    const first = resolveCommandOnPath('tool');
    assert.equal(all.length, 2, 'both installs enumerated');
    assert.ok(first && first.resolvedPath, 'single-resolver found it');
    assert.equal(all[0].resolvedPath, first.resolvedPath, 'walker[0] === resolver pick');
  });
});

test('resolveAllCommandsOnPath: PATH order is preserved', () => {
  withFakePath({ first: [`tool${EXT}`], second: [`tool${EXT}`] }, ({ dirs }) => {
    const all = resolveAllCommandsOnPath('tool');
    assert.equal(all[0].dir, dirs[0]);
    assert.equal(all[1].dir, dirs[1]);
  });
});

test('resolveAllCommandsOnPath: qualified names and extensions yield no walk', () => {
  assert.deepEqual(resolveAllCommandsOnPath('/usr/bin/tool'), []);
  assert.deepEqual(resolveAllCommandsOnPath('tool.exe'), []);
  assert.deepEqual(resolveAllCommandsOnPath(''), []);
});

test('resolveAllCommandsOnPath: absent command yields empty, not null', () => {
  withFakePath({ a: [] }, () => {
    assert.deepEqual(resolveAllCommandsOnPath('definitely-not-installed-xyz'), []);
  });
});

// ─── enumerateVendorBinaries: de-dup ─────────────────────────────────────────

test('enumerateVendorBinaries: a repeated PATH dir collapses to one entry, not a fake conflict', () => {
  // Windows PATHs very often list the same directory more than once. Reporting the
  // same FILE as N installs inflated the count and marked every copy `← spawned`,
  // which read as a version conflict that did not exist.
  const root = mkdtempSync(join(tmpdir(), 'hopper-binprov-dup-'));
  const prevPath = process.env.PATH;
  const prevExt = process.env.PATHEXT;
  try {
    const dir = join(root, 'bin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `codex${EXT}`), 'fake', { mode: 0o755 });
    if (isWindows) process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    process.env.PATH = [dir, dir, dir].join(delimiter);

    const rep = enumerateVendorBinaries('codex');
    assert.equal(rep.entries.length, 1, 'one distinct FILE');
    assert.equal(rep.entries[0].pathHits, 3, 'repeat count retained');
    assert.equal(rep.duplicatePathDirs, 2, 'collapsed duplicates reported');
    assert.equal(rep.entries.filter((e) => e.spawned).length, 1, 'exactly one entry marked spawned');
    assert.equal(summarizeBinaryDrift(rep).verdict, 'ok', 'a repeated dir is NOT a conflict');
  } finally {
    process.env.PATH = prevPath;
    if (prevExt === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = prevExt;
    rmSync(root, { recursive: true, force: true });
  }
});

test('enumerateVendorBinaries: two distinct files both enumerated, first marked spawned', () => {
  withFakePath({ old: [`codex${EXT}`], new: [`codex${EXT}`] }, ({ dirs }) => {
    const rep = enumerateVendorBinaries('codex');
    assert.equal(rep.entries.length, 2);
    assert.equal(rep.entries[0].dir, dirs[0]);
    assert.equal(rep.entries[0].spawned, true, 'PATH-first is what dispatch spawns');
    assert.equal(rep.entries[1].spawned, false);
  });
});

// ─── extractVersion ──────────────────────────────────────────────────────────

test('extractVersion: pulls semver out of assorted vendor banners', () => {
  assert.equal(extractVersion('codex-cli 0.131.0').version, '0.131.0');
  assert.equal(extractVersion('grok/0.2.118\n').version, '0.2.118');
  assert.equal(extractVersion('  1.0.77  ').version, '1.0.77');
  // `v`-prefixed: no word boundary between `v` and `2`, which the first regex got wrong.
  assert.equal(extractVersion('v2.1.220-beta.3').version, '2.1.220-beta.3');
});

test('extractVersion: distinguishes "answered unparseably" from "did not answer"', () => {
  const unparsed = extractVersion('some banner with no version');
  assert.equal(unparsed.version, null);
  assert.match(unparsed.note, /^unparsed: /);

  const silent = extractVersion('   \n  ');
  assert.equal(silent.version, null);
  assert.equal(silent.note, 'no output');
});

test('extractVersion: control characters cannot break the report', () => {
  // Built from char codes on purpose: a literal ESC/BEL in the source would make
  // this file binary to grep and easy to mangle on the next edit.
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  const noisy = `x${BEL}${ESC}[31mred${ESC}[0m no version`;
  const note = extractVersion(noisy).note;
  assert.match(note, /^unparsed: /);
  const hasControl = [...note].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
  assert.equal(hasControl, false, 'control chars stripped from the note');
});

// ─── summarizeBinaryDrift ────────────────────────────────────────────────────

const entry = (path, version, spawned = false) =>
  ({ resolvedPath: path, dir: '', direct: true, pathHits: 1, spawned, version, versionNote: null });

test('summarizeBinaryDrift: differing versions across installs is a conflict', () => {
  const rep = {
    name: 'codex', command: 'codex', found: true, offPathSpawn: null, duplicatePathDirs: 0,
    entries: [entry('/a/codex', '0.131.0', true), entry('/b/codex', '0.146.0')],
  };
  const s = summarizeBinaryDrift(rep);
  assert.equal(s.verdict, 'conflict');
  assert.equal(s.spawnedVersion, '0.131.0');
  assert.deepEqual(s.distinctVersions.sort(), ['0.131.0', '0.146.0']);
});

test('summarizeBinaryDrift: same version across installs is multiple, not conflict', () => {
  const rep = {
    name: 'copilot', command: 'copilot', found: true, offPathSpawn: null, duplicatePathDirs: 0,
    entries: [entry('/a/copilot', '1.0.77', true), entry('/b/copilot', '1.0.77')],
  };
  assert.equal(summarizeBinaryDrift(rep).verdict, 'multiple');
});

test('summarizeBinaryDrift: unprobed multi-install is multiple (absence of versions is not agreement)', () => {
  const rep = {
    name: 'codex', command: 'codex', found: true, offPathSpawn: null, duplicatePathDirs: 0,
    entries: [entry('/a/codex', null, true), entry('/b/codex', null)],
  };
  const s = summarizeBinaryDrift(rep);
  assert.equal(s.verdict, 'multiple');
  assert.equal(s.probed, false, 'probed=false so the renderer can say "use --deep"');
});

test('summarizeBinaryDrift: missing and off-path verdicts', () => {
  assert.equal(summarizeBinaryDrift({ found: false, entries: [] }).verdict, 'missing');
  assert.equal(
    summarizeBinaryDrift({ found: true, entries: [], offPathSpawn: '/opt/agy/agy', duplicatePathDirs: 0 }).verdict,
    'off-path',
  );
});

// ─── formatBinaryReport ──────────────────────────────────────────────────────

test('formatBinaryReport: conflict names both versions and marks exactly one spawned', () => {
  const rep = {
    name: 'codex', command: 'codex', found: true, offPathSpawn: null, duplicatePathDirs: 0,
    entries: [entry('/a/codex', '0.131.0', true), entry('/b/codex', '0.146.0')],
  };
  const out = formatBinaryReport(rep).join('\n');
  assert.match(out, /2 distinct versions/);
  assert.match(out, /0\.131\.0/);
  assert.match(out, /0\.146\.0/);
  assert.equal((out.match(/← spawned/g) || []).length, 1, 'exactly one spawned marker');
});

test('formatBinaryReport: single install stays a one-liner', () => {
  const rep = {
    name: 'grok', command: 'grok', found: true, offPathSpawn: null, duplicatePathDirs: 0,
    entries: [entry('/a/grok', '0.2.118', true)],
  };
  assert.equal(formatBinaryReport(rep).length, 1);
});

// ─── compareVersionDesc ──────────────────────────────────────────────────────

test('compareVersionDesc: numeric segments, not lexicographic (0.146.0 > 0.131.0)', () => {
  // The exact trap: sorted as strings, '0.131.0' precedes '0.146.0', so the
  // next-step text would name the OLD binary as the newest one to keep.
  assert.deepEqual(['0.131.0', '0.146.0'].sort(compareVersionDesc), ['0.146.0', '0.131.0']);
  assert.deepEqual(['1.9.0', '1.10.0'].sort(compareVersionDesc), ['1.10.0', '1.9.0']);
  assert.equal(compareVersionDesc('2.0.0', '2.0.0'), 0);
});

// ─── buildNextSteps wiring ───────────────────────────────────────────────────

test('buildNextSteps: a version conflict becomes an actionable step naming the newest', () => {
  const rows = [{
    name: 'codex', installed: true, models: ['x'], dispatchDisabled: null,
    binaries: {
      name: 'codex', command: 'codex', found: true, offPathSpawn: null, duplicatePathDirs: 0,
      entries: [entry('/a/codex', '0.131.0', true), entry('/b/codex', '0.146.0')],
    },
  }];
  const sum = { notInstalled: [], authMissing: [], capsStale: [], ready: 1, total: 1 };
  const steps = buildNextSteps(rows, sum, { hopperDir: '/tmp/.hopper' }).join('\n');
  assert.match(steps, /codex: 2 installs on PATH/);
  assert.match(steps, /NOT the newest \(0\.146\.0\)/);
});

test('buildNextSteps: no conflict step when versions agree', () => {
  const rows = [{
    name: 'copilot', installed: true, models: ['x'], dispatchDisabled: null,
    binaries: {
      name: 'copilot', command: 'copilot', found: true, offPathSpawn: null, duplicatePathDirs: 0,
      entries: [entry('/a/copilot', '1.0.77', true), entry('/b/copilot', '1.0.77')],
    },
  }];
  const sum = { notInstalled: [], authMissing: [], capsStale: [], ready: 1, total: 1 };
  const steps = buildNextSteps(rows, sum, { hopperDir: '/tmp/.hopper' }).join('\n');
  assert.ok(!/installs on PATH/.test(steps), 'agreement is not reported as a problem');
});

// ─── probeBinaryVersions ─────────────────────────────────────────────────────

test('probeBinaryVersions: annotates each entry from its own spawn (injected)', () => {
  const rep = {
    name: 'codex', command: 'codex', found: true, offPathSpawn: null, duplicatePathDirs: 0,
    entries: [entry('/a/codex', null, true), entry('/b/codex', null)],
  };
  const byPath = { '/a/codex': 'codex-cli 0.131.0', '/b/codex': 'codex-cli 0.146.0' };
  probeBinaryVersions(rep, {
    spawnFn: (cmd, args) => {
      // On Windows non-.exe entries route through cmd.exe /c <path> --version.
      const target = args.includes('--version') ? (args[args.length - 2] ?? cmd) : cmd;
      return { stdout: byPath[target] ?? byPath[cmd] ?? '', stderr: '' };
    },
  });
  assert.equal(rep.entries[0].version, '0.131.0');
  assert.equal(rep.entries[1].version, '0.146.0');
  assert.equal(summarizeBinaryDrift(rep).verdict, 'conflict');
});

test('probeBinaryVersions: a throwing spawn degrades to a note, never throws', () => {
  const rep = {
    name: 'codex', command: 'codex', found: true, offPathSpawn: null, duplicatePathDirs: 0,
    entries: [entry('/a/codex', null, true)],
  };
  probeBinaryVersions(rep, { spawnFn: () => { throw new Error('ENOENT'); } });
  assert.equal(rep.entries[0].version, null);
  assert.match(rep.entries[0].versionNote, /probe failed/);
});

// ─── --setup dead-code regression ────────────────────────────────────────────

test('--setup renders every section (guards the unconditional `return;` regression)', () => {
  // 03330ea (2026-07-22) left an unconditional `return;` in runSetup(), so for a
  // month `--setup` printed a terse vendor dump and silently skipped EVERYTHING
  // below it. It survived undetected precisely because the renderer had zero test
  // coverage (ISSUE-setup-sandbox-column-dead-code.md says so explicitly). This
  // test is that coverage: it asserts on the SECTIONS, so any future early return
  // — wherever it is placed — fails here instead of shipping.
  const bin = fileURLToPath(new URL('../../cli/bin/hopper-dispatch', import.meta.url));
  const out = execFileSync(process.execPath, [bin, '--setup'], {
    encoding: 'utf-8',
    timeout: 120_000,
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
  });

  for (const section of [
    'Runtime',                     // host viability block
    'Vendors (',                   // the pipe table
    'Sandbox',                     // the column the docs tell users to consult
    'Vendor binaries',             // binary provenance (added with this test)
    'Vendor provenance',           // the closed projection 03330ea introduced
    'Task-type policy',            // the batch-2 AGENTS.md lint
    'Next steps',                  // the actionable tail
  ]) {
    assert.ok(out.includes(section), `--setup output is missing the "${section}" section`);
  }

  // The terse dump that used to REPLACE the report must not also be emitted:
  // its header duplicated the real one, which is how the truncation hid.
  assert.equal(
    (out.match(/hopper-dispatch v[\d.]+ — setup & readiness/g) || []).length, 1,
    'the report header must appear exactly once',
  );
});

test('--setup reports real binary provenance, not hardcoded unknowns', () => {
  // Until 2026-08-05 these two fields were literal placeholders for every vendor
  // on every machine, which is why a shadowed stale binary was undiagnosable.
  const bin = fileURLToPath(new URL('../../cli/bin/hopper-dispatch', import.meta.url));
  const out = execFileSync(process.execPath, [bin, '--setup'], {
    encoding: 'utf-8',
    timeout: 120_000,
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
  });
  const provenance = out.slice(out.indexOf('Vendor provenance'));
  assert.ok(
    /binaryAvailability=(present|missing)/.test(provenance),
    'binaryAvailability must be observed (present/missing), not the unknown placeholder',
  );
  assert.ok(
    !/binaryAvailability=unknown binaryBasename=null/.test(provenance),
    'the hardcoded unknown/null pair must not reappear',
  );
});

test('--binaries works outside a .hopper workspace (machine diagnostic, not a queue command)', () => {
  // It sits ABOVE the workspace gate deliberately: which binaries exist is a
  // property of the machine. Requiring `.hopper/` would withhold it exactly when
  // it is most needed — diagnosing a host before any project is scaffolded.
  const bin = fileURLToPath(new URL('../../cli/bin/hopper-dispatch', import.meta.url));
  const empty = mkdtempSync(join(tmpdir(), 'hopper-no-workspace-'));
  try {
    const out = execFileSync(process.execPath, [bin, '--binaries', 'codex'], {
      encoding: 'utf-8', timeout: 120_000, cwd: empty,
    });
    assert.match(out, /vendor binaries/i);
    assert.ok(!/no \.hopper\/ directory found/.test(out));
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('--setup stays path-free while --binaries carries the paths', () => {
  // The split is a contract, not a style choice: model-attestation-contract.test.js
  // fails --setup if a discovered binary's directory appears in its output.
  //
  // Expressed without any literal path separator (which is also what broke the first
  // version of this test): take the paths --binaries actually printed, and assert
  // none of them reappear in --setup's binaries section.
  const bin = fileURLToPath(new URL('../../cli/bin/hopper-dispatch', import.meta.url));
  const cwd = fileURLToPath(new URL('../..', import.meta.url));
  const setup = execFileSync(process.execPath, [bin, '--setup'], { encoding: 'utf-8', timeout: 120_000, cwd });
  const binaries = execFileSync(process.execPath, [bin, '--binaries'], { encoding: 'utf-8', timeout: 120_000, cwd });

  const printedPaths = binaries
    .split(/\r?\n/)
    .flatMap((line) => line.trim().split(/\s{2,}/))
    .map((tok) => tok.trim())
    .filter((tok) => tok.length > 8 && tok.includes(sep));
  assert.ok(printedPaths.length > 0, '--binaries must print paths (that is its whole job)');

  const section = setup.slice(setup.indexOf('Vendor binaries'), setup.indexOf('Vendor provenance'));
  assert.ok(section.length > 0, '--setup must have a Vendor binaries section');
  for (const printed of printedPaths) {
    assert.ok(!section.includes(printed), `--setup leaked the path ${printed}`);
  }
  assert.match(setup, /--binaries/, '--setup must point at where the paths live');
});
