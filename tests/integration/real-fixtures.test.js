// Integration tests against REAL .hopper/ fixtures (codex Phase 1 audit F4 fix)
// Anchor: tests/integration/real-fixtures.test.js
//
// Synthetic unit tests cover happy path; this file verifies the dispatch
// chain works against the actual files committed in this repo.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveDispatch, getStatus } from '../../cli/src/dispatch.js';
import { parseAgentsFile, resolveVendor } from '../../cli/src/agents.js';
import { loadTaskFrame, verifyFrameAntiPersona, listTaskTypes } from '../../cli/src/tasks.js';
import { parseQueue, findEligibleTask } from '../../cli/src/queue.js';
import { SCAFFOLD_TASK_TYPES } from '../../cli/src/scaffold.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const HOPPER_DIR = join(REPO_ROOT, '.hopper');

test('integration: parseQueue reads real queue.md without errors', async () => {
  const tasks = await parseQueue(join(HOPPER_DIR, 'queue.md'));
  // Real queue has 19 tasks per spec v2.0.3
  assert.ok(tasks.length >= 18, `expected ≥18 tasks, got ${tasks.length}`);
  // Specific known tasks should be present
  const ids = tasks.map((t) => t.id);
  assert.ok(ids.includes('T-PLUGIN-00'));
  assert.ok(ids.includes('T-PLUGIN-05e'));
  assert.ok(ids.includes('T-PLUGIN-10'));
});

test('integration: real queue.md uses v2 Task-type schema (not v1 Role)', async () => {
  const tasks = await parseQueue(join(HOPPER_DIR, 'queue.md'));
  // Every task should have a recognized task-type
  const validTypes = ['spec-write', 'code-impl', 'code-review-adversarial',
    'code-review-acceptance', 'sidecar-polish', 'spec-blindspot-hunt'];
  for (const t of tasks) {
    assert.ok(validTypes.includes(t.taskType),
      `task ${t.id} has unknown task-type '${t.taskType}'`);
  }
});

test('integration: all real task-type frames pass anti-persona check', async () => {
  const types = await listTaskTypes(HOPPER_DIR);
  // Derived from the shipped registry, not a hardcoded count. The literal `6` here
  // turned every task-type addition into a CI failure discovered only after push —
  // and `npm test` globs tests/unit/ only, so it could not be seen locally either.
  // What this test is actually for is the anti-persona check below; the count is a
  // guard that the fixture workspace has not silently lost its frames.
  assert.equal(types.length, SCAFFOLD_TASK_TYPES.length,
    `this repo's own .hopper/tasks/ should hold one frame per shipped task-type; `
    + `got ${types.length} of ${SCAFFOLD_TASK_TYPES.length}. `
    + 'Run `hopper-dispatch --migrate-config --yes` to add the missing ones.');

  for (const type of types) {
    const frame = await loadTaskFrame(HOPPER_DIR, type);
    const result = verifyFrameAntiPersona(frame);
    assert.ok(result.ok,
      `Frame '${type}.md' has persona violations: ${JSON.stringify(result.hits)}`);
  }
});

test('integration: parseAgentsFile reads real AGENTS.md and produces normalized vendor IDs', async () => {
  const { agents, preferences } = await parseAgentsFile(join(HOPPER_DIR, 'AGENTS.md'));
  assert.ok(agents.length >= 5, `expected ≥5 agents, got ${agents.length}`);

  // Per codex Phase 1 F2 fix: vendor IDs must match cli/src/vendors/<vendor>.js convention
  // (i.e. NOT 'codex-cli' / 'kimi-cli' / 'agy-cli' but normalized 'codex' / 'kimi' / 'agy')
  const vendors = agents.map((a) => a.vendor);
  const expectedNormalizedVendors = ['codex', 'kimi', 'opencode', 'copilot', 'agy'];
  for (const expected of expectedNormalizedVendors) {
    assert.ok(
      vendors.includes(expected) || vendors.includes('claude-code-tui'),
      `expected normalized vendor '${expected}' in agents list; got: ${JSON.stringify(vendors)}`,
    );
  }
  // Specifically: NO vendor should still have '-cli' suffix
  for (const v of vendors) {
    assert.ok(!v.endsWith('-cli'), `vendor '${v}' still has -cli suffix; normalization failed`);
  }
});

test('integration: real AGENTS.md task-type preferences resolve to known vendors', async () => {
  const { agents, preferences } = await parseAgentsFile(join(HOPPER_DIR, 'AGENTS.md'));
  // Each preference should point at a nickname that exists in agents list
  const nicknames = new Set(agents.map((a) => a.nickname));
  for (const [taskType, vendorPref] of Object.entries(preferences)) {
    assert.ok(
      nicknames.has(vendorPref) || agents.some((a) => a.vendor === vendorPref),
      `preference for '${taskType}' points at '${vendorPref}' but no matching nickname/vendor found`,
    );
  }
});

test('integration: resolveDispatch end-to-end for a known-eligible task scenario', async () => {
  // Find a task whose deps are all done (or no deps) AND status is pending
  const tasks = await parseQueue(join(HOPPER_DIR, 'queue.md'));
  const eligibleTask = tasks.find((t) => {
    if (t.status !== 'pending') return false;
    if (t.depends.length === 0) return true;
    return t.depends.every((depId) => tasks.find((d) => d.id === depId)?.status === 'done');
  });

  if (!eligibleTask) {
    // No eligible task right now — verify dispatch handles "ineligible" cleanly
    // by picking a known-ineligible task and asserting error
    const known = tasks.find((t) => t.status !== 'pending');
    if (known) {
      await assert.rejects(
        () => resolveDispatch({ hopperDir: HOPPER_DIR, taskId: known.id }),
        /Task not eligible/,
      );
    }
    return;
  }

  // Eligible task found — resolve should succeed
  const result = await resolveDispatch({ hopperDir: HOPPER_DIR, taskId: eligibleTask.id });
  assert.ok(result.task);
  assert.equal(result.task.id, eligibleTask.id);
  assert.ok(result.vendor);
  assert.ok(result.composedPrompt.length > 0);
  assert.ok(result.frame.length > 0);
});

test('integration: getStatus returns valid summary against real queue.md', async () => {
  const summary = await getStatus(HOPPER_DIR);
  assert.ok(summary.total >= 18);
  assert.equal(typeof summary.pending, 'number');
  assert.equal(typeof summary.done, 'number');
  // Sum of statuses must equal total (or close — some defensive '|| 0' bookkeeping)
  const sum = summary.pending + summary['in-progress'] + summary.done + summary.failed + summary.removed;
  assert.equal(sum, summary.total);
});
