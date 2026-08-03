// Phase 6b cache tests
// Anchor: tests/unit/cache.test.js

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  readCache, readCacheWithOutcome, writeCache, getVendorCache, setVendorCache, recoverCache,
  isStale, staleness, cachePath, CACHE_VERSION, windowsAclLines,
} from '../../cli/src/cache.js';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { projectInventoryEntry } from '../../cli/src/inventory-contract.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISPATCH_CLI = join(REPO_ROOT, 'cli', 'bin', 'hopper-dispatch');

function withTmpCache(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-cache-'));
  const oldEnv = process.env.HOPPER_CACHE_DIR;
  process.env.HOPPER_CACHE_DIR = tmp;
  try {
    return fn(tmp);
  } finally {
    if (oldEnv === undefined) delete process.env.HOPPER_CACHE_DIR;
    else process.env.HOPPER_CACHE_DIR = oldEnv;
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- windowsAclLines: icacls output parsing (platform-independent, so it
// runs on every OS even though the win32-gated callers only run on
// Windows). Regression coverage for a real bug found via GitHub Actions
// windows-latest CI: `icacls <path>`'s default listing interleaves SACL
// "Mandatory Label" (integrity level) entries with real DACL ACE lines
// using the same `principal:(flags)` shape, which used to make owner-only
// hardening that genuinely succeeded look like it failed whenever the
// target inherited a Mandatory Label (plausible on GitHub Actions
// windows-latest, which redirects TEMP/TMP onto the ephemeral D:\ drive).
test('windowsAclLines excludes an inherited Mandatory Label line, keeping only the real DACL grant', () => {
  const stdout = [
    'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\hopper-cache-abc123 FV-AZ123-45\\runneradmin:(F)',
    '                                                                  Mandatory Label\\Medium Mandatory Level:(OI)(NP)(IO)(NW)',
    '',
    'Successfully processed 1 files; Failed processing 0 files.',
  ].join('\r\n');
  const lines = windowsAclLines(stdout);
  assert.deepEqual(lines, ['C:\\Users\\runneradmin\\AppData\\Local\\Temp\\hopper-cache-abc123 FV-AZ123-45\\runneradmin:(F)']);
});

test('windowsAclLines is case-insensitive about the Mandatory Label prefix', () => {
  const stdout = [
    'C:\\dir FV-AZ123-45\\runneradmin:(OI)(CI)(F)',
    '        MANDATORY LABEL\\High Mandatory Level:(OI)(NP)(IO)(NW)',
  ].join('\r\n');
  assert.equal(windowsAclLines(stdout).length, 1);
});

test('windowsAclLines destructive counter-proof: a REAL second grant is still counted (not swallowed by the Mandatory Label exclusion)', () => {
  const stdout = [
    'C:\\dir FV-AZ123-45\\runneradmin:(F)',
    '        Everyone:(F)',
    '',
    'Successfully processed 1 files; Failed processing 0 files.',
  ].join('\r\n');
  const lines = windowsAclLines(stdout);
  assert.equal(lines.length, 2, 'a genuine competing DACL grant must still break the owner-only invariant');
});

test('windowsAclLines: no ACE lines at all yields an empty array (fails closed, not a false pass)', () => {
  assert.deepEqual(windowsAclLines('Successfully processed 1 files; Failed processing 0 files.'), []);
  assert.deepEqual(windowsAclLines(''), []);
  assert.deepEqual(windowsAclLines(undefined), []);
});

test('readCache returns null when file does not exist', () => {
  withTmpCache(() => {
    assert.equal(readCache(), null);
  });
});

test('readCacheWithOutcome distinguishes missing, v1, malformed, and version mismatch without exposing raw errors', () => {
  withTmpCache((tmp) => {
    assert.deepEqual(readCacheWithOutcome(), {
      outcome: 'missing', cache: null, diagnostic_code: 'none',
    });

    writeCache({ version: CACHE_VERSION, host: 'x', probed_at_global: '', vendors: {} });
    assert.equal(readCacheWithOutcome().outcome, 'ok-v1');

    writeFileSync(join(tmp, 'vendor-capabilities.json'), '{ not JSON', 'utf-8');
    assert.deepEqual(readCacheWithOutcome(), {
      outcome: 'malformed', cache: null, diagnostic_code: 'inventory-cache-malformed',
    });

    writeFileSync(join(tmp, 'vendor-capabilities.json'), JSON.stringify({ version: 2, vendors: {} }), 'utf-8');
    assert.deepEqual(readCacheWithOutcome(), {
      outcome: 'version-mismatch', cache: null, diagnostic_code: 'inventory-cache-version-unsupported',
    });
  });
});

test('ordinary cache create and update harden an empty temp before writing sensitive payloads', () => {
  withTmpCache((tmp) => {
    const path = cachePath();
    const observed = [];
    const security = {
      prepareOwnerOnly(tempPath) {
        observed.push(['prepare', tempPath, readFileSync(tempPath, 'utf-8')]);
      },
      assertOwnerOnly(tempPath) {
        observed.push(['assert', tempPath, readFileSync(tempPath, 'utf-8')]);
        return true;
      },
    };

    writeCache({ version: CACHE_VERSION, host: 'first', probed_at_global: '', vendors: {} }, { security });
    writeCache({ version: CACHE_VERSION, host: 'second', probed_at_global: '', vendors: {} }, { security });

    assert.deepEqual(observed.map(([step, , bytes]) => [step, bytes]), [
      ['prepare', ''], ['assert', ''], ['prepare', ''], ['assert', ''],
    ]);
    assert.equal(JSON.parse(readFileSync(path, 'utf-8')).host, 'second');
    assert.deepEqual(readdirSync(tmp).filter((name) => name.includes('.tmp.')), []);
  });
});

test('ordinary cache write fails closed before payload when owner-only hardening fails', () => {
  withTmpCache((tmp) => {
    const path = cachePath();
    const active = '{"version":1,"host":"old","probed_at_global":"","vendors":{},"active":"must remain byte-identical"}';
    writeFileSync(path, active, 'utf-8');

    assert.deepEqual(
      setVendorCache(
        'kimi',
        { models: ['replacement'] },
        { security: { prepareOwnerOnly: () => { throw new Error('simulated ACL failure'); } } },
      ),
      { written: false, outcome: 'ok-v1', diagnostic_code: 'inventory-cache-write-owner-only-failed' },
    );
    assert.equal(readFileSync(path, 'utf-8'), active);
    assert.deepEqual(readdirSync(tmp).filter((name) => name.includes('.tmp.')), []);
  });
});

test('cache parent hardening happens before lock, temp, or payload and fails closed', () => {
  withTmpCache((tmp) => {
    const parent = join(tmp, 'nested-cache-parent');
    const prior = process.env.HOPPER_CACHE_DIR;
    process.env.HOPPER_CACHE_DIR = parent;
    try {
      const result = setVendorCache('claude', { models: ['fable'] }, {
        security: {
          prepareParentOwnerOnly(path) {
            assert.equal(path, parent);
            assert.deepEqual(readdirSync(path), [], 'parent must be empty before any lock, temp, or payload');
            throw new Error('simulated parent ACL failure');
          },
        },
      });
      assert.deepEqual(result, {
        written: false,
        outcome: 'missing',
        diagnostic_code: 'inventory-cache-parent-owner-only-failed',
      });
      assert.deepEqual(readdirSync(parent), [], 'failed parent hardening must not write lock, temp, or payload');
    } finally {
      process.env.HOPPER_CACHE_DIR = prior;
    }
  });
});

test('cache parent hardening failure preserves active bytes and is public-safe', () => {
  withTmpCache((tmp) => {
    const path = cachePath();
    const active = '{"version":1,"host":"old","probed_at_global":"","vendors":{},"active":"must remain byte-identical"}';
    writeFileSync(path, active, 'utf-8');
    const result = setVendorCache('claude', { models: ['fable'] }, {
      security: { prepareParentOwnerOnly: () => { throw new Error('simulated parent ACL failure'); } },
    });
    assert.deepEqual(result, {
      written: false,
      outcome: 'ok-v1',
      diagnostic_code: 'inventory-cache-parent-owner-only-failed',
    });
    assert.equal(readFileSync(path, 'utf-8'), active);
    assert.deepEqual(readdirSync(tmp).filter((name) => name.endsWith('.lock') || name.includes('.tmp.')), []);
    assert.equal(projectInventoryEntry('claude', {
      diagnostic_code: result.diagnostic_code,
      provenance: { source_kind: 'future-private-source', binary_availability: 'present', binary_basename: 'claude' },
      future_root_escape: 'must-not-project',
    }).diagnosticCode, 'inventory-cache-parent-owner-only-failed');
  });
});

test('setVendorCache creates a v1 cache only when missing and additively preserves unknown root, vendor, and provenance fields', () => {
  withTmpCache(() => {
    writeCache({
      version: CACHE_VERSION,
      host: 'future-host',
      probed_at_global: '2026-01-01T00:00:00.000Z',
      future_root: { retained: true },
      vendors: {
        claude: {
          models: ['old'],
          models_source: 'old source',
          reasoning_levels: ['high'],
          future_vendor: { retained: true },
          provenance: {
            source_kind: 'adapter-aliases',
            binary_availability: 'present',
            future_provenance: 'retain-me',
          },
        },
      },
    });

    const result = setVendorCache('claude', {
      models: ['fable'],
      models_source: 'canonical',
      probed_at: '2026-07-22T00:00:00.000Z',
      introspection_supported: 'partial',
      provenance: { source_kind: 'static' },
    });
    assert.deepEqual(result, { written: true, outcome: 'ok-v1', diagnostic_code: 'none' });

    const entry = getVendorCache('claude');
    const cache = readCache();
    assert.deepEqual(cache.future_root, { retained: true });
    assert.deepEqual(entry.models, ['fable']);
    assert.deepEqual(entry.reasoning_levels, ['high'], 'an omitted owned optional field retains its prior value');
    assert.deepEqual(entry.future_vendor, { retained: true });
    assert.equal(entry.provenance.source_kind, 'static');
    assert.equal(entry.provenance.binary_availability, 'present');
    assert.equal(entry.provenance.future_provenance, 'retain-me');
  });
});

test('Kimi, Claude, and OpenCode cache writes retain only canonical provenance rather than raw probe diagnostics', () => {
  withTmpCache(() => {
    setVendorCache('kimi', {
      models: ['configured-alias'],
      models_source: 'C:\\Users\\person\\.kimi-code\\config.toml',
      binary_path: 'C:\\Users\\person\\bin\\kimi.cmd',
      notes: ['provider=private-account stderr=secret'],
      provenance: { source_kind: 'config', binary_availability: 'present', binary_basename: 'kimi' },
    });
    const entry = getVendorCache('kimi');
    assert.equal(entry.models_source, 'config');
    assert.equal(Object.hasOwn(entry, 'binary_path'), false);
    assert.equal(Object.hasOwn(entry, 'notes'), false);
    assert.deepEqual(entry.provenance, {
      source_kind: 'config', binary_availability: 'present', binary_basename: 'kimi',
    });
  });
});

test('setVendorCache removes sensitive legacy fields from every vendor and nested provenance while retaining canonical and unknown benign fields', () => {
  withTmpCache(() => {
    writeCache({
      version: CACHE_VERSION,
      host: 'x',
      probed_at_global: '2026-07-22T00:00:00.000Z',
      vendors: {
        mimo: {
          models: ['mimo-safe'],
          reasoning_levels: ['high'],
          models_source: 'RAW_MIMO_MODELS_SOURCE',
          binary_path: 'C:\\PRIVATE\\mimo.cmd',
          config_path: 'C:\\PRIVATE\\mimo-config.toml',
          raw_path: 'C:\\PRIVATE\\mimo-output.log',
          notes: ['AUTH_EXCERPT_PRIVATE'],
          sourceNote: 'SOURCE_NOTE_PRIVATE',
          error: 'RAW_ERROR_PRIVATE',
          stderr: 'RAW_STDERR_PRIVATE',
          auth_excerpt: 'AUTH_EXCERPT_PRIVATE',
          provider_url: 'https://private.example.invalid/mimo',
          future_vendor: { retained: true },
          provenance: {
            source_kind: 'static',
            binaryPath: 'C:\\PRIVATE\\nested-mimo.cmd',
            configPath: 'C:\\PRIVATE\\nested-config.toml',
            rawPath: 'C:\\PRIVATE\\nested-output.log',
            notes: ['NESTED_NOTE_PRIVATE'],
            modelsSource: 'NESTED_RAW_SOURCE_PRIVATE',
            stderr: 'NESTED_STDERR_PRIVATE',
            authExcerpt: 'NESTED_AUTH_PRIVATE',
            providerUrl: 'https://private.example.invalid/nested',
            future_provenance: 'retain-me',
          },
        },
      },
    });

    setVendorCache('future-vendor', {
      models: ['future-safe'],
      reasoning_levels: ['xhigh'],
      models_source: 'RAW_FUTURE_MODELS_SOURCE',
      binary_path: 'C:\\PRIVATE\\future.cmd',
      notes: ['FUTURE_NOTE_PRIVATE'],
      sourceNote: 'FUTURE_SOURCE_NOTE_PRIVATE',
      error: 'FUTURE_ERROR_PRIVATE',
      stderr: 'FUTURE_STDERR_PRIVATE',
      auth_excerpt: 'FUTURE_AUTH_PRIVATE',
      provider_url: 'https://private.example.invalid/future',
      future_vendor: { retained: true },
      provenance: {
        source_kind: 'cli-catalog',
        binary_path: 'C:\\PRIVATE\\future-nested.cmd',
        raw_source: 'FUTURE_NESTED_RAW_SOURCE_PRIVATE',
        notes: ['FUTURE_NESTED_NOTE_PRIVATE'],
        stderr: 'FUTURE_NESTED_STDERR_PRIVATE',
        auth_excerpt: 'FUTURE_NESTED_AUTH_PRIVATE',
        provider_url: 'https://private.example.invalid/future-nested',
        future_provenance: 'retain-me-too',
      },
    });

    const cache = readCache();
    const sensitiveKeys = new Set([
      'binary_path', 'binaryPath', 'config_path', 'configPath', 'raw_path', 'rawPath',
      'notes', 'sourceNote', 'source_note', 'modelsSource', 'raw_source', 'rawSource',
      'error', 'stderr', 'auth_excerpt', 'authExcerpt', 'provider_url', 'providerUrl',
    ]);
    const findSensitiveKeys = (value, path = '$') => {
      if (!value || typeof value !== 'object') return [];
      return Object.entries(value).flatMap(([key, child]) => [
        ...(sensitiveKeys.has(key) ? [`${path}.${key}`] : []),
        ...findSensitiveKeys(child, `${path}.${key}`),
      ]);
    };
    const serialized = JSON.stringify(cache.vendors);
    const privateValues = [
      'C:\\PRIVATE', 'RAW_MIMO_MODELS_SOURCE', 'AUTH_EXCERPT_PRIVATE', 'SOURCE_NOTE_PRIVATE',
      'RAW_ERROR_PRIVATE', 'RAW_STDERR_PRIVATE', 'private.example.invalid', 'NESTED_RAW_SOURCE_PRIVATE',
      'NESTED_NOTE_PRIVATE', 'NESTED_STDERR_PRIVATE', 'NESTED_AUTH_PRIVATE', 'RAW_FUTURE_MODELS_SOURCE',
      'FUTURE_NOTE_PRIVATE', 'FUTURE_SOURCE_NOTE_PRIVATE', 'FUTURE_ERROR_PRIVATE', 'FUTURE_STDERR_PRIVATE',
      'FUTURE_AUTH_PRIVATE', 'FUTURE_NESTED_RAW_SOURCE_PRIVATE', 'FUTURE_NESTED_NOTE_PRIVATE',
      'FUTURE_NESTED_STDERR_PRIVATE', 'FUTURE_NESTED_AUTH_PRIVATE',
    ];
    assert.deepEqual(findSensitiveKeys(cache.vendors), []);
    for (const value of privateValues) assert.ok(!serialized.includes(value), value);
    assert.deepEqual(cache.vendors.mimo.models, ['mimo-safe']);
    assert.deepEqual(cache.vendors.mimo.reasoning_levels, ['high']);
    assert.equal(cache.vendors.mimo.models_source, 'static');
    assert.deepEqual(cache.vendors.mimo.future_vendor, { retained: true });
    assert.equal(cache.vendors.mimo.provenance.future_provenance, 'retain-me');
    assert.deepEqual(cache.vendors['future-vendor'].models, ['future-safe']);
    assert.deepEqual(cache.vendors['future-vendor'].reasoning_levels, ['xhigh']);
    assert.equal(cache.vendors['future-vendor'].models_source, 'cli-catalog');
    assert.deepEqual(cache.vendors['future-vendor'].future_vendor, { retained: true });
    assert.equal(cache.vendors['future-vendor'].provenance.future_provenance, 'retain-me-too');
  });
});

test('setVendorCache leaves malformed and future-version cache bytes untouched', () => {
  withTmpCache((tmp) => {
    const path = join(tmp, 'vendor-capabilities.json');
    for (const raw of ['{ malformed', '{"version":2,"vendors":{},"future":"retain"}']) {
      writeFileSync(path, raw, 'utf-8');
      const result = setVendorCache('claude', { models: ['fable'] });
      assert.equal(result.written, false);
      assert.ok(['malformed', 'version-mismatch'].includes(result.outcome));
      assert.equal(readFileSync(path, 'utf-8'), raw);
    }
  });
});

test('ordinary CLI probe fails closed on malformed cache without spawning recovery or changing bytes', () => {
  withTmpCache((tmp) => {
    const path = join(tmp, 'vendor-capabilities.json');
    const raw = '{ malformed ordinary probe must preserve';
    writeFileSync(path, raw, 'utf-8');
    const child = spawnSync(process.execPath, [DISPATCH_CLI, '--probe', 'claude'], {
      encoding: 'utf-8',
      env: { ...process.env, HOPPER_CACHE_DIR: tmp, PATH: '' },
    });
    assert.equal(child.status, 1);
    assert.match(`${child.stdout}\n${child.stderr}`, /inventory-cache-malformed/);
    assert.match(`${child.stdout}\n${child.stderr}`, /--recover-cache/);
    assert.equal(readFileSync(path, 'utf-8'), raw);
  });
});

test('CLI inventory readers use the closed projection instead of raw cache path, source, or notes', () => {
  withTmpCache((tmp) => {
    writeCache({
      version: CACHE_VERSION,
      host: 'x',
      probed_at_global: '2026-07-22T00:00:00.000Z',
      vendors: {
        claude: {
          models: ['fable'],
          models_source: 'C:\\Users\\person\\.claude\\config.json',
          binary_path: 'C:\\Users\\person\\bin\\claude.exe',
          notes: ['private account detail and stderr'],
          probed_at: '2026-07-22T00:00:00.000Z',
          provenance: {
            source_kind: 'adapter-aliases', binary_availability: 'present', binary_basename: 'claude',
          },
          diagnostic_code: 'none',
        },
      },
    });
    for (const args of [['--models', 'claude'], ['--capabilities', 'claude']]) {
      const child = spawnSync(process.execPath, [DISPATCH_CLI, ...args], {
        encoding: 'utf-8', env: { ...process.env, HOPPER_CACHE_DIR: tmp },
      });
      const output = `${child.stdout}\n${child.stderr}`;
      assert.equal(child.status, 0, args.join(' '));
      assert.match(output, /claude-selector-metadata/, args.join(' '));
      assert.doesNotMatch(output, /C:\\Users\\person|private account detail|config\.json/, args.join(' '));
    }
  });
});

test('ordinary setup returns a closed recovery hint for an unreadable cache', () => {
  withTmpCache((tmp) => {
    writeFileSync(join(tmp, 'vendor-capabilities.json'), '{ malformed setup cache', 'utf-8');
    const child = spawnSync(process.execPath, [DISPATCH_CLI, '--setup', 'claude'], {
      encoding: 'utf-8', env: { ...process.env, HOPPER_CACHE_DIR: tmp },
    });
    assert.equal(child.status, 1);
    assert.match(`${child.stdout}\n${child.stderr}`, /inventory-cache-malformed/);
    assert.match(`${child.stdout}\n${child.stderr}`, /--recover-cache/);
  });
});

test('ordinary models and capabilities return the same closed recovery hint for an unreadable cache', () => {
  withTmpCache((tmp) => {
    writeFileSync(join(tmp, 'vendor-capabilities.json'), '{ malformed reader cache', 'utf-8');
    for (const args of [['--models', 'claude'], ['--capabilities', 'claude']]) {
      const child = spawnSync(process.execPath, [DISPATCH_CLI, ...args], {
        encoding: 'utf-8', env: { ...process.env, HOPPER_CACHE_DIR: tmp },
      });
      const output = `${child.stdout}\n${child.stderr}`;
      assert.equal(child.status, 1, args.join(' '));
      assert.match(output, /inventory-cache-malformed/, args.join(' '));
      assert.match(output, /--recover-cache/, args.join(' '));
    }
  });
});

function recoveryFs(overrides = {}) {
  return {
    existsSync: fs.existsSync,
    mkdirSync: fs.mkdirSync,
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    openSync: fs.openSync,
    closeSync: fs.closeSync,
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync,
    readdirSync: fs.readdirSync,
    statSync: fs.statSync,
    chmodSync: fs.chmodSync,
    fsyncSync: fs.fsyncSync,
    ...overrides,
  };
}

function recoveryBackupNames(tmp) {
  return readdirSync(tmp).filter((name) => name.includes('.recovery-') && name.endsWith('.bak'));
}

test('recoverCache makes a fresh v1 cache through an owner-only temp and exclusive backup commit', () => {
  withTmpCache((tmp) => {
    const path = cachePath();
    const active = '{"version":999,"secret":"old"}\n';
    writeFileSync(path, active, 'utf-8');

    const recovered = recoverCache({ now: () => new Date('2026-07-22T01:02:03.000Z'), randomHex: () => 'deadbeef' });
    assert.deepEqual(recovered, { committed: true, diagnostic_code: 'none' });
    assert.equal(readCacheWithOutcome().outcome, 'ok-v1');
    const backups = recoveryBackupNames(tmp);
    assert.deepEqual(backups, ['vendor-capabilities.json.recovery-20260722T010203000Z-deadbeef.bak']);
    assert.equal(readFileSync(join(tmp, backups[0]), 'utf-8'), active);
    assert.deepEqual(readdirSync(tmp).filter((name) => name.includes('.tmp.')), []);
  });
});

test('recoverCache installs a missing active cache without creating a backup', () => {
  withTmpCache((tmp) => {
    const result = recoverCache();
    assert.deepEqual(result, { committed: true, diagnostic_code: 'none' });
    assert.equal(readCacheWithOutcome().outcome, 'ok-v1');
    assert.deepEqual(recoveryBackupNames(tmp), []);
  });
});

test('recoverCache removes a temp whose owner-only assertion fails before touching active bytes', () => {
  withTmpCache((tmp) => {
    const path = cachePath();
    const active = '{"version":2,"keep":"exact bytes"}';
    writeFileSync(path, active, 'utf-8');
    const result = recoverCache({ security: { assertOwnerOnly: () => false } });
    assert.deepEqual(result, { committed: false, diagnostic_code: 'inventory-cache-recovery-backup-create-failed' });
    assert.equal(readFileSync(path, 'utf-8'), active);
    assert.deepEqual(readdirSync(tmp).filter((name) => name.includes('.tmp.')), []);
    assert.deepEqual(recoveryBackupNames(tmp), []);
  });
});

test('recoverCache deletes a newly-created backup when its owner-only assertion fails', () => {
  withTmpCache((tmp) => {
    const path = cachePath();
    const active = '{"version":2,"keep":"exact bytes"}';
    writeFileSync(path, active, 'utf-8');
    let assertions = 0;
    const result = recoverCache({
      security: {
        prepareOwnerOnly: () => {},
        assertOwnerOnly: () => ++assertions === 1,
      },
    });
    assert.deepEqual(result, { committed: false, diagnostic_code: 'inventory-cache-recovery-backup-create-failed' });
    assert.equal(readFileSync(path, 'utf-8'), active);
    assert.deepEqual(recoveryBackupNames(tmp), []);
  });
});

test('recoverCache fails closed after eight exclusive backup-name collisions', () => {
  withTmpCache((tmp) => {
    const path = cachePath();
    const active = '{"version":2}';
    writeFileSync(path, active, 'utf-8');
    writeFileSync(join(tmp, 'vendor-capabilities.json.recovery-20260722T010203000Z-deadbeef.bak'), 'existing', 'utf-8');
    const result = recoverCache({ now: () => new Date('2026-07-22T01:02:03.000Z'), randomHex: () => 'deadbeef' });
    assert.deepEqual(result, { committed: false, diagnostic_code: 'inventory-cache-recovery-backup-create-failed' });
    assert.equal(readFileSync(path, 'utf-8'), active);
  });
});

test('recoverCache retention uses timestamp then complete basename, excludes the current backup, and self-heals a failed prune', () => {
  withTmpCache((tmp) => {
    const path = cachePath();
    writeFileSync(path, '{"version":2}', 'utf-8');
    const prefix = 'vendor-capabilities.json.recovery-20260721T000000000Z-';
    for (const suffix of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc']) writeFileSync(join(tmp, `${prefix}${suffix}.bak`), suffix, 'utf-8');

    let failPrune = true;
    const failed = recoverCache({
      now: () => new Date('2026-07-22T01:02:03.000Z'),
      randomHex: () => 'deadbeef',
      fsOps: recoveryFs({
        unlinkSync: (target) => {
          if (failPrune && target.endsWith('.bak')) throw new Error('retention denied');
          return fs.unlinkSync(target);
        },
      }),
    });
    assert.deepEqual(failed, { committed: false, diagnostic_code: 'inventory-cache-recovery-backup-create-failed' });
    assert.equal(readFileSync(path, 'utf-8'), '{"version":2}');
    assert.equal(recoveryBackupNames(tmp).length, 4, 'a failed prune may leave a temporary retention excess');

    failPrune = false;
    const healed = recoverCache({ now: () => new Date('2026-07-22T01:02:04.000Z'), randomHex: () => 'feedface' });
    assert.deepEqual(healed, { committed: true, diagnostic_code: 'none' });
    const backups = recoveryBackupNames(tmp).sort();
    assert.equal(backups.length, 3);
    assert.equal(backups.some((name) => name.endsWith('-feedface.bak')), true, 'current invocation backup is retained');
    assert.equal(backups.includes(`${prefix}aaaaaaaa.bak`), false, 'equal timestamps prune bytewise earliest basename first');
  });
});

test('recoverCache keeps active bytes unchanged when prune precedes a failed replace', () => {
  withTmpCache((tmp) => {
    const path = cachePath();
    const active = '{"version":2,"active":"unchanged"}';
    writeFileSync(path, active, 'utf-8');
    for (const suffix of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc']) {
      writeFileSync(join(tmp, `vendor-capabilities.json.recovery-20260721T000000000Z-${suffix}.bak`), suffix, 'utf-8');
    }
    const result = recoverCache({
      now: () => new Date('2026-07-22T01:02:03.000Z'),
      randomHex: () => 'deadbeef',
      fsOps: recoveryFs({ renameSync: () => { throw new Error('replace failed'); } }),
    });
    assert.deepEqual(result, { committed: false, diagnostic_code: 'inventory-cache-recovery-replace-failed' });
    assert.equal(readFileSync(path, 'utf-8'), active);
    assert.equal(recoveryBackupNames(tmp).includes('vendor-capabilities.json.recovery-20260721T000000000Z-aaaaaaaa.bak'), false, 'pre-commit prune is not rolled back');
  });
});

test('recoverCache reports durability unknown only after atomic replacement has committed', () => {
  withTmpCache(() => {
    const path = cachePath();
    writeFileSync(path, '{"version":2,"old":true}', 'utf-8');
    const result = recoverCache({ fsOps: recoveryFs({ fsyncSync: () => { throw new Error('durability unknown'); } }) });
    assert.deepEqual(result, { committed: true, diagnostic_code: 'inventory-cache-recovery-durability-unknown' });
    assert.equal(readCacheWithOutcome().outcome, 'ok-v1');
  });
});

test('writeCache + readCache roundtrip preserves data', () => {
  withTmpCache(() => {
    const data = {
      version: CACHE_VERSION,
      host: 'test-host',
      probed_at_global: '2026-05-21T12:00:00Z',
      vendors: {
        codex: { models: ['gpt-5'], introspection_supported: 'full', probed_at: '2026-05-21T12:00:00Z' },
      },
    };
    writeCache(data);
    const got = readCache();
    assert.deepEqual(got, data);
  });
});

test('readCache returns null on version mismatch (no auto-migration)', () => {
  withTmpCache(() => {
    writeCache({ version: 999, host: 'x', probed_at_global: '', vendors: {} });
    assert.equal(readCache(), null);
  });
});

test('getVendorCache returns null when vendor not cached', () => {
  withTmpCache(() => {
    setVendorCache('codex', { models: [], introspection_supported: 'full' });
    assert.equal(getVendorCache('kimi'), null);
  });
});

test('setVendorCache preserves other vendor entries', () => {
  withTmpCache(() => {
    setVendorCache('codex', { models: ['gpt-5'], introspection_supported: 'full' });
    setVendorCache('kimi', { models: ['default'], introspection_supported: 'config-only' });
    const codex = getVendorCache('codex');
    const kimi = getVendorCache('kimi');
    assert.deepEqual(codex.models, ['gpt-5']);
    assert.deepEqual(kimi.models, ['default']);
  });
});

test('isStale: fresh timestamp returns false', () => {
  const fresh = new Date().toISOString();
  assert.equal(isStale(fresh), false);
});

test('isStale: 30-day-old timestamp returns true (default 14d ceiling)', () => {
  const old = new Date(Date.now() - 30 * 24 * 3.6e6).toISOString();
  assert.equal(isStale(old), true);
});

test('isStale: 7d old returns false; 21d returns true (default 14d ceiling)', () => {
  const sevenDays = new Date(Date.now() - 7 * 24 * 3.6e6).toISOString();
  const twentyOneDays = new Date(Date.now() - 21 * 24 * 3.6e6).toISOString();
  assert.equal(isStale(sevenDays), false);
  assert.equal(isStale(twentyOneDays), true);
});

test('isStale: null/invalid returns true', () => {
  assert.equal(isStale(null), true);
  assert.equal(isStale(undefined), true);
  assert.equal(isStale('not-a-date'), true);
});

test('staleness: returns human-readable string', () => {
  const now = new Date().toISOString();
  assert.match(staleness(now), /m ago|s ago|0\.0h ago/);

  const oneHour = new Date(Date.now() - 3.6e6).toISOString();
  assert.match(staleness(oneHour), /h ago|m ago/);

  const fiveDays = new Date(Date.now() - 5 * 24 * 3.6e6).toISOString();
  assert.match(staleness(fiveDays), /d ago/);
});

test('cachePath uses HOPPER_CACHE_DIR override', () => {
  withTmpCache((tmp) => {
    assert.equal(cachePath(), join(tmp, 'vendor-capabilities.json'));
  });
});

test('writeCache atomic — no leftover tmp files', () => {
  withTmpCache((tmp) => {
    writeCache({ version: CACHE_VERSION, host: 'x', probed_at_global: '', vendors: {} });
    const finalFile = join(tmp, 'vendor-capabilities.json');
    assert.ok(existsSync(finalFile));
    // Check no .tmp.* leftovers in the cache dir
    const dirs = readdirSync(tmp);
    const tmpFiles = dirs.filter((f) => f.includes('.tmp.'));
    assert.equal(tmpFiles.length, 0, `tmp files left over: ${tmpFiles.join(', ')}`);
  });
});

test('F2-fix: parallel setVendorCache calls preserve all entries (sync barrier)', async (t) => {
  // R2-F2: tighter race exerciser. The earlier version had children fire
  // setVendorCache as soon as they finished module-load — but module-load
  // takes ~50-150ms per child, easily long enough for the OS scheduler to
  // serialize them. Now each child busy-waits until a shared START_AT
  // timestamp (HOPPER_RACE_START_AT) before calling setVendorCache, so all
  // 5 children fire within a sub-ms window. Without the lock, last writer
  // wins; with the lock, all 5 entries survive.
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-cache-race-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));

  const { spawn } = await import('node:child_process');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const { dirname: pathDirname, resolve: pathResolve, join: pathJoin } = await import('node:path');
  const __dirname = pathDirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = pathResolve(__dirname, '..', '..');
  const cacheJsUrl = pathToFileURL(pathJoin(REPO_ROOT, 'cli', 'src', 'cache.js')).href;
  const vendors = ['codex', 'kimi', 'opencode', 'copilot', 'agy'];

  // Children sleep until the shared START_AT (set by us below to "now + 1.5s",
  // generous enough that all 5 children finish module-load before firing).
  const startAt = Date.now() + 1500;
  const script = `
    import { setVendorCache, readCache } from '${cacheJsUrl}';
    const vendor = process.argv[1];
    const startAt = Number(process.env.HOPPER_RACE_START_AT);
    // Spin-sleep until target time (avoids setTimeout jitter)
    while (Date.now() < startAt) { /* tight loop, last ~few ms only */ }
    const fireAt = Date.now();
    setVendorCache(vendor, { models: [vendor + '-m1'], introspection_supported: 'full', probed_at: new Date().toISOString() });
    process.stdout.write(JSON.stringify({ vendor, fireAt }));
  `;

  const results = await Promise.all(vendors.map((v) => new Promise((res, rej) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, '--', v], {
      env: { ...process.env, HOPPER_CACHE_DIR: tmp, HOPPER_RACE_START_AT: String(startAt) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => code === 0 ? res(JSON.parse(out)) : rej(new Error(`exit ${code}: ${err}`)));
  })));

  // Sanity: confirm the children actually fired close together. If the gap
  // between first and last fireAt is >250ms, the race window is too wide
  // and this test isn't really exercising the race — bail out (test
  // environment too slow / inconsistent, treat as inconclusive rather
  // than fake-passing).
  const fireTimes = results.map((r) => r.fireAt).sort((a, b) => a - b);
  const fireSpread = fireTimes[fireTimes.length - 1] - fireTimes[0];
  assert.ok(fireSpread < 250,
    `sync barrier failed — children fired ${fireSpread}ms apart, too wide to exercise race (timestamps: ${fireTimes.join(', ')})`);

  // Read the final cache directly
  const finalRaw = readFileSync(join(tmp, 'vendor-capabilities.json'), 'utf-8');
  const finalCache = JSON.parse(finalRaw);
  for (const v of vendors) {
    assert.ok(finalCache.vendors[v],
      `vendor '${v}' must survive parallel write (fire-spread ${fireSpread}ms); survivors: ${Object.keys(finalCache.vendors).join(', ')}`);
  }
});

test('F2-fix: stale lockfile (>30s old) is auto-cleared', () => {
  withTmpCache((tmp) => {
    const lockPath = join(tmp, 'vendor-capabilities.json.lock');
    // Pre-create a stale lockfile (mtime 60s ago)
    writeFileSync(lockPath, '', 'utf-8');
    const oldTime = new Date(Date.now() - 60_000);
    utimesSync(lockPath, oldTime, oldTime);
    // setVendorCache should succeed — stale lock auto-cleared
    setVendorCache('codex', { models: ['x'], introspection_supported: 'full' });
    const c = readCache();
    assert.ok(c.vendors.codex);
  });
});
