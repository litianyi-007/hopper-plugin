// Per-machine vendor capability cache (Phase 6b)
// Anchor: cli/src/cache.js
//
// Location: ~/.hopper/cache/vendor-capabilities.json (per-machine, not
// per-project — model availability is machine + account specific).
//
// Per spec §3 #4: cache READ is zero-subprocess (--capabilities + --models).
// Cache WRITE happens only via --probe (opt-in, diagnostic, single-spawn-
// per-vendor). Dispatch path NEVER auto-writes the cache.
//
// Schema v1:
//   {
//     "version": 1,
//     "host": "<hostname>",
//     "probed_at_global": ISO8601,
//     "vendors": {
//       "<name>": {
//         "introspection_supported": "full" | "partial" | "config-only" | "none",
//         "probed_at": ISO8601,
//         "binary_path": string | null,
//         "version": string | null,
//         "models": string[],         // alias/identifier list
//         "models_source": string,    // what command/file produced this
//         "reasoning_levels": string[],
//         "notes": string[],
//         "duration_ms": number
//       }
//     }
//   }

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, statSync, readdirSync, chmodSync, fsyncSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const CACHE_VERSION = 1;
const STALE_DAYS_DEFAULT = 14;
const LOCK_STALE_MS = 30_000;        // a lockfile older than this is considered abandoned
const LOCK_ACQUIRE_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 50;

/**
 * Resolve the cache file path. Allows HOPPER_CACHE_DIR override for tests.
 */
export function cachePath() {
  const root = process.env.HOPPER_CACHE_DIR || join(homedir(), '.hopper', 'cache');
  return join(root, 'vendor-capabilities.json');
}

/**
 * Read the cache. Returns null if missing or malformed.
 * Auto-migrates / discards on version mismatch (safe — cache is rebuildable).
 * For diagnostic surfaces that need to distinguish "missing" from "corrupt",
 * use `readCacheWithDiagnostics()`.
 */
export function readCache() {
  const r = readCacheWithOutcome();
  return r.cache;
}

/**
 * Return a bounded cache-read outcome. Callers must use the diagnostic code,
 * never the raw filesystem/parser error, on public surfaces.
 */
export function readCacheWithOutcome() {
  const path = cachePath();
  if (!existsSync(path)) return { outcome: 'missing', cache: null, diagnostic_code: 'none' };
  let raw;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (_) {
    return { outcome: 'malformed', cache: null, diagnostic_code: 'inventory-cache-malformed' };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return { outcome: 'malformed', cache: null, diagnostic_code: 'inventory-cache-malformed' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { outcome: 'malformed', cache: null, diagnostic_code: 'inventory-cache-malformed' };
  }
  if (parsed.version !== CACHE_VERSION) {
    return { outcome: 'version-mismatch', cache: null, diagnostic_code: 'inventory-cache-version-unsupported' };
  }
  if (!parsed.vendors || typeof parsed.vendors !== 'object') {
    return { outcome: 'malformed', cache: null, diagnostic_code: 'inventory-cache-malformed' };
  }
  return { outcome: 'ok-v1', cache: parsed, diagnostic_code: 'none' };
}

/**
 * Compatibility wrapper for existing callers. `error` is deliberately a
 * closed diagnostic code, not a raw path or parse exception.
 */
export function readCacheWithDiagnostics() {
  const result = readCacheWithOutcome();
  return {
    ...result,
    error: result.diagnostic_code === 'none' ? null : result.diagnostic_code,
  };
}

/**
 * Write cache atomically via an owner-only temp + rename.
 *
 * The same production filesystem and security seams as explicit recovery are
 * accepted here so every cache payload is protected before its first byte is
 * written. A failed hardening step is deliberately closed to a diagnostic
 * code: the active cache must remain untouched.
 */
export function writeCache(data, { fsOps = DEFAULT_FS_OPS, security = {} } = {}) {
  const path = cachePath();
  const mergedSecurity = { ...DEFAULT_SECURITY, ...security };
  if (!prepareCacheParent(path, fsOps, mergedSecurity)) throw new Error('inventory-cache-parent-owner-only-failed');
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  const temp = createOwnerOnlyExclusive(tmp, fsOps, mergedSecurity);
  if (!temp.created) throw new Error('inventory-cache-write-owner-only-failed');
  try {
    fsOps.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fsOps.renameSync(tmp, path);
  } catch (_) {
    bestEffortUnlink(tmp, fsOps);
    throw new Error('inventory-cache-write-failed');
  }
}

/**
 * Get cached entry for one vendor, or null if absent.
 */
export function getVendorCache(name) {
  const { cache } = readCacheWithOutcome();
  return cache?.vendors?.[name] || null;
}

/**
 * Acquire an exclusive file lock by O_EXCL creation. Retries on EEXIST until
 * `timeoutMs` elapses. If an existing lock is older than LOCK_STALE_MS it is
 * treated as abandoned (process crashed mid-write) and removed.
 * Returns the lockfile path on success; throws on timeout.
 */
function acquireLock(lockPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const fd = openSync(lockPath, 'wx');  // O_CREAT | O_EXCL
      closeSync(fd);
      return lockPath;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Stale-lock recovery: if the lockfile is older than LOCK_STALE_MS,
      // assume the holding process died and remove it.
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try { unlinkSync(lockPath); } catch (_) { /* race: someone else cleared it */ }
          continue;  // immediate retry
        }
      } catch (_) { /* stat race; fall through to backoff */ }
      if (Date.now() >= deadline) {
        throw new Error(`cache lock timeout after ${timeoutMs}ms: ${lockPath}`);
      }
      // Sync sleep via Atomics.wait — locks are held briefly (a few ms of JSON write).
      Atomics.wait(LOCK_SLEEP_BUF, 0, 0, LOCK_RETRY_MS);
    }
  }
}

const LOCK_SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));

function releaseLock(lockPath) {
  try { unlinkSync(lockPath); } catch (_) { /* already gone */ }
}

/**
 * Set one vendor's cache entry (merges into existing cache, preserves others).
 * F2-fix: holds an exclusive file lock for the read-merge-write critical section
 * so parallel `--probe codex` / `--probe opencode` invocations cannot drop each
 * other's entries.
 */
export function setVendorCache(name, entry, { fsOps = DEFAULT_FS_OPS, security = {} } = {}) {
  const path = cachePath();
  const prior = readCacheWithOutcome();
  const mergedSecurity = { ...DEFAULT_SECURITY, ...security };
  if (!prepareCacheParent(path, fsOps, mergedSecurity)) {
    return { written: false, outcome: prior.outcome, diagnostic_code: 'inventory-cache-parent-owner-only-failed' };
  }
  const lockPath = `${path}.lock`;
  acquireLock(lockPath, LOCK_ACQUIRE_TIMEOUT_MS);
  try {
    // Re-read INSIDE the critical section so we merge against current state,
    // not a stale pre-lock snapshot. A malformed/future cache is not empty:
    // ordinary probes must not overwrite a byte of it.
    const current = readCacheWithOutcome();
    if (current.outcome === 'malformed' || current.outcome === 'version-mismatch') {
      return { written: false, outcome: current.outcome, diagnostic_code: current.diagnostic_code };
    }
    const c = current.outcome === 'missing' ? freshCache() : current.cache;
    c.vendors = sanitizeVendorRegistry(c.vendors);
    const oldEntry = c.vendors[name] && typeof c.vendors[name] === 'object' ? c.vendors[name] : {};
    c.vendors[name] = sanitizeVendorEntry(mergeVendorEntry(oldEntry, entry));
    c.probed_at_global = new Date().toISOString();
    try {
      writeCache(c, { fsOps, security: mergedSecurity });
    } catch (err) {
      const diagnostic_code = err && err.message === 'inventory-cache-parent-owner-only-failed'
        ? 'inventory-cache-parent-owner-only-failed'
        : err && err.message === 'inventory-cache-write-owner-only-failed'
          ? 'inventory-cache-write-owner-only-failed'
        : 'inventory-cache-write-failed';
      return { written: false, outcome: current.outcome, diagnostic_code };
    }
    return { written: true, outcome: current.outcome, diagnostic_code: 'none' };
  } finally {
    releaseLock(lockPath);
  }
}

function mergeVendorEntry(previous, incoming) {
  const merged = { ...previous };
  if (!incoming || typeof incoming !== 'object') return merged;
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (key === 'provenance' && value && typeof value === 'object' && !Array.isArray(value)) {
      const priorProvenance = previous.provenance && typeof previous.provenance === 'object' && !Array.isArray(previous.provenance)
        ? previous.provenance
        : {};
      merged.provenance = { ...priorProvenance, ...value };
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

const SENSITIVE_LEGACY_FIELDS = new Set([
  'binary_path', 'binaryPath', 'config_path', 'configPath', 'config_file', 'configFile',
  'raw_path', 'rawPath', 'raw_log', 'rawLog', 'log_path', 'logPath',
  'notes', 'note', 'source_note', 'sourceNote', 'source_path', 'sourcePath',
  'modelsSource', 'raw_source', 'rawSource', 'error', 'stderr', 'stdout',
  'auth_excerpt', 'authExcerpt', 'auth_error', 'authError',
  'provider', 'provider_url', 'providerUrl', 'provider_path', 'providerPath',
  'url', 'uri', 'endpoint', 'endpoint_url', 'endpointUrl',
]);

const SAFE_PROBE_SOURCE_KINDS = new Set([
  'adapter-aliases', 'cli-catalog', 'config', 'static', 'unavailable', 'unknown',
]);

function sanitizeVendorRegistry(vendors) {
  if (!vendors || typeof vendors !== 'object' || Array.isArray(vendors)) return {};
  return Object.fromEntries(Object.entries(vendors).map(([name, entry]) => [name, sanitizeVendorEntry(entry)]));
}

function sanitizeVendorEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const sanitized = sanitizeLegacyValue(entry, { vendorEntry: true });
  if (Object.hasOwn(sanitized, 'models_source')) {
    const sourceKind = sanitized.provenance?.source_kind;
    sanitized.models_source = SAFE_PROBE_SOURCE_KINDS.has(sourceKind) ? sourceKind : 'unknown';
  }
  return sanitized;
}

function sanitizeLegacyValue(value, { vendorEntry = false } = {}) {
  if (Array.isArray(value)) return value.map((item) => sanitizeLegacyValue(item));
  if (!value || typeof value !== 'object') return value;
  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'models_source' && vendorEntry) {
      sanitized[key] = child;
      continue;
    }
    if (key === 'models_source' || SENSITIVE_LEGACY_FIELDS.has(key)) continue;
    sanitized[key] = sanitizeLegacyValue(child);
  }
  return sanitized;
}

function freshCache({ vendor = null, entry = null } = {}) {
  const vendors = {};
  if (vendor && entry) vendors[vendor] = sanitizeVendorEntry(mergeVendorEntry({}, entry));
  return {
    version: CACHE_VERSION,
    host: hostname(),
    probed_at_global: new Date().toISOString(),
    vendors,
  };
}

const DEFAULT_FS_OPS = {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  renameSync,
  unlinkSync,
  readdirSync,
  statSync,
  chmodSync,
  fsyncSync,
};

function windowsIdentity() {
  const name = process.env.USERNAME;
  const domain = process.env.USERDOMAIN;
  return domain && name ? `${domain}\\${name}` : name;
}

// `icacls <path>`'s default listing interleaves SACL "Mandatory Label"
// (integrity level) entries with DACL ACE lines, using the same visual
// shape (`principal:(flags)`) as a real permission grant -- e.g. a stock
// `icacls C:\` shows `Mandatory Label\High Mandatory Level:(OI)(NP)(IO)(NW)`
// on the very same listing as the real owner/SYSTEM/Administrators DACL
// grants. A Mandatory Label is not a discretionary access grant to another
// principal (it cannot be used by anyone to read or write the object), so
// it must never be counted as a competing ACE when asserting "exactly one
// owner-only grant exists". Concretely: GitHub Actions windows-latest
// redirects TEMP/TMP onto the ephemeral D:\ drive; if that drive's root (or
// any ancestor) carries an inheritable Mandatory Label -- plausible for
// freshly-provisioned/ephemeral volumes, mirroring the drive-root example
// above -- every directory created under it (including every
// fs.mkdtempSync() cache dir) inherits that label. Counting it as a second
// ACE would make owner-only hardening that genuinely succeeded look like it
// failed, i.e. a false fail-closed that is indistinguishable from a real
// security defect without this exclusion. Excluding it does not weaken the
// check: we still require exactly one DACL grant and still require it to
// belong to our own identity.
function windowsAclLines(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /:\([A-Z]/i.test(line))
    .filter((line) => !/^mandatory label\\/i.test(line));
}

function hardenWindowsAcl(path) {
  const identity = windowsIdentity();
  if (!identity) throw new Error('current Windows identity is unavailable');
  const result = spawnSync('icacls', [path, '/inheritance:r', '/grant:r', `${identity}:(F)`], {
    encoding: 'utf-8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`icacls hardening failed (status=${result.status}): ${(result.stderr || result.stdout || '').trim().slice(0, 500)}`);
  }
}

function assertWindowsOwnerOnly(path) {
  const identity = windowsIdentity();
  if (!identity) return false;
  const result = spawnSync('icacls', [path], { encoding: 'utf-8', windowsHide: true });
  if (result.status !== 0) return false;
  const aclLines = windowsAclLines(result.stdout);
  return aclLines.length === 1
    && aclLines[0].toLowerCase().endsWith(`${identity.toLowerCase()}:(f)`);
}

const DEFAULT_SECURITY = {
  prepareParentOwnerOnly(path, { fsOps }) {
    fsOps.chmodSync(path, 0o700);
    if (process.platform === 'win32') hardenWindowsDirectoryAcl(path);
  },
  assertParentOwnerOnly(path, { fsOps }) {
    if (process.platform === 'win32') return assertWindowsParentOwnerOnly(path);
    return (fsOps.statSync(path).mode & 0o777) === 0o700;
  },
  prepareOwnerOnly(path, { fsOps }) {
    fsOps.chmodSync(path, 0o600);
    if (process.platform === 'win32') hardenWindowsAcl(path);
  },
  assertOwnerOnly(path, { fsOps }) {
    if (process.platform === 'win32') return assertWindowsOwnerOnly(path);
    return (fsOps.statSync(path).mode & 0o777) === 0o600;
  },
};

function prepareCacheParent(path, fsOps, security) {
  const directory = dirname(path);
  try {
    if (!fsOps.existsSync(directory)) fsOps.mkdirSync(directory, { recursive: true, mode: 0o700 });
    security.prepareParentOwnerOnly(directory, { fsOps });
    return security.assertParentOwnerOnly(directory, { fsOps }) === true;
  } catch (_) {
    return false;
  }
}

function assertWindowsParentOwnerOnly(path) {
  const identity = windowsIdentity();
  if (!identity) return false;
  const result = spawnSync('icacls', [path], { encoding: 'utf-8', windowsHide: true });
  if (result.status !== 0) return false;
  const aclLines = windowsAclLines(result.stdout);
  return aclLines.length === 1
    && aclLines[0].toLowerCase().endsWith(`${identity.toLowerCase()}:(oi)(ci)(f)`);
}

function hardenWindowsDirectoryAcl(path) {
  const identity = windowsIdentity();
  if (!identity) throw new Error('current Windows identity is unavailable');
  const result = spawnSync('icacls', [path, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)(F)`], {
    encoding: 'utf-8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`icacls parent hardening failed (status=${result.status}): ${(result.stderr || result.stdout || '').trim().slice(0, 500)}`);
  }
}

function bestEffortUnlink(path, fsOps) {
  try { fsOps.unlinkSync(path); } catch (_) { /* cleanup is best-effort */ }
}

function createOwnerOnlyExclusive(path, fsOps, security) {
  let fd;
  try {
    fd = fsOps.openSync(path, 'wx', 0o600);
  } catch (err) {
    if (err && err.code === 'EEXIST') return { collision: true, created: false };
    return { collision: false, created: false };
  }
  try {
    fsOps.closeSync(fd);
    security.prepareOwnerOnly(path, { fsOps });
    if (!security.assertOwnerOnly(path, { fsOps })) throw new Error('owner-only assertion failed');
    return { collision: false, created: true };
  } catch (_) {
    bestEffortUnlink(path, fsOps);
    return { collision: false, created: false };
  }
}

function compactUtc(now) {
  const d = now instanceof Date ? now : new Date(now);
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}${pad(d.getUTCMilliseconds(), 3)}Z`;
}

function backupCandidates(path, now, randomHex) {
  const stamp = compactUtc(now());
  const base = `${path}.recovery-${stamp}`;
  return Array.from({ length: 8 }, () => `${base}-${randomHex()}.bak`);
}

function recoveryBackups(path, fsOps) {
  const directory = dirname(path);
  const base = path.split(/[\\/]/).pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${base}\\.recovery-(\\d{8}T\\d{9}Z)-[a-f0-9]{8}\\.bak$`);
  return fsOps.readdirSync(directory)
    .filter((name) => pattern.test(name))
    .map((name) => ({ name, path: join(directory, name), timestamp: pattern.exec(name)[1] }));
}

function pruneRecoveryBackups(path, currentBackupPath, fsOps) {
  const backups = recoveryBackups(path, fsOps);
  const removeCount = Math.max(0, backups.length - 3);
  const candidates = backups
    .filter((backup) => backup.path !== currentBackupPath)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  for (const backup of candidates.slice(0, removeCount)) fsOps.unlinkSync(backup.path);
}

function syncDurability(path, fsOps) {
  // Windows requires a write-capable handle for FlushFileBuffers/fsync.
  const fd = fsOps.openSync(path, 'r+');
  try { fsOps.fsyncSync(fd); } finally { fsOps.closeSync(fd); }
}

/**
 * Explicitly reconstruct a fresh v1 cache. This is the only recovery writer;
 * it never runs as part of ordinary cache reads or probes. Filesystem/security
 * seams are platform abstractions: production uses the defaults, while tests
 * can exercise failures without mutating a real user cache.
 */
export function recoverCache({ vendor = null, entry = null, now = () => new Date(), randomHex = () => randomBytes(4).toString('hex'), fsOps = DEFAULT_FS_OPS, security = {} } = {}) {
  const path = cachePath();
  const mergedSecurity = { ...DEFAULT_SECURITY, ...security };
  let active = null;
  let activeExists = false;
  let tempPath = null;
  let currentBackupPath = null;
  try {
    if (!prepareCacheParent(path, fsOps, mergedSecurity)) {
      return { committed: false, diagnostic_code: 'inventory-cache-parent-owner-only-failed' };
    }
    activeExists = fsOps.existsSync(path);
    if (activeExists) active = fsOps.readFileSync(path);

    tempPath = `${path}.tmp.${process.pid}.${Date.now()}.${randomHex()}`;
    const temp = createOwnerOnlyExclusive(tempPath, fsOps, mergedSecurity);
    if (!temp.created) return { committed: false, diagnostic_code: 'inventory-cache-recovery-backup-create-failed' };

    const fresh = freshCache({ vendor, entry });
    fsOps.writeFileSync(tempPath, JSON.stringify(fresh, null, 2), 'utf-8');
    const tempOutcome = readCacheFromPath(tempPath, fsOps);
    if (tempOutcome.outcome !== 'ok-v1') return { committed: false, diagnostic_code: 'inventory-cache-recovery-backup-create-failed' };

    if (activeExists) {
      for (const candidate of backupCandidates(path, now, randomHex)) {
        const backup = createOwnerOnlyExclusive(candidate, fsOps, mergedSecurity);
        if (backup.collision) continue;
        if (!backup.created) return { committed: false, diagnostic_code: 'inventory-cache-recovery-backup-create-failed' };
        currentBackupPath = candidate;
        fsOps.writeFileSync(currentBackupPath, active);
        break;
      }
      if (!currentBackupPath) return { committed: false, diagnostic_code: 'inventory-cache-recovery-backup-create-failed' };
    }

    try {
      pruneRecoveryBackups(path, currentBackupPath, fsOps);
    } catch (_) {
      return { committed: false, diagnostic_code: 'inventory-cache-recovery-backup-create-failed' };
    }

    try {
      fsOps.renameSync(tempPath, path);
    } catch (_) {
      return { committed: false, diagnostic_code: 'inventory-cache-recovery-replace-failed' };
    }
    tempPath = null;

    try {
      syncDurability(path, fsOps);
    } catch (_) {
      return { committed: true, diagnostic_code: 'inventory-cache-recovery-durability-unknown' };
    }
    return { committed: true, diagnostic_code: 'none' };
  } catch (_) {
    return { committed: false, diagnostic_code: 'inventory-cache-recovery-backup-create-failed' };
  } finally {
    if (tempPath) bestEffortUnlink(tempPath, fsOps);
  }
}

function readCacheFromPath(path, fsOps) {
  try {
    const parsed = JSON.parse(fsOps.readFileSync(path, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || parsed.version !== CACHE_VERSION || !parsed.vendors || typeof parsed.vendors !== 'object') {
      return { outcome: 'malformed' };
    }
    return { outcome: 'ok-v1' };
  } catch (_) {
    return { outcome: 'malformed' };
  }
}

/**
 * Returns true if a probedAt ISO timestamp is older than `daysCeiling` days.
 * Used to flag stale cache entries.
 */
export function isStale(probedAt, daysCeiling = STALE_DAYS_DEFAULT) {
  if (!probedAt) return true;
  const t = Date.parse(probedAt);
  if (!Number.isFinite(t)) return true;
  return (Date.now() - t) > daysCeiling * 24 * 3.6e6;
}

/**
 * Human-readable "how stale" string for diagnostic output.
 */
export function staleness(probedAt) {
  if (!probedAt) return 'never';
  const t = Date.parse(probedAt);
  if (!Number.isFinite(t)) return 'invalid';
  const hours = (Date.now() - t) / 3.6e6;
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;
}

// Exported for direct, cross-platform unit testing of the icacls output
// parser (see windowsAclLines() above) -- the win32-gated code paths that
// call it cannot themselves run outside a real Windows machine, but the
// parsing logic itself is pure and platform-independent, so it can and
// should be regression-tested everywhere `npm test` runs.
export { CACHE_VERSION, STALE_DAYS_DEFAULT, windowsAclLines };
