// Drift guard for the vendored codex-marketplace plugin copy (plugins/hopper/).
// Anchor: tests/unit/vendored-plugin-sync.test.js
//
// codex marketplace local source.path cannot be the repo root (openai/codex#17066)
// and has no ignore mechanism, so a minimal plugin subset is vendored under
// plugins/hopper/. This test fails if that copy drifts from the main source —
// run `node scripts/sync-vendored-plugin.mjs` (or `npm run sync:plugin`) to fix.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO, 'scripts', 'sync-vendored-plugin.mjs');

test('plugins/hopper vendored copy stays in sync with main source (codex#17066 drift guard)', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf-8' });
  assert.equal(r.status, 0,
    `plugins/hopper/ drifted from the main source. Fix: \`node scripts/sync-vendored-plugin.mjs\` then commit plugins/hopper/.\n${r.stdout}\n${r.stderr}`);
});

test('0.38.0 release metadata and static command surfaces stay aligned', () => {
  const version = '0.38.0';
  const manifests = [
    'package.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    'plugins/hopper/.codex-plugin/plugin.json',
  ];

  for (const manifest of manifests) {
    const parsed = JSON.parse(readFileSync(join(REPO, manifest), 'utf8'));
    assert.equal(parsed.version, version, `${manifest} must declare ${version}`);
    if (manifest === '.claude-plugin/marketplace.json') {
      assert.equal(parsed.plugins[0].version, version,
        `${manifest} plugin entry must declare ${version}`);
    }
  }

  const dispatch = readFileSync(join(REPO, 'cli', 'bin', 'hopper-dispatch'), 'utf8');
  const smoke = readFileSync(join(REPO, 'commands', 'smoke.md'), 'utf8');
  const vendors = readFileSync(join(REPO, 'commands', 'vendors.md'), 'utf8');
  assert.match(dispatch, new RegExp(`const VERSION = '${version}';`));
  assert.match(smoke, new RegExp(`hopper standalone \\(CLI v${version}\\)`));
  assert.match(vendors, new RegExp(`v${version}`));
});
