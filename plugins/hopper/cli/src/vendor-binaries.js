// Vendor binary provenance — which file hopper actually spawns, and what else
// on PATH answers to the same name.
// Anchor: cli/src/vendor-binaries.js
//
// WHY THIS EXISTS (2026-08-05, live incident)
// -------------------------------------------
// A machine can carry several installs of the same vendor CLI on PATH. hopper
// spawns whichever resolves FIRST, and that is not necessarily the one the
// operator's interactive shell resolves — different shells inherit different
// PATH order. Observed live: `codex` resolved to 0.131.0 for hopper (via a
// hand-written `~/bin/codex` shim) and to 0.146.0 for the user's PowerShell
// (via nvm4w, later on PATH). Every codex dispatch then failed 400 against a
// model that requires codex >= 0.144, and NOTHING in hopper could see why:
//   - `--setup` reported `binaryAvailability=unknown binaryBasename=null`
//     (hardcoded, never populated)
//   - the handoff frontmatter recorded the same two unknowns
//   - only the FIRST PATH hit was ever resolved, so the second install was
//     invisible by construction
// The operator diagnosed it by hand from a 400KB raw log. This module is the
// missing observation.
//
// SPAWN CARVE-OUT
// ---------------
// Same contract as vendor-compat.js: the version probe spawns, so it is kept
// OUT of vendors/index.js and the adapter files, preserving the single-spawn
// dispatch invariant (spec §3 #4) and the no-spawn discovery test. Enumeration
// (enumerateVendorBinaries) is pure-fs and safe on the `--setup` zero-extra-
// spawn path; only probeBinaryVersions() spawns, and only under `--deep`.
//
// PRIVACY BOUNDARY
// ----------------
// Absolute paths are LOCAL DIAGNOSTICS. They are rendered to the operator's own
// terminal and never routed through projectInventoryEntry() / renderSafeInventory()
// — that projection is deliberately closed and path-free. A VERSION string is
// path-free and therefore may cross into the public projection; a PATH may not.

import { spawnSync } from 'node:child_process';
import { getAdapter } from './vendors/index.js';
import { resolveAllCommandsOnPath, resolveCommandWithKnownPaths } from './path-resolve.js';
import { compareVersionDesc } from './version.js';

/** Cap for any vendor-emitted string we keep, so a pathological CLI cannot flood the report. */
const RAW_VERSION_CAP = 80;

/**
 * Every PATH entry answering to a vendor's command name, plus which one hopper
 * would actually spawn. ZERO subprocess — statSync/accessSync only.
 *
 * `spawned` marks the entry `resolveCommandWithKnownPaths` selects, i.e. exactly
 * what dispatch will run. When the binary is off-PATH and only reachable through
 * the adapter's knownInstallPaths fallback, `entries` is empty and
 * `offPathSpawn` carries that path instead.
 *
 * @param {string} name vendor id
 * @returns {{
 *   name: string, command: string,
 *   entries: Array<{ resolvedPath: string, dir: string, direct: boolean, spawned: boolean, version: string|null, versionNote: string|null }>,
 *   offPathSpawn: string|null,
 *   found: boolean,
 * }}
 */
export function enumerateVendorBinaries(name) {
  const adapter = getAdapter(name);  // throws on unknown vendor
  const command = adapter.command;
  const hits = resolveAllCommandsOnPath(command);
  const selected = resolveCommandWithKnownPaths(command, adapter.knownInstallPaths || []);
  const selectedPath = selected ? selected.resolvedPath : null;

  // De-duplicate BY FILE, first-seen order preserved. A PATH that lists the same
  // directory several times (very common on Windows) makes the walker return the
  // same file repeatedly — reporting that as N separate installs inflates the
  // count and marks every copy `← spawned`, which reads as a conflict that does
  // not exist. The signal is DISTINCT FILES; repeated PATH dirs are hygiene, so
  // they are collapsed here and surfaced once as `duplicatePathDirs`.
  // De-dup lives in this diagnostic layer, not in resolveAllCommandsOnPath():
  // that function stays a faithful PATH walk so it keeps mirroring the resolver
  // that dispatch actually uses.
  const seen = new Map();
  for (const h of hits) {
    const key = process.platform === 'win32' ? h.resolvedPath.toLowerCase() : h.resolvedPath;
    const prior = seen.get(key);
    if (prior) { prior.pathHits += 1; continue; }
    seen.set(key, {
      ...h,
      pathHits: 1,
      // Path comparison is case-insensitive on Windows: PATH entries and the
      // resolver can disagree on drive-letter / directory casing for the same file.
      spawned: selectedPath != null && samePath(h.resolvedPath, selectedPath),
      version: null,
      versionNote: null,
    });
  }
  const entries = [...seen.values()];
  const duplicatePathDirs = hits.length - entries.length;

  // Off-PATH fallback: the adapter found it under knownInstallPaths, so no PATH
  // walk could have produced it (agy on Windows is the shipped case).
  const offPathSpawn = selectedPath && !entries.some((e) => e.spawned) ? selectedPath : null;

  return { name, command, entries, offPathSpawn, duplicatePathDirs, found: Boolean(selectedPath) };
}

/** Case-insensitive on win32, exact elsewhere. */
function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * SPAWNS `<binary> --version` once per enumerated entry and annotates it in place.
 * `--deep` only. Never called from the dispatch path.
 *
 * Version extraction is deliberately vendor-agnostic: take the first
 * semver-shaped token anywhere in stdout+stderr. Vendors print wildly different
 * banners (`codex-cli 0.131.0`, `grok/0.2.101`, bare `1.2.3`), and a per-vendor
 * parser table would be one more thing to rot. A line that yields no semver is
 * recorded as a capped raw snippet with `versionNote: 'unparsed'` rather than
 * being dropped — "it answered but not in a shape we know" is different
 * information from "it did not answer".
 *
 * @param {ReturnType<typeof enumerateVendorBinaries>} report mutated in place and returned
 * @param {object} [o]
 * @param {number} [o.timeoutMs]
 * @param {Function} [o.spawnFn] injectable for tests (defaults to spawnSync)
 */
export function probeBinaryVersions(report, { timeoutMs = 8000, spawnFn = spawnSync } = {}) {
  for (const entry of report.entries) {
    // .cmd/.bat cannot be executed by CreateProcessW directly — route through
    // the same cmd.exe wrapper the real spawn would use.
    const useShim = process.platform === 'win32' && !entry.direct;
    const cmd = useShim ? (process.env.ComSpec || 'cmd.exe') : entry.resolvedPath;
    const args = useShim ? ['/c', entry.resolvedPath, '--version'] : ['--version'];
    try {
      const r = spawnFn(cmd, args, { encoding: 'utf-8', timeout: timeoutMs, windowsHide: true });
      const out = `${(r && r.stdout) || ''}\n${(r && r.stderr) || ''}`;
      const parsed = extractVersion(out);
      entry.version = parsed.version;
      entry.versionNote = parsed.note;
    } catch (err) {
      entry.version = null;
      entry.versionNote = `probe failed: ${sanitize(String((err && err.message) || err))}`;
    }
  }
  return report;
}

/**
 * First semver-shaped token in arbitrary CLI output.
 * @param {string} out
 * @returns {{ version: string|null, note: string|null }}
 */
export function extractVersion(out) {
  const text = typeof out === 'string' ? out : '';
  // Leading \b would REJECT the very common `v1.2.3` form: `v` and `1` are both word
  // characters, so there is no boundary between them (caught by unit test — `v2.1.220-beta.3`
  // parsed as null). Anchor on "start, or a char that is not a digit or dot" instead, which
  // still refuses to start mid-number (`1.220` inside `2.1.220`). Written as a capture group
  // rather than a lookbehind so the floor stays Node 18 with no regex-feature dependency.
  // The pre-release tail is segment-wise so it can never end on a stray dot.
  const m = text.match(/(^|[^\d.])(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)/);
  if (m) return { version: m[2], note: null };
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!firstLine) return { version: null, note: 'no output' };
  return { version: null, note: `unparsed: ${sanitize(firstLine)}` };
}

/** Strip control chars and cap, so vendor output cannot break the terminal report. */
function sanitize(s) {
  const clean = [...String(s)]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? ' ' : ch;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > RAW_VERSION_CAP ? `${clean.slice(0, RAW_VERSION_CAP - 1)}\u2026` : clean;
}

/**
 * Pure verdict over an enumerated (and optionally version-probed) report.
 * Separated from rendering so the judgment is unit-testable without a terminal.
 *
 * Verdicts:
 *   'missing'   — nothing resolves; dispatch would ENOENT
 *   'conflict'  — several entries AND at least two distinct known versions.
 *                 THE incident case: hopper's pick may not be the operator's.
 *   'multiple'  — several entries, but no version disagreement is established
 *                 (either all equal, or versions were never probed)
 *   'ok'        — exactly one entry
 *   'off-path'  — only reachable via the adapter's knownInstallPaths fallback
 *
 * @param {ReturnType<typeof enumerateVendorBinaries>} report
 * @returns {{ verdict: string, distinctVersions: string[], spawnedVersion: string|null, entryCount: number, probed: boolean }}
 */
export function summarizeBinaryDrift(report) {
  const entries = (report && report.entries) || [];
  const probed = entries.some((e) => e.version != null || e.versionNote != null);
  const distinctVersions = [...new Set(entries.map((e) => e.version).filter(Boolean))];
  const spawnedEntry = entries.find((e) => e.spawned) || null;
  const spawnedVersion = spawnedEntry ? spawnedEntry.version : null;
  const base = { distinctVersions, spawnedVersion, entryCount: entries.length, probed };

  if (!report || !report.found) return { verdict: 'missing', ...base };
  if (entries.length === 0 && report.offPathSpawn) return { verdict: 'off-path', ...base };
  if (entries.length <= 1) return { verdict: 'ok', ...base };
  if (distinctVersions.length > 1) return { verdict: 'conflict', ...base };
  return { verdict: 'multiple', ...base };
}

/**
 * PATH-FREE one-liner for the PUBLIC discovery surface (`--setup`).
 *
 * `--models` / `--capabilities` / `--setup` / `--check` are contractually
 * forbidden from emitting local filesystem paths — enforced by
 * tests/unit/model-attestation-contract.test.js, which runs each of them against
 * a vendor binary planted in a temp dir and fails if the directory appears
 * anywhere in the output. Absolute paths are therefore confined to the
 * `--binaries` command (a local diagnostic, not a discovery surface), and this
 * summary carries only counts, verdicts and parsed version numbers.
 *
 * Only a PARSED semver is rendered; an `unparsed:` snippet is vendor-controlled
 * text and is reduced to `?` so no vendor output can cross this boundary either.
 *
 * @param {ReturnType<typeof enumerateVendorBinaries>} report
 * @returns {string} single line, already padded, no leading indent
 */
export function formatBinarySummary(report) {
  const s = summarizeBinaryDrift(report);
  const name = ((report && report.name) || '?').padEnd(9);
  if (s.verdict === 'missing') return `${name} not found on PATH`;
  if (s.verdict === 'off-path') return `${name} ${'—'.padEnd(10)} off PATH (adapter knownInstallPaths fallback)`;

  const shown = s.spawnedVersion || (s.probed ? '?' : '—');
  const head = `${name} ${String(shown).padEnd(10)}`;

  if (s.verdict === 'conflict') {
    const newest = [...s.distinctVersions].sort(compareVersionDesc)[0];
    const behind = s.spawnedVersion && newest && s.spawnedVersion !== newest
      ? ` — spawning ${s.spawnedVersion}, newest present is ${newest}`
      : '';
    return `${head} ⚠ ${s.entryCount} installs, ${s.distinctVersions.length} versions (${s.distinctVersions.join(', ')})${behind}`;
  }
  if (s.verdict === 'multiple') {
    return `${head} ${s.entryCount} installs on PATH${s.probed ? ' (same version)' : ' (versions not probed — --deep)'}`;
  }
  const dup = report.duplicatePathDirs > 0 ? `  (PATH lists its dir ${report.duplicatePathDirs + 1}x)` : '';
  return `${head} 1 install${dup}`;
}


/**
 * FULL provenance including absolute paths — for the `--binaries` local
 * diagnostic ONLY. Never call this from `--setup`/`--check`/`--models`/
 * `--capabilities`; see formatBinarySummary() for why.
 *
 * Pure — returns strings, prints nothing, so the renderer stays I/O-only and
 * this stays testable.
 *
 * @param {ReturnType<typeof enumerateVendorBinaries>} report
 * @returns {string[]}
 */
export function formatBinaryReport(report) {
  const s = summarizeBinaryDrift(report);
  const name = (report && report.name) || '?';
  const pad = name.padEnd(9);
  const lines = [];

  if (s.verdict === 'missing') {
    lines.push(`  ${pad} not found on PATH`);
    return lines;
  }
  if (s.verdict === 'off-path') {
    lines.push(`  ${pad} ${report.offPathSpawn}  (off PATH — adapter knownInstallPaths fallback)`);
    return lines;
  }

  const spawned = report.entries.find((e) => e.spawned) || report.entries[0];
  const ver = spawned && spawned.version ? spawned.version : (s.probed ? '?' : '—');
  lines.push(`  ${pad} ${String(ver).padEnd(10)} ${spawned ? spawned.resolvedPath : ''}`);

  if (s.verdict === 'conflict') {
    lines.push(`  ${' '.repeat(9)} ⚠ ${s.entryCount} entries on PATH, ${s.distinctVersions.length} distinct versions`
      + ' — hopper spawns the FIRST, which may not be what your shell runs:');
  } else if (s.verdict === 'multiple') {
    lines.push(`  ${' '.repeat(9)} ${s.entryCount} entries on PATH${s.probed ? ' (same version)' : ' (versions not probed — use --deep)'}:`);
  } else {
    if (report.duplicatePathDirs > 0) {
      lines.push(`  ${' '.repeat(9)} note: PATH lists this binary's directory ${report.duplicatePathDirs + 1}x (harmless, but PATH is worth tidying)`);
    }
    return lines;
  }
  for (const e of report.entries) {
    const v = e.version ? e.version : (e.versionNote ? '?' : '—');
    const dup = e.pathHits > 1 ? `  (${e.pathHits} PATH entries → same file)` : '';
    lines.push(`  ${' '.repeat(11)} ${String(v).padEnd(10)} ${e.resolvedPath}${e.spawned ? '   ← spawned' : ''}${dup}`);
  }
  return lines;
}
