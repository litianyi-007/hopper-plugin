// Recursive version-consistency guard (DISCOVERY-style, not enumeration).
// Anchor: tests/unit/version-discovery.test.js
//
// package-lock.json's `version` field sat 5 releases behind (0.50.0 while the repo
// shipped 0.55.0) and nothing caught it — even though package-lock.json was named
// in the project's written release checklist. The sibling `version consistency`
// test (tests/unit/claude-code-host.test.js) and the `release metadata` test
// (tests/unit/vendored-plugin-sync.test.js) are both hardcoded enumerations of a
// fixed file list; neither one mentions package-lock.json, so neither could ever
// have caught the drift. A written list is not a mechanism.
//
// This test does not enumerate. It walks the whole repo, finds every JSON
// location that plausibly carries THIS package's own version (skipping
// node_modules/.git), and asserts they all agree with package.json. A manifest
// added in the future is covered automatically, with no list to remember to
// update. This complements (does not replace) the two enumeration guards above.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const SEMVER = /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/;
const SKIP_DIRS = new Set(['node_modules', '.git']);

// Walk the repo for every *.json file, skipping node_modules/.git.
function findJsonFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      findJsonFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

// Collect every location within one parsed JSON document that plausibly holds
// THIS package's own version. Deliberately narrow: package-lock.json alone
// carries 355 third-party `version` fields under `packages` (one per dependency)
// plus more inside its `dependencies` tree — none of those describe this
// package, and none of the three shapes below can match them, because only
// the empty-string key of `packages` (the lockfile's self-entry) is checked.
function collectVersionLocations(file, parsed) {
  const locations = [];
  if (!parsed || typeof parsed !== 'object') return locations;

  // Shape 1: top-level `.version` (package.json, plugin.json, package-lock.json, ...)
  if (typeof parsed.version === 'string' && SEMVER.test(parsed.version)) {
    locations.push({ file, path: '.version', version: parsed.version });
  }

  // Shape 2: `.plugins[*].version` (marketplace.json catalog entries)
  if (Array.isArray(parsed.plugins)) {
    parsed.plugins.forEach((entry, i) => {
      if (entry && typeof entry.version === 'string' && SEMVER.test(entry.version)) {
        locations.push({ file, path: `.plugins[${i}].version`, version: entry.version });
      }
    });
  }

  // Shape 3: `.packages[""].version` (package-lock.json v2/v3 self-entry —
  // the empty string key is the package described by this lockfile itself;
  // every other key under `.packages` is a third-party dependency path).
  if (parsed.packages && typeof parsed.packages === 'object' && !Array.isArray(parsed.packages)) {
    const self = parsed.packages[''];
    if (self && typeof self.version === 'string' && SEMVER.test(self.version)) {
      locations.push({ file, path: '.packages[""].version', version: self.version });
    }
  }

  return locations;
}

function discoverAllVersionLocations() {
  const files = findJsonFiles(REPO_ROOT);
  const locations = [];
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue; // not valid JSON (or unreadable) — not a version-bearing manifest
    }
    locations.push(...collectVersionLocations(file, parsed));
  }
  return locations;
}

test('every discovered version location in the repo matches package.json (recursive, not enumerated)', () => {
  const pkgVersion = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;
  assert.match(pkgVersion, SEMVER, `package.json version "${pkgVersion}" must itself look like semver`);

  const locations = discoverAllVersionLocations();

  const mismatches = locations
    .filter((loc) => loc.version !== pkgVersion)
    .map((loc) => `${relative(REPO_ROOT, loc.file)}${loc.path} = "${loc.version}" (expected "${pkgVersion}")`);

  assert.equal(mismatches.length, 0,
    `version drift found at ${mismatches.length} discovered location(s):\n${mismatches.join('\n')}`);
});

test('the discovery scan itself is not vacuous (floor assertion on the scanner, not the versions)', () => {
  // A discovery scan that silently stopped matching anything would pass the
  // assertion above vacuously — green while checking nothing, which is the
  // exact failure mode this whole guard exists to prevent. This is a sanity
  // check on the SCANNER: it does not re-enumerate every manifest (that is
  // what the two existing hardcoded-list guards already do), it only asserts
  // the scan still finds roughly what it finds today and still reaches the
  // two files at the center of this guard's motivation.
  const locations = discoverAllVersionLocations();
  const filesFound = new Set(locations.map((loc) => relative(REPO_ROOT, loc.file)));

  assert.ok(locations.length >= 9,
    `version-discovery scan appears broken: found only ${locations.length} version location(s) ` +
    `across the repo (expected at least 9 as of this guard's introduction — package.json, ` +
    `package-lock.json (x2: top-level + packages[""]), .claude-plugin/marketplace.json (x2: top-level ` +
    `+ plugins[0]), .claude-plugin/plugin.json, .codex-plugin/plugin.json, plugins/hopper/kimi.plugin.json, ` +
    `plugins/hopper/.codex-plugin/plugin.json). If this dropped, the walker or the shape matchers regressed, ` +
    `not the release.`);

  assert.ok(filesFound.has('package.json'),
    'version-discovery scan appears broken: package.json was not found by the walker');
  assert.ok(filesFound.has('package-lock.json'),
    'version-discovery scan appears broken: package-lock.json was not found by the walker — ' +
    'this is the exact file this guard was added to catch drift in');
});

test('package-lock.json contributes exactly its own 2 self-locations, never a dependency version', () => {
  // Empirical proof that the collector does not fall into the 355-entries trap:
  // packages[""] (this package) plus top-level .version — nothing under any
  // other packages[...] key, and nothing from a legacy `dependencies` tree.
  const lockPath = join(REPO_ROOT, 'package-lock.json');
  const parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
  const thirdPartyCount = Object.keys(parsed.packages || {}).filter((k) => k !== '').length;
  assert.ok(thirdPartyCount > 300,
    `sanity check on the fixture itself: expected package-lock.json to list 300+ third-party ` +
    `packages (found ${thirdPartyCount}) — if this dropped, the "we correctly ignore them" claim below is untested`);

  const locations = collectVersionLocations(lockPath, parsed);
  assert.equal(locations.length, 2,
    `collector found ${locations.length} location(s) inside package-lock.json, expected exactly 2 ` +
    `(top-level .version + packages[""].version). Found: ${JSON.stringify(locations.map((l) => l.path))}`);
});
