// Vendor adapter registry (T-PLUGIN-05a-e composition point)
// Anchor: cli/src/vendors/index.js
//
// Per spec §3 #4: this is a STATIC registry. No dynamic loading, no plugin
// discovery, no runtime registration. Adapters are imported at load time.
// Adding a vendor = edit this file + add adapter module.

import { codexAdapter } from './codex.js';
import { kimiAdapter } from './kimi.js';
import { opencodeAdapter } from './opencode.js';
import { copilotAdapter } from './copilot.js';
import { agyAdapter } from './agy.js';
import { grokAdapter } from './grok.js';
import { mimoAdapter } from './mimo.js';
import { claudeAdapter } from './claude.js';
import { piAdapter } from './pi.js';
// Phase 6b probe entry points — each module exports an async probe() fn.
// Imported lazily by probeVendor() below so that --check / --capabilities
// (which don't probe) don't pull these subprocess-capable modules into
// their hot path. The static no-spawn discovery test only scans adapter
// files + vendors/index.js; vendor-probe/*.js is the carve-out for
// opt-in --probe spawning per spec §3 #4 + §14.6.

/** @type {Record<string, import('../types.js').VendorAdapter>} */
const REGISTRY = {
  codex: codexAdapter,
  kimi: kimiAdapter,
  opencode: opencodeAdapter,
  copilot: copilotAdapter,
  agy: agyAdapter,
  grok: grokAdapter,
  mimo: mimoAdapter,
  claude: claudeAdapter,
  pi: piAdapter,
};

/**
 * Get a vendor adapter by name.
 *
 * @param {string} name
 * @returns {import('../types.js').VendorAdapter}
 * @throws {Error} If no adapter registered for this name
 */
export function getAdapter(name) {
  const adapter = REGISTRY[name];
  if (!adapter) {
    const known = Object.keys(REGISTRY).join(', ');
    throw new Error(`No vendor adapter registered for '${name}'. Known adapters: ${known}`);
  }
  return adapter;
}

/**
 * List all registered vendor adapter names.
 *
 * @returns {string[]}
 */
export function listAdapters() {
  return Object.keys(REGISTRY);
}

/**
 * Product-supported vendor set (2026-07-31 product decision). This is a
 * SUBSET of REGISTRY — every registered adapter above still ships, is still
 * dispatchable in code, and still appears in `--vendors` / scaffolded docs;
 * this constant only says which ones the hopper product line actively
 * supports going forward for docs/positioning purposes (e.g. which rows
 * scaffold.js's generated `.hopper/AGENTS.md` "Active Agent Instances" table
 * annotates "not supported"). It is NOT the dispatch-time enforcement gate —
 * that is still each project's own `.hopper/AGENTS.md` "## Approved Vendors"
 * table (fail-closed: unlisted or Approved=no is refused regardless of this
 * constant). This is the single source of truth other modules must read
 * instead of hand-copying the vendor list — a hand-copied list is exactly
 * what let `claude` and `mimo` silently fall off the scaffolded table before
 * this constant existed.
 *
 * @type {readonly string[]}
 */
export const PRODUCT_SUPPORTED_VENDORS = Object.freeze(['codex', 'grok', 'claude', 'kimi', 'pi']);

/**
 * Phase 6a: install-check helper. Runs in-process binary + auth checks
 * for one adapter. NO subprocess spawn (no vendor introspection).
 *
 * @param {string} name
 * @returns {{
 *   name: string,
 *   command: string,
 *   binaryFound: boolean,
 *   resolvedPath: string | null,
 *   needsShellWrap: boolean,
 *   authOk: boolean,
 *   authContext?: 'key-present-unverified'|'credential-artifact-present-unverified'|'not-detected'|'unknown',
 *   authState: 'verified'|'advisory'|'unverified',
 *   authNotes: string[],
 *   overallStatus: 'READY' | 'AUTH_NEEDED' | 'NOT_INSTALLED' | 'UNKNOWN',
 * }}
 */
export async function installCheckForAdapter(name) {
  // Phase 6c F2: also consult adapter.knownInstallPaths so --check reports
  // installed-but-not-on-PATH binaries (agy on Windows) correctly.
  const { resolveCommandWithKnownPaths } = await import('../path-resolve.js');
  const adapter = REGISTRY[name];
  if (!adapter) throw new Error(`No vendor adapter registered for '${name}'`);
  const resolved = resolveCommandWithKnownPaths(adapter.command, adapter.knownInstallPaths || []);
  const binaryFound = resolved !== null && resolved.resolvedPath !== null;
  const auth = adapter.envPreflight();
  // authOk MUST mirror overallStatus's treatment of the soft-warn pattern: every
  // adapter returns `ok:true` when auth is found OR is undetectable-but-probably-fine
  // (keychain/session-backed), attaching an advisory `Note: …` in `missing` for the
  // latter. That advisory must NOT render as Auth=NO (the previous
  // `missing.length === 0` test did, contradicting overallStatus=READY and producing
  // a false negative for keychain-only vendors like copilot). Only `ok:false` — a
  // hard, detectable auth-requirement gap — is not-authed. The `authNotes` carry the
  // soft-warn for display; parseResult is the backstop for a real auth failure at dispatch.
  const authOk = Boolean(auth.ok);
  const softWarn = authOk && Array.isArray(auth.missing) && auth.missing.length > 0;
  const authContexts = new Set([
    'key-present-unverified',
    'credential-artifact-present-unverified',
    'not-detected',
    'unknown',
  ]);
  const authContext = authContexts.has(auth.authContext) ? auth.authContext : undefined;
  const authState = authContext
    ? 'unverified'
    : (authOk ? (softWarn ? 'advisory' : 'verified') : 'unverified');
  let overallStatus = 'READY';
  if (!binaryFound) overallStatus = 'NOT_INSTALLED';
  else if (!auth.ok) overallStatus = 'AUTH_NEEDED';
  else if (softWarn) overallStatus = 'READY';  // soft-warn doesn't downgrade
  return {
    name,
    command: adapter.command,
    binaryFound,
    resolvedPath: resolved ? resolved.resolvedPath : null,
    needsShellWrap: resolved ? resolved.prependArgs.length > 0 : false,
    authOk,
    authSoftWarn: softWarn,   // authed-but-unverifiable-on-disk (keychain/session) — advisory, not a failure
    authContext,
    authState,
    authNotes: auth.missing || [],
    overallStatus,
  };
}

/**
 * Phase 6a: capabilities lookup. Returns the adapter's static capability
 * hint object, or null if the adapter lacks one.
 *
 * @param {string} name
 * @returns {object | null}
 */
export function capabilitiesForAdapter(name) {
  const adapter = REGISTRY[name];
  if (!adapter) throw new Error(`No vendor adapter registered for '${name}'`);
  return adapter.capabilities || null;
}

/**
 * Phase 6b: opt-in probe. Lazy-imports cli/src/vendor-probe/<name>.js and
 * calls its probe() function. Returns the standard probe-result shape:
 *   {
 *     introspection_supported: 'full' | 'partial' | 'config-only' | 'none',
 *     binary_path, version, models, models_source, reasoning_levels, notes,
 *     duration_ms
 *   }
 *
 * Spec §3 #4 carve-out: this MAY spawn vendor subprocesses (one or more per
 * vendor). Subprocesses are opt-in (user runs --probe), diagnostic (result
 * cached, not dispatched), single-attempt (no retry on failure).
 */
export async function probeVendor(name) {
  if (!REGISTRY[name]) {
    throw new Error(`No vendor adapter registered for '${name}'. Known: ${Object.keys(REGISTRY).join(', ')}`);
  }
  // Dynamic import — keeps spawn-capable modules off the --check / --capabilities hot path.
  const mod = await import(`../vendor-probe/${name}.js`);
  if (typeof mod.probe !== 'function') {
    throw new Error(`vendor-probe/${name}.js does not export probe()`);
  }
  return mod.probe();
}
