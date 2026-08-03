// Phase 6b vendor probe tests
// Anchor: tests/unit/vendor-probe.test.js
//
// Each adapter's probe() returns a standard shape. Live spawn-based probe
// is NOT tested here (requires real vendor CLIs installed + auth); instead
// we test the structural contract + the zero-spawn vendors (kimi, agy).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { probeVendor, listAdapters } from '../../cli/src/vendors/index.js';

test('probeVendor throws on unknown vendor name', async () => {
  await assert.rejects(
    () => probeVendor('nonexistent'),
    /No vendor adapter registered/
  );
});

test('agy probe returns introspection_supported=none, no spawn', async () => {
  const r = await probeVendor('agy');
  assert.equal(r.introspection_supported, 'none');
  assert.ok(Array.isArray(r.models));
  assert.ok(Array.isArray(r.reasoning_levels));
  assert.equal(r.reasoning_levels.length, 0, 'agy has no reasoning enum');
  assert.ok(typeof r.duration_ms === 'number');
});

test('kimi probe falls back to config-only introspection when binary is not on PATH', async () => {
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const r = await probeVendor('kimi');
    assert.equal(r.introspection_supported, 'config-only');
    assert.ok(Array.isArray(r.models));
    assert.deepEqual(r.reasoning_levels, ['low', 'medium', 'high', 'xhigh', 'max'],
      'Kimi Code 0.x reasoning is config/provider-driven (no argv toggle)');
    assert.ok(r.duration_ms < 5000, `config fallback should be <5s; got ${r.duration_ms}ms`);
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  }
});

test('kimi probe uses provider list JSON when Kimi Code 0.14+ is available', async (t) => {
  const { mkdtempSync, writeFileSync, rmSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, delimiter } = await import('node:path');
  const { probe } = await import('../../cli/src/vendor-probe/kimi.js');

  const tmp = mkdtempSync(join(tmpdir(), 'kimi-probe-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const isWindows = process.platform === 'win32';
  const fakeKimi = join(tmp, isWindows ? 'kimi.cmd' : 'kimi');
  const providerJson = JSON.stringify({
    providers: { 'managed:kimi-code': { type: 'kimi' } },
    models: {
      'kimi-code/kimi-for-coding': {
        provider: 'managed:kimi-code',
        model: 'kimi-for-coding',
        capabilities: ['thinking', 'tool_use'],
      },
      'custom/fast': { capabilities: ['tool_use'] },
    },
  });
  if (isWindows) {
    writeFileSync(fakeKimi, [
      '@echo off',
      'if "%1"=="--version" (',
      '  echo 0.14.0',
      '  exit /b 0',
      ')',
      'if "%1"=="provider" if "%2"=="list" if "%3"=="--json" (',
      `  echo ${providerJson.replace(/%/g, '%%')}`,
      '  exit /b 0',
      ')',
      'exit /b 2',
    ].join('\r\n'));
  } else {
    const quotedJson = `'${providerJson.replace(/'/g, "'\\''")}'`;
    writeFileSync(fakeKimi, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      "  printf '%s\\n' '0.14.0'",
      '  exit 0',
      'fi',
      'if [ "$1" = "provider" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then',
      `  printf '%s\\n' ${quotedJson}`,
      '  exit 0',
      'fi',
      'exit 2',
      '',
    ].join('\n'));
    chmodSync(fakeKimi, 0o755);
  }

  const savedPath = process.env.PATH;
  const savedHome = process.env.KIMI_CODE_HOME;
  process.env.PATH = `${tmp}${delimiter}${savedPath || ''}`;
  process.env.KIMI_CODE_HOME = join(tmp, 'empty-home');
  try {
    const r = await probe();
    assert.equal(r.introspection_supported, 'partial');
    assert.equal(r.version, '0.14.0');
    assert.deepEqual(r.models, ['kimi-code/kimi-for-coding', 'custom/fast']);
    assert.match(r.models_source, /provider list --json/);
    assert.ok(r.notes.includes('Kimi provider catalog returned configured aliases.'), 'provider note must use closed wording');
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedHome === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = savedHome;
  }
});

test('kimi probe closes config and process diagnostics before result or cache storage', async (t) => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, delimiter } = await import('node:path');
  const { probe } = await import('../../cli/src/vendor-probe/kimi.js');
  const { cachePath, setVendorCache } = await import('../../cli/src/cache.js');

  const tmp = mkdtempSync(join(tmpdir(), 'kimi-private-probe-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const isWindows = process.platform === 'win32';
  const fakeKimi = join(tmp, isWindows ? 'kimi.cmd' : 'kimi');
  const privateConfigPath = join(tmp, 'private-config-home', 'config.toml');
  const privateStderr = 'https://probe-private.invalid/private-provider/private-auth/private-stderr';
  mkdirSync(privateConfigPath, { recursive: true });
  if (isWindows) {
    writeFileSync(fakeKimi, [
      '@echo off',
      'if "%1"=="--version" exit /b 0',
      'if "%1"=="provider" if "%2"=="list" if "%3"=="--json" (',
      `  echo ${privateStderr} 1>&2`,
      '  exit /b 2',
      ')',
      'exit /b 2',
    ].join('\r\n'));
  } else {
    writeFileSync(fakeKimi, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then exit 0; fi',
      'if [ "$1" = "provider" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then',
      `  printf '%s\\n' '${privateStderr}' >&2`,
      '  exit 2',
      'fi',
      'exit 2',
      '',
    ].join('\n'));
    chmodSync(fakeKimi, 0o755);
  }

  const savedPath = process.env.PATH;
  const savedHome = process.env.KIMI_CODE_HOME;
  const savedCacheDir = process.env.HOPPER_CACHE_DIR;
  process.env.PATH = `${tmp}${delimiter}${savedPath || ''}`;
  process.env.KIMI_CODE_HOME = join(tmp, 'private-config-home');
  process.env.HOPPER_CACHE_DIR = join(tmp, 'cache');
  try {
    const result = await probe();
    const forbidden = [privateConfigPath, 'https://probe-private.invalid', 'private-provider', 'private-auth', 'private-stderr'];
    const assertClosed = (value) => {
      if (typeof value === 'string') {
        for (const secret of forbidden) assert.doesNotMatch(value, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      } else if (Array.isArray(value)) {
        value.forEach(assertClosed);
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(assertClosed);
      }
    };
    // Primary assertion: redaction happens INSIDE probe() itself (kimi.js never
    // puts the raw config path, stderr, or provider/auth excerpts into the
    // returned object -- only closed notes/provenance strings) -- well before
    // any cache write. Assert it on the in-memory result directly so this
    // security property is verified on every platform, including a real
    // Windows host where the cache write below never happens at all (fail-
    // closed, 2026-08-03 user ruling: owner-only can never be established
    // there -- see cache.test.js for the diagnostic writeup).
    assertClosed(result);

    // Secondary: the same closed shape must also survive an actual cache
    // round-trip wherever the write can succeed. On POSIX this ordinarily
    // succeeds, so this stays a real end-to-end check there (unchanged
    // rigor). On Windows the write fails closed -- assert THAT instead of
    // crashing on a guaranteed ENOENT for a file that was never created.
    const cacheWrite = setVendorCache('kimi', result);
    if (isWindows) {
      assert.equal(cacheWrite.written, false, 'Windows fail-closed: owner-only cannot be established, so the cache write is rejected');
      assert.equal(existsSync(cachePath()), false, 'a rejected write must leave no cache file (nothing to leak from)');
    } else {
      assert.equal(cacheWrite.written, true, 'POSIX cache write must succeed (unchanged rigor)');
      assertClosed(JSON.parse(readFileSync(cachePath(), 'utf-8')));
    }
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedHome === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = savedHome;
    if (savedCacheDir === undefined) delete process.env.HOPPER_CACHE_DIR;
    else process.env.HOPPER_CACHE_DIR = savedCacheDir;
  }
});

test('mimo and kimi probes close binary paths and raw process diagnostics before result or cache storage', async (t) => {
  const { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, delimiter } = await import('node:path');
  const { probe: mimoProbe } = await import('../../cli/src/vendor-probe/mimo.js');
  const { probe: kimiProbe } = await import('../../cli/src/vendor-probe/kimi.js');
  const { cachePath, setVendorCache } = await import('../../cli/src/cache.js');

  const tmp = mkdtempSync(join(tmpdir(), 'probe-private-diagnostics-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const isWindows = process.platform === 'win32';
  const fakeMimo = join(tmp, isWindows ? 'mimo.cmd' : 'mimo');
  const fakeKimi = join(tmp, isWindows ? 'kimi.cmd' : 'kimi');
  const privateModelStderr = 'MIMO_PRIVATE_MODELS_STDERR';
  const privateAuthExcerpt = 'MIMO_PRIVATE_AUTH_EXCERPT';
  const privateKimiStderr = 'KIMI_PRIVATE_PROVIDER_STDERR';
  if (isWindows) {
    writeFileSync(fakeMimo, [
      '@echo off',
      'if "%1"=="--version" ( echo 1.2.3 & exit /b 0 )',
      `if "%1"=="models" ( echo ${privateModelStderr} 1>&2 & exit /b 2 )`,
      `if "%1"=="auth" ( echo ${privateAuthExcerpt} & exit /b 0 )`,
      'exit /b 2',
    ].join('\r\n'));
    writeFileSync(fakeKimi, [
      '@echo off',
      'if "%1"=="--version" exit /b 0',
      `if "%1"=="provider" if "%2"=="list" if "%3"=="--json" ( echo ${privateKimiStderr} 1>&2 & exit /b 2 )`,
      'exit /b 2',
    ].join('\r\n'));
  } else {
    writeFileSync(fakeMimo, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then printf "%s\\n" "1.2.3"; exit 0; fi',
      `if [ "$1" = "models" ]; then printf '%s\\n' '${privateModelStderr}' >&2; exit 2; fi`,
      `if [ "$1" = "auth" ]; then printf '%s\\n' '${privateAuthExcerpt}'; exit 0; fi`,
      'exit 2',
      '',
    ].join('\n'));
    writeFileSync(fakeKimi, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then exit 0; fi',
      `if [ "$1" = "provider" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then printf '%s\\n' '${privateKimiStderr}' >&2; exit 2; fi`,
      'exit 2',
      '',
    ].join('\n'));
    chmodSync(fakeMimo, 0o755);
    chmodSync(fakeKimi, 0o755);
  }

  const savedPath = process.env.PATH;
  const savedCacheDir = process.env.HOPPER_CACHE_DIR;
  const savedKimiHome = process.env.KIMI_CODE_HOME;
  process.env.PATH = `${tmp}${delimiter}${savedPath || ''}`;
  process.env.HOPPER_CACHE_DIR = join(tmp, 'cache');
  process.env.KIMI_CODE_HOME = join(tmp, 'empty-kimi-home');
  try {
    const results = { mimo: await mimoProbe(), kimi: await kimiProbe() };
    const secrets = [tmp, privateModelStderr, privateAuthExcerpt, privateKimiStderr];
    const assertClosed = (value) => {
      if (typeof value === 'string') {
        for (const secret of secrets) assert.ok(!value.includes(secret), `${secret} leaked from probe output`);
      } else if (Array.isArray(value)) {
        value.forEach(assertClosed);
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(assertClosed);
      }
    };
    // Primary: redaction happens INSIDE mimo.js/kimi.js's probe() -- neither
    // ever puts raw model/auth stdout+stderr or the resolved binary path into
    // the returned object -- well before any cache write. Assert it on the
    // in-memory results directly so this holds on every platform, including a
    // real Windows host where the cache write below fails closed (2026-08-03
    // user ruling) and never touches disk at all.
    assertClosed(results);
    assert.equal(Object.hasOwn(results.mimo, 'binary_path'), false);
    assert.equal(Object.hasOwn(results.kimi, 'binary_path'), false);

    // Secondary: the same closed shape must also survive an actual cache
    // round-trip wherever the write can succeed (POSIX, unchanged rigor). On
    // Windows the write fails closed for both vendors -- assert THAT instead
    // of a guaranteed ENOENT on a file that was never created.
    const writes = Object.fromEntries(Object.entries(results).map(([vendor, result]) => [vendor, setVendorCache(vendor, result)]));
    if (isWindows) {
      for (const [vendor, w] of Object.entries(writes)) {
        assert.equal(w.written, false, `Windows fail-closed: ${vendor} cache write must be rejected`);
      }
      assert.equal(existsSync(cachePath()), false, 'a rejected write must leave no cache file (nothing to leak from)');
    } else {
      for (const [vendor, w] of Object.entries(writes)) {
        assert.equal(w.written, true, `POSIX cache write for ${vendor} must succeed (unchanged rigor)`);
      }
      assertClosed(JSON.parse(readFileSync(cachePath(), 'utf-8')));
    }
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedCacheDir === undefined) delete process.env.HOPPER_CACHE_DIR;
    else process.env.HOPPER_CACHE_DIR = savedCacheDir;
    if (savedKimiHome === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = savedKimiHome;
  }
});

test('all 8 adapters have a probe-module that exports probe()', async () => {
  for (const name of listAdapters()) {
    const mod = await import(`../../cli/src/vendor-probe/${name}.js`);
    assert.equal(typeof mod.probe, 'function', `${name} must export probe()`);
  }
});

test('probe result shape is consistent across all adapters', async () => {
  // Probe the cheap ones only; Kimi may spawn two fast local CLI commands when installed.
  for (const name of ['agy', 'kimi']) {
    const r = await probeVendor(name);
    assert.ok(['full', 'partial', 'config-only', 'none'].includes(r.introspection_supported),
      `${name} introspection_supported must be one of valid levels; got ${r.introspection_supported}`);
    assert.ok('models' in r);
    assert.ok('models_source' in r);
    assert.ok('reasoning_levels' in r);
    assert.ok('notes' in r);
    assert.ok('duration_ms' in r);
    assert.ok(typeof r.duration_ms === 'number');
  }
});

test('codex probe-module: codex.probe parses .slug field (not .name/.id)', async () => {
  // Read the source to confirm the slug-field fix landed
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve, join } = await import('node:path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = resolve(__dirname, '..', '..');
  const src = readFileSync(join(REPO_ROOT, 'cli', 'src', 'vendor-probe', 'codex.js'), 'utf-8');
  assert.match(src, /m\.slug/, 'codex probe must extract .slug field per Phase 6b research');
});

test('zero-spawn discovery surface unchanged: --check / --capabilities still spawn-free', async () => {
  // The path-resolve.js + vendors/index.js + adapter files must STILL be
  // spawn-free. Vendor-probe/*.js MAY spawn (that's the carve-out).
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve, join } = await import('node:path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = resolve(__dirname, '..', '..');

  const discoveryHotPath = [
    join(REPO_ROOT, 'cli', 'src', 'path-resolve.js'),
    join(REPO_ROOT, 'cli', 'src', 'vendors', 'index.js'),
    join(REPO_ROOT, 'cli', 'src', 'vendors', 'codex.js'),
    join(REPO_ROOT, 'cli', 'src', 'vendors', 'kimi.js'),
    join(REPO_ROOT, 'cli', 'src', 'vendors', 'opencode.js'),
    join(REPO_ROOT, 'cli', 'src', 'vendors', 'copilot.js'),
    join(REPO_ROOT, 'cli', 'src', 'vendors', 'agy.js'),
    join(REPO_ROOT, 'cli', 'src', 'vendors', 'grok.js'),
    join(REPO_ROOT, 'cli', 'src', 'vendors', 'mimo.js'),
    join(REPO_ROOT, 'cli', 'src', 'vendors', 'claude.js'),
  ];
  for (const f of discoveryHotPath) {
    const src = readFileSync(f, 'utf-8');
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const noStrings = noComments.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``');
    const noImports = noStrings.replace(/^\s*import\s*\{[^}]*\}\s*from[^;\n]+;?/gm, '');
    assert.ok(!/\bspawn\s*\(/.test(noImports),
      `${f.split(/[/\\]/).pop()}: contains spawn() call site — would break --check/--capabilities zero-spawn proof`);
  }
});

// ─── P1-fix: static-fixture tests for the 4 parser paths ───────────────

test('codex parser: extracts .slug from JSON array', async () => {
  const { parseCodexModelsJson } = await import('../../cli/src/vendor-probe/codex.js');
  const stdout = JSON.stringify([
    { slug: 'gpt-5.5', name: 'GPT 5.5 (display)', id: 'm-1' },
    { slug: 'gpt-5.4' },
  ]);
  assert.deepEqual(parseCodexModelsJson(stdout), ['gpt-5.5', 'gpt-5.4']);
});

test('codex parser: handles { models: [...] } envelope', async () => {
  const { parseCodexModelsJson } = await import('../../cli/src/vendor-probe/codex.js');
  const stdout = JSON.stringify({ models: [{ slug: 'foo' }, { slug: 'bar' }] });
  assert.deepEqual(parseCodexModelsJson(stdout), ['foo', 'bar']);
});

test('codex parser: falls back to .name then .id when .slug missing', async () => {
  const { parseCodexModelsJson } = await import('../../cli/src/vendor-probe/codex.js');
  const stdout = JSON.stringify([{ name: 'fallback-name' }, { id: 'fallback-id' }]);
  assert.deepEqual(parseCodexModelsJson(stdout), ['fallback-name', 'fallback-id']);
});

test('codex parser: filters out entries with no identifier', async () => {
  const { parseCodexModelsJson } = await import('../../cli/src/vendor-probe/codex.js');
  const stdout = JSON.stringify([{ slug: 'good' }, {}, { other: 'x' }, { slug: 'good2' }]);
  assert.deepEqual(parseCodexModelsJson(stdout), ['good', 'good2']);
});

test('codex parser: throws on malformed JSON', async () => {
  const { parseCodexModelsJson } = await import('../../cli/src/vendor-probe/codex.js');
  assert.throws(() => parseCodexModelsJson('not json {'));
});

// ─── Codex account-aware probe arbitration ────────────────────────────────

const CODEX_PROBE_NOW = Date.parse('2026-07-21T10:00:00.000Z');
const CODEX_COMMAND_MODELS = [{ slug: 'gpt-5.6-sol' }, { slug: 'gpt-5.3-codex-spark' }];

function codexCache({
  fetched_at = '2026-07-21T09:59:00.000Z',
  client_version = '0.144.5',
  models = CODEX_COMMAND_MODELS,
} = {}) {
  return JSON.stringify({ fetched_at, client_version, models });
}

function codexProbeDeps({ version = '0.144.5', models = CODEX_COMMAND_MODELS, cache, runner } = {}) {
  const calls = [];
  const defaultRunner = async (_command, args) => {
    calls.push(args);
    if (args.at(-1) === '--version') return { exitCode: 0, stdout: `${version}\n`, stderr: '', timedOut: false };
    return { exitCode: 0, stdout: JSON.stringify(models), stderr: '', timedOut: false };
  };
  return {
    calls,
    deps: {
      runner: runner || defaultRunner,
      pathResolver: () => ({ resolvedPath: '/fake/codex', command: '/fake/codex', prependArgs: [] }),
      readFile: () => {
        if (cache instanceof Error) throw cache;
        return cache;
      },
      env: { CODEX_HOME: '/account-codex', HOPPER_CODEX_HOME: '/wrong-hopper-home' },
      home: () => '/home/ignored',
      clock: () => CODEX_PROBE_NOW,
    },
  };
}

test('codex probe: fresh account cache containing Spark is full and spawns exactly version + debug models', async () => {
  const { probe } = await import('../../cli/src/vendor-probe/codex.js');
  const fixture = codexProbeDeps({ cache: codexCache() });
  const result = await probe(fixture.deps);
  assert.equal(result.introspection_supported, 'full');
  assert.ok(result.models.includes('gpt-5.3-codex-spark'));
  assert.deepEqual(fixture.calls, [['--version'], ['debug', 'models']]);
  assert.ok(!fixture.calls.flat().includes('--bundled'));
  assert.match(result.models_source, /account cache/);
  assert.ok(result.notes.some((note) => /cache age 60s/.test(note)));
});

test('codex probe: command success with missing, bad, or stale cache is partial and returns command models', async () => {
  const { probe } = await import('../../cli/src/vendor-probe/codex.js');
  const cases = [
    new Error(Object.assign(new Error('not found'), { code: 'ENOENT' })),
    '{not json',
    codexCache({ fetched_at: '2026-07-21T09:54:59.000Z' }),
  ];
  for (const cache of cases) {
    const fixture = codexProbeDeps({ cache });
    const result = await probe(fixture.deps);
    assert.equal(result.introspection_supported, 'partial');
    assert.deepEqual(result.models, ['gpt-5.6-sol', 'gpt-5.3-codex-spark']);
    assert.match(result.models_source, /command catalog/);
  }
});

test('codex probe: failed commands return a parsable nonempty account cache as partial', async () => {
  const { probe } = await import('../../cli/src/vendor-probe/codex.js');
  const calls = [];
  const fixture = codexProbeDeps({
    cache: codexCache(),
    runner: async (_command, args) => {
      calls.push(args);
      return { exitCode: 1, stdout: '', stderr: 'offline', timedOut: false };
    },
  });
  const result = await probe(fixture.deps);
  assert.equal(result.introspection_supported, 'partial');
  assert.ok(result.models.includes('gpt-5.3-codex-spark'));
  assert.match(result.models_source, /account cache/);
  assert.deepEqual(calls, [['--version'], ['debug', 'models']]);
});

test('codex probe: failed commands and no cache returns none', async () => {
  const { probe } = await import('../../cli/src/vendor-probe/codex.js');
  const fixture = codexProbeDeps({
    cache: new Error(Object.assign(new Error('not found'), { code: 'ENOENT' })),
    runner: async () => ({ exitCode: 1, stdout: '', stderr: 'offline', timedOut: false }),
  });
  const result = await probe(fixture.deps);
  assert.equal(result.introspection_supported, 'none');
  assert.deepEqual(result.models, []);
});

test('codex probe: version mismatch or output conflict makes the command catalog partial', async () => {
  const { probe } = await import('../../cli/src/vendor-probe/codex.js');
  const cases = [
    { cache: codexCache({ client_version: '0.143.0' }) },
    { cache: codexCache({ models: [{ slug: 'gpt-5.6-sol' }, { slug: 'gpt-5.3-codex-spark' }, { slug: 'hidden-account-model' }] }) },
  ];
  for (const testCase of cases) {
    const fixture = codexProbeDeps(testCase);
    const result = await probe(fixture.deps);
    assert.equal(result.introspection_supported, 'partial');
    assert.deepEqual(result.models, ['gpt-5.6-sol', 'gpt-5.3-codex-spark']);
    assert.ok(result.notes.some((note) => /match=false|conflict=true/.test(note)));
  }
});

test('codex probe: CODEX_HOME cache path wins and HOPPER_CODEX_HOME is ignored', async () => {
  const { probe } = await import('../../cli/src/vendor-probe/codex.js');
  const { join, normalize } = await import('node:path');
  let readPath = null;
  const fixture = codexProbeDeps({ cache: codexCache() });
  fixture.deps.readFile = (path) => {
    readPath = path;
    return codexCache();
  };
  await probe(fixture.deps);
  assert.equal(normalize(readPath), normalize(join('/account-codex', 'models_cache.json')));
  assert.ok(!readPath.includes('wrong-hopper-home'));

  fixture.deps.env = { HOPPER_CODEX_HOME: '/still-ignored' };
  fixture.deps.home = () => '/default-home';
  await probe(fixture.deps);
  assert.equal(normalize(readPath), normalize(join('/default-home', '.codex', 'models_cache.json')));
});

test('opencode parser: strips ANSI codes', async () => {
  const { stripAnsi } = await import('../../cli/src/vendor-probe/opencode.js');
  // ESC[31m red ESC[0m reset
  const colored = '\x1B[31mclaude-opus-4-7\x1B[0m';
  assert.equal(stripAnsi(colored), 'claude-opus-4-7');
});

test('opencode parser: extracts model identifiers and EXCLUDES header lines', async () => {
  const { parseOpencodeModelsList } = await import('../../cli/src/vendor-probe/opencode.js');
  const stdout = [
    '\x1B[1mAvailable models:\x1B[0m',         // R2-P1: header MUST be excluded
    'Available models:',                         // bare header form too
    'Models in catalog (13):',                  // another header form
    '',
    'opencode/claude-opus-4-7',
    'opencode/claude-sonnet-4-6',
    'deepseek/v4-flash',
    'xiaomi/mimo-coder-pro:thinking',
    '  ',
    '(some prose with parens)',
    '# comment-like',
    '* asterisk leader',
  ].join('\n');
  const got = parseOpencodeModelsList(stdout);
  assert.ok(got.includes('opencode/claude-opus-4-7'));
  assert.ok(got.includes('deepseek/v4-flash'));
  assert.ok(got.includes('xiaomi/mimo-coder-pro:thinking'));
  // R2-P1 regression: lines with whitespace / prose must NOT be included
  assert.ok(!got.includes('Available models:'),
    `R2-P1: header line must be excluded; got models: ${got.join(', ')}`);
  assert.ok(!got.some((m) => m.includes(' ')),
    `no identifier may contain whitespace; got: ${got.join(', ')}`);
  assert.ok(!got.some((m) => m.includes(':') && m.endsWith(':')),
    `no identifier may end with ':' (that would indicate a header); got: ${got.join(', ')}`);
  // Exactly the 4 real models present
  assert.equal(got.length, 4, `expected 4 model identifiers, got ${got.length}: ${got.join(', ')}`);
});

test('mimo parser: extracts model identifiers and excludes decorative output', async () => {
  const { parseMimoModelsList } = await import('../../cli/src/vendor-probe/mimo.js');
  const stdout = [
    '\x1B[1mAvailable models:\x1B[0m',
    '',
    'mimo/mimo-auto',
    'xiaomi/mimo-v2-flash',
    'xiaomi/mimo-v2.5-pro-ultraspeed',
    '┌ Credentials',
    'some prose with spaces',
  ].join('\n');
  const got = parseMimoModelsList(stdout);
  assert.deepEqual(got, [
    'mimo/mimo-auto',
    'xiaomi/mimo-v2-flash',
    'xiaomi/mimo-v2.5-pro-ultraspeed',
  ]);
});

test('kimi parser: handles bare TOML section names', async () => {
  const { parseKimiTomlConfig } = await import('../../cli/src/vendor-probe/kimi.js');
  const content = `
[models.default]
capabilities = ["thinking", "vision"]

[models.fast]
capabilities = ["thinking"]
`;
  const r = parseKimiTomlConfig(content);
  assert.deepEqual(r.models, ['default', 'fast']);
  assert.equal(r.modelsCaps.length, 2);
  assert.deepEqual(r.modelsCaps[0].caps, ['thinking', 'vision']);
});

test('kimi parser: P2-fix — handles TOML-quoted section names with slashes', async () => {
  const { parseKimiTomlConfig } = await import('../../cli/src/vendor-probe/kimi.js');
  const content = `
[models."kimi-code/kimi-for-coding"]
capabilities = ["thinking"]

[models.'single-quoted/name']
capabilities = ["always_thinking"]
`;
  const r = parseKimiTomlConfig(content);
  assert.deepEqual(r.models, ['kimi-code/kimi-for-coding', 'single-quoted/name']);
  // Both capability blocks must be extracted (regression: original indexOf missed quoted keys)
  assert.equal(r.modelsCaps.length, 2,
    `expected 2 modelsCaps, got ${r.modelsCaps.length}: ${JSON.stringify(r.modelsCaps)}`);
  assert.deepEqual(r.modelsCaps[0].caps, ['thinking']);
  assert.deepEqual(r.modelsCaps[1].caps, ['always_thinking']);
});

test('kimi parser: R2-P2 — handles brackets inside TOML-quoted keys', async () => {
  const { parseKimiTomlConfig } = await import('../../cli/src/vendor-probe/kimi.js');
  const content = `
[models."a.b+key[1]"]
capabilities = ["thinking"]

[models."weird]name"]
capabilities = ["vision"]

[models.plain]
capabilities = ["fast"]
`;
  const r = parseKimiTomlConfig(content);
  // Bracket-containing quoted keys must be captured fully
  assert.ok(r.models.includes('a.b+key[1]'),
    `R2-P2: bracket-containing key must survive; got models: ${r.models.join(', ')}`);
  assert.ok(r.models.includes('plain'));
  // Capability extraction must work even for the bracket-key section
  const bracketCap = r.modelsCaps.find((c) => c.name === 'a.b+key[1]');
  assert.ok(bracketCap, 'expected capabilities for the bracket-key model');
  assert.deepEqual(bracketCap.caps, ['thinking']);
});

test('kimi parser: empty config returns empty result', async () => {
  const { parseKimiTomlConfig } = await import('../../cli/src/vendor-probe/kimi.js');
  const r = parseKimiTomlConfig('# just comments\n# no model blocks\n');
  assert.deepEqual(r.models, []);
  assert.deepEqual(r.modelsCaps, []);
});

test('kimi parser: provider list JSON extracts configured aliases and capabilities', async () => {
  const { parseKimiProviderListJson } = await import('../../cli/src/vendor-probe/kimi.js');
  const stdout = `${JSON.stringify({
    providers: { 'managed:kimi-code': { type: 'kimi' } },
    models: {
      'kimi-code/kimi-for-coding': { capabilities: ['thinking', 'image_in', 'tool_use'] },
      'local/custom': { capabilities: ['tool_use'] },
    },
  })}\n[logger] write failed: EPERM\n`;
  const r = parseKimiProviderListJson(stdout);
  assert.deepEqual(r.providers, ['managed:kimi-code']);
  assert.deepEqual(r.models, ['kimi-code/kimi-for-coding', 'local/custom']);
  assert.deepEqual(r.modelsCaps[0], {
    name: 'kimi-code/kimi-for-coding',
    caps: ['thinking', 'image_in', 'tool_use'],
  });
});

test('copilot scanner: lists *.agent.md files with name stripping', async (t) => {
  const { scanAgentMdFiles } = await import('../../cli/src/vendor-probe/copilot.js');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: pathJoin } = await import('node:path');
  const dir = mkdtempSync(pathJoin(tmpdir(), 'copilot-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(pathJoin(dir, 'reviewer.agent.md'), '---\nname: reviewer\n---\n');
  writeFileSync(pathJoin(dir, 'planner.agent.md'), '---\nname: planner\n---\n');
  writeFileSync(pathJoin(dir, 'README.md'), 'not an agent');           // ignored: wrong suffix
  writeFileSync(pathJoin(dir, '.gitignore'), '');                       // ignored
  const got = scanAgentMdFiles(dir);
  assert.ok(got.includes('reviewer'), `expected reviewer; got ${got.join(', ')}`);
  assert.ok(got.includes('planner'), `expected planner; got ${got.join(', ')}`);
  assert.ok(!got.some((s) => s.includes('README')), `README must not be listed; got ${got.join(', ')}`);
  assert.equal(got.length, 2);
});

test('copilot scanner: applies suffix when provided', async (t) => {
  const { scanAgentMdFiles } = await import('../../cli/src/vendor-probe/copilot.js');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: pathJoin } = await import('node:path');
  const dir = mkdtempSync(pathJoin(tmpdir(), 'copilot-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(pathJoin(dir, 'foo.agent.md'), '');
  const got = scanAgentMdFiles(dir, ' (project)');
  assert.deepEqual(got, ['foo (project)']);
});

test('copilot scanner: missing dir returns empty array (does not throw)', async () => {
  const { scanAgentMdFiles } = await import('../../cli/src/vendor-probe/copilot.js');
  assert.deepEqual(scanAgentMdFiles('/no/such/path/should/not/exist'), []);
});

test('vendor-probe modules are NOT pulled into --check/--capabilities (lazy import)', async () => {
  // Verify vendors/index.js uses dynamic import for probe modules so they
  // are not loaded by --check or --capabilities (which don't probe).
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve, join } = await import('node:path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = resolve(__dirname, '..', '..');
  const indexSrc = readFileSync(join(REPO_ROOT, 'cli', 'src', 'vendors', 'index.js'), 'utf-8');
  // Must contain a dynamic import for vendor-probe
  assert.match(indexSrc, /await\s+import\s*\(\s*['"`]\.\.\/vendor-probe\//,
    'vendors/index.js must lazy-import vendor-probe modules so --check/--capabilities stay spawn-free');
});

// ─── grok parser + live-probe self-heal (ISSUE-grok-model-line-rotation-stale-knownGood.md) ───
//
// V3 upgrade: grok's model line rotates without notice (grok-build /
// grok-composer-2.5-fast both silently became "unknown model id" between
// 2026-06-02 and 2026-07-16). The probe used to be a hardcoded static
// catalog (zero-spawn); it now actually spawns `grok models` and parses its
// "Available models:" bullet list, so a future rename self-heals via
// `--probe grok` instead of requiring a source-code fix every time xAI
// renames a model.

test('grok parser: extracts the single default model from a real "grok models" sample (v0.2.101, 2026-07-18)', async () => {
  const { parseGrokModelsList } = await import('../../cli/src/vendor-probe/grok.js');
  // Verbatim live capture: `grok models` on grok CLI v0.2.101.
  const stdout = [
    'You are logged in with grok.com.',
    '',
    'Default model: grok-4.5',
    '',
    'Available models:',
    '  * grok-4.5 (default)',
    '',
  ].join('\n');
  assert.deepEqual(parseGrokModelsList(stdout), ['grok-4.5']);
});

test('grok parser: extracts multiple bulleted models, dash leaders, and stops at trailing prose', async () => {
  const { parseGrokModelsList } = await import('../../cli/src/vendor-probe/grok.js');
  const stdout = [
    'Available models:',
    '  * grok-4.5 (default)',
    '  * grok-4.5-fast',
    '  - grok-3-mini',
    '',
    'Use --model <id> to select a model.',
  ].join('\n');
  assert.deepEqual(parseGrokModelsList(stdout), ['grok-4.5', 'grok-4.5-fast', 'grok-3-mini']);
});

test('grok parser: no "Available models:" header returns [] (never throws)', async () => {
  const { parseGrokModelsList } = await import('../../cli/src/vendor-probe/grok.js');
  assert.deepEqual(parseGrokModelsList('You are not logged in. Run `grok login`.'), []);
  assert.deepEqual(parseGrokModelsList(''), []);
  assert.deepEqual(parseGrokModelsList(undefined), []);
});

test('grok parser: header present but no bullet lines follow returns []', async () => {
  const { parseGrokModelsList } = await import('../../cli/src/vendor-probe/grok.js');
  assert.deepEqual(parseGrokModelsList('Available models:\nNo models configured.'), []);
});

test('grok probe: live-parses a fake `grok models` binary into introspection_supported=full', async (t) => {
  const { mkdtempSync, writeFileSync, rmSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, delimiter } = await import('node:path');
  const { probe } = await import('../../cli/src/vendor-probe/grok.js');

  const tmp = mkdtempSync(join(tmpdir(), 'grok-probe-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const isWindows = process.platform === 'win32';
  const fakeGrok = join(tmp, isWindows ? 'grok.cmd' : 'grok');
  const sample = [
    'You are logged in with grok.com.',
    '',
    'Default model: grok-4.5',
    '',
    'Available models:',
    '  * grok-4.5 (default)',
  ].join('\n');
  if (isWindows) {
    writeFileSync(fakeGrok, [
      '@echo off',
      'if "%1"=="models" (',
      `  echo ${sample.split('\n').join('&echo ')}`,
      '  exit /b 0',
      ')',
      'exit /b 2',
    ].join('\r\n'));
  } else {
    writeFileSync(fakeGrok, [
      '#!/bin/sh',
      'if [ "$1" = "models" ]; then',
      `  cat <<'GROKEOF'`,
      sample,
      'GROKEOF',
      '  exit 0',
      'fi',
      'exit 2',
      '',
    ].join('\n'));
    chmodSync(fakeGrok, 0o755);
  }

  const savedPath = process.env.PATH;
  process.env.PATH = `${tmp}${delimiter}${savedPath || ''}`;
  try {
    const r = await probe();
    assert.equal(r.introspection_supported, 'full');
    assert.deepEqual(r.models, ['grok-4.5']);
    assert.match(r.models_source, /grok models/);
    assert.ok(r.notes.some((n) => /model line rotates/.test(n)), 'notes should explain the self-heal rationale');
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  }
});

test('grok probe: falls back HONESTLY to static knownGood when `grok models` is unparseable, and says so', async (t) => {
  const { mkdtempSync, writeFileSync, rmSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, delimiter } = await import('node:path');
  const { probe } = await import('../../cli/src/vendor-probe/grok.js');
  const { grokAdapter } = await import('../../cli/src/vendors/grok.js');

  const tmp = mkdtempSync(join(tmpdir(), 'grok-probe-fallback-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const isWindows = process.platform === 'win32';
  const fakeGrok = join(tmp, isWindows ? 'grok.cmd' : 'grok');
  if (isWindows) {
    writeFileSync(fakeGrok, [
      '@echo off',
      'if "%1"=="models" (',
      '  echo unexpected output shape, no header',
      '  exit /b 0',
      ')',
      'exit /b 2',
    ].join('\r\n'));
  } else {
    writeFileSync(fakeGrok, [
      '#!/bin/sh',
      'if [ "$1" = "models" ]; then',
      '  echo "unexpected output shape, no header"',
      '  exit 0',
      'fi',
      'exit 2',
      '',
    ].join('\n'));
    chmodSync(fakeGrok, 0o755);
  }

  const savedPath = process.env.PATH;
  process.env.PATH = `${tmp}${delimiter}${savedPath || ''}`;
  try {
    const r = await probe();
    assert.equal(r.introspection_supported, 'partial', 'unparseable live output degrades to partial, not a silent full/none');
    assert.deepEqual(r.models, grokAdapter.capabilities.modelArg.knownGood, 'falls back to the adapter static knownGood verbatim');
    assert.match(r.models_source, /static knownGood fallback/);
    assert.ok(r.notes.some((n) => /did not match the expected/.test(n)), 'notes must explain WHY it fell back');
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  }
});

test('grok probe: binary not on PATH returns introspection_supported=none (unchanged contract)', async () => {
  const { probe } = await import('../../cli/src/vendor-probe/grok.js');
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const r = await probe();
    assert.equal(r.introspection_supported, 'none');
    assert.deepEqual(r.models, []);
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  }
});
