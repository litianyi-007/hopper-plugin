// Unit tests for agents.js (T-PLUGIN-04)
// Anchor: tests/unit/agents.test.js

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseAgentsContent,
  resolveVendor,
  assertVendorApproved,
  E_APPROVED_VENDORS_SECTION_MISSING,
  E_VENDOR_NOT_APPROVED,
} from '../../cli/src/agents.js';

const SAMPLE_AGENTS = `
# hopper-plugin Agent Instances

## Active Agent Instances

| Nickname | UUID | Vendor | Default invocation |
|----------|------|--------|---------------------|
| \`codex-builder\` | \`uuid-1\` | codex | \`codex exec ...\` |
| \`kimi-builder\` | \`uuid-2\` | kimi | \`kimi -p ...\` |
| \`opencode-builder\` | \`uuid-3\` | opencode | \`opencode run ...\` |
| \`agy-builder\` | \`uuid-4\` | agy | \`agy -p ...\` |

## Task-type → vendor default preference

| Task-type | Default vendor | Why |
|-----------|----------------|-----|
| \`spec-write\` | codex-builder | High reasoning |
| \`code-impl\` | kimi-builder | Cheap tier |
| \`spec-blindspot-hunt\` | codex-builder | High reasoning |
`;

test('parseAgentsContent extracts agent bindings', () => {
  const { agents } = parseAgentsContent(SAMPLE_AGENTS);
  assert.equal(agents.length, 4);
  assert.equal(agents[0].nickname, 'codex-builder');
  assert.equal(agents[0].vendor, 'codex');
  assert.equal(agents[0].uuid, 'uuid-1');
  assert.equal(agents[3].vendor, 'agy');
});

test('parseAgentsContent extracts task-type preferences', () => {
  const { preferences } = parseAgentsContent(SAMPLE_AGENTS);
  assert.equal(preferences['spec-write'], 'codex-builder');
  assert.equal(preferences['code-impl'], 'kimi-builder');
});

test('resolveVendor uses per-row Vendor override if set', () => {
  const { agents, preferences } = parseAgentsContent(SAMPLE_AGENTS);
  const task = {
    id: 'T-X',
    taskType: 'code-impl',
    status: 'pending',
    depends: [],
    priority: 'normal',
    brief: '',
    vendor: 'opencode', // override
  };
  assert.equal(resolveVendor(task, { agents, preferences }), 'opencode');
});

test('resolveVendor looks up task-type preference -> nickname -> vendor', () => {
  const { agents, preferences } = parseAgentsContent(SAMPLE_AGENTS);
  const task = {
    id: 'T-X',
    taskType: 'code-impl',
    status: 'pending',
    depends: [],
    priority: 'normal',
    brief: '',
    vendor: null,
  };
  // code-impl → kimi-builder → kimi
  assert.equal(resolveVendor(task, { agents, preferences }), 'kimi');
});

test('resolveVendor falls back to taskTypePref array', () => {
  const { agents } = parseAgentsContent(SAMPLE_AGENTS);
  // No preference table; agent has pref array
  const agentsWithPref = agents.map((a) => ({
    ...a,
    taskTypePref: a.nickname === 'codex-builder' ? ['spec-write'] : [],
  }));
  const task = {
    id: 'T-X',
    taskType: 'spec-write',
    status: 'pending',
    depends: [],
    priority: 'normal',
    brief: '',
    vendor: null,
  };
  assert.equal(resolveVendor(task, { agents: agentsWithPref, preferences: {} }), 'codex');
});

test('resolveVendor throws when no resolution available', () => {
  const task = {
    id: 'T-X',
    taskType: 'unknown-type',
    status: 'pending',
    depends: [],
    priority: 'normal',
    brief: '',
    vendor: null,
  };
  assert.throws(
    () => resolveVendor(task, { agents: [], preferences: {} }),
    /No vendor binding for task-type 'unknown-type'/,
  );
});

// ─── Approved Vendors (TH-approved-vendors, 2026-07-31) ───────────────────
// AGENTS.md upgraded from a pure routing table into a project-level vendor
// whitelist gate. These tests cover the parser's new `approvedVendors` field
// and the `assertVendorApproved` enforcement function directly (pure unit,
// no subprocess). CLI/dispatch-level wiring (both call sites, plus
// composition with the host!=vendor guard) is covered in
// tests/unit/dispatch-governance.test.js and tests/unit/host-detect.test.js.

const AGENTS_WITH_APPROVED = `
## Active Agent Instances

| Nickname | UUID | Vendor | Default invocation |
|----------|------|--------|---------------------|
| \`codex-builder\` | \`uuid-1\` | codex | \`codex exec ...\` |

## Approved Vendors

<!-- 本项目允许派发的 vendor。未列或 Approved=no 的一律拒绝，--vendor 覆盖也不例外。 -->

| Vendor | Approved | Approved by | Date | Scope / Notes |
|---|---|---|---|---|
| \`codex\` | yes | \`alice\` | \`2026-07-31\` | ok |
| \`kimi\` | no | \`alice\` | \`2026-07-31\` | not approved yet |
| \`grok\` | **no**（一些说明文字） | | | rich-text cell |
`;

test('parseAgentsContent: Approved Vendors section is parsed with present=true and correct yes/no verdicts', () => {
  const { approvedVendors } = parseAgentsContent(AGENTS_WITH_APPROVED);
  assert.equal(approvedVendors.present, true);
  assert.equal(approvedVendors.list.length, 3);
  const byVendor = Object.fromEntries(approvedVendors.list.map((e) => [e.vendor, e.approved]));
  assert.equal(byVendor.codex, true);
  assert.equal(byVendor.kimi, false);
  // Rich-text "no" cell (bold + trailing Chinese prose) must still parse as not-approved,
  // not accidentally match "yes" or throw.
  assert.equal(byVendor.grok, false);
});

test('parseAgentsContent: approvedVendors.present is false when the section is absent entirely (fail-closed signal)', () => {
  const noSection = `
## Active Agent Instances

| Nickname | UUID | Vendor | Default invocation |
|----------|------|--------|---------------------|
| \`codex-builder\` | \`uuid-1\` | codex | \`codex exec ...\` |
`;
  const { approvedVendors } = parseAgentsContent(noSection);
  assert.equal(approvedVendors.present, false);
  assert.deepEqual(approvedVendors.list, []);
});

test('parseAgentsContent: Approved Vendors section present but empty table still reports present=true with an empty list', () => {
  const emptyTable = `
## Approved Vendors

| Vendor | Approved | Approved by | Date | Scope / Notes |
|---|---|---|---|---|
`;
  const { approvedVendors } = parseAgentsContent(emptyTable);
  assert.equal(approvedVendors.present, true);
  assert.deepEqual(approvedVendors.list, []);
});

test('assertVendorApproved: throws E_APPROVED_VENDORS_SECTION_MISSING (fail-closed) when the section is missing — teeth #3', () => {
  const { approvedVendors } = parseAgentsContent('## Active Agent Instances\n');
  assert.throws(
    () => assertVendorApproved({ approvedVendors }, 'codex'),
    (err) => {
      assert.equal(err.code, E_APPROVED_VENDORS_SECTION_MISSING);
      assert.match(err.message, /no.*"## Approved Vendors" section/);
      // Error surfaces a copy-pasteable skeleton to add.
      assert.match(err.message, /## Approved Vendors/);
      assert.match(err.message, /\| Vendor \| Approved \|/);
      return true;
    },
  );
});

test('assertVendorApproved: adding the section (teeth #3 reverse) flips the same vendor from reject to allow', () => {
  const { approvedVendors: missing } = parseAgentsContent('## Active Agent Instances\n');
  assert.throws(() => assertVendorApproved({ approvedVendors: missing }, 'codex'));

  const { approvedVendors: present } = parseAgentsContent(
    '## Approved Vendors\n\n| Vendor | Approved |\n|---|---|\n| `codex` | yes |\n',
  );
  assert.doesNotThrow(() => assertVendorApproved({ approvedVendors: present }, 'codex'));
});

test('assertVendorApproved: throws E_VENDOR_NOT_APPROVED when the vendor has no row in the table — teeth #2', () => {
  const { approvedVendors } = parseAgentsContent(AGENTS_WITH_APPROVED);
  assert.throws(
    () => assertVendorApproved({ approvedVendors }, 'copilot'),
    (err) => {
      assert.equal(err.code, E_VENDOR_NOT_APPROVED);
      assert.match(err.message, /'copilot' is not approved/);
      // Lists the known entries so the operator can see what IS configured.
      assert.match(err.message, /codex=yes/);
      assert.match(err.message, /kimi=no/);
      return true;
    },
  );
});

test('assertVendorApproved: adding a `yes` row for a previously-unlisted vendor flips reject to allow — teeth #2 reverse', () => {
  const before = parseAgentsContent(AGENTS_WITH_APPROVED).approvedVendors;
  assert.throws(() => assertVendorApproved({ approvedVendors: before }, 'copilot'));

  const after = parseAgentsContent(
    AGENTS_WITH_APPROVED.replace(
      '| `grok` |',
      '| `copilot` | yes | `alice` | `2026-07-31` | added |\n| `grok` |',
    ),
  ).approvedVendors;
  assert.doesNotThrow(() => assertVendorApproved({ approvedVendors: after }, 'copilot'));
});

test('assertVendorApproved: throws E_VENDOR_NOT_APPROVED when the row exists but Approved is not yes — teeth #1', () => {
  const { approvedVendors } = parseAgentsContent(AGENTS_WITH_APPROVED);
  assert.throws(
    () => assertVendorApproved({ approvedVendors }, 'kimi'),
    (err) => err.code === E_VENDOR_NOT_APPROVED,
  );
  assert.throws(
    () => assertVendorApproved({ approvedVendors }, 'grok'),
    (err) => err.code === E_VENDOR_NOT_APPROVED,
  );
});

test('assertVendorApproved: flipping a row from no to yes flips reject to allow — teeth #1 reverse', () => {
  const before = parseAgentsContent(AGENTS_WITH_APPROVED).approvedVendors;
  assert.throws(() => assertVendorApproved({ approvedVendors: before }, 'kimi'));

  const after = parseAgentsContent(
    AGENTS_WITH_APPROVED.replace('| `kimi` | no |', '| `kimi` | yes |'),
  ).approvedVendors;
  assert.doesNotThrow(() => assertVendorApproved({ approvedVendors: after }, 'kimi'));
});

test('assertVendorApproved: passes silently for an approved vendor (no throw, no return value contract)', () => {
  const { approvedVendors } = parseAgentsContent(AGENTS_WITH_APPROVED);
  assert.doesNotThrow(() => assertVendorApproved({ approvedVendors }, 'codex'));
});

test('resolveVendor is deterministic (same input → same output, no state)', () => {
  // Per codex F1: no round-robin / no memoization across calls
  const data = parseAgentsContent(SAMPLE_AGENTS);
  const task = {
    id: 'T-X',
    taskType: 'code-impl',
    status: 'pending',
    depends: [],
    priority: 'normal',
    brief: '',
    vendor: null,
  };
  // Call 10 times — same answer every time
  const results = [];
  for (let i = 0; i < 10; i++) {
    results.push(resolveVendor(task, data));
  }
  const unique = [...new Set(results)];
  assert.equal(unique.length, 1, 'resolveVendor must be deterministic; got varied results: ' + JSON.stringify(unique));
  assert.equal(unique[0], 'kimi');
});
