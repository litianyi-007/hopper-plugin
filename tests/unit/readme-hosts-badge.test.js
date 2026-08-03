// Discoverable consistency guard for the "hosts" badge across every README*.md.
// Anchor: tests/unit/readme-hosts-badge.test.js
//
// 2026-08-03: the hosts badge sat at 4 since this repo's inception while the
// real host count grew to 7 (hosts/ picked up copilot-cli / cursor-cli /
// grok-cli over two months and multiple releases) — nobody noticed because
// nothing checked it. It was hand-corrected to 7 today, but a manual fix with
// no guard just resets the clock on the same class of drift. Compare the
// "tests" badge in the SAME commit: that count is not reliably pinnable (it
// drifts every time a test is added), so it was downgraded to a non-numeric
// "passing" badge instead of being guarded. "hosts" is different — the true
// count is cheaply DISCOVERABLE from the filesystem, so it gets a real guard
// rather than the same downgrade.
//
// BOTH sides of the comparison are discovered, never hand-enumerated:
//   - real count: readdirSync('hosts/'), directories only.
//   - README files: glob README*.md at the repo root — NOT a hardcoded list of
//     three filenames. tests/unit/vendor-security-claims.test.js's scanTargets()
//     had to fix exactly this hardcoding mistake once already (see its comment:
//     hardcoding 'README.md' silently skipped README.en.md / README.ja.md).
//
// The "+1" in the assertion is the standalone host (hopper-dispatch invoked
// directly, no wrapper) — hosts/ intentionally has no subdirectory for it.
//
// A README with NO hosts badge at all FAILS this test rather than being
// skipped: a missing badge (e.g. a newly-added translation whose author forgot
// to carry the badge row over) is itself an instance of the same drift class
// this guard exists for, and a skip would make that failure mode invisible.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// e.g. ![Hosts](https://img.shields.io/badge/hosts-7-111827)
const HOSTS_BADGE_RE = /!\[Hosts\]\(https:\/\/img\.shields\.io\/badge\/hosts-(\d+)-[0-9a-fA-F]+\)/;

function realHostDirCount() {
  return readdirSync(join(REPO, 'hosts'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .length;
}

function readmeFiles() {
  return readdirSync(REPO)
    .filter((f) => /^README.*\.md$/.test(f))
    .sort();
}

test('every README*.md "Hosts" badge == hosts/ directory count + 1 (standalone)', () => {
  const dirCount = realHostDirCount();
  const expected = dirCount + 1;
  const files = readmeFiles();
  assert.ok(files.length > 0, 'no README*.md found at repo root — the glob itself is broken, fix the test');

  const problems = [];
  for (const file of files) {
    const text = readFileSync(join(REPO, file), 'utf-8');
    const m = text.match(HOSTS_BADGE_RE);
    if (!m) {
      problems.push(
        `${file}: NO "Hosts" badge found (expected .../badge/hosts-<N>-<color>). A README with no hosts ` +
        `badge at all is drift too (e.g. a newly-added translation that forgot to carry the badge row over) ` +
        `— add one, value ${expected} (hosts/ has ${dirCount} dir(s) + 1 standalone).`
      );
      continue;
    }
    const badgeValue = Number(m[1]);
    if (badgeValue !== expected) {
      problems.push(
        `${file}: badge says hosts-${badgeValue}, but hosts/ actually has ${dirCount} directory(ies) + 1 ` +
        `standalone = ${expected}. Update the badge in ${file} to hosts-${expected}.`
      );
    }
  }
  assert.equal(problems.length, 0, `Hosts badge out of sync with hosts/:\n${problems.join('\n')}`);
});
