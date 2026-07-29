// Consolidated vendor readiness report ("setup" / "doctor").
// Anchor: cli/src/setup.js
//
// A PURE AGGREGATOR over the existing discovery primitives — it adds no new
// probing logic, so the single-spawn invariant (spec §3 #4) is preserved:
//   - installCheckForAdapter : install path + auth (filesystem only, no spawn)
//   - capabilitiesForAdapter : model/effort acceptance + staleAfter (static)
//   - getVendorCache         : last-probed model catalog (reads cache file)
//   - adapter.args()         : derive sandbox-control + web-search support (pure)
//   - compatCheckForAdapter  : flag/param drift — ONLY in the opt-in `deep` tier,
//                              which spawns `<vendor> --help` once per vendor.
//
// One place to answer "is each vendor ready, and what can it do" before a
// dispatch: installed? · auth? · models? · capability fresh? · full-access? ·
// web-search? — the three axes the operator cares about (run / safety / research).

import { listAdapters, getAdapter, installCheckForAdapter, capabilitiesForAdapter, probeVendor } from './vendors/index.js';
import { getVendorCache, setVendorCache } from './cache.js';
import { projectInventoryEntry } from './inventory-contract.js';
import { compatCheckForAdapter } from './vendor-compat.js';
import { reconcileModels } from './model-normalize.js';
import { parseAgentsFile } from './agents.js';
import { listTaskTypes } from './tasks.js';
import { parseEffortPolicyCell, parseModelRuleCell, isOobCell, MODEL_SENTINELS } from './policy.js';
import { join } from 'node:path';

// Permission/approval flags that grant UNCONDITIONAL write access no matter what `sandbox`
// mode was requested — the class of flag that made grok misclassify as 'argv' (2026-07-29
// audit): its argv genuinely differs between full-access and read-only (`--always-approve`
// is dropped), but `--permission-mode` stays `bypassPermissions` either way, so the
// "read-only" argv never actually restricts anything. Matches:
//   --dangerously-bypass-approvals-and-sandbox (codex), --dangerously-skip-permissions
//   (opencode/agy/mimo/claude's full-access-only flag, listed here for completeness even
//   though today it never appears in THEIR read-only argv), --always-approve (grok,
//   full-access-only in practice — see above).
const UNCONDITIONAL_ACCESS_FLAG = /^--(dangerously-(bypass|skip)[-a-z]*|always-approve)$/;
// A --permission-mode value that itself grants unconditional access regardless of the
// requested sandbox (grok's case: this is a SEPARATE flag from --always-approve and does
// not vary with `sandbox` at all).
const UNCONDITIONAL_ACCESS_PERMISSION_MODE = 'bypassPermissions';

/**
 * Does argv rendered for a *read-only* sandbox request still carry a permission/approval
 * flag that grants unconditional write access regardless of the requested mode? If so, the
 * argv "differing by mode" (see sandboxControl below) is cosmetic, not a real downgrade.
 * @param {string[]} argv
 * @returns {boolean}
 */
function argvPinsUnconditionalAccess(argv) {
  if (argv.some((a) => UNCONDITIONAL_ACCESS_FLAG.test(a))) return true;
  const idx = argv.indexOf('--permission-mode');
  return idx !== -1 && argv[idx + 1] === UNCONDITIONAL_ACCESS_PERMISSION_MODE;
}

/**
 * Does the adapter enforce the sandbox through argv (so hopper can downgrade a
 * dispatch to read-only), or does the vendor only honor its own native policy?
 * Derived by diffing the argv the adapter emits for full-access vs read-only —
 * but a bare diff is NOT sufficient (2026-07-29 audit, ISSUE-grok-sandboxControl-
 * false-argv): grok's argv DOES differ by mode (`--always-approve` is dropped for
 * read-only), yet its `--permission-mode` stays `bypassPermissions` regardless, so
 * nothing is actually restricted. A genuine argv downgrade additionally requires
 * that the READ-ONLY argv carry no unconditional-access flag/permission-mode (see
 * argvPinsUnconditionalAccess above).
 * 'argv' = differs by mode AND the read-only argv carries no unconditional-access
 * flag (downgradable); 'full' = pins full-access always — either identical argv
 * across modes (codex, whose -s sandbox is broken on Windows) or argv that differs
 * on paper but whose read-only form still grants unconditional access (grok's
 * bypassPermissions); not downgradable either way. 'native' = no sandbox flag at
 * all (vendor honors its own policy, e.g. kimi; not downgradable).
 * @returns {'argv'|'full'|'native'|'?'}
 */
export function sandboxControl(adapter) {
  try {
    const SEP = String.fromCharCode(1);
    const fullArgv = adapter.args("x", { sandbox: "danger-full-access" });
    const roArgv = adapter.args("x", { sandbox: "read-only" });
    const full = fullArgv.join(SEP);
    const ro = roArgv.join(SEP);
    const roPinsUnconditionalAccess = argvPinsUnconditionalAccess(roArgv);
    // argv differs by mode -> hopper can downgrade to read-only ONLY if the read-only argv
    // doesn't itself carry an unconditional-access flag (grok: it does, so this is skipped).
    if (full !== ro && !roPinsUnconditionalAccess) return "argv";
    // Either identical argv for both modes, or argv that differs but whose read-only form
    // still pins unconditional access: distinguish a vendor that PINS full-access (not
    // downgradable) from one carrying no sandbox flag at all (native policy, e.g. kimi).
    return roPinsUnconditionalAccess ? "full" : "native";
  } catch (_) { return "?"; }
}

/**
 * Does the adapter plumb a web-search toggle (needed for PRD / market research)?
 * Reads the declared capabilities.webSearch (argv-diff fallback when undeclared).
 * @returns {'yes'|'manual'|'no'|'?'}
 */
export function webSearchSupport(adapter) {
  const ws = adapter && adapter.capabilities && adapter.capabilities.webSearch;
  if (ws && typeof ws.hopperEnabled === 'boolean') {
    if (ws.hopperEnabled) return 'yes';      // hopper enables it on --web-search
    return ws.headless ? 'manual' : 'no';    // vendor can search but needs env/config, or unsupported
  }
  try {
    const on = adapter.args('x', { webSearch: true }).join('');
    const off = adapter.args('x', {}).join('');
    return on !== off ? 'yes' : 'no';
  } catch (_) { return '?'; }
}

/**
 * Build the per-vendor readiness rows. Pure except for the optional `deep` tier.
 * @param {object} [o]
 * @param {boolean} [o.deep]  also run the flag-drift compat probe (spawns --help)
 *                            AND live-enumerate each vendor's models, reconciling
 *                            the result against the hardcoded knownGood (V3).
 * @param {string}  [o.only]  restrict to a single vendor
 * @param {Date}    [o.now]   injectable clock for capability-staleness (testable)
 * @param {Function}[o.probeFn] injectable model-enumeration probe (defaults to the
 *                            real probeVendor; tests pass a fake to avoid spawning)
 * @param {boolean} [o.persist] write the live catalog to the probe cache (default true)
 * @returns {Promise<Array<object>>}
 */
export async function buildVendorReadiness({ deep = false, only = null, now = new Date(), probeFn = probeVendor, persist = true } = {}) {
  const names = only ? [only] : listAdapters();
  const rows = [];
  for (const name of names) {
    let install = null;
    let error = null;
    try { install = await installCheckForAdapter(name); } catch (e) { error = String((e && e.message) || e); }
    const caps = capabilitiesForAdapter(name) || null;
    let cache = null;
    try { cache = getVendorCache(name); } catch (_) { cache = null; }
    const adapter = (() => { try { return getAdapter(name); } catch (_) { return null; } })();

    const staleAfter = caps && caps.staleAfter ? caps.staleAfter : null;
    const row = {
      name,
      installed: install ? Boolean(install.binaryFound) : false,
      path: install ? (install.resolvedPath || null) : null,
      authOk: install ? Boolean(install.authOk) : false,
      authSoftWarn: install ? Boolean(install.authSoftWarn) : false,
      authContext: install ? (install.authContext || null) : null,
      authState: install ? (install.authState || 'unverified') : 'unverified',
      authNotes: install ? (install.authNotes || []) : [],
      status: install ? install.overallStatus : (error ? 'ERROR' : 'UNKNOWN'),
      models: cache && Array.isArray(cache.models) ? cache.models : null,
      modelsProbedAt: cache ? (cache.probed_at || null) : null,
      modelAccepted: caps ? caps.modelArg.accepted : '?',
      reasoningAccepted: caps ? caps.reasoningArg.accepted : '?',
      capsStaleAfter: staleAfter,
      capsStale: staleAfter ? now > new Date(staleAfter) : false,
      sandboxControl: adapter ? sandboxControl(adapter) : '?',
      webSearch: adapter ? webSearchSupport(adapter) : '?',
      // Dispatch gate (e.g. agy headless-output unsupported) — disabled vendors are listed +
      // introspectable here but blocked from dispatch unless their enableEnv is set.
      dispatchDisabled: adapter && adapter.dispatchDisabled
        ? { reason: adapter.dispatchDisabled.reason, enableEnv: adapter.dispatchDisabled.enableEnv }
        : null,
      inventory: projectInventoryEntry(name, cache || {
        provenance: { source_kind: 'static', binary_availability: 'unknown', binary_basename: null },
      }, cache ? 'ok-v1' : 'missing'),
      error,
      compat: null,
    };
    if (deep) {
      try { row.compat = compatCheckForAdapter(name); }
      catch (e) { row.compat = { ran: false, reason: String((e && e.message) || e) }; }

      // V3: live-enumerate the vendor's models, reconcile vs hardcoded knownGood.
      const kg = (caps && caps.modelArg && Array.isArray(caps.modelArg.knownGood)) ? caps.modelArg.knownGood : [];
      try {
        const live = await probeFn(name);
        const liveModels = live && Array.isArray(live.models) ? live.models.filter((m) => typeof m === 'string' && m.trim()) : [];
        const introspection = (live && live.introspection_supported) || 'none';
        // A GENUINELY-live catalog requires `introspection_supported === 'full'` — NOT
        // merely a non-empty list. 'partial' (claude version+static aliases) and
        // 'config-only' (kimi config names) return a static/fallback list that is NOT a
        // live enumeration; reconciling it would flag every default as STALE — the exact
        // false alarm this guards against.
        const liveEnumerated = introspection === 'full' && liveModels.length > 0;
        // knownGood must be a real catalog, not a placeholder sentinel (opencode ships
        // `['<provider>/<model>']` as a format example, not a model list).
        const kgUsable = kg.length > 0 && !kg.some((g) => typeof g === 'string' && g.includes('<'));
        row.modelsLive = liveModels;
        // This row can be consumed by future setup renderers; retain only the
        // same closed projection used by all other public inventory surfaces.
        row.modelsLiveSource = projectInventoryEntry(name, live, 'ok-v1').sourceLabel;
        row.introspection = introspection;
        // Refresh the cache + Models column ONLY for genuinely-live catalogs, so doctor
        // never stamps a fresh probed_at onto static/fallback data.
        if (persist && liveEnumerated) {
          try { setVendorCache(name, { ...live, probed_at: now.toISOString() }); } catch (_) { /* cache write best-effort */ }
          row.models = liveModels;
          row.modelsProbedAt = now.toISOString();
        }
        if (!liveEnumerated) {
          row.modelReconcile = { applicable: false, reason: introspection === 'full'
            ? 'live enumeration returned no models'
            : `no live model-enumeration command (introspection: ${introspection}); model list is static/account-dependent` };
        } else if (!kgUsable) {
          row.modelReconcile = { applicable: false, reason: 'no hardcoded knownGood catalog to reconcile against (placeholder/empty)' };
        } else {
          const driftExpected = (caps && caps.modelArg && Array.isArray(caps.modelArg.driftExpected)) ? caps.modelArg.driftExpected : [];
          row.modelReconcile = { applicable: true, ...reconcileModels(name, kg, liveModels, driftExpected) };
        }
      } catch (e) {
        row.modelsLive = null;
        row.modelReconcile = { applicable: false, reason: `probe failed: ${String((e && e.message) || e)}` };
      }
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Format the per-vendor "Model catalog drift" detail (doctor --deep). PURE and
 * exported so the renderer logic is unit-testable without spawning the CLI.
 * @param {object} row a buildVendorReadiness row (expects .modelReconcile, .modelsLive)
 * @returns {{verdict: 'OK'|'DRIFT'|'n/a'|'—', detail: string}}
 */
export function formatModelDrift(row) {
  const rec = row && row.modelReconcile;
  if (!rec) return { verdict: '—', detail: '' };
  if (rec.applicable === false) return { verdict: 'n/a', detail: rec.reason || '' };
  const liveN = Array.isArray(row.modelsLive) ? row.modelsLive.length : 0;
  const suppressed = Array.isArray(rec.expectedSuppressed) ? rec.expectedSuppressed.length : 0;
  // Count matches from the LIVE side (liveN minus the new + suppressed live models) so
  // the "N of M" is accurate even if two defaults map to one live model (rec.matched is
  // a knownGood-side count that could exceed the distinct matched-live count).
  const liveMatched = Math.max(0, liveN - rec.newOnLive.length - suppressed);
  const parts = [`${liveMatched} of ${liveN} live model(s) match defaults`];
  if (suppressed > 0) parts.push(`${suppressed} expected-divergence suppressed (driftExpected)`);
  if (rec.missingFromLive.length) parts.push(`STALE default(s) not in live catalog: ${rec.missingFromLive.join(', ')}`);
  if (rec.newOnLive.length) parts.push(`NEW live model(s) absent from defaults: ${rec.newOnLive.slice(0, 8).join(', ')}${rec.newOnLive.length > 8 ? '…' : ''}`);
  const verdict = (rec.missingFromLive.length || rec.newOnLive.length) ? 'DRIFT' : 'OK';
  return { verdict, detail: parts.join('; ') };
}

/**
 * Roll the rows up into a one-line readiness verdict.
 * @param {Array<object>} rows
 * @returns {{ ready: number, total: number, notInstalled: string[], authMissing: string[], capsStale: string[] }}
 */
export function summarizeReadiness(rows) {
  const notInstalled = rows.filter((r) => !r.installed).map((r) => r.name);
  const authMissing = rows.filter((r) => r.installed && !r.authOk).map((r) => r.name);
  const capsStale = rows.filter((r) => r.capsStale).map((r) => r.name);
  const disabled = rows.filter((r) => r.dispatchDisabled).map((r) => r.name);
  const ready = rows.filter((r) => r.installed && r.authOk).length;
  // "Usable now" = installed + authed + not gated off by capability (the agy case).
  const usable = rows.filter((r) => r.installed && r.authOk && !r.dispatchDisabled).length;
  return { ready, usable, total: rows.length, notInstalled, authMissing, capsStale, disabled };
}

// Minimum Node major hopper supports (package.json engines.node ">=18").
export const MIN_NODE_MAJOR = 18;

/**
 * Runtime/prerequisite report — the "is the host itself viable" check (Node version, platform,
 * CLI version), mirroring what a good vendor `setup` shows before the per-vendor table. Pure;
 * injectable for tests.
 * @returns {{ nodeVersion, nodeMajor, nodeOk, minNodeMajor, platform, arch, version }}
 */
export function buildRuntimeReport({
  nodeVersion = process.version, platform = process.platform, arch = process.arch, version = null,
} = {}) {
  const nodeMajor = Number.parseInt(String(nodeVersion).replace(/^v/, '').split('.')[0], 10);
  const nodeOk = Number.isFinite(nodeMajor) && nodeMajor >= MIN_NODE_MAJOR;
  return { nodeVersion, nodeMajor, nodeOk, minNodeMajor: MIN_NODE_MAJOR, platform, arch, version };
}

/**
 * Concrete, ordered next-steps derived from the readiness rows + summary — the actionable tail
 * a setup command should leave the user with (install, authenticate, probe, enable, scaffold).
 * Pure; returns an array of one-line strings (empty when nothing to do).
 */
export function buildNextSteps(rows, sum, { hopperDir = null } = {}) {
  const steps = [];
  if (!hopperDir) {
    steps.push('Not inside a hopper workspace — run `hopper-dispatch --init-tasks` to scaffold `.hopper/` here.');
  }
  if (sum.notInstalled.length) {
    steps.push(`Install missing vendor CLI(s): ${sum.notInstalled.join(', ')} — \`hopper-dispatch --check ${sum.notInstalled[0]}\` shows the install command.`);
  }
  if (sum.authMissing.length) {
    steps.push(`Authenticate: ${sum.authMissing.join(', ')} — \`hopper-dispatch --check ${sum.authMissing[0]}\` shows the fix.`);
  }
  const unprobed = rows.filter((r) => r.installed && (!r.models || r.models.length === 0)).map((r) => r.name);
  if (unprobed.length) {
    steps.push(`Populate model caches (optional, enables \`--model\` validation): \`hopper-dispatch --probe\` — un-probed: ${unprobed.join(', ')}.`);
  }
  if (sum.capsStale.length) {
    steps.push(`Re-verify STALE capability metadata for ${sum.capsStale.join(', ')}: \`hopper-dispatch --setup --deep\`.`);
  }
  for (const r of rows.filter((x) => x.dispatchDisabled)) {
    steps.push(`${r.name} is DISABLED for dispatch — enable with ${r.dispatchDisabled.enableEnv}=1 if needed (\`--vendors\` shows why).`);
  }
  return steps;
}

/**
 * Batch 2: "Task-type policy" lint for `--setup`. Per task-type, reports the
 * status of all three columns in AGENTS.md's task-vendor-preference table
 * (Default vendor / Effort policy / Model rule) using the shared bound/unbound/
 * unparseable vocabulary, plus two warning classes:
 *   - effort out-of-range: an Effort policy value the bound vendor's
 *     reasoningArg.knownGood enum doesn't list (it will be silently clamped at
 *     dispatch unless you already know that — see policy.js computeEffortClamp).
 *   - Model rule references a non-existent sentinel (anything other than a
 *     known entry in MODEL_SENTINELS, once OOB/empty is ruled out).
 *
 * Pure I/O aggregation (reads AGENTS.md + task-type frame filenames), no
 * subprocess spawn — safe on the --setup zero-extra-spawn path (the surrounding
 * vendor-readiness rows are the only thing that spawns, and only in --deep).
 *
 * @param {string|null} hopperDir
 * @returns {Promise<{
 *   applicable: boolean, reason?: string,
 *   rows: Array<{ taskType: string, vendor: string|null, vendorStatus: 'bound'|'unbound',
 *                 effortStatus: 'bound'|'unbound'|'unparseable', effortValue: string|null,
 *                 modelStatus: 'bound'|'unbound'|'unparseable', modelRuleRaw: string }>,
 *   warnings: string[],
 * }>}
 */
export async function buildTaskTypePolicyReport(hopperDir) {
  if (!hopperDir) {
    return { applicable: false, reason: 'no .hopper/ workspace found in cwd — run `hopper-dispatch --init-tasks` to scaffold one', rows: [], warnings: [] };
  }
  let agentsData;
  try {
    agentsData = await parseAgentsFile(join(hopperDir, 'AGENTS.md'));
  } catch (err) {
    return { applicable: false, reason: `could not read .hopper/AGENTS.md: ${String((err && err.message) || err)}`, rows: [], warnings: [] };
  }
  let taskTypes;
  try { taskTypes = await listTaskTypes(hopperDir); } catch (_) { taskTypes = []; }
  if (taskTypes.length === 0) {
    return { applicable: false, reason: 'no task-type frames found under .hopper/tasks/', rows: [], warnings: [] };
  }

  const rows = [];
  const warnings = [];
  for (const taskType of taskTypes) {
    // Resolve the SAME way resolveVendor() does for the preferences-table branch:
    // the cell may name a nickname (Active Agent Instances), not a bare vendor id.
    const prefCell = agentsData.preferences[taskType] || null;
    let vendor = prefCell;
    if (prefCell) {
      const binding = agentsData.agents.find((a) => a.nickname === prefCell);
      if (binding) vendor = binding.vendor;
    }
    const vendorStatus = vendor ? 'bound' : 'unbound';

    const policy = (agentsData.policies && agentsData.policies[taskType]) || { effortPolicy: '', modelRule: '' };

    // Effort policy: the per-vendor table form needs a bound vendor to select an
    // entry; the single-token form does not. parseEffortPolicyCell handles both —
    // pass '' when unbound so only the vendor-agnostic single-token form can resolve.
    const parsedEffort = parseEffortPolicyCell(policy.effortPolicy, vendor || '');
    const effortStatus = parsedEffort.status === 'ok' ? 'bound' : parsedEffort.status;
    const effortValue = parsedEffort.value;

    // Model rule: OOB/empty -> unbound; a recognized sentinel -> bound; anything else
    // is a reference to a sentinel name that doesn't exist.
    const parsedModel = parseModelRuleCell(policy.modelRule);
    const modelStatus = parsedModel.status === 'ok' ? 'bound' : parsedModel.status;

    rows.push({ taskType, vendor, vendorStatus, effortStatus, effortValue, modelStatus, modelRuleRaw: policy.modelRule });

    // Warning 1: effort out-of-range for the vendor actually bound to this task-type.
    if (vendor && effortStatus === 'bound') {
      let reasoningKg = [];
      try { reasoningKg = capabilitiesForAdapter(vendor)?.reasoningArg?.knownGood || []; } catch (_) { /* unknown vendor name — nothing to check against */ }
      if (reasoningKg.length > 0 && !reasoningKg.includes(effortValue)) {
        warnings.push(`[${taskType}] Effort policy '${effortValue}' exceeds vendor '${vendor}'s reasoning enum (${reasoningKg.join('|')}) — will be silently clamped at dispatch (see the dispatch-time clamp notice) unless intentional.`);
      }
    }
    // Warning 2: Model rule references a non-existent sentinel.
    if (modelStatus === 'unparseable' && !isOobCell(policy.modelRule)) {
      warnings.push(`[${taskType}] Model rule '${String(policy.modelRule).trim()}' references an unrecognized sentinel (known: ${MODEL_SENTINELS.join(', ')}).`);
    }
  }

  return { applicable: true, rows, warnings };
}
