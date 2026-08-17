// Version primitives shared across the CLI. Leaf module — imports nothing local.
// Anchor: cli/src/version.js
//
// Exists to break an import cycle and to end a duplication. `scaffold.js` needs the
// stamp constant + the running version; `workspace-drift.js` needs those AND the
// scaffold's frame builders. Importing each other directly is a cycle, and ESM's
// live bindings make cycles work *usually* — right up until evaluation order shifts
// and a constant is read in its temporal dead zone. A leaf both can import is the
// boring fix.
//
// It also collapses three independent copies of the same comparator (setup.js,
// vendor-binaries.js, workspace-drift.js), each written because importing across
// those modules looked like more trouble than retyping six lines. Three copies of a
// comparator is exactly how one of them ends up lexicographic while the others are
// not — and a lexicographic version sort reports 0.131.0 as newer than 0.146.0,
// which is the bug this codebase already paid for once.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Machine-readable provenance stamp written into scaffolded `.hopper/AGENTS.md`. */
export const SCAFFOLD_STAMP_PREFIX = 'hopper-scaffold-version:';

/** Running plugin version, read from package.json. `'unknown'` if unreadable. */
export function currentVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf-8')).version;
  } catch (_) { return 'unknown'; }
}

/**
 * Descending comparator over release versions. Segments compare NUMERICALLY:
 * sorted as strings, `0.131.0` precedes `0.146.0` and any "which is newest" answer
 * built on it names the older build. Pre-release/build tails are ignored — this only
 * has to order observed releases.
 */
export function compareVersionDesc(a, b) {
  const parts = (v) => String(v).split(/[-+]/)[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** true when `a` is strictly older than `b`. */
export function isOlder(a, b) { return compareVersionDesc(a, b) > 0; }
