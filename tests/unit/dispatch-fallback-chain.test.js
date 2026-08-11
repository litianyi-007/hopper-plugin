// Batch 2: --reasoning / --model fallback chains inside resolveAdapterOptsForTask
// (the single chokepoint every dispatch path — sync/background/adhoc/swarm — flows
// through), plus the effort-clamp visibility notice and the sentinel->real-name
// resolution that must reach argv + output.md frontmatter.
// Anchor: tests/unit/dispatch-fallback-chain.test.js
//
// See tests/unit/policy.test.js for the underlying pure-parser coverage and
// tests/unit/setup-policy-lint.test.js for the --setup lint warnings.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { resolveAdapterOptsForTask } from '../../cli/src/dispatch.js';

function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

const resolvedWith = (vendor, taskType, policy) => ({
  task: { taskType, brief: 'demo' },
  taskSpec: '',
  vendor,
  policy: policy || { effortPolicy: '', modelRule: '' },
});

// ─── --reasoning fallback chain priority ───

test('reasoning chain: explicit --reasoning flag wins over everything else', () => {
  const resolved = resolvedWith('grok', 'code-review-adversarial', { effortPolicy: 'medium', modelRule: '' });
  const out = resolveAdapterOptsForTask(resolved, { reasoning: 'low' });
  assert.equal(out.reasoning, 'low');
  assert.ok(!out.policyNotices.some((n) => n.includes('Effort policy')), 'flag present — policy cell must not even be consulted for a notice');
});

test('reasoning chain: single-token Effort policy resolves when no flag is passed', () => {
  const resolved = resolvedWith('codex', 'prd-research', { effortPolicy: 'medium', modelRule: '' });
  const out = resolveAdapterOptsForTask(resolved, {});
  assert.equal(out.reasoning, 'medium');
  assert.ok(out.policyNotices.some((n) => n.includes("Effort policy (task-type 'prd-research'): medium")));
});

test('reasoning chain: per-vendor table selects the entry matching the resolved vendor', () => {
  const policy = { effortPolicy: 'codex:xhigh, grok:high', modelRule: '' };
  assert.equal(resolveAdapterOptsForTask(resolvedWith('codex', 'code-review-adversarial', policy), {}).reasoning, 'xhigh');
  assert.equal(resolveAdapterOptsForTask(resolvedWith('grok', 'code-review-adversarial', policy), {}).reasoning, 'high');
});

test('reasoning chain: unbound Effort policy (OOB / vendor not named) falls through silently to HOPPER_DEFAULT_REASONING', () => {
  withEnv('HOPPER_DEFAULT_REASONING', 'medium', () => {
    const oob = resolveAdapterOptsForTask(resolvedWith('codex', 'code-impl', { effortPolicy: '(bind per project)', modelRule: '' }), {});
    assert.equal(oob.reasoning, 'medium');
    // OOB is silent on the EFFORT axis — not an error, no effort notice. (The
    // model axis independently emits a hopper-default notice since 2026-08-11,
    // so this asserts the absence of an effort notice, not of all notices.)
    assert.equal(oob.policyNotices.filter((n) => /effort/i.test(n)).length, 0, 'OOB effort is silent — not an error');

    const notNamed = resolveAdapterOptsForTask(resolvedWith('kimi', 'code-review-adversarial', { effortPolicy: 'codex:xhigh, grok:high', modelRule: '' }), {});
    assert.equal(notNamed.reasoning, 'medium', 'kimi not in the per-vendor table -> falls through');
  });
});

test('reasoning chain: no policy at all -> HOPPER_DEFAULT_REASONING, else the xhigh product default', () => {
  withEnv('HOPPER_DEFAULT_REASONING', undefined, () => {
    const out = resolveAdapterOptsForTask(resolvedWith('codex', 'code-impl', null), {});
    assert.equal(out.reasoning, 'xhigh');
  });
  withEnv('HOPPER_DEFAULT_REASONING', 'low', () => {
    const out = resolveAdapterOptsForTask(resolvedWith('codex', 'code-impl', null), {});
    assert.equal(out.reasoning, 'low');
  });
});

test('reasoning chain: unparseable Effort policy falls through AND emits a notice (does not silently vanish)', () => {
  const out = resolveAdapterOptsForTask(resolvedWith('codex', 'code-impl', { effortPolicy: 'not-a-real-level', modelRule: '' }), {});
  assert.equal(out.reasoning, 'xhigh', 'falls through to the product default');
  assert.ok(out.policyNotices.some((n) => n.includes('unparseable')));
});

// ─── effort clamp visibility (req #2) ───

test('clamp visibility: grok resolving to xhigh (default) prints the exact clamp notice', () => {
  const out = resolveAdapterOptsForTask(resolvedWith('grok', 'code-impl', null), {});
  assert.equal(out.reasoning, 'xhigh', 'the RESOLVED value is untouched — the vendor adapter still does the actual clamp at args() time');
  assert.ok(out.policyNotices.includes('effort xhigh → clamped to high (grok max)'));
});

test('clamp visibility: no notice when the resolved level is already in the vendor enum', () => {
  const out = resolveAdapterOptsForTask(resolvedWith('grok', 'code-impl', null), { reasoning: 'medium' });
  assert.ok(!out.policyNotices.some((n) => n.includes('clamped')));
});

test('clamp visibility: no notice for a vendor that ignores --reasoning entirely (kimi)', () => {
  const out = resolveAdapterOptsForTask(resolvedWith('kimi', 'code-impl', null), {});
  assert.ok(!out.policyNotices.some((n) => n.includes('clamped')));
});

// ─── --model fallback chain + verified-latest sentinel ───

test('model chain: explicit --model flag wins; still goes through V4 normalization', () => {
  const out = resolveAdapterOptsForTask(resolvedWith('codex', 'code-impl', { effortPolicy: '', modelRule: 'verified-latest' }), { model: 'GPT-5.5' });
  assert.equal(out.model, 'gpt-5.5', 'normalized; Model rule cell ignored because a flag was given');
  assert.ok(!out.policyNotices.some((n) => n.includes('Model rule')));
});

test('model chain: Model rule verified-latest resolves to the vendor DECLARED hopper default', () => {
  // 2026-08-11: the sentinel now reads `capabilities.modelArg.hopperDefault`
  // instead of inferring knownGood[0] — see resolveVerifiedLatest in
  // cli/src/policy.js. codex's declared default equals what index 0 used to be,
  // so the resolved model is unchanged; only the provenance is now explicit.
  const out = resolveAdapterOptsForTask(resolvedWith('codex', 'code-impl', { effortPolicy: '', modelRule: 'verified-latest' }), {});
  assert.equal(out.model, 'gpt-5.6-sol', "codex's declared hopperDefault");
  assert.ok(out.policyNotices.some((n) => n.includes("Model rule (task-type 'code-impl'): verified-latest")));
  assert.ok(out.policyNotices.some((n) => n.includes("model sentinel 'verified-latest' → gpt-5.6-sol (codex hopper default)")));
});

test('model chain: an adapter declaring NO hopper default omits --model instead of pinning an alias', () => {
  // opencode declares `hopperDefault: null` — which models exist depends
  // entirely on the user's opencode auth config, so hopper has no basis for a
  // preference. (The related defect: claude's knownGood is an UNORDERED alias
  // set, so inferring index 0 pinned every `verified-latest` review to `sonnet`
  // and silently downgraded an opus-entitled account. claude now declares its
  // preference explicitly — see tests/unit/vendor-model-default.test.js.)
  const out = resolveAdapterOptsForTask(resolvedWith('opencode', 'code-impl', { effortPolicy: '', modelRule: 'verified-latest' }), {});
  assert.equal(out.model, undefined, 'must NOT invent a model for a vendor with no declared preference');
  assert.ok(out.policyNotices.some((n) => /declares no hopper default/.test(n)),
    `expected a no-hopper-default notice; got ${JSON.stringify(out.policyNotices)}`);
});

test('model chain: sentinel resolution is vendor-scoped (grok gets its own knownGood[0])', () => {
  const out = resolveAdapterOptsForTask(resolvedWith('grok', 'code-impl', { effortPolicy: '', modelRule: 'verified-latest' }), {});
  // ISSUE-grok-model-line-rotation-stale-knownGood.md: grok-build retired
  // ("unknown model id") between 2026-06-02 and 2026-07-16; knownGood[0]
  // moved to grok-4.5 (V-verified 2026-07-18 live micro-test).
  assert.equal(out.model, 'grok-4.5');
});

test('model chain: unbound Model rule (OOB) falls through to the vendor hopper default, not to nothing', () => {
  // 2026-08-11: an unpinned dispatch no longer inherits whatever the vendor CLI
  // felt like. It lands on the adapter's declared hopper default and SAYS SO —
  // the silence was how a swarm panelist ran pi on gpt-5.5 while recording
  // `requested_selector: null`.
  const out = resolveAdapterOptsForTask(resolvedWith('codex', 'code-impl', { effortPolicy: '', modelRule: '(bind per project)' }), {});
  assert.equal(out.model, 'gpt-5.6-sol');
  assert.ok(out.policyNotices.some((n) => /hopper default/.test(n)), 'the resolution must be visible');
  // A vendor that declares no preference still falls through to nothing.
  const unpinnable = resolveAdapterOptsForTask(resolvedWith('opencode', 'code-impl', { effortPolicy: '', modelRule: '(bind per project)' }), {});
  assert.equal(unpinnable.model, undefined);
});

test('model chain: unparseable Model rule (unknown sentinel) falls through WITH a notice, never forwarded as a literal --model', () => {
  const out = resolveAdapterOptsForTask(resolvedWith('codex', 'code-impl', { effortPolicy: '', modelRule: 'not-a-real-sentinel' }), {});
  assert.notEqual(out.model, 'not-a-real-sentinel', 'must NOT forward the garbage string as a literal --model value');
  assert.equal(out.model, 'gpt-5.6-sol', 'falls through to the vendor hopper default (2026-08-11)');
  assert.ok(out.policyNotices.some((n) => n.includes('unrecognized sentinel')));
});

test('model chain: a vendor with no pinnable default omits --model with a notice, never forwards a placeholder', () => {
  // opencode declares `hopperDefault: null` for the same reason its knownGood is
  // the documentation placeholder '<provider>/<model>': the reachable catalog
  // depends entirely on the user's opencode auth config, so hopper has no basis
  // for a preference. The placeholder must never reach argv as a real model.
  const out = resolveAdapterOptsForTask(resolvedWith('opencode', 'code-impl', { effortPolicy: '', modelRule: 'verified-latest' }), {});
  assert.equal(out.model, undefined);
  assert.ok(out.policyNotices.some((n) => /declares no hopper default/.test(n)),
    `expected a no-hopper-default notice; got ${JSON.stringify(out.policyNotices)}`);
});

test('model+reasoning chain: no resolved/vendor object at all never throws (back-compat with pre-batch-2 callers)', () => {
  assert.doesNotThrow(() => resolveAdapterOptsForTask({ task: { taskType: 'code-impl' } }, {}));
  assert.doesNotThrow(() => resolveAdapterOptsForTask(undefined, {}));
});

// ─── policyNotices is print-time metadata, not a real adapter opt ───

test('policyNotices is non-enumerable: invisible to JSON.stringify and object-spread (never leaks into argv/env forwarding)', () => {
  const out = resolveAdapterOptsForTask(resolvedWith('codex', 'code-impl', { effortPolicy: '', modelRule: 'verified-latest' }), {});
  assert.ok(Array.isArray(out.policyNotices) && out.policyNotices.length > 0, 'directly readable right after the call');
  assert.equal(JSON.stringify(out).includes('policyNotices'), false, 'must not appear in the JSON blob forwarded to the background runner via env');
  const spread = { ...out };
  assert.equal(Object.prototype.hasOwnProperty.call(spread, 'policyNotices'), false, 'must not survive an object spread (background/sync build effectiveOpts this way)');
});

// ─── static regression guard: the frontmatter/output.md model-field wiring bug ───

test('regression guard: cli/bin/hopper-dispatch --write path threads the RESOLVED model, not the raw --model flag, into writeOutput()', () => {
  // req #3: output.md frontmatter must record the resolved REAL name (e.g. a
  // verified-latest sentinel resolved to a concrete model), not the sentinel
  // literal a raw `adapterOpts.model` would still carry. This is a static
  // source guard (mirrors the zero-spawn source-scan pattern in discovery.test.js)
  // against reintroducing `model: adapterOpts.model` at the writeOutput call site.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = resolve(__dirname, '..', '..');
  const src = readFileSync(join(REPO_ROOT, 'cli', 'bin', 'hopper-dispatch'), 'utf-8');
  const writeOutputCall = src.match(/writeOutput\(\{[^}]*\}\)/)[0];
  assert.match(writeOutputCall, /model:\s*effectiveAdapterOpts\.model/, `writeOutput() call must pass effectiveAdapterOpts.model (the resolved value), got: ${writeOutputCall}`);
  assert.doesNotMatch(writeOutputCall, /model:\s*adapterOpts\.model\b/, 'must not regress to the pre-resolution raw flag value');
});
