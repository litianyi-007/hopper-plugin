// V4: model-name normalization (user-said name → canonical bare name).
// Anchor: tests/unit/model-normalize.test.js

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeModel, reconcileModels, modelKeysMatch, compareRuntimeIdentity } from '../../cli/src/model-normalize.js';
import { resolveAdapterOptsForTask } from '../../cli/src/dispatch.js';

test('V4 normalizeModel: codex — case/dash/dot-insensitive, prefix-strip, FULL-key equality, passthrough', () => {
  const kg = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'];
  assert.equal(normalizeModel('codex', 'GPT-5.5', kg), 'gpt-5.5');
  assert.equal(normalizeModel('codex', 'gpt5.5', kg), 'gpt-5.5');
  assert.equal(normalizeModel('codex', 'openai-codex/gpt-5.5', kg), 'gpt-5.5'); // provider prefix stripped
  assert.equal(normalizeModel('codex', 'gpt-5.4', kg), 'gpt-5.4');             // must NOT become gpt-5.4-mini
  assert.equal(normalizeModel('codex', 'gpt-5.4-mini', kg), 'gpt-5.4-mini');
  assert.equal(normalizeModel('codex', 'gpt-6', kg), 'gpt-6');                 // unknown → passthrough
});

test('V4 normalizeModel: claude — [1m] variants stay distinct from the base alias', () => {
  const kg = ['sonnet', 'opus', 'opus[1m]'];
  assert.equal(normalizeModel('claude', 'Opus', kg), 'opus');
  assert.equal(normalizeModel('claude', 'opus 1m', kg), 'opus[1m]');
  assert.equal(normalizeModel('claude', 'opus', kg), 'opus'); // not opus[1m]
});

test('V4 normalizeModel: agy — fuzzy-matches a loose phrase to the exact display label', () => {
  const kg = ['Gemini 3.5 Flash (High)', 'Gemini 3.1 Pro (Low)'];
  assert.equal(normalizeModel('agy', 'gemini 3.5 flash high', kg), 'Gemini 3.5 Flash (High)');
  assert.equal(normalizeModel('agy', 'GEMINI-3.1-PRO-LOW', kg), 'Gemini 3.1 Pro (Low)');
});

test('V4 normalizeModel: mimo — exact + unambiguous tail match; prefix never invented', () => {
  const kg = ['mimo/mimo-auto', 'xiaomi/mimo-v2.5-pro', 'xiaomi/mimo-v2.5-pro-ultraspeed'];
  assert.equal(normalizeModel('mimo', 'xiaomi/mimo-v2.5-pro', kg), 'xiaomi/mimo-v2.5-pro');
  assert.equal(normalizeModel('mimo', 'mimo-v2.5-pro', kg), 'xiaomi/mimo-v2.5-pro'); // unique tail match
  assert.equal(normalizeModel('mimo', 'mimo-v9-nonexistent', kg), 'mimo-v9-nonexistent'); // passthrough
});

test('V4 normalizeModel: kimi — alias key only (no fuzzy rewrite to an upstream id)', () => {
  const kg = ['kimi-code/kimi-for-coding'];
  assert.equal(normalizeModel('kimi', 'kimi-code/kimi-for-coding', kg), 'kimi-code/kimi-for-coding');
  assert.equal(normalizeModel('kimi', 'some-other-alias', kg), 'some-other-alias'); // passthrough, never guess
});

test('V4 normalizeModel: empty / placeholder knownGood → passthrough', () => {
  assert.equal(normalizeModel('opencode', 'anthropic/claude-sonnet-4-6', ['<provider>/<model>']), 'anthropic/claude-sonnet-4-6');
  assert.equal(normalizeModel('codex', '', ['gpt-5.5']), '');
});

test('V4 integration: resolveAdapterOptsForTask normalizes against the resolved vendor knownGood', () => {
  const resolved = { vendor: 'codex', task: { taskType: 'code-impl', brief: 'x' }, taskSpec: '' };
  assert.equal(resolveAdapterOptsForTask(resolved, { model: 'GPT-5.5' }).model, 'gpt-5.5', 'normalized via the chokepoint');
  assert.equal(resolveAdapterOptsForTask(resolved, { model: 'gpt-9-future' }).model, 'gpt-9-future', 'unknown passes through');
});

// ─── review follow-ups: validation-legal loose forms, ambiguity/cross-vendor safety, hygiene ───

test('V4 normalizeModel: claude/agy — VALIDATION-LEGAL loose forms reach the canonical bracket/paren label', () => {
  // The dash/no-separator forms (what actually passes MODEL_PATTERN as --model) must
  // still collide onto the bracket/paren canonical names V2 ships.
  assert.equal(normalizeModel('claude', 'opus-1m', ['opus', 'opus[1m]']), 'opus[1m]');
  assert.equal(normalizeModel('claude', 'opus1m', ['opus', 'opus[1m]']), 'opus[1m]');
  const agyKg = ['Gemini 3.5 Flash (High)', 'Gemini 3.1 Pro (Low)'];
  assert.equal(normalizeModel('agy', 'gemini-3.5-flash-high', agyKg), 'Gemini 3.5 Flash (High)');
});

test('V4 normalizeModel: mimo AMBIGUOUS tail → passthrough (never invent a prefix)', () => {
  assert.equal(normalizeModel('mimo', 'shared', ['a/shared', 'b/shared']), 'shared', 'two providers share the tail → no guess');
});

test('V4 normalizeModel: cross-vendor safety — one vendor id offered to another passes through unchanged', () => {
  // codex catalog has gpt-5.3-codex-spark (canonKey gpt53codexspark) — a bare gpt-5.3-codex
  // (gpt53codex) must NOT collide onto it.
  assert.equal(normalizeModel('codex', 'gpt-5.3-codex', ['gpt-5.5', 'gpt-5.3-codex-spark']), 'gpt-5.3-codex');
  assert.equal(normalizeModel('grok', 'claude-opus-4.8', ['grok-build']), 'claude-opus-4.8');
});

test('V4 normalizeModel: input hygiene — non-string / nullish / bad knownGood never throw', () => {
  assert.equal(normalizeModel('codex', undefined, ['gpt-5.5']), undefined);
  assert.equal(normalizeModel('codex', null, ['gpt-5.5']), null);
  assert.equal(normalizeModel('codex', '   ', ['gpt-5.5']), '   ');
  assert.equal(normalizeModel('codex', 42, ['gpt-5.5']), 42);
  assert.equal(normalizeModel('codex', 'gpt-5.5', null), 'gpt-5.5', 'null knownGood → passthrough');
  assert.equal(normalizeModel('codex', 'gpt-5.5', undefined), 'gpt-5.5');
});

test('V4 normalizeModel: idempotent — normalizing the canonical output again is a fixpoint', () => {
  const kg = ['gpt-5.5', 'gpt-5.4-mini'];
  const once = normalizeModel('codex', 'GPT-5.5', kg);
  assert.equal(normalizeModel('codex', once, kg), once);
  const agyKg = ['Gemini 3.5 Flash (High)'];
  const a1 = normalizeModel('agy', 'gemini-3.5-flash-high', agyKg);
  assert.equal(normalizeModel('agy', a1, agyKg), a1);
});

// ─── V3: reconcile hardcoded knownGood vs a live-enumerated catalog ───

test('V3 reconcileModels: codex — matched / stale-default / new-on-live (canon-insensitive)', () => {
  const r = reconcileModels('codex', ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'], ['GPT-5.5', 'gpt5.4', 'gpt-6']);
  assert.deepEqual(r.matched, ['gpt-5.5', 'gpt-5.4']);
  assert.deepEqual(r.missingFromLive, ['gpt-5.4-mini'], 'a default the live catalog no longer lists is STALE');
  assert.deepEqual(r.newOnLive, ['gpt-6'], 'a live model absent from defaults is NEW');
});

test('V3 reconcileModels: mimo — a prefixed default matches a bare live id by tail', () => {
  const r = reconcileModels('mimo', ['xiaomi/mimo-v2.5-pro', 'mimo/mimo-auto'], ['mimo-v2.5-pro']);
  assert.ok(r.matched.includes('xiaomi/mimo-v2.5-pro'));
  assert.ok(r.missingFromLive.includes('mimo/mimo-auto'));
  assert.deepEqual(r.newOnLive, []);
});

test('V3 reconcileModels: claude — opus[1m] stays distinct from a live `opus` (no false match)', () => {
  const r = reconcileModels('claude', ['opus', 'opus[1m]'], ['opus', 'sonnet']);
  assert.deepEqual(r.matched, ['opus']);
  assert.deepEqual(r.missingFromLive, ['opus[1m]']);
  assert.deepEqual(r.newOnLive, ['sonnet']);
});

test('V3 reconcileModels: empty edges — empty live → all missing; empty kg → all new; junk filtered', () => {
  assert.deepEqual(reconcileModels('codex', ['gpt-5.5'], []), { matched: [], missingFromLive: ['gpt-5.5'], newOnLive: [], expectedSuppressed: [] });
  assert.deepEqual(reconcileModels('codex', [], ['gpt-5.5']), { matched: [], missingFromLive: [], newOnLive: ['gpt-5.5'], expectedSuppressed: [] });
  assert.deepEqual(reconcileModels('codex', ['gpt-5.5', '', null], ['gpt-5.5', '  ']), { matched: ['gpt-5.5'], missingFromLive: [], newOnLive: [], expectedSuppressed: [] });
});

test('V3 modelKeysMatch: vendor-scoped — bare-slug strips prefix, alias is full-key only', () => {
  assert.ok(modelKeysMatch('codex', 'openai/gpt-5.5', 'gpt-5.5'), 'bare-slug strips the provider prefix on both sides');
  assert.ok(!modelKeysMatch('kimi', 'kimi-code/kimi-for-coding', 'kimi-for-coding'), 'alias vendor uses full-key only — tail must NOT match');
});

test('V3 reconcileModels: driftExpected suppresses BOTH directions, but a genuinely-new model still surfaces', () => {
  // codex shape: spark is a Pro-only default (absent from the free bundle → would be
  // false-STALE); gpt-5.2 + codex-auto-review ship in the bundle but are intentionally
  // not promoted (→ would be false-NEW). gpt-6 is genuinely new.
  const kg = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'];
  const live = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2', 'codex-auto-review', 'gpt-6'];
  const expected = ['gpt-5.3-codex-spark', 'codex-auto-review', 'gpt-5.2'];
  const r = reconcileModels('codex', kg, live, expected);
  assert.deepEqual(r.missingFromLive, [], 'spark (Pro-only, expected) is NOT flagged STALE');
  assert.deepEqual(r.newOnLive, ['gpt-6'], 'gpt-5.2/codex-auto-review suppressed; only the genuinely-new gpt-6 surfaces');
  assert.ok(r.matched.includes('gpt-5.3-codex'), 'the newly-curated default matches the live catalog');
  assert.deepEqual(r.expectedSuppressed, ['gpt-5.2', 'codex-auto-review'], 'live-side suppressed models reported for the renderer (NOT spark, which is kg-side)');
});

test('V3 modelKeysMatch: provider-prefixed — bare↔prefixed matches by tail, prefixed↔prefixed does NOT', () => {
  assert.ok(modelKeysMatch('mimo', 'xiaomi/mimo-v2.5-pro', 'mimo-v2.5-pro'), 'a bare live id matches a prefixed default by tail');
  assert.ok(modelKeysMatch('mimo', 'xiaomi/mimo-v2.5-pro', 'xiaomi/mimo-v2.5-pro'), 'identical prefixed ids match');
  assert.ok(!modelKeysMatch('mimo', 'xiaomi/mimo-v2.5-pro', 'openai/mimo-v2.5-pro'), 'two providers same tail → NOT a match (real drift not hidden)');
});

test('strict runtime identity comparator is separate from legacy modelKeysMatch', () => {
  assert.ok(modelKeysMatch('opencode', 'openai/gpt-5', 'gpt-5'), 'legacy validation deliberately accepts a bare tail');
  assert.equal(
    compareRuntimeIdentity('opencode', { identity_kind: 'provider-model', provider: 'openai', model: 'gpt-5' }, 'gpt-5'),
    'uncomparable',
    'runtime proof must not inherit legacy tail matching',
  );
});

test('V4 resolveAdapterOptsForTask retains raw/effective selector provenance', () => {
  const explicit = resolveAdapterOptsForTask(
    { vendor: 'codex', task: { taskType: 'code-impl', brief: 'x' }, taskSpec: '' },
    { model: 'GPT-5.5' },
  );
  assert.equal(explicit.requestedSelector, 'GPT-5.5');
  assert.equal(explicit.effectiveSelector, 'gpt-5.5');
  assert.equal(explicit.effectiveSelectorSource, 'user-argv');

  // 2026-08-11: an unpinned dispatch to a vendor that DECLARES a hopper default
  // now carries a real effective selector. This is the whole point — a null
  // effective selector is unattestable, which is how a swarm panelist ran pi on
  // gpt-5.5 with `requested_selector: null` and nobody could tell from the
  // handoff. `requestedSelector` stays null: the user asked for nothing, and
  // runtime attestation must never compare against a value hopper invented.
  const hopperDefaulted = resolveAdapterOptsForTask(
    { vendor: 'codex', task: { taskType: 'code-impl', brief: 'x' }, taskSpec: '', policy: { modelRule: '' } },
    {},
  );
  assert.equal(hopperDefaulted.requestedSelector, null, 'the user requested nothing — do not backfill an audit value');
  assert.equal(hopperDefaulted.effectiveSelector, 'gpt-5.6-sol');
  assert.equal(hopperDefaulted.effectiveSelectorSource, 'policy');

  // A vendor that declares NO hopper default still reports a fully unpinned
  // dispatch honestly, rather than inventing a selector.
  const unpinnable = resolveAdapterOptsForTask(
    { vendor: 'opencode', task: { taskType: 'code-impl', brief: 'x' }, taskSpec: '', policy: { modelRule: '' } },
    {},
  );
  assert.equal(unpinnable.requestedSelector, null);
  assert.equal(unpinnable.effectiveSelector, null);
  assert.equal(unpinnable.effectiveSelectorSource, 'vendor-default');
});
