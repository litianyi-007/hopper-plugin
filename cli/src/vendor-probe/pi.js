// pi vendor probe — runs `pi --version`, `pi --list-models`, `pi auth check`
// Anchor: cli/src/vendor-probe/pi.js
//
// Per spec §3 #4: probe() is a DIAGNOSTIC path (opt-in via `--probe`), distinct
// from the dispatch single-spawn invariant. It spawns a bounded number of `pi`
// subprocesses, each with a hard 30s timeout and NO retry.
//
// WHY pi's CATALOG IS WORTH PROBING (unlike claude's, which is 'partial'):
// `pi --list-models` is a real, machine-local catalog command AND it is
// account-scoped — V-verified 2026-08-10, it listed only `openai-codex` models
// on a machine whose ~/.pi/agent/auth.json and models-store.json both contain
// exactly that one provider. So the probe's list is not merely "what pi knows
// about", it is "what this install can actually dispatch to". That makes it the
// self-healing source of truth for the adapter's necessarily machine-specific
// knownGood array (see the sourceNote in cli/src/vendors/pi.js).

import { spawn } from 'node:child_process';
import { resolveCommandWithKnownPaths } from '../path-resolve.js';
import { killProcessTree } from '../subprocess.js';
import { piAdapter } from '../vendors/pi.js';

const PROBE_TIMEOUT_MS = 30_000;
const IS_WINDOWS = process.platform === 'win32';

/**
 * Ceiling on `pi auth check` spawns. One per distinct provider in the catalog is
 * normally 1–2 processes, but the catalog is vendor-controlled input and this is
 * a diagnostic path — a bound keeps a pathological store from turning `--probe`
 * into dozens of spawns.
 */
const MAX_AUTH_CHECKS = 4;

/** Closed vocabulary for a provider's readiness note; anything else becomes 'unknown'. */
const AUTH_STATUSES = new Set(['ready', 'not_ready', 'unknown']);

/**
 * Parse `pi --list-models` into `provider/model` identifiers.
 *
 * The output is a whitespace-aligned table whose first row is a header
 * (V-verified 2026-08-10 on pi 0.84.1):
 *
 *   provider      model          context  max-out  thinking  images
 *   openai-codex  gpt-5.6-terra  272K     128K     yes       yes
 *
 * Only the first two columns are taken, and both must look like identifiers, so
 * prose, blank lines and the header itself are dropped. The header is rejected
 * by the same rule that accepts data rows — column 1 of the header is literally
 * `provider` and column 2 is `model`, which WOULD pass the shape test, so it is
 * excluded explicitly rather than by hoping a regex misses it.
 *
 * Pure and exported for static-fixture tests (no spawn needed to test it).
 * @param {string} stdout
 * @returns {string[]} deduplicated `provider/model` strings, input order preserved
 */
export function parsePiModelsList(stdout) {
  // The PROVIDER column is a plain identifier. The MODEL column is deliberately
  // more permissive: real pi catalogs carry ids containing `/` and `@` — e.g.
  // Cloudflare Workers AI's `@cf/moonshotai/kimi-k2.6` — and the original,
  // stricter pattern silently dropped those rows, so a provider whose whole
  // catalog is namespaced could report `catalog-unavailable` while working fine
  // (adversarial review 2026-08-10). Still anchored and still character-class
  // bounded, so prose and the header row cannot slip through.
  const providerIdent = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
  const modelIdent = /^[@A-Za-z0-9][A-Za-z0-9._:/@-]*$/;
  const seen = new Set();
  const out = [];
  for (const raw of String(stdout || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean);
    if (cols.length < 2) continue;
    const [provider, model] = cols;
    if (provider === 'provider' && model === 'model') continue;  // header row
    if (!providerIdent.test(provider) || !modelIdent.test(model)) continue;
    const id = `${provider}/${model}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Distinct provider names from a `provider/model` list, in first-seen order.
 * @param {string[]} models
 * @returns {string[]}
 */
export function piProvidersFromModels(models) {
  const seen = [];
  for (const m of Array.isArray(models) ? models : []) {
    const provider = String(m).split('/')[0];
    if (provider && !seen.includes(provider)) seen.push(provider);
  }
  return seen;
}

/**
 * Reduce one `pi auth check --json` result to a closed status token. The command
 * emits `{"status":"ready","provider":"...","authType":"oauth"}` on success and
 * `{"status":"not_ready","provider":"...","reason":"credentials_not_configured"}`
 * otherwise (V-verified 2026-08-10). Only `status` is read: `reason` and
 * `authType` are vendor-controlled strings that would end up in a diagnostic
 * note, and nothing here needs them.
 * @param {{exitCode: number, stdout: string}} result
 * @returns {'ready'|'not_ready'|'unknown'}
 */
export function parsePiAuthStatus(result) {
  try {
    const parsed = JSON.parse(String(result?.stdout || '').trim());
    const status = parsed && typeof parsed === 'object' ? parsed.status : null;
    return AUTH_STATUSES.has(status) ? status : 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

/** Run a single subprocess attempt; capture stdout + exit code. No retry. */
function runOnce(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: !IS_WINDOWS,  // group-kill needs detached on POSIX
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { timedOut = true; killProcessTree(child.pid, IS_WINDOWS); }, PROBE_TIMEOUT_MS);
    timer.unref();
    child.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: code ?? 1, stdout, stderr, timedOut }); });
    child.on('error', () => { clearTimeout(timer); resolve({ exitCode: 127, stdout, stderr, timedOut: false }); });
  });
}

/**
 * Probe the pi CLI. Returns the standard probe-result shape (see cli/src/cache.js).
 */
export async function probe() {
  const t0 = Date.now();

  // Resolve binary path (no spawn — in-process PATH walk, then the adapter's
  // deterministic knownInstallPaths). Using the knownInstallPaths-aware resolver
  // is load-bearing, not tidiness: dispatch resolves through it, so a plain
  // PATH-only walk here would report `binary_availability: "missing"` /
  // `introspection_supported: "none"` for an install that dispatch runs
  // perfectly well — exactly the macOS/Linux npm-global-off-PATH case those
  // paths exist for (adversarial review 2026-08-10).
  const resolved = resolveCommandWithKnownPaths('pi', piAdapter.knownInstallPaths || []);
  if (!resolved || !resolved.resolvedPath) {
    return {
      introspection_supported: 'none',
      version: null,
      models: [],
      models_source: 'unavailable',
      reasoning_levels: [],
      notes: [],
      provenance: {
        source_kind: 'unavailable', source_label: 'unavailable',
        binary_availability: 'missing', binary_basename: null,
      },
      diagnostic_code: 'catalog-unavailable',
      duration_ms: Date.now() - t0,
    };
  }

  const cmd = resolved.command;
  const prepend = resolved.prependArgs;
  const notes = [];

  // 1. version
  let version = null;
  const verResult = await runOnce(cmd, [...prepend, '--version']);
  if (verResult.exitCode === 0 && verResult.stdout) {
    const m = verResult.stdout.match(/[\d]+\.[\d]+\.[\d]+/);
    if (m) version = m[0];
  }
  if (!version) notes.push('pi --version was unparseable or did not run');

  // 2. account-scoped model catalog
  let models = [];
  let modelsSource = 'unavailable';
  let diagnosticCode = 'probe-failed';
  const modelsResult = await runOnce(cmd, [...prepend, '--list-models']);
  if (modelsResult.exitCode === 0 && modelsResult.stdout.trim()) {
    models = parsePiModelsList(modelsResult.stdout);
    if (models.length > 0) {
      modelsSource = 'cli-catalog';
      diagnosticCode = 'none';
    } else {
      notes.push('pi --list-models produced no parseable rows (no provider authenticated?)');
      diagnosticCode = 'catalog-unavailable';
    }
  } else {
    notes.push(modelsResult.timedOut
      ? 'pi --list-models timed out'
      : `pi --list-models exited ${modelsResult.exitCode}`);
  }

  // 3. per-provider readiness. `pi auth check` REQUIRES a --provider (or
  // --model), so there is no single "is pi logged in" call — readiness is only
  // meaningful per provider, which is exactly what a model selector targets.
  const providers = piProvidersFromModels(models).slice(0, MAX_AUTH_CHECKS);
  for (const provider of providers) {
    const authResult = await runOnce(cmd, [...prepend, 'auth', 'check', '--provider', provider, '--json', '--no-refresh']);
    notes.push(`auth ${provider}=${parsePiAuthStatus(authResult)}`);
  }
  const skipped = piProvidersFromModels(models).length - providers.length;
  if (skipped > 0) notes.push(`auth check skipped for ${skipped} further provider(s) (cap ${MAX_AUTH_CHECKS})`);

  return {
    // 'full': both the version AND the model catalog come from live commands.
    introspection_supported: modelsSource === 'cli-catalog' ? 'full' : 'partial',
    version,
    models,
    models_source: modelsSource,
    // pi's --thinking enum is a fixed, documented CLI vocabulary, not a live
    // query, so it is reported verbatim rather than probed. Listed in pi's own
    // order; `off`/`max` are outside hopper's canonical scale and reachable only
    // via HOPPER_PI_THINKING (see cli/src/vendors/pi.js resolvePiThinking).
    reasoning_levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    notes,
    provenance: {
      source_kind: modelsSource === 'cli-catalog' ? 'cli-catalog' : 'unavailable',
      source_label: modelsSource === 'cli-catalog' ? 'pi-cli-catalog' : 'unavailable',
      binary_availability: 'present', binary_basename: 'pi',
    },
    diagnostic_code: diagnosticCode,
    duration_ms: Date.now() - t0,
  };
}
