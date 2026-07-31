import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveDispatch, resolveAdhocDispatch, planSwarm } from '../../cli/src/dispatch.js';
import { EXECUTION_MODE_GUARDRAIL } from '../../cli/src/tasks.js';
import { renderOutputMarkdown, writeOutput } from '../../cli/src/output.js';
import { validateHostVendorSeparation } from '../../cli/src/validation.js';
import { E_APPROVED_VENDORS_SECTION_MISSING, E_VENDOR_NOT_APPROVED } from '../../cli/src/agents.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function writeQueueAndFrame(hopperDir) {
  mkdirSync(join(hopperDir, 'tasks'), { recursive: true });
  mkdirSync(join(hopperDir, 'handoffs'), { recursive: true });
  writeFileSync(join(hopperDir, 'queue.md'), `## Tasks

| ID | Task-type | Status | Brief |
|----|-----------|--------|-------|
| T-1 | code-impl | pending | do it |
`);
  writeFileSync(join(hopperDir, 'tasks', 'code-impl.md'), '# Frame\nImplement.');
  writeFileSync(join(hopperDir, 'handoffs', 'leader-tasklist.md'), '## T-1\nSpec body.');
}

function scaffoldMinimal(root) {
  const hopperDir = join(root, '.hopper');
  writeQueueAndFrame(hopperDir);
  writeFileSync(join(hopperDir, 'AGENTS.md'), `## Approved Vendors

| Vendor | Approved |
|---|---|
| codex | yes |
| grok | yes |

## Task-type → vendor default preference

| Task-type | Default vendor | Why |
|---|---|---|
| code-impl | codex | x |
`);
  return hopperDir;
}

/** Same routing as scaffoldMinimal but with NO "## Approved Vendors" section at all. */
function scaffoldNoApprovedSection(root) {
  const hopperDir = join(root, '.hopper');
  writeQueueAndFrame(hopperDir);
  writeFileSync(join(hopperDir, 'AGENTS.md'), `## Task-type → vendor default preference

| Task-type | Default vendor | Why |
|---|---|---|
| code-impl | codex | x |
`);
  return hopperDir;
}

test('resolveDispatch injects the constitution when GOVERNANCE.md present', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-disp-'));
  try {
    const hopperDir = scaffoldMinimal(tmp);
    mkdirSync(join(hopperDir, 'governance'), { recursive: true });
    writeFileSync(join(hopperDir, 'governance', 'core.md'), 'GOVERNANCE CONSTITUTION');
    writeFileSync(join(hopperDir, 'GOVERNANCE.md'), '- **Constitution**: .hopper/governance/core.md\n');
    const r = await resolveDispatch({ hopperDir, taskId: 'T-1' });
    assert.ok(r.composedPrompt.startsWith(EXECUTION_MODE_GUARDRAIL), 'execution guardrail leads the handoff');
    assert.match(r.composedPrompt, /GOVERNANCE CONSTITUTION/, 'constitution injected after the guardrail');
    assert.match(r.composedPrompt, /## Task spec/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('resolveDispatch composes without governance when GOVERNANCE.md absent', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-disp-'));
  try {
    const hopperDir = scaffoldMinimal(tmp);
    const r = await resolveDispatch({ hopperDir, taskId: 'T-1' });
    assert.ok(r.composedPrompt.startsWith(EXECUTION_MODE_GUARDRAIL), 'guardrail leads even without governance');
    assert.match(r.composedPrompt, /# Frame/, 'frame composed after the guardrail');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('resolveAdhocDispatch: queue-less dispatch (brief = spec; --vendor wins; validates inputs)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-disp-'));
  try {
    const hopperDir = scaffoldMinimal(tmp);
    const r = await resolveAdhocDispatch({ hopperDir, taskType: 'code-impl', brief: 'do the ad-hoc thing', id: 'adhoc-1' });
    assert.equal(r.task.id, 'adhoc-1');
    assert.equal(r.task.taskType, 'code-impl');
    assert.equal(r.vendor, 'codex', 'defaults to the AGENTS.md preference');
    assert.equal(r.taskSpec, 'do the ad-hoc thing', 'brief becomes the spec');
    assert.ok(r.composedPrompt.includes('do the ad-hoc thing'), 'spec composed into the prompt');

    const overridden = await resolveAdhocDispatch({ hopperDir, taskType: 'code-impl', brief: 'x', id: 'adhoc-2', vendorOverride: 'grok' });
    assert.equal(overridden.vendor, 'grok', '--vendor overrides the routed vendor');

    await assert.rejects(() => resolveAdhocDispatch({ hopperDir, taskType: 'code-impl', brief: '', id: 'adhoc-3' }), /non-empty --brief/);
    await assert.rejects(() => resolveAdhocDispatch({ hopperDir, taskType: 'BAD TYPE', brief: 'x', id: 'adhoc-4' }), /Invalid --task-type/);
    await assert.rejects(() => resolveAdhocDispatch({ hopperDir, taskType: 'code-impl', brief: 'x', id: '../escape' }), /unsafe characters|task-id/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('resolveDispatch: vendorOverride (--vendor) wins over the AGENTS.md routing', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-disp-'));
  try {
    const hopperDir = scaffoldMinimal(tmp);
    const def = await resolveDispatch({ hopperDir, taskId: 'T-1' });
    assert.equal(def.vendor, 'codex', 'default routes to codex per AGENTS.md');
    const overridden = await resolveDispatch({ hopperDir, taskId: 'T-1', vendorOverride: 'grok' });
    assert.equal(overridden.vendor, 'grok', '--vendor overrides the routed vendor');
    // governance + composition still key on the (overridden) vendor, not the default
    assert.ok(overridden.composedPrompt.startsWith(EXECUTION_MODE_GUARDRAIL) && overridden.composedPrompt.includes('# Frame'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('host != vendor is still enforced for an OVERRIDDEN vendor (review coverage gap)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-disp-'));
  try {
    const hopperDir = scaffoldMinimal(tmp);
    const r = await resolveDispatch({ hopperDir, taskId: 'T-1', vendorOverride: 'grok' });
    assert.equal(r.vendor, 'grok');
    assert.throws(() => validateHostVendorSeparation('grok', r.vendor), /cannot dispatch to the same vendor/i);
    assert.doesNotThrow(() => validateHostVendorSeparation('codex', r.vendor));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ─── Approved Vendors gate wiring (TH-approved-vendors, 2026-07-31) ───────
// Both dispatch.js call sites — resolveDispatch (queue.md path, :71) and
// resolveAdhocDispatch (ad-hoc path, :116) — must enforce the Approved
// Vendors whitelist AFTER vendor resolution, so an explicit vendorOverride
// (the CLI's --vendor) cannot bypass it either. Teeth #4 from the brief.

test('resolveDispatch (queue path): throws E_APPROVED_VENDORS_SECTION_MISSING when AGENTS.md has no Approved Vendors section — teeth #3', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-disp-'));
  try {
    const hopperDir = scaffoldNoApprovedSection(tmp);
    await assert.rejects(
      () => resolveDispatch({ hopperDir, taskId: 'T-1' }),
      (err) => {
        assert.equal(err.code, E_APPROVED_VENDORS_SECTION_MISSING);
        return true;
      },
    );
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('resolveAdhocDispatch (ad-hoc path): throws E_APPROVED_VENDORS_SECTION_MISSING when AGENTS.md has no Approved Vendors section — teeth #3', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-disp-'));
  try {
    const hopperDir = scaffoldNoApprovedSection(tmp);
    await assert.rejects(
      () => resolveAdhocDispatch({ hopperDir, taskType: 'code-impl', brief: 'x', id: 'adhoc-noapproval' }),
      (err) => {
        assert.equal(err.code, E_APPROVED_VENDORS_SECTION_MISSING);
        return true;
      },
    );
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('resolveDispatch (queue path, :71): an unapproved --vendor override is rejected, NOT silently honored — teeth #4', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-disp-'));
  try {
    const hopperDir = scaffoldMinimal(tmp); // Approved Vendors = codex, grok only
    // The default (unoverridden) route to `codex` is approved and still works.
    await assert.doesNotReject(() => resolveDispatch({ hopperDir, taskId: 'T-1' }));
    // `claude` is a real, registered adapter (would pass host!=vendor for a
    // non-Claude-Code host) but is NOT in this project's Approved Vendors table —
    // the override must still be refused.
    await assert.rejects(
      () => resolveDispatch({ hopperDir, taskId: 'T-1', vendorOverride: 'claude' }),
      (err) => {
        assert.equal(err.code, E_VENDOR_NOT_APPROVED);
        assert.match(err.message, /'claude' is not approved/);
        return true;
      },
    );
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('resolveAdhocDispatch (ad-hoc path, :116): an unapproved --vendor override is rejected, NOT silently honored — teeth #4', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-disp-'));
  try {
    const hopperDir = scaffoldMinimal(tmp); // Approved Vendors = codex, grok only
    await assert.doesNotReject(
      () => resolveAdhocDispatch({ hopperDir, taskType: 'code-impl', brief: 'x', id: 'adhoc-ok' }),
    );
    await assert.rejects(
      () => resolveAdhocDispatch({ hopperDir, taskType: 'code-impl', brief: 'x', id: 'adhoc-bad', vendorOverride: 'claude' }),
      (err) => {
        assert.equal(err.code, E_VENDOR_NOT_APPROVED);
        assert.match(err.message, /'claude' is not approved/);
        return true;
      },
    );
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('resolveAdhocDispatch: synthetic task renders through writeOutput/renderOutputMarkdown without throwing (downstream-field guard)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hopper-disp-'));
  try {
    const hopperDir = scaffoldMinimal(tmp);
    const resolved = await resolveAdhocDispatch({ hopperDir, taskType: 'code-impl', brief: 'adhoc brief', id: 'adhoc-render' });
    const dispatchResult = {
      task: resolved.task, vendor: resolved.vendor,
      output: { status: 'success', text: 'OK' },
      raw: { exitCode: 0, timedOut: false, durationMs: 5, stdout: 'OK', stderr: '' },
    };
    const md = renderOutputMarkdown(dispatchResult);
    assert.match(md, /adhoc-render/);
    assert.match(md, /code-impl/);
    const written = await writeOutput({ hopperDir, dispatchResult });
    assert.ok(written.path.endsWith('adhoc-render-output.md'));
    assert.equal(typeof written.queueEdit, 'string');
    assert.equal(typeof written.costEdit, 'string');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('planSwarm: fans a qualitative brief to N distinct vendors with per-vendor ids', () => {
  const panels = planSwarm({ taskType: 'code-review-acceptance', brief: 'review X', vendors: 'codex,grok,claude', idBase: 'sw', now: 1 });
  assert.equal(panels.length, 3);
  assert.deepEqual(panels.map((p) => p.vendor), ['codex', 'grok', 'claude']);
  assert.deepEqual(panels.map((p) => p.id), ['sw-codex', 'sw-grok', 'sw-claude']);
  assert.ok(panels.every((p) => p.taskType === 'code-review-acceptance' && p.brief === 'review X'));
});

test('planSwarm: dedups vendors; rejects <2, non-qualitative task-types, empty brief, bad names', () => {
  assert.equal(planSwarm({ taskType: 'prd-research', brief: 'x', vendors: 'codex,codex,grok', idBase: 'b', now: 1 }).length, 2, 'dedup');
  assert.throws(() => planSwarm({ taskType: 'prd-research', brief: 'x', vendors: 'codex' }), /at least 2 vendors/);
  assert.throws(() => planSwarm({ taskType: 'code-impl', brief: 'x', vendors: 'codex,grok' }), /read-only\/qualitative/);
  assert.throws(() => planSwarm({ taskType: 'prd-research', brief: '   ', vendors: 'codex,grok' }), /non-empty --brief/);
  assert.throws(() => planSwarm({ taskType: 'prd-research', brief: 'x', vendors: 'codex,Bad Vendor' }), /Invalid vendor name/);
});
