// Guards against a declared-but-absent license: this repo shipped for a long
// time with every manifest claiming "Apache-2.0" while LICENSE itself was a
// 19-line file-header boilerplate stub missing the entire TERMS AND
// CONDITIONS body (`gh repo view ... --json licenseInfo` returned "Other" —
// GitHub couldn't even identify it). Nothing asserted that LICENSE's actual
// contents matched what package.json/plugin manifests *claimed*. This file
// closes that gap with two guards:
//
//   1. LICENSE must contain substantive MIT license text, not just a title
//      or a "see this URL" pointer.
//   2. Every manifest in the repo that declares a `license` field (found by
//      walking the tree, not by a hardcoded file list) must agree with each
//      other and with what's actually in LICENSE.
//
// Anchor: tests/unit/license-integrity.test.js

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Directories that are never part of THIS repo's own declared license surface:
// node_modules is third-party code with its own (varied) licenses, and .git
// is VCS internals.
const IGNORED_DIRS = new Set(['node_modules', '.git']);

/**
 * Recursively find every `.json` file under `dir`.
 */
function findJsonFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Recursively collect every string value found under a key literally named
 * "license" anywhere in a parsed JSON value (objects and arrays), reporting
 * a dotted/bracketed path for diagnostics. This is what makes the guard
 * "discovery" rather than an enumerated list: a brand-new manifest (or a
 * newly nested plugin entry) that declares `"license": "..."` is picked up
 * automatically, with no file list to keep in sync.
 */
function collectLicenseFields(node, path = '') {
  const found = [];
  if (node === null || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach((item, i) => found.push(...collectLicenseFields(item, `${path}[${i}]`)));
    return found;
  }
  for (const [key, value] of Object.entries(node)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (key === 'license' && typeof value === 'string') {
      found.push({ path: nextPath, value });
    } else if (value && typeof value === 'object') {
      found.push(...collectLicenseFields(value, nextPath));
    }
  }
  return found;
}

/**
 * Enumerate every declared `license` field across the repo's own manifests.
 *
 * package-lock.json is special-cased: it's the one file where "license"
 * fields legitimately disagree by design — every third-party dependency
 * pins its OWN license (MIT/ISC/BSD/Apache-2.0/...), which is a fact about
 * that dependency, not a claim this repo makes about itself. Only this
 * package's own entry (`packages[""].license` under npm lockfileVersion 3)
 * is part of the surface this guard checks; dependency entries under
 * `packages["node_modules/..."]` are deliberately excluded.
 */
function collectRepoLicenseDeclarations(repoRoot) {
  const declarations = [];
  for (const file of findJsonFiles(repoRoot)) {
    const rel = relative(repoRoot, file).split('\\').join('/');
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue; // not valid JSON (or empty) — not a license-declaring manifest
    }

    if (rel === 'package-lock.json') {
      const rootLicense = parsed.packages && parsed.packages[''] && parsed.packages[''].license;
      if (typeof rootLicense === 'string') {
        declarations.push({ file: rel, path: 'packages[""].license', value: rootLicense });
      }
      continue; // do NOT descend into packages["node_modules/..."] dependency entries
    }

    for (const { path, value } of collectLicenseFields(parsed)) {
      declarations.push({ file: rel, path, value });
    }
  }
  return declarations;
}

test('LICENSE contains substantive MIT terms, not just a title or a link', () => {
  const licenseText = readFileSync(join(REPO, 'LICENSE'), 'utf8');

  // Deliberately assert on body text, not just presence/non-emptiness/a title
  // line — a stub that only carries "MIT License" (or a "full text: <url>"
  // pointer, the exact shape of the old Apache stub this repo shipped) must
  // still fail here.
  assert.match(licenseText, /MIT License/, 'LICENSE must carry the "MIT License" title');
  assert.match(
    licenseText,
    /Permission is hereby granted, free of charge/,
    'LICENSE must contain the MIT grant clause body, not just a title or a link to the full text'
  );
  assert.match(
    licenseText,
    /without restriction/,
    'LICENSE must contain the MIT grant-of-rights clause'
  );
  assert.match(
    licenseText,
    /THE SOFTWARE IS PROVIDED "AS IS"/,
    'LICENSE must contain the MIT warranty-disclaimer clause (the second half of the terms — a truncated stub could carry the grant but drop this)'
  );
});

test('every declared `license` field in the repo agrees with LICENSE (discovery, not enumeration)', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const expected = pkg.license; // source of truth: this package's own manifest

  const declarations = collectRepoLicenseDeclarations(REPO);

  // Sanity: the walk must actually find manifests (guards against the walk
  // itself silently returning nothing, which would make every assertion
  // below vacuously true).
  assert.ok(
    declarations.length >= 6,
    `expected to discover at least 6 license declarations, found ${declarations.length}: ${JSON.stringify(declarations)}`
  );

  const mismatched = declarations.filter((d) => d.value !== expected);
  assert.equal(
    mismatched.length,
    0,
    `license field(s) drifted from package.json's "${expected}": ${JSON.stringify(mismatched)}`
  );

  // The declared license must also actually be backed by LICENSE's contents.
  // (Only MIT is asserted in depth here; if this repo ever legitimately
  // switches to a different license, this test's LICENSE-content check needs
  // updating alongside it — that's an intentional, visible coupling.)
  assert.equal(expected, 'MIT', 'this repo is expected to declare MIT');
  const licenseText = readFileSync(join(REPO, 'LICENSE'), 'utf8');
  assert.match(licenseText, /MIT License/);
  assert.match(licenseText, /Permission is hereby granted, free of charge/);
});
