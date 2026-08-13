// V2/V5: agy auth misclassification fix + agy --model + bare-model knownGood corrections.
// Anchor: tests/unit/vendor-model-auth.test.js

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { agyAdapter } from '../../cli/src/vendors/agy.js';
import { copilotAdapter } from '../../cli/src/vendors/copilot.js';
import { grokAuthContext } from '../../cli/src/vendors/grok.js';
import { getAdapter, listAdapters, installCheckForAdapter } from '../../cli/src/vendors/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── V5: agy never-auth was a false positive (boot noise + non-TTY stdout drop) ───

test('V5 agy parseResult: boot-time auth noise + a success marker is NOT auth-fail', () => {
  // The exact reproduced shape: exit 0, empty stdout (non-TTY drop), log has transient
  // "not logged in" boot noise THEN the authoritative success markers.
  const r = agyAdapter.parseResult({
    exitCode: 0, timedOut: false, durationMs: 43000, stdout: '', stderr: '',
    logFileContent: [
      'printmode.go:190 Print mode: not authenticated, trying silent auth',
      'You are not logged into Antigravity',
      'Failed to get OAuth token: error getting token source',
      'auth.go:132 ChainedAuth: authenticated via keyring (effective: keyring)',
      'server_oauth.go:217 OAuth: authenticated successfully as user@example.com',
      'printmode.go:192 Print mode: silent auth succeeded',
      '<full conversation streamed> ... clean shutdown',
    ].join('\n'),
  });
  assert.notEqual(r.status, 'auth-fail', 'boot noise + success marker must NOT be auth-fail');
  assert.equal(r.status, 'unknown-fail');
  assert.match(r.error, /non-TTY stdout|interactive TUI/, 'explains the real cause (1.0.12 non-TTY --print drop)');
});

test('V5 agy parseResult: a REAL auth failure marker (no success) is still auth-fail', () => {
  const r = agyAdapter.parseResult({
    exitCode: 1, timedOut: false, durationMs: 1200, stdout: '', stderr: '',
    logFileContent: 'Print mode: silent auth failed, triggering OAuth\nkeyringAuth: timed out',
  });
  assert.equal(r.status, 'auth-fail');
});

test('V5 agy parseResult: exit 0 + real stdout + auth marker = success', () => {
  const r = agyAdapter.parseResult({
    exitCode: 0, timedOut: false, durationMs: 5000, stdout: 'THE ANSWER', stderr: '',
    logFileContent: 'ChainedAuth: authenticated via keyring',
  });
  assert.equal(r.status, 'success');
  assert.equal(r.text, 'THE ANSWER');
});

test('V5 agy parseResult: boot noise + success marker + REAL stdout = success (the common recovery)', () => {
  const r = agyAdapter.parseResult({
    exitCode: 0, timedOut: false, durationMs: 5000, stdout: 'HOPPER_AGY_OK', stderr: '',
    logFileContent: [
      'Failed to get OAuth token: error getting token source',
      'You are not logged into Antigravity',
      'ChainedAuth: authenticated via keyring (effective: keyring)',
      'Print mode: silent auth succeeded',
    ].join('\n'),
  });
  assert.equal(r.status, 'success', 'veto must coexist with a real payload');
  assert.equal(r.text, 'HOPPER_AGY_OK');
});

test('V5 agy parseResult: a NEGATED "authenticated via keyring" phrase does NOT veto a real auth failure', () => {
  const r = agyAdapter.parseResult({
    exitCode: 1, timedOut: false, durationMs: 1000, stdout: '', stderr: '',
    logFileContent: 'You are not logged into Antigravity\ncould not be authenticated via keyring backend: locked',
  });
  assert.equal(r.status, 'auth-fail', 'negated keyring phrase must not be read as a success marker (anchored regex)');
});

// ─── V2: agy --model + bare-model knownGood corrections ───

test('V2 agy: --model forwarded as a verbatim label; modelArg freeform with the 4 labels', () => {
  const a = agyAdapter.args('p', { model: 'Gemini 3.1 Pro (High)' });
  const i = a.indexOf('--model');
  assert.ok(i >= 0 && a[i + 1] === 'Gemini 3.1 Pro (High)', 'forwards the full label verbatim');
  assert.ok(!agyAdapter.args('p', {}).includes('--model'), 'no --model when unset');
  assert.equal(agyAdapter.capabilities.modelArg.accepted, 'freeform');
  assert.ok(agyAdapter.capabilities.modelArg.knownGood.includes('Gemini 3.5 Flash (High)'));
});

test('V2 knownGood corrections: grok drops stale grok-4.3; codex includes gpt-5.4', () => {
  const grok = getAdapter('grok').capabilities.modelArg.knownGood;
  // ISSUE-grok-model-line-rotation-stale-knownGood.md: grok-build /
  // grok-composer-2.5-fast (the prior knownGood, asserted here through
  // 0.31.0) were retired to "unknown model id" between 2026-06-02 and
  // 2026-07-16; knownGood now points at the V-verified 2026-07-18 default.
  assert.ok(grok.includes('grok-4.6'), 'grok-4.6 is the live-verified knownGood[0]（2026-08-13 起）');
  assert.ok(grok.includes('grok-4.5'), 'grok-4.5 保留为 knownGood[1] 回退基线');
  assert.ok(!grok.includes('grok-build'), 'retired grok-build must not linger in knownGood');
  assert.ok(!grok.includes('grok-composer-2.5-fast'), 'retired grok-composer-2.5-fast must not linger in knownGood');
  assert.ok(!grok.includes('grok-4.3'), 'stale grok-4.3 removed');
  const codexModelArg = getAdapter('codex').capabilities.modelArg;
  const codex = codexModelArg.knownGood;
  assert.ok(codex.includes('gpt-5.4') && codex.includes('gpt-5.5'), 'codex now lists gpt-5.4');
  assert.ok(codex.includes('gpt-5.3-codex'), 'V3 curation: codex adds the GA gpt-5.3-codex default');
  assert.deepEqual(codexModelArg.driftExpected, ['gpt-5.3-codex-spark', 'codex-auto-review', 'gpt-5.2'],
    'V3: codex declares expected-divergence so doctor --deep stays a clean signal');
  const claude = getAdapter('claude').capabilities.modelArg.knownGood;
  assert.ok(claude.includes('opusplan') && claude.includes('sonnet[1m]'), 'claude lists compound aliases');
  assert.ok(getAdapter('copilot').capabilities.modelArg.knownGood.includes('auto'), 'copilot populated');
});

test('Grok auth context is presence-only and gives XAI_API_KEY precedence without exposing it', () => {
  assert.equal(grokAuthContext({ env: { XAI_API_KEY: 'unit-secret' }, exists: () => true, home: '/hidden' }), 'key-present-unverified');
  assert.equal(grokAuthContext({ env: {}, exists: () => true, home: '/hidden' }), 'credential-artifact-present-unverified');
  assert.equal(grokAuthContext({ env: {}, exists: () => false, home: '/hidden' }), 'not-detected');
  assert.equal(grokAuthContext({ env: {}, exists: () => { throw new Error('denied'); }, home: '/hidden' }), 'unknown');
});

test('installCheck preserves Grok context but never turns presence into verified auth', async () => {
  const saved = process.env.XAI_API_KEY;
  try {
    process.env.XAI_API_KEY = 'unit-secret-never-returned';
    const result = await installCheckForAdapter('grok');
    assert.equal(result.authContext, 'key-present-unverified');
    assert.equal(result.authState, 'unverified');
    assert.doesNotMatch(JSON.stringify(result), /unit-secret-never-returned/);
  } finally {
    if (saved === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = saved;
  }
});

// ─── copilot 'never auth' false-negative: soft-warn must not render as Auth=NO ───

test('installCheck invariant: authOk mirrors overallStatus (soft-warn is NOT a hard NO)', async () => {
  // The bug: authOk flipped false on a soft-warn note while overallStatus stayed READY.
  // Encode the contract across ALL real adapters (machine-independent — the invariant
  // holds regardless of which vendors happen to be authed on this host).
  for (const name of listAdapters()) {
    const r = await installCheckForAdapter(name);
    if (r.overallStatus === 'READY') assert.equal(r.authOk, true, `${name}: READY must have authOk=true`);
    if (r.overallStatus === 'AUTH_NEEDED') assert.equal(r.authOk, false, `${name}: AUTH_NEEDED must have authOk=false`);
    if (r.authSoftWarn) assert.equal(r.authOk, true, `${name}: a soft-warn implies authed (authOk=true)`);
    if (r.authSoftWarn) assert.ok(r.authNotes.length > 0, `${name}: soft-warn must carry an advisory note`);
  }
});

test('copilot envPreflight: env token → clean ok; never a hard fail (keychain/profile backstop)', () => {
  const saved = { gh: process.env.GH_TOKEN, ght: process.env.GITHUB_TOKEN, cop: process.env.COPILOT_GITHUB_TOKEN };
  try {
    process.env.GH_TOKEN = 'ghp_test';
    delete process.env.GITHUB_TOKEN; delete process.env.COPILOT_GITHUB_TOKEN;
    const withTok = copilotAdapter.envPreflight();
    assert.deepEqual(withTok, { ok: true, missing: [] }, 'an explicit token is a clean ok');
    // copilot must NEVER hard-fail auth (ok:false) — it falls back to gh cache /
    // ~/.copilot profile / soft-warn, so it is always at worst "warn", never "NO".
    delete process.env.GH_TOKEN;
    const result = copilotAdapter.envPreflight();
    assert.equal(result.ok, true, 'copilot envPreflight is never ok:false');
    assert.ok(Array.isArray(result.missing), 'shape: {ok, missing}');
  } finally {
    for (const [k, v] of [['GH_TOKEN', saved.gh], ['GITHUB_TOKEN', saved.ght], ['COPILOT_GITHUB_TOKEN', saved.cop]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('installCheck threading: a soft-warn copilot is authOk + authSoftWarn (deterministic, empty HOME)', async () => {
  // Deterministically force the soft-warn branch (no env token, no gh, no ~/.copilot)
  // and assert the index.js threading: authOk=true AND authSoftWarn=true with a note —
  // this is the exact pairing the bug broke (authOk was false on a soft-warn).
  const saved = {
    GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    COPILOT_GITHUB_TOKEN: process.env.COPILOT_GITHUB_TOKEN,
    HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
  };
  const emptyHome = mkdtempSync(join(tmpdir(), 'hopper-emptyhome-ic-'));
  try {
    delete process.env.GH_TOKEN; delete process.env.GITHUB_TOKEN; delete process.env.COPILOT_GITHUB_TOKEN;
    process.env.HOME = emptyHome; process.env.USERPROFILE = emptyHome;
    const r = await installCheckForAdapter('copilot');
    assert.equal(r.authOk, true, 'soft-warn copilot is authOk=true (not a hard NO)');
    assert.equal(r.authSoftWarn, true, 'and flagged as soft-warn (assumed/unverifiable)');
    assert.ok(r.authNotes.length > 0, 'carries the advisory note');
    if (r.binaryFound) assert.equal(r.overallStatus, 'READY', 'soft-warn does not downgrade overallStatus');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(emptyHome, { recursive: true, force: true });
  }
});

test('copilot parseResult: a real auth failure is labeled auth-fail (heuristic backstop)', () => {
  const fail = copilotAdapter.parseResult({
    exitCode: 1, timedOut: false, durationMs: 200, stdout: '', stderr: 'Error: not authenticated. Run `copilot` to sign in.',
  });
  assert.equal(fail.status, 'auth-fail');
  // exit 0 with the word "authenticated" in normal output must NOT be misread as a failure
  const ok = copilotAdapter.parseResult({ exitCode: 0, timedOut: false, durationMs: 200, stdout: 'You are authenticated and ready.', stderr: '' });
  assert.equal(ok.status, 'success');
});
