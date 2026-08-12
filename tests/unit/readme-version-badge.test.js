// Discoverable consistency guard for the "Version" badge across every README*.md.
// Anchor: tests/unit/readme-version-badge.test.js
//
// 2026-08-12: the version badge sat at 0.50.0 in all three READMEs while the
// package shipped 0.54.0 — four minor releases of drift that nobody noticed
// because nothing checked it. The "hosts" badge ON THE SAME LINE has had a
// discovery-based guard since 2026-08-03 (readme-hosts-badge.test.js) and
// therefore never drifted; the version badge next to it had none. Same class of
// bug, same fix: enumerated checklists go stale, discovery guards do not.
//
// BOTH sides of the comparison are discovered, never hand-enumerated:
//   - expected version: package.json (the release-metadata guard in
//     tests/unit/vendored-plugin-sync.test.js already anchors every manifest to it).
//   - README files: glob README*.md at the repo root — NOT a hardcoded list of
//     three filenames, for the reason readme-hosts-badge.test.js documents
//     (hardcoding 'README.md' silently skipped README.en.md / README.ja.md once).
//
// A README with NO version badge FAILS rather than being skipped — a missing
// badge (e.g. a new translation whose author dropped the badge row) is itself an
// instance of the drift class this guard exists for.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// e.g. ![Version](https://img.shields.io/badge/version-0.55.0-3DDC97)
const VERSION_BADGE_RE = /!\[Version\]\(https:\/\/img\.shields\.io\/badge\/version-([0-9]+\.[0-9]+\.[0-9]+)-[0-9a-fA-F]+\)/;

function readmeFiles() {
  return readdirSync(REPO)
    .filter((f) => /^README.*\.md$/.test(f))
    .sort();
}

test('every README*.md "Version" badge matches package.json', () => {
  const expected = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf-8')).version;
  const files = readmeFiles();
  assert.ok(files.length > 0, 'no README*.md found at repo root — the glob itself is broken, fix the test');

  const problems = [];
  for (const file of files) {
    const text = readFileSync(join(REPO, file), 'utf-8');
    const m = text.match(VERSION_BADGE_RE);
    if (!m) {
      problems.push(
        `${file}: NO "Version" badge found (expected .../badge/version-<x.y.z>-<color>). A README with no ` +
        `version badge is drift too — add one, value ${expected}.`
      );
      continue;
    }
    if (m[1] !== expected) {
      problems.push(
        `${file}: badge says version-${m[1]}, but package.json declares ${expected}. ` +
        `Update the badge in ${file} to version-${expected}.`
      );
    }
  }
  assert.equal(problems.length, 0, `Version badge out of sync with package.json:\n${problems.join('\n')}`);
});
