// Discovery-based guard: scaffolded `.hopper/AGENTS.md` "Active Agent
// Instances" table vs. the real vendor-adapter registry.
// Anchor: tests/unit/scaffold-vendor-coverage.test.js
//
// 2026-07-31 bug this guards against: cli/src/scaffold.js's AGENTS_MD table
// was hand-maintained, and silently OMITTED `claude` and `mimo` entirely
// (the table only had codex/kimi/opencode/copilot/agy/grok) — even though
// `claude` is one of the four vendors the 2026-07-31 product decision
// actually supports. A new project scaffolded off that table would fill in
// `## Approved Vendors` from a list that was simply wrong. That decision —
// the product-supported set is `codex` / `grok` / `claude` / `kimi` — used to
// live only in prose (docs, commit messages); it is now the single constant
// `PRODUCT_SUPPORTED_VENDORS` in cli/src/vendors/index.js, and scaffold.js's
// AGENTS_MD table is generated FROM it (see cli/src/scaffold.js
// buildAgentInstancesTable / buildAgentInstanceRow). This file is the guard
// that would have caught the original bug and will catch any recurrence:
// every assertion below is DISCOVERY-based (driven by listAdapters() /
// PRODUCT_SUPPORTED_VENDORS at test time), not a hand-copied vendor list —
// "清单会过时，发现式守卫不会" (a hand-maintained checklist goes stale; a
// guard that reads the real registry at test time does not).
//
// This file intentionally does NOT hand-code a vendor list anywhere (not
// even in a comment used for assertions) — every check below iterates
// listAdapters() and/or PRODUCT_SUPPORTED_VENDORS directly, so it keeps
// working unchanged if a vendor is added, removed, or its support status
// flips.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildScaffoldFiles } from '../../cli/src/scaffold.js';
import { listAdapters, PRODUCT_SUPPORTED_VENDORS } from '../../cli/src/vendors/index.js';

/** The `## Active Agent Instances` ... `## Approved Vendors` slice of the scaffolded AGENTS.md. */
function activeAgentInstancesSection() {
  const agentsMd = buildScaffoldFiles().find((f) => f.rel === 'AGENTS.md').content;
  const start = agentsMd.indexOf('## Active Agent Instances');
  assert.ok(start !== -1, 'scaffolded AGENTS.md must contain an "## Active Agent Instances" heading');
  // Anchored to LINE START (`\n## `): the table's own "not supported" rows contain the
  // literal inline-code substring "`## Approved Vendors`" (a cross-reference to the real
  // section further down), so a bare, unanchored indexOf/search for that text would match
  // inside the FIRST such row instead of the actual heading — truncating the section before
  // most rows are even included. Matching only a real markdown heading avoids that trap.
  const headingMatch = /\n## Approved Vendors\b/.exec(agentsMd.slice(start));
  assert.ok(headingMatch, 'scaffolded AGENTS.md must contain an "## Approved Vendors" heading after "## Active Agent Instances"');
  const end = start + headingMatch.index;
  return agentsMd.slice(start, end);
}

/** The full markdown table-row line for `vendor` (nickname column, backtick-quoted), or null if absent. */
function rowFor(section, vendor) {
  const re = new RegExp('^\\|\\s*`' + vendor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`\\s*\\|.*$', 'm');
  const match = section.match(re);
  return match ? match[0] : null;
}

// ── 1. Coverage: every registered adapter has a row ──────────────────────
// This is the assertion that directly catches the original bug: `claude`
// and `mimo` were registered adapters (cli/src/vendors/index.js REGISTRY)
// with no AGENTS.md row at all.

test('scaffold-vendor-coverage: every listAdapters() adapter has a row in the Active Agent Instances table', () => {
  const section = activeAgentInstancesSection();
  const adapters = listAdapters();
  assert.ok(adapters.length > 0, 'listAdapters() must return at least one adapter (sanity check on the discovery source itself)');
  for (const vendor of adapters) {
    const row = rowFor(section, vendor);
    assert.ok(row,
      `adapter '${vendor}' is registered in cli/src/vendors/index.js (listAdapters()) but has no row in the ` +
      'scaffolded AGENTS.md "## Active Agent Instances" table. This is exactly the class of bug that silently ' +
      "dropped 'claude' and 'mimo' before the 2026-07-31 fix — add a VENDOR_ROW_META entry for it in cli/src/scaffold.js.");
  }
});

// ── 2. Unsupported vendors are annotated ──────────────────────────────────

test('scaffold-vendor-coverage: every adapter NOT in PRODUCT_SUPPORTED_VENDORS is annotated "not supported"', () => {
  const section = activeAgentInstancesSection();
  const unsupported = listAdapters().filter((v) => !PRODUCT_SUPPORTED_VENDORS.includes(v));
  assert.ok(unsupported.length > 0, 'sanity check: at least one registered adapter must currently be unsupported for this test to be meaningful');
  for (const vendor of unsupported) {
    const row = rowFor(section, vendor);
    assert.ok(row, `no Active Agent Instances row found for '${vendor}' (see the coverage test above)`);
    assert.match(row, /not supported/i,
      `adapter '${vendor}' is NOT in PRODUCT_SUPPORTED_VENDORS (cli/src/vendors/index.js) but its AGENTS.md row ` +
      'carries no "not supported" annotation — a project reading this table would wrongly believe it is product-supported.');
  }
});

// ── 3. Supported vendors are NOT mislabeled ───────────────────────────────

test('scaffold-vendor-coverage: every adapter IN PRODUCT_SUPPORTED_VENDORS is NOT annotated "not supported"', () => {
  const section = activeAgentInstancesSection();
  assert.ok(PRODUCT_SUPPORTED_VENDORS.length > 0, 'sanity check: PRODUCT_SUPPORTED_VENDORS must not be empty for this test to be meaningful');
  for (const vendor of PRODUCT_SUPPORTED_VENDORS) {
    const row = rowFor(section, vendor);
    assert.ok(row, `no Active Agent Instances row found for '${vendor}' (see the coverage test above)`);
    assert.doesNotMatch(row, /not supported/i,
      `adapter '${vendor}' IS in PRODUCT_SUPPORTED_VENDORS but its AGENTS.md row is annotated "not supported" — ` +
      'this is the false-negative direction of the same bug: a genuinely supported vendor being told it is not.');
  }
});

// ── 4. PRODUCT_SUPPORTED_VENDORS itself must name real adapters ──────────
// Guards against the constant being typo'd (e.g. 'grok3') so the guards
// above would still pass green while quietly checking nothing real.

test('scaffold-vendor-coverage: every name in PRODUCT_SUPPORTED_VENDORS is a real registered adapter id', () => {
  const known = new Set(listAdapters());
  for (const vendor of PRODUCT_SUPPORTED_VENDORS) {
    assert.ok(known.has(vendor),
      `PRODUCT_SUPPORTED_VENDORS (cli/src/vendors/index.js) names '${vendor}', which is not a registered adapter ` +
      `(listAdapters() = [${listAdapters().join(', ')}]) — likely a typo in the constant.`);
  }
});
