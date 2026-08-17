import { spawn as nodeSpawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAdapters } from '../../../cli/src/vendors/index.js';

/**
 * Vendors the dashboard's probe action may spawn. DERIVED from the adapter
 * registry, not hand-listed: this was a literal 6-name set that had already
 * drifted — `mimo` and `claude` were registered adapters the dashboard silently
 * refused to probe, and `pi` would have been the third. The registry is the only
 * thing that knows what a valid vendor is, and reading it here means a new
 * adapter is covered without a second edit (the same "a hand-copied checklist
 * goes stale; a guard that reads the real registry does not" rule that
 * cli/src/scaffold.js's table already follows).
 *
 * Still a real allowlist: `vendor` arrives over HTTP, and membership is checked
 * before it ever reaches spawn() — deriving the SOURCE of the set does not widen
 * it to arbitrary input.
 */
export const ALLOWED_VENDORS = new Set(listAdapters());

const __dirname = dirname(fileURLToPath(import.meta.url));
const DISPATCH_PATH = resolve(__dirname, '..', '..', '..', 'cli', 'bin', 'hopper-dispatch');

export function buildProbeArgs(vendor) {
  return ['--probe', vendor];
}

export function spawnProbe(vendor, { spawn = nodeSpawn } = {}) {
  if (!ALLOWED_VENDORS.has(vendor)) {
    const err = new Error(`vendor not allowed: ${vendor}`);
    err.code = 'EINVAL';
    throw err;
  }
  return spawn(process.execPath, [DISPATCH_PATH, ...buildProbeArgs(vendor)], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
