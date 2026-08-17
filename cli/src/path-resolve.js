// In-process PATH + PATHEXT resolver — no subprocess.
// Anchor: cli/src/path-resolve.js
//
// Used by:
//   - cli/bin/hopper-runner (decide whether to wrap with cmd.exe for .cmd/.bat)
//   - cli/src/vendors/index.js installCheckForAdapter (report install status)
//
// Extracted from hopper-runner's inline resolveWindowsCommand per the
// Phase 6a discovery-API addition so both code paths share one implementation.
// Per spec §3 #4: no subprocess in this resolver. statSync + accessSync only.
//
// Per codex Phase 6a strict audit P2 #1 (trust boundary): PATH is treated
// as TRUSTED INPUT. A hostile PATH entry (UNC path, Windows junction,
// relative `..`) can cause statSync probes outside the cwd, but cannot
// execute code — discovery is read-only. Users with untrusted PATH should
// audit `echo $PATH` (POSIX) or `$env:Path` (Windows) before running --check.

import { statSync, accessSync, constants, realpathSync } from 'node:fs';
import { join, delimiter, resolve } from 'node:path';

/**
 * Was this module file executed DIRECTLY (`node <file>`), as opposed to imported?
 *
 * The naive form — `resolve(process.argv[1]) === fileURLToPath(import.meta.url)` —
 * has two independent failure modes, BOTH of which fail the same catastrophic way:
 * `main()` never runs, the process exits 0, and NOTHING is printed. For an
 * automation caller that is indistinguishable from success.
 *
 *   1. SYMLINK / JUNCTION. `path.resolve()` does not follow links, but
 *      `import.meta.url` is already realpath-resolved. Invoking through
 *      `<npm-root>/hopper-plugin/cli/bin/hopper-dispatch` (an npm-global link into
 *      the plugin cache) therefore compares a link path against a real path and
 *      never matches. Reproduced live 2026-08-05 on the shipped 0.46.0:
 *      `node <npm-link>/…/hopper-dispatch --help` printed nothing and exited 0,
 *      while the same call through the realpath printed the usage banner.
 *
 *   2. WINDOWS PATH CASE. `realpathSync` on win32 does NOT normalize casing — it
 *      echoes back whatever casing the caller supplied for each directory
 *      component (verified: `F:/workspace/…` and `F:/WORKSPACE/…` both resolve,
 *      and the two results are NOT string-equal). Any launcher that hands over a
 *      differently-cased argv[1] — a cmd.exe shim, `%~dp0` expansion, a
 *      lowercase drive letter, a PATH entry typed in another case — silently
 *      re-creates failure mode 1.
 *
 * So: realpath BOTH sides (never just one), and compare case-insensitively on
 * win32 only (POSIX filesystems are genuinely case-sensitive; folding there would
 * risk the opposite bug — running main() on a merely similarly-named file).
 *
 * Both realpath calls are individually guarded. An unguarded one would throw at
 * module top level, killing the CLI with a bare stack trace instead of its own
 * error handling. On failure each side degrades to the lexical `resolve()`, which
 * is exactly the pre-fix behaviour — a floor, not a regression.
 *
 * This must stay STRICT in the false direction: `cli/bin/hopper-dispatch` is
 * imported by tests (for `parseProbeCacheRecoveryArgs`), and a false positive
 * would run `main()` inside the test process. Distinct files always compare
 * unequal under every branch here.
 *
 * @param {string|undefined} argv1  process.argv[1]
 * @param {string} moduleFilename   fileURLToPath(import.meta.url) of the caller
 * @param {object} [o]
 * @param {Function} [o.realpath]   injectable for tests
 * @param {string}   [o.platform]   injectable for tests
 * @returns {boolean}
 */
export function isDirectInvocation(argv1, moduleFilename, { realpath = realpathSync, platform = process.platform } = {}) {
  if (!argv1 || !moduleFilename) return false;
  const canon = (p) => {
    let out;
    try { out = realpath(resolve(p)); } catch (_) { out = resolve(p); }
    return platform === 'win32' ? out.toLowerCase() : out;
  };
  try {
    return canon(argv1) === canon(moduleFilename);
  } catch (_) {
    return false;
  }
}

/**
 * Walk PATH (+ PATHEXT on Windows) for an unqualified command name.
 * Pure-sync, pure-fs. No subprocess.
 *
 * On Windows: tries PATHEXT extensions in order within each PATH dir,
 * first match wins. `.exe`/`.com` returns directly executable; `.cmd`/`.bat`
 * returns wrapped via cmd.exe `/c` (because CreateProcessW can't execute
 * batch files directly).
 *
 * On POSIX (Linux + macOS): returns the first executable-by-name match in
 * PATH order. `accessSync(path, X_OK)` is used to verify the file is
 * actually executable (honoring owner/group/world bits + filesystem ACLs);
 * a non-executable same-named file is skipped.
 *
 * @param {string} cmd  Unqualified command name (e.g. "codex").
 *                      If already a path or has an extension, returned as-is.
 * @returns {{ command: string, prependArgs: string[], resolvedPath: string|null } | null}
 *   `command` + `prependArgs` are ready-to-pass to spawn().
 *   `resolvedPath` is the actual file found (null if cmd was already qualified).
 *   Returns null if cmd is unqualified and NOT found on PATH.
 */
export function resolveCommandOnPath(cmd) {
  if (cmd.includes('/') || cmd.includes('\\') || /\.\w+$/.test(cmd)) {
    return { command: cmd, prependArgs: [], resolvedPath: null };
  }
  const isWindows = process.platform === 'win32';
  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean);

  if (!isWindows) {
    // POSIX (Linux + macOS): first executable-by-name match in PATH order.
    // MUST check exec permission, not just file existence — a non-executable
    // file with the same name would otherwise be falsely reported "found".
    for (const dir of pathDirs) {
      const candidate = join(dir, cmd);
      try {
        const st = statSync(candidate);
        if (!st.isFile()) continue;
        // X_OK = execute bit. accessSync throws if not executable for the
        // current process (owner/group/world + filesystem ACLs all checked).
        try {
          accessSync(candidate, constants.X_OK);
        } catch (_) {
          continue;
        }
        return { command: candidate, prependArgs: [], resolvedPath: candidate };
      } catch (_) {
        // not found / not accessible — continue
      }
    }
    return null;
  }

  // Windows: PATH+PATHEXT, first-match-in-first-dir semantics
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    .map(e => e.trim()).filter(Boolean);
  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext);
      try {
        if (statSync(candidate).isFile()) {
          const lower = ext.toLowerCase();
          if (lower === '.exe' || lower === '.com') {
            return { command: candidate, prependArgs: [], resolvedPath: candidate };
          }
          // .cmd / .bat / other → cmd.exe /c wrapper
          return {
            command: process.env.ComSpec || 'cmd.exe',
            prependArgs: ['/c', candidate],
            resolvedPath: candidate,
          };
        }
      } catch (_) {
        // continue
      }
    }
  }
  return null;
}

/**
 * Convenience: just check if a command is installed (resolvable on PATH).
 * @param {string} cmd
 * @returns {boolean}
 */
export function isCommandAvailable(cmd) {
  const r = resolveCommandOnPath(cmd);
  return r !== null && r.resolvedPath !== null;
}

/**
 * EVERY PATH hit for an unqualified command, in PATH order — not just the first.
 * Same walk order and same accept/reject rules as resolveCommandOnPath(), so
 * `resolveAllCommandsOnPath(cmd)[0].resolvedPath` always equals
 * `resolveCommandOnPath(cmd).resolvedPath` (asserted by a unit test rather than
 * by sharing code: resolveCommandOnPath sits on the SPAWN path, so it is left
 * byte-identical rather than refactored under a diagnostic feature).
 *
 * Why this exists: a machine can carry several installs of the same vendor CLI
 * on PATH at different versions, and hopper silently spawns whichever comes
 * FIRST — which is not necessarily the one the operator's interactive shell
 * resolves (different shells inherit different PATH order). Observed live
 * 2026-08-05: `codex` resolved to 0.131.0 for hopper and 0.146.0 for the user's
 * PowerShell, and every codex dispatch failed against a model that needed
 * >= 0.144. Nothing in hopper could see it, because only the first hit was ever
 * looked at. This is the discovery half of that gap (`--setup` renders it; the
 * version half needs a spawn and therefore lives behind `--deep`).
 *
 * Zero subprocess, statSync/accessSync only — safe on the `--setup`
 * zero-extra-spawn path. Deliberately NOT de-duplicated: this stays a faithful
 * walk so it keeps mirroring the resolver dispatch uses. A PATH listing the same
 * directory twice therefore yields the same file twice — collapsing that is the
 * caller's concern (see vendor-binaries.js `enumerateVendorBinaries`, which
 * de-dupes by file and reports the repeat count separately).
 *
 * @param {string} cmd Unqualified command name (e.g. "codex"). A qualified path
 *   or a name carrying an extension yields [] — there is no PATH walk to do.
 * @returns {Array<{ resolvedPath: string, dir: string, direct: boolean }>}
 *   `direct` = executable by CreateProcessW without a cmd.exe wrapper
 *   (.exe/.com on Windows; always true on POSIX).
 */
export function resolveAllCommandsOnPath(cmd) {
  if (!cmd || cmd.includes('/') || cmd.includes('\\') || /\.\w+$/.test(cmd)) return [];
  const isWindows = process.platform === 'win32';
  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  const hits = [];

  if (!isWindows) {
    for (const dir of pathDirs) {
      const candidate = join(dir, cmd);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        hits.push({ resolvedPath: candidate, dir, direct: true });
      } catch (_) { /* not found / not executable — continue */ }
    }
    return hits;
  }

  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    .map((e) => e.trim()).filter(Boolean);
  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext);
      try {
        if (!statSync(candidate).isFile()) continue;
        const lower = ext.toLowerCase();
        hits.push({ resolvedPath: candidate, dir, direct: lower === '.exe' || lower === '.com' });
      } catch (_) { /* continue */ }
    }
  }
  return hits;
}

/**
 * Phase 6c F2: resolveCommandOnPath + deterministic known-install-path lookup.
 *
 * NOTE: This is NOT vendor fallback orchestration (banned by spec §3 #4). This
 * is a deterministic path resolver: walks PATH first, then statSync's a known
 * fixed list of vendor-installer locations. No retry across vendors, no
 * recovery loop — just "where on this machine does the binary live."
 *
 * Some installers (notably agy on Windows) don't add their bin directory to
 * PATH. Without this lookup, dispatch fails with `spawn ENOENT` even when the
 * binary exists at a deterministic location. This helper:
 *   1. Tries resolveCommandOnPath() first (preferred — respects user's PATH)
 *   2. If null, walks `knownInstallPaths` in order; first existing file wins
 *   3. Returns null only if both fail
 *
 * Each `knownInstallPaths` entry must be an absolute path to the binary itself
 * (e.g. `~/AppData/Local/agy/bin/agy.exe`). Tildes are not expanded — caller
 * should expand via `os.homedir()` before declaring.
 *
 * Returns the same shape as resolveCommandOnPath: `{ command, prependArgs, resolvedPath }`.
 */
export function resolveCommandWithKnownPaths(cmd, knownInstallPaths = []) {
  const onPath = resolveCommandOnPath(cmd);
  // Phase 6c follow-up P1 (codex/copilot dogfood convergent finding,
  // codex reproduced with node.exe→cmd.exe hijack):
  // resolveCommandOnPath returns non-null in TWO cases — (a) resolved via
  // PATH walk (resolvedPath set), and (b) qualified pass-through where
  // cmd already contained /, \, or .ext (resolvedPath null). The previous
  // check only honored (a) and fell through to the fallback walk for (b),
  // hijacking the user's qualified path. Honor both: if onPath is non-null
  // at all, return it. The fallback walk only runs when resolveCommandOnPath
  // returned null (genuinely unqualified-and-not-on-PATH).
  if (onPath) return onPath;
  if (!knownInstallPaths || knownInstallPaths.length === 0) return null;

  const isWindows = process.platform === 'win32';
  for (const candidate of knownInstallPaths) {
    try {
      const st = statSync(candidate);
      if (!st.isFile()) continue;
      if (!isWindows) {
        // POSIX: verify exec bit before accepting
        try { accessSync(candidate, constants.X_OK); } catch (_) { continue; }
        return { command: candidate, prependArgs: [], resolvedPath: candidate };
      }
      // Windows: .exe/.com return directly; .cmd/.bat get cmd.exe wrap
      const lower = candidate.toLowerCase();
      if (lower.endsWith('.exe') || lower.endsWith('.com')) {
        return { command: candidate, prependArgs: [], resolvedPath: candidate };
      }
      if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
        return {
          command: process.env.ComSpec || 'cmd.exe',
          prependArgs: ['/c', candidate],
          resolvedPath: candidate,
        };
      }
      // Unknown extension — assume direct-exec on Windows
      return { command: candidate, prependArgs: [], resolvedPath: candidate };
    } catch (_) {
      // continue to next fallback
    }
  }
  return null;
}
