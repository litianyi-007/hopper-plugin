// Vendor readiness aggregator ("setup"/"doctor").
// Anchor: tests/unit/setup.test.js

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildVendorReadiness, summarizeReadiness, sandboxControl, webSearchSupport, formatModelDrift, buildRuntimeReport, buildNextSteps, MIN_NODE_MAJOR } from '../../cli/src/setup.js';
import { reconcileModels } from '../../cli/src/model-normalize.js';
import { listAdapters, getAdapter } from '../../cli/src/vendors/index.js';
import { getVendorCache, setVendorCache } from '../../cli/src/cache.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DISPATCH_BIN = resolve(__dirname, '..', '..', 'cli', 'bin', 'hopper-dispatch');

// --- Windows fail-closed context (2026-08-03 user ruling; see cache.test.js
// for the full diagnostic writeup) --------------------------------------
//
// A real windows-latest CI diagnostic showed `/inheritance:r` cannot strip
// pre-existing explicit SYSTEM/Administrators ACEs, so owner-only can never
// be established on Windows and every vendor-cache WRITE fails closed there
// -- deliberately, not a bug. buildVendorReadiness() (cli/src/setup.js) calls
// cache.js's setVendorCache() internally with NO injectable `security`
// override (adding one would be a cli/ change, out of scope for this
// test-only fix), so the two tests below that exercise buildVendorReadiness's
// OWN persist path can only observe the real fail-closed decision on an
// actual win32 host, guarded by `WIN32` below (same layering as
// cache.test.js's recoverCache() tests).
const WIN32 = process.platform === 'win32';

// An OS-independent "owner-only always succeeds" security stub, used ONLY to
// seed test fixtures (an existing cache entry) so that step isn't itself
// subject to the ambient platform's real cache-write security -- the actual
// subject under test elsewhere is buildVendorReadiness's own never-clobber
// decision, not the cache write's owner-only mechanism. Same rationale/shape
// as cache.test.js's ALWAYS_OWNER_ONLY_SECURITY.
const ALWAYS_OWNER_ONLY_SECURITY = {
  prepareParentOwnerOnly() {},
  assertParentOwnerOnly() { return true; },
  prepareOwnerOnly() {},
  assertOwnerOnly() { return true; },
};

test('setup: buildVendorReadiness returns one well-formed row per registered vendor', async () => {
  const rows = await buildVendorReadiness();
  assert.equal(rows.length, listAdapters().length);
  for (const r of rows) {
    assert.equal(typeof r.name, 'string');
    assert.equal(typeof r.installed, 'boolean');
    assert.ok(['ok', true, false].includes(r.authOk) || typeof r.authOk === 'boolean');
    assert.ok(['argv', 'full', 'native', '?'].includes(r.sandboxControl), `${r.name} sandboxControl`);
    assert.ok(['yes', 'manual', 'no', '?'].includes(r.webSearch), `${r.name} webSearch`);
    assert.ok('models' in r && 'capsStaleAfter' in r);
  }
});

test('setup: Grok keeps credential detection as unverified context only', async () => {
  const saved = process.env.XAI_API_KEY;
  try {
    process.env.XAI_API_KEY = 'unit-secret-never-returned';
    const [grok] = await buildVendorReadiness({ only: 'grok' });
    assert.equal(grok.authContext, 'key-present-unverified');
    assert.equal(grok.authState, 'unverified');
    assert.doesNotMatch(JSON.stringify(grok), /unit-secret-never-returned/);
  } finally {
    if (saved === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = saved;
  }
});

test('setup/check: Grok renders a local auth context as unverified, not remote authentication proof', () => {
  const secret = 'unit-secret-never-returned';
  for (const args of [['--setup', 'grok'], ['--check', 'grok']]) {
    const result = spawnSync(process.execPath, [DISPATCH_BIN, ...args], {
      encoding: 'utf8',
      env: { ...process.env, XAI_API_KEY: secret },
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, `${args.join(' ')} should be a zero-spawn diagnostic`);
    assert.match(output, /grok: status=\S+ auth=unverified auth_context=key-present-unverified/);
    assert.match(output, /zero-spawn/i);
    assert.match(output, /does not validate (?:the )?credential remotely/i);
    assert.match(output, /interactive\/browser state .* may not be inherited by the Hopper Node parent/i);
    assert.doesNotMatch(output, /auth=verified/);
    assert.doesNotMatch(output, new RegExp(secret));
  }
});

test('setup/check: ANY adapter declaring an authContext renders it — not just grok', () => {
  // Regression guard. renderReadinessAuth() in cli/bin/hopper-dispatch keyed on
  // `vendor === 'grok'`, so when `pi` became the second adapter to declare an
  // authContext its declaration was silently DROPPED: the line printed
  // `auth=advisory`, i.e. it claimed more than a zero-spawn check can know,
  // which is exactly what the grok branch existed to prevent. The renderer now
  // keys on the DECLARATION, so this holds for whichever adapter declares one.
  const declaring = listAdapters().filter((v) => getAdapter(v).envPreflight().authContext !== undefined);
  assert.ok(declaring.length >= 2,
    `this guard is only meaningful with 2+ declaring adapters; got [${declaring.join(', ')}]`);
  for (const vendor of declaring) {
    const result = spawnSync(process.execPath, [DISPATCH_BIN, '--check', vendor], { encoding: 'utf8' });
    assert.equal(result.status, 0, `--check ${vendor} should be a zero-spawn diagnostic`);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, new RegExp(`${vendor}: status=\\S+ auth=unverified auth_context=\\S+`),
      `${vendor} declares an authContext from envPreflight(), so --check must render it as unverified ` +
      'context rather than collapsing it to advisory/verified.');
    assert.doesNotMatch(output, new RegExp(`${vendor}: status=\\S+ auth=(?:advisory|verified)`),
      `${vendor}'s declared local credential context must never be presented as remote authentication proof`);
  }
});

test('buildRuntimeReport: flags Node below the supported minimum', () => {
  assert.equal(buildRuntimeReport({ nodeVersion: 'v22.5.0' }).nodeOk, true);
  const old = buildRuntimeReport({ nodeVersion: 'v16.20.0' });
  assert.equal(old.nodeOk, false);
  assert.equal(old.nodeMajor, 16);
  assert.equal(old.minNodeMajor, MIN_NODE_MAJOR);
});

test('summarizeReadiness: usable excludes dispatch-disabled vendors; ready does not', () => {
  const rows = [
    { name: 'codex', installed: true, authOk: true, capsStale: false, dispatchDisabled: null },
    { name: 'agy', installed: true, authOk: true, capsStale: false, dispatchDisabled: { reason: 'x', enableEnv: 'HOPPER_ENABLE_AGY' } },
  ];
  const sum = summarizeReadiness(rows);
  assert.equal(sum.ready, 2);   // both installed + authed
  assert.equal(sum.usable, 1);  // agy excluded (disabled by capability)
  assert.deepEqual(sum.disabled, ['agy']);
});

test('buildNextSteps: surfaces install / probe / disabled / workspace actions', () => {
  const rows = [
    { name: 'codex', installed: true, authOk: true, capsStale: false, models: ['m'], dispatchDisabled: null },
    { name: 'kimi', installed: true, authOk: true, capsStale: false, models: [], dispatchDisabled: null }, // un-probed
    { name: 'agy', installed: true, authOk: true, capsStale: false, models: ['m'], dispatchDisabled: { reason: 'r', enableEnv: 'HOPPER_ENABLE_AGY' } },
    { name: 'grok', installed: false, authOk: false, capsStale: false, models: null, dispatchDisabled: null },
  ];
  const sum = summarizeReadiness(rows);
  const text = buildNextSteps(rows, sum, { hopperDir: '/x/.hopper' }).join('\n');
  assert.match(text, /Install missing vendor CLI\(s\): grok/);
  assert.match(text, /Populate model caches/);          // kimi has no cached models
  assert.match(text, /HOPPER_ENABLE_AGY=1/);             // agy disabled
  assert.doesNotMatch(text, /agy 1\b/);                  // no mangled-version truncation (regression)

  // missing workspace surfaces --init-tasks
  assert.match(buildNextSteps([], summarizeReadiness([]), { hopperDir: null }).join('\n'), /--init-tasks/);
});

test('setup: sandboxControl(codex) is platform-split (2026-07-31) — full on Windows, argv on macOS/Linux; kimi stays native', () => {
  // codex: its -s sandbox is broken on Windows so it always emits the bypass flag there →
  // 'full' (pins full-access, not downgradable). On macOS/Linux codex's own -s <mode>
  // sandbox is verified working, so its read-only argv genuinely differs and carries no
  // unconditional-access flag → 'argv' (hopper can force a real downgrade). `platform` is
  // a test-only override forwarded into adapter.args(); production callers never set it.
  assert.equal(sandboxControl(getAdapter('codex'), { platform: 'win32' }), 'full');
  assert.equal(sandboxControl(getAdapter('codex'), { platform: 'darwin' }), 'argv');
  assert.equal(sandboxControl(getAdapter('codex'), { platform: 'linux' }), 'argv');
  // kimi carries no sandbox flag at all → 'native', regardless of platform.
  assert.equal(sandboxControl(getAdapter('kimi')), 'native');
});

test('setup: sandboxControl(codex) with no platform override reflects the REAL host platform', { skip: process.platform === 'win32' ? 'this host IS Windows — the win32 branch above already covers it live' : false }, () => {
  // No injection — proves the production call path (buildVendorReadiness never
  // passes `platform`) resolves correctly via adapter.args()'s own
  // `opts.platform ?? process.platform` default on THIS actual host.
  assert.equal(sandboxControl(getAdapter('codex')), 'argv');
});

test('setup: web-search readiness reflects per-adapter capability (T3)', () => {
  for (const v of ['codex', 'claude', 'grok', 'kimi']) {
    assert.equal(webSearchSupport(getAdapter(v)), 'yes', `${v} headless web search (hopper-enabled)`);
  }
  assert.equal(webSearchSupport(getAdapter('copilot')), 'manual', 'copilot: full-access only; read-only token unverified');
  assert.equal(webSearchSupport(getAdapter('mimo')), 'manual', 'mimo: possible via env, not auto-forwarded');
  assert.equal(webSearchSupport(getAdapter('opencode')), 'no', 'opencode: config-gated, not headless out of the box');
  assert.equal(webSearchSupport(getAdapter('agy')), 'no');
});

test('setup: only-filter restricts to a single vendor', async () => {
  const rows = await buildVendorReadiness({ only: 'codex' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'codex');
  assert.equal(rows[0].webSearch, 'yes');
});

test('setup: capsStale uses the injected clock (deterministic)', async () => {
  const future = await buildVendorReadiness({ only: 'codex', now: new Date('2099-01-01') });
  assert.equal(future[0].capsStale, true, 'a far-future now makes capability metadata stale');
  const past = await buildVendorReadiness({ only: 'codex', now: new Date('2000-01-01') });
  assert.equal(past[0].capsStale, false, 'a past now keeps it fresh');
});

test('setup: summarizeReadiness rolls up ready/notInstalled/authMissing/capsStale', async () => {
  const rows = await buildVendorReadiness({ now: new Date('2000-01-01') });
  const sum = summarizeReadiness(rows);
  assert.equal(sum.total, rows.length);
  assert.ok(sum.ready <= sum.total);
  assert.ok(Array.isArray(sum.notInstalled) && Array.isArray(sum.authMissing) && Array.isArray(sum.capsStale));
  assert.equal(sum.capsStale.length, 0, 'no vendor is stale against a year-2000 clock');
});

// ─── V3 renderer: formatModelDrift (pure; the runSetup drift line) ───

test('formatModelDrift: OK row with suppression explains the gap accurately', () => {
  const kg = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'];
  const live = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2', 'codex-auto-review'];
  const rec = { applicable: true, ...reconcileModels('codex', kg, live, ['gpt-5.3-codex-spark', 'codex-auto-review', 'gpt-5.2']) };
  const out = formatModelDrift({ name: 'codex', modelsLive: live, modelReconcile: rec });
  assert.equal(out.verdict, 'OK');
  assert.match(out.detail, /4 of 6 live model\(s\) match defaults/);
  assert.match(out.detail, /2 expected-divergence suppressed \(driftExpected\)/);
});

test('formatModelDrift: DRIFT row lists NEW + STALE; n/a passes the reason; no-rec is a dash', () => {
  const drift = formatModelDrift({ name: 'mimo', modelsLive: ['a', 'b'], modelReconcile: { applicable: true, matched: ['a'], missingFromLive: ['x'], newOnLive: ['b'], expectedSuppressed: [] } });
  assert.equal(drift.verdict, 'DRIFT');
  assert.match(drift.detail, /NEW live model\(s\) absent from defaults: b/);
  assert.match(drift.detail, /STALE default\(s\) not in live catalog: x/);
  const na = formatModelDrift({ name: 'claude', modelsLive: [], modelReconcile: { applicable: false, reason: 'no live model-enumeration command (introspection: partial)' } });
  assert.equal(na.verdict, 'n/a');
  assert.match(na.detail, /introspection: partial/);
  assert.deepEqual(formatModelDrift({ name: 'x', modelReconcile: null }), { verdict: '—', detail: '' });
});

test('formatModelDrift: duplicate-tail defaults never yield a negative/over-100% count', () => {
  // pathological: two knownGood entries match the same single live model.
  const rec = { applicable: true, ...reconcileModels('codex', ['openai/gpt-5.5', 'gpt-5.5'], ['gpt-5.5'], []) };
  const out = formatModelDrift({ name: 'codex', modelsLive: ['gpt-5.5'], modelReconcile: rec });
  assert.equal(out.verdict, 'OK');
  assert.match(out.detail, /1 of 1 live model\(s\) match defaults/, 'live-side count stays sane (not "2 of 1")');
  assert.ok(!/-\d/.test(out.detail), 'no negative count leaks into the output');
});

// ─── V3: doctor --deep live model enumeration + reconcile (injected probe, no spawn) ───

test('V3 deep: a genuinely-live (introspection:full) catalog reconciles against knownGood', async () => {
  const fakeProbe = async () => ({ introspection_supported: 'full', models: ['gpt-5.5', 'GPT-5.4', 'gpt-6-new'], models_source: 'fake' });
  const rows = await buildVendorReadiness({ only: 'codex', deep: true, persist: false, probeFn: fakeProbe });
  const rec = rows[0].modelReconcile;
  assert.equal(rec.applicable, true);
  assert.ok(rec.matched.includes('gpt-5.5') && rec.matched.includes('gpt-5.4'), 'case-insensitive live match');
  assert.ok(rec.missingFromLive.includes('gpt-5.4-mini'), 'a default missing from the live catalog is STALE');
  assert.deepEqual(rec.newOnLive, ['gpt-6-new'], 'a live model absent from defaults is NEW');
  assert.deepEqual(rows[0].modelsLive, ['gpt-5.5', 'GPT-5.4', 'gpt-6-new']);
});

test('V3 deep: codex driftExpected suppresses Pro-only/internal noise; OK until a genuinely-new model appears', async () => {
  // Real codex knownGood + driftExpected, with a live catalog mirroring the bundled list.
  // gpt-5.6-sol/terra/luna: V-verified 2026-07-17 addition to knownGood (codex.js) — the
  // bundled catalog now ships them too, so the fixture must include them or they'd
  // false-flag as missingFromLive (STALE).
  const liveBundled = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2', 'codex-auto-review'];
  const okProbe = async () => ({ introspection_supported: 'full', models: liveBundled, models_source: 'codex debug models --bundled' });
  const ok = await buildVendorReadiness({ only: 'codex', deep: true, persist: false, probeFn: okProbe });
  assert.equal(ok[0].modelReconcile.applicable, true);
  assert.deepEqual(ok[0].modelReconcile.missingFromLive, [], 'spark (Pro-only) not flagged STALE');
  assert.deepEqual(ok[0].modelReconcile.newOnLive, [], 'gpt-5.2/codex-auto-review suppressed as expected');

  const newProbe = async () => ({ introspection_supported: 'full', models: [...liveBundled, 'gpt-6'], models_source: 'codex debug models --bundled' });
  const drift = await buildVendorReadiness({ only: 'codex', deep: true, persist: false, probeFn: newProbe });
  assert.deepEqual(drift[0].modelReconcile.newOnLive, ['gpt-6'], 'a genuinely-new model still surfaces as NEW');
});

test('V3 deep: introspection:partial with a non-empty STATIC list is n/a — NOT false drift (claude/kimi shape)', async () => {
  // The regression the review caught: claude returns introspection 'partial' with 4
  // static aliases; reconciling against its 9-entry knownGood would falsely flag 5 STALE.
  const fakeProbe = async () => ({ introspection_supported: 'partial', models: ['sonnet', 'opus', 'haiku', 'fable'], models_source: 'static aliases (no catalog command)' });
  const rows = await buildVendorReadiness({ only: 'claude', deep: true, persist: false, probeFn: fakeProbe });
  assert.equal(rows[0].modelReconcile.applicable, false, 'a static/partial list must not be reconciled');
  assert.match(rows[0].modelReconcile.reason, /introspection: partial|no live model-enumeration/);
});

test('V3 deep: introspection:none reports n/a (no false "missing")', async () => {
  const fakeProbe = async () => ({ introspection_supported: 'none', models: [], models_source: 'no enumeration command' });
  const rows = await buildVendorReadiness({ only: 'agy', deep: true, persist: false, probeFn: fakeProbe });
  assert.equal(rows[0].modelReconcile.applicable, false);
  assert.match(rows[0].modelReconcile.reason, /introspection: none|no live model-enumeration/);
});

test('V3 deep: a live catalog but a PLACEHOLDER knownGood (opencode sentinel) is n/a', async () => {
  const fakeProbe = async () => ({ introspection_supported: 'full', models: ['anthropic/claude-opus-4.8', 'openai/gpt-5.5'], models_source: 'opencode models' });
  const rows = await buildVendorReadiness({ only: 'opencode', deep: true, persist: false, probeFn: fakeProbe });
  assert.equal(rows[0].modelReconcile.applicable, false, 'sentinel knownGood (`<provider>/<model>`) must not be reconciled');
  assert.match(rows[0].modelReconcile.reason, /placeholder|no hardcoded knownGood/);
});

test('V3 deep: a probe that throws degrades to applicable:false (never blocks the report)', async () => {
  const fakeProbe = async () => { throw new Error('boom'); };
  const rows = await buildVendorReadiness({ only: 'grok', deep: true, persist: false, probeFn: fakeProbe });
  assert.equal(rows[0].modelReconcile.applicable, false);
  assert.match(rows[0].modelReconcile.reason, /probe failed: boom/);
  assert.equal(rows[0].modelsLive, null);
});

test('V3 shallow: non-deep doctor never enumerates (probeFn is not called)', async () => {
  let called = false;
  const rows = await buildVendorReadiness({ only: 'codex', deep: false, probeFn: async () => { called = true; return { introspection_supported: 'full', models: [] }; } });
  assert.equal(called, false, 'shallow doctor must not spawn/enumerate');
  assert.ok(rows[0].modelReconcile == null, 'no reconcile attached without --deep');
});

test('V3 deep: persist gate — true writes the live catalog to cache; false suppresses the write', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-setup-cache-'));
  const oldEnv = process.env.HOPPER_CACHE_DIR;
  process.env.HOPPER_CACHE_DIR = tmp;
  try {
    const fakeProbe = async () => ({ introspection_supported: 'full', models: ['gpt-5.5', 'gpt-6'], models_source: 'fake' });
    // persist:false → no cache file written (true on every platform).
    await buildVendorReadiness({ only: 'codex', deep: true, persist: false, probeFn: fakeProbe });
    assert.equal(getVendorCache('codex'), null, 'persist:false must not write the cache');

    // persist:true → cache reflects the live catalog -- EXCEPT on a real Windows
    // host, where buildVendorReadiness's internal (non-injectable) setVendorCache()
    // call fails closed (see the WIN32 comment above): owner-only can never be
    // established there, so no cache entry is ever produced. That is the
    // deliberate fail-closed decision, not a bug -- assert its ABSENCE instead of
    // its presence on Windows. This can only be forced on a genuine win32 host
    // (unlike cache.test.js's forcedWindowsSecurity(), buildVendorReadiness()
    // doesn't plumb an injectable `security` through to this internal call), so
    // unlike most Windows branches in this suite, this one is not cross-platform
    // forceable without a cli/ change -- out of scope for this fix.
    await buildVendorReadiness({ only: 'codex', deep: true, persist: true, probeFn: fakeProbe });
    const cached = getVendorCache('codex');
    if (WIN32) {
      assert.equal(cached, null, 'Windows fail-closed: owner-only can never be established here, so persist:true still writes nothing');
    } else {
      assert.ok(cached && Array.isArray(cached.models), 'persist:true writes a cache entry');
      assert.deepEqual(cached.models, ['gpt-5.5', 'gpt-6']);
    }
  } finally {
    if (oldEnv === undefined) delete process.env.HOPPER_CACHE_DIR; else process.env.HOPPER_CACHE_DIR = oldEnv;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('V3 deep: a non-live (partial) probe never clobbers an existing cache entry', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-setup-cache2-'));
  const oldEnv = process.env.HOPPER_CACHE_DIR;
  process.env.HOPPER_CACHE_DIR = tmp;
  try {
    // Seed a good prior cache entry through the OS-independent
    // ALWAYS_OWNER_ONLY_SECURITY stub (see top-of-file comment): this test's real
    // subject is buildVendorReadiness's OWN never-clobber decision for a
    // partial/static probe -- for such a probe `liveEnumerated` is false, so
    // buildVendorReadiness never even calls setVendorCache (cli/src/setup.js) --
    // which holds on every platform, including a real Windows host where cache
    // writes otherwise fail closed. Seeding through the real, ambient,
    // platform-gated security would make the FIXTURE SETUP itself subject to
    // that unrelated fail-closed decision, which isn't what this test is about.
    setVendorCache('claude', { models: ['sonnet', 'opus'], introspection_supported: 'partial', probed_at: '2020-01-01T00:00:00.000Z' }, { security: ALWAYS_OWNER_ONLY_SECURITY });
    const fakeProbe = async () => ({ introspection_supported: 'partial', models: ['sonnet', 'opus', 'haiku', 'fable'], models_source: 'static' });
    await buildVendorReadiness({ only: 'claude', deep: true, persist: true, probeFn: fakeProbe });
    const cached = getVendorCache('claude');
    assert.equal(cached.probed_at, '2020-01-01T00:00:00.000Z', 'a partial/static probe must not refresh the cache timestamp');
    assert.deepEqual(cached.models, ['sonnet', 'opus'], 'a partial/static probe must not overwrite cached models');
  } finally {
    if (oldEnv === undefined) delete process.env.HOPPER_CACHE_DIR; else process.env.HOPPER_CACHE_DIR = oldEnv;
    rmSync(tmp, { recursive: true, force: true });
  }
});
