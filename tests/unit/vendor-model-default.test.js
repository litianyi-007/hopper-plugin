// Per-vendor default model: the adapter's declared preference, the project's
// override, and the resolution order between them.
// Anchor: tests/unit/vendor-model-default.test.js
//
// WHY (2026-08-11). An UNPINNED dispatch used to inherit whatever the vendor CLI
// felt like, and said nothing about it. Observed live: a `--swarm` panel ran pi
// on `gpt-5.5` out of ~/.pi/agent/settings.json while every other pi dispatch in
// that project used the 5.6 line, and both panelists recorded
// `requested_selector: null` / `resolution_status: unverified`, so the handoff
// could not even show what had happened.
//
// The fix separates two things the old code conflated in one array:
//   knownGood      = models known to work (a catalog: normalization, drift)
//   hopperDefault  = the model hopper WANTS for hopper-shaped work (an intent)
// `verified-latest` now reads the intent. Inferring it from knownGood[0] is what
// made `claude` resolve to `sonnet` — its knownGood is an unordered alias set —
// which silently downgraded an opus-entitled account on the scaffold's own
// default task-type table.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveVerifiedLatest } from '../../cli/src/policy.js';
import { listAdapters, capabilitiesForAdapter } from '../../cli/src/vendors/index.js';
import { parseAgentsFile, vendorDefaultModel } from '../../cli/src/agents.js';
import { resolveAdapterOptsForTask } from '../../cli/src/dispatch.js';
import { effectiveModelDefault } from '../../cli/src/setup.js';

/** Run `fn` with env vars set (undefined = delete), then restore. */
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const resolved = (vendor, extra = {}) => ({
  task: { taskType: 'code-review-adversarial' },
  vendor,
  policy: { effortPolicy: '', modelRule: '' },
  ...extra,
});

// ── the sentinel reads the declared intent ───────────────────────────────

test('every registered adapter DECLARES hopperDefault — the intent is never inferred', () => {
  // A new adapter that forgets to declare one silently falls back to the
  // knownGood[0] inference this field exists to retire.
  for (const vendor of listAdapters()) {
    const modelArg = capabilitiesForAdapter(vendor)?.modelArg;
    assert.ok(modelArg && Object.hasOwn(modelArg, 'hopperDefault'),
      `${vendor}: capabilities.modelArg must declare hopperDefault (use null to mean "hopper has no preference")`);
  }
});

test('resolveVerifiedLatest prefers the declared default over knownGood ordering', () => {
  assert.equal(resolveVerifiedLatest({ hopperDefault: 'chosen', knownGood: ['first', 'chosen'] }), 'chosen');
  // An explicit null is an ANSWER ("no preference"), not an absence — it must
  // not fall through to knownGood[0].
  assert.equal(resolveVerifiedLatest({ hopperDefault: null, knownGood: ['first'] }), null);
  // Undeclared (a future/3rd-party adapter) keeps the legacy inference.
  assert.equal(resolveVerifiedLatest({ knownGood: ['first'] }), 'first');
  // A bare array is still accepted (legacy call form).
  assert.equal(resolveVerifiedLatest(['first']), 'first');
  // Placeholders and empties are never forwarded as a real model.
  assert.equal(resolveVerifiedLatest({ knownGood: ['<provider>/<model>'] }), null);
  assert.equal(resolveVerifiedLatest({ hopperDefault: '   ' }), null);
  assert.equal(resolveVerifiedLatest(undefined), null);
});

test('claude resolves to its DECLARED default, never to knownGood[0] — the downgrade regression pin', () => {
  // claude is the case that proves the field is load-bearing: its declared
  // preference (`opus`, an operator choice — hopper-dispatched work is review
  // and judgment, where the top tier earns its cost) and its knownGood[0]
  // (`sonnet`, merely the most common alias in an UNORDERED set) are DIFFERENT
  // models. If resolution ever reverts to the array inference, this goes red and
  // an opus-entitled account is being silently downgraded on every task-type
  // carrying `Model rule: verified-latest` — which the scaffold writes for every
  // review type.
  const claude = capabilitiesForAdapter('claude').modelArg;
  assert.equal(claude.knownGood[0], 'sonnet', 'the alias that used to be pinned by accident');
  assert.notEqual(claude.hopperDefault, claude.knownGood[0], 'declared intent must not be the array accident');
  assert.equal(resolveVerifiedLatest(claude), 'opus');
  assert.equal(resolveAdapterOptsForTask(resolved('claude'), {}).model, 'opus');
});

test('vendors that DO have a preference keep resolving to it', () => {
  const expected = { codex: 'gpt-5.6-sol', grok: 'grok-4.6', claude: 'opus' };
  for (const [vendor, model] of Object.entries(expected)) {
    assert.equal(resolveVerifiedLatest(capabilitiesForAdapter(vendor).modelArg), model, vendor);
  }
});

// ── the project's per-vendor override ────────────────────────────────────

test('the Approved Vendors table parses an optional Default model column', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hopper-agents-'));
  try {
    const path = join(dir, 'AGENTS.md');
    writeFileSync(path, [
      '# Agents', '', '## Approved Vendors', '',
      '| Vendor | Approved | Approved by | Date | Default model | Scope / Notes |',
      '|---|---|---|---|---|---|',
      '| `pi` | yes | user | 2026-08-11 | openai-codex/gpt-5.6-sol | pinned |',
      '| `grok` | yes | user | 2026-08-11 | - | dash means unset |',
      '| `codex` | yes | user | 2026-08-11 | (bind per project) | OOB means unset |',
      '| `claude` | yes | user | 2026-08-11 |  | empty means unset |',
      '',
    ].join('\n'));
    const agentsData = await parseAgentsFile(path);
    assert.equal(vendorDefaultModel(agentsData, 'pi'), 'openai-codex/gpt-5.6-sol');
    for (const unset of ['grok', 'codex', 'claude']) {
      assert.equal(vendorDefaultModel(agentsData, unset), null, `${unset}: dash/OOB/empty must mean "no override"`);
    }
    assert.equal(vendorDefaultModel(agentsData, 'kimi'), null, 'a vendor absent from the table has no override');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a minimal 2-column Approved Vendors table is still legal (backward compatibility)', async () => {
  // The column is OPTIONAL: every AGENTS.md written before 2026-08-11 lacks it,
  // and this table is the fail-closed dispatch gate — breaking its parse would
  // refuse every dispatch in every existing project.
  const dir = mkdtempSync(join(tmpdir(), 'hopper-agents-min-'));
  try {
    const path = join(dir, 'AGENTS.md');
    writeFileSync(path, [
      '# Agents', '', '## Approved Vendors', '',
      '| Vendor | Approved |', '|---|---|', '| `pi` | yes |', '',
    ].join('\n'));
    const agentsData = await parseAgentsFile(path);
    assert.equal(agentsData.approvedVendors.present, true);
    assert.equal(agentsData.approvedVendors.list.length, 1);
    assert.equal(agentsData.approvedVendors.list[0].approved, true);
    assert.equal(vendorDefaultModel(agentsData, 'pi'), null, 'no column → no override, not a crash');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── resolution order ─────────────────────────────────────────────────────

test('an unpinned dispatch lands on the adapter preset and SAYS so', () => {
  const out = resolveAdapterOptsForTask(resolved('codex'), {});
  assert.equal(out.model, 'gpt-5.6-sol');
  assert.equal(out.effectiveSelector, 'gpt-5.6-sol',
    'a null effective selector is unattestable — that is how the swarm case went unnoticed');
  assert.equal(out.requestedSelector, null, 'the user asked for nothing; never backfill the audit value');
  assert.ok(out.policyNotices.some((n) => /hopper default/.test(n)));
});

test('resolution order: --model > HOPPER_<VENDOR>_MODEL > AGENTS.md Default model > adapter preset', () => {
  const project = { vendorDefaultModel: 'openai-codex/gpt-5.6-terra' };

  // 4. adapter preset (nothing else present) — codex declares one; pi does not.
  assert.equal(resolveAdapterOptsForTask(resolved('codex'), {}).model, 'gpt-5.6-sol');
  assert.equal(resolveAdapterOptsForTask(resolved('pi'), {}).model, undefined);

  // 3. project column beats the preset
  const viaProject = resolveAdapterOptsForTask(resolved('pi', project), {});
  assert.equal(viaProject.model, 'openai-codex/gpt-5.6-terra');
  assert.ok(viaProject.policyNotices.some((n) => /Approved Vendors 'Default model'/.test(n)));

  withEnv({ HOPPER_PI_MODEL: 'openai-codex/gpt-5.6-luna' }, () => {
    // 2. machine env beats the project column
    const viaEnv = resolveAdapterOptsForTask(resolved('pi', project), {});
    assert.equal(viaEnv.model, 'openai-codex/gpt-5.6-luna');
    assert.ok(viaEnv.policyNotices.some((n) => /HOPPER_PI_MODEL/.test(n)));

    // 1. an explicit --model still wins over everything
    assert.equal(resolveAdapterOptsForTask(resolved('pi', project), { model: 'openai-codex/gpt-5.4' }).model,
      'openai-codex/gpt-5.4');
  });
});

test('a vendor declaring no preference stays genuinely unpinned', () => {
  // opencode: which models exist depends entirely on the user's opencode auth
  // config, so hopper has no basis for a preference and declares `null`.
  const out = resolveAdapterOptsForTask(resolved('opencode'), {});
  assert.equal(out.model, undefined);
  assert.equal(out.effectiveSelector, null);
  assert.equal(out.effectiveSelectorSource, 'vendor-default');
  // ...but the project can still pin it deliberately.
  assert.equal(resolveAdapterOptsForTask(resolved('opencode', { vendorDefaultModel: 'anthropic/claude-sonnet-4-6' }), {}).model,
    'anthropic/claude-sonnet-4-6');
});

// ── the readiness surface agrees with what dispatch does ─────────────────

test('effectiveModelDefault reports the same value and names its source', () => {
  assert.deepEqual(effectiveModelDefault('codex'), { value: 'gpt-5.6-sol', source: 'adapter' });
  assert.deepEqual(effectiveModelDefault('pi'), { value: null, source: 'none' }, 'a platform router ships no preference');
  assert.deepEqual(effectiveModelDefault('opencode'), { value: null, source: 'none' });
  assert.deepEqual(effectiveModelDefault('pi', { projectDefault: 'openai-codex/gpt-5.6-sol' }),
    { value: 'openai-codex/gpt-5.6-sol', source: 'project' });
  assert.deepEqual(effectiveModelDefault('pi', { projectDefault: 'x', env: { HOPPER_PI_MODEL: 'y' } }),
    { value: 'y', source: 'env' });

  // The readiness surface must not diverge from the dispatcher: for every
  // vendor, what --capabilities reports is what an unpinned dispatch gets.
  for (const vendor of listAdapters()) {
    const reported = effectiveModelDefault(vendor).value;
    const dispatched = resolveAdapterOptsForTask(resolved(vendor), {}).model ?? null;
    assert.equal(reported, dispatched, `${vendor}: --capabilities and dispatch disagree`);
  }
});

// ── swarm: each panelist resolves its OWN model ──────────────────────────

test('swarm panelists each resolve their own vendor default (the objection, answered)', () => {
  // `--swarm` still refuses a shared --model — one id cannot be right for
  // diverse vendors — but the panel is no longer unpinned as a result.
  const codex = resolveAdapterOptsForTask(resolved('codex'), {});
  const grok = resolveAdapterOptsForTask(resolved('grok'), {});
  assert.equal(codex.model, 'gpt-5.6-sol');
  assert.equal(grok.model, 'grok-4.6');
  assert.notEqual(codex.model, grok.model, 'per-vendor resolution, not one shared id');
  for (const out of [codex, grok]) {
    assert.notEqual(out.effectiveSelector, null, 'every panelist must be attestable');
  }
  // A PLATFORM panelist stays unpinned by design, but is never silent about it.
  const pi = resolveAdapterOptsForTask(resolved('pi'), {});
  assert.equal(pi.model, undefined);
  assert.ok(pi.policyNotices.some((n) => /NOT PINNED/.test(n)));
});

// ── missing task-type frame points at the fix ────────────────────────────

test('a missing task-type frame error lists what exists and names --migrate-config', async () => {
  // A live swarm asking for `decision-review` died 2/2 on this error and the
  // host downgraded the panel to a different review type rather than run one
  // migration — because the message only said "see .hopper/tasks/".
  const { loadTaskFrame } = await import('../../cli/src/tasks.js');
  const dir = mkdtempSync(join(tmpdir(), 'hopper-frames-'));
  try {
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'tasks', 'code-impl.md'), '# frame\n');
    await assert.rejects(
      () => loadTaskFrame(dir, 'decision-review'),
      (err) => {
        assert.match(err.message, /Available here: code-impl/, 'must list what the workspace actually has');
        assert.match(err.message, /--migrate-config/, 'must name the command that installs missing frames');
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── platform routers: hopper must not guess, and must not be silent ──────

test('pi ships NO model preference — it is a platform router, not a model vendor', () => {
  // Its users are on gpt / claude / kimi / qwen / glm…; a shipped preference for
  // one family would be wrong for everyone else, and wrong expensively — a model
  // from a provider you are not logged into fails outright rather than falling back.
  const modelArg = capabilitiesForAdapter('pi').modelArg;
  assert.equal(modelArg.hopperDefault, null);
  assert.equal(resolveVerifiedLatest(modelArg), null);
});

test('an unpinned platform dispatch WARNS with real provider ids instead of failing silently', () => {
  // Warn, not refuse (operator decision 2026-08-11): a refusal would break every
  // existing unpinned pi dispatch. But silence is what let a swarm panelist run
  // pi on `gpt-5.5` from ~/.pi/agent/settings.json unnoticed.
  const out = resolveAdapterOptsForTask(resolved('pi'), {});
  assert.equal(out.model, undefined, 'hopper must not invent a model for a platform router');
  const notice = out.policyNotices.find((n) => /NOT PINNED/.test(n));
  assert.ok(notice, `expected an unpinned notice; got ${JSON.stringify(out.policyNotices)}`);
  assert.match(notice, /openai-codex/, 'the notice must carry usable provider ids');
  assert.match(notice, /Default model/, 'and say where to record the answer');

  // Once pinned — by project column or env — the warning is gone.
  assert.ok(!resolveAdapterOptsForTask(resolved('pi', { vendorDefaultModel: 'kimi-coding/kimi-k2' }), {})
    .policyNotices.some((n) => /NOT PINNED/.test(n)));
  withEnv({ HOPPER_PI_MODEL: 'anthropic/claude-sonnet-4-6' }, () => {
    assert.ok(!resolveAdapterOptsForTask(resolved('pi'), {}).policyNotices.some((n) => /NOT PINNED/.test(n)));
  });
});

test('a vendor that is merely unpinned (not a platform) does NOT get the platform warning', () => {
  // opencode declares no default either, but for a different reason and with no
  // provider table — it must not inherit pi's message.
  assert.ok(!resolveAdapterOptsForTask(resolved('opencode'), {}).policyNotices.some((n) => /NOT PINNED/.test(n)));
});

test('the shipped pi provider ids are the ones pi actually accepts', () => {
  // Enumerated empirically with `pi auth check --provider <id> --json` on pi
  // 0.84.1 (it distinguishes `provider_not_found` from
  // `credentials_not_configured`), then cross-checked against pi's bundled
  // docs/providers.md. Pinned because the intuitive names are all REJECTED, so a
  // plausible-looking edit here would hand users ids that cannot work.
  const ids = capabilitiesForAdapter('pi').modelArg.platformProviders.map((p) => p.id);
  for (const real of ['openai-codex', 'openai', 'anthropic', 'github-copilot', 'xai',
    'kimi-coding', 'qwen-token-plan', 'google', 'deepseek', 'zai', 'minimax', 'openrouter']) {
    assert.ok(ids.includes(real), `${real} is a real pi provider id and must be listed`);
  }
  for (const notReal of ['kimi', 'moonshot', 'qwen', 'dashscope', 'gemini', 'claude', 'grok', 'copilot', 'glm']) {
    assert.ok(!ids.includes(notReal), `${notReal} is rejected by pi as provider_not_found — never ship it`);
  }
  // The asymmetry that catches people: the ChatGPT subscription is its own
  // provider, while the Claude subscription reuses the API-key id.
  assert.ok(ids.includes('openai-codex') && ids.includes('openai'), 'both OpenAI providers, they are different');
  for (const p of capabilitiesForAdapter('pi').modelArg.platformProviders) {
    assert.ok(p.label && p.auth, `${p.id}: needs a human label and an auth hint to be answerable`);
  }
});

test('the platform warning fires on the SENTINEL path too — the path dispatches actually take', () => {
  // Caught live: the first version of this warning guarded on `!out.model`, but
  // the scaffold writes `Model rule: verified-latest` for every review
  // task-type, which SETS out.model to the sentinel and skipped the guard
  // entirely. The warning never printed once in a real dispatch. Both routes to
  // "ended up unpinned" must announce it.
  const viaSentinel = resolveAdapterOptsForTask(
    { task: { taskType: 'code-review-adversarial' }, vendor: 'pi', policy: { effortPolicy: '', modelRule: 'verified-latest' } },
    {},
  );
  assert.equal(viaSentinel.model, undefined);
  assert.ok(viaSentinel.policyNotices.some((n) => /NOT PINNED/.test(n)),
    `sentinel path must warn; got ${JSON.stringify(viaSentinel.policyNotices)}`);

  const viaNoRule = resolveAdapterOptsForTask(resolved('pi'), {});
  assert.ok(viaNoRule.policyNotices.some((n) => /NOT PINNED/.test(n)), 'no-rule path must warn too');

  // A vendor WITH a declared default takes the sentinel path without warning.
  const pinned = resolveAdapterOptsForTask(
    { task: { taskType: 'code-review-adversarial' }, vendor: 'codex', policy: { effortPolicy: '', modelRule: 'verified-latest' } },
    {},
  );
  assert.equal(pinned.model, 'gpt-5.6-sol');
  assert.ok(!pinned.policyNotices.some((n) => /NOT PINNED/.test(n)));
});
