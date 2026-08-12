// docs/archive/ISSUES.md#queue-brief-dropped-without-leader-tasklist fix.
// Anchor: tests/unit/dispatch-task-content.test.js
//
// The queued dispatch path used to lose the task entirely. loadTaskSpec() returned
// a PLACEHOLDER STRING on both of its miss branches —
//   "(no detailed spec found for <id> in leader-tasklist.md; using queue.md brief only)"
//   "(no leader-tasklist.md found at <path>; using queue.md brief only)"
// — and resolveDispatch handed that string to composePrompt AS the task spec. The
// vendor therefore received a handoff whose entire "## Task spec" section was a
// sentence about a missing file; queue.md's Brief column never reached it. Both
// sentences also claimed "using queue.md brief only" while using nothing at all —
// the same shape of lie as the bug being fixed.
//
// Fixed behavior (all four fixtures below):
//   (a) detailed spec + brief  → BOTH composed, spec first, brief under
//                                "### Queue brief", with explicit precedence
//   (b) leader-tasklist.md exists but has no section for the id → brief IS the spec
//   (c) leader-tasklist.md absent entirely                      → brief IS the spec
//   (d) brief empty AND no detailed spec                        → THROW (fail closed)
// Plus: the placeholder sentences must never appear in a vendor prompt again, and a
// non-ENOENT read failure must still throw rather than degrade to "no spec".

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  resolveDispatch, resolveAdhocDispatch, loadTaskSpec,
  QUEUE_BRIEF_HEADING, QUEUE_BRIEF_PRECEDENCE_NOTE,
} from '../../cli/src/dispatch.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DISPATCH_BIN = join(REPO_ROOT, 'cli', 'bin', 'hopper-dispatch');

const PLACEHOLDER_RE = /no detailed spec found for|no leader-tasklist\.md found at|using queue\.md brief only/i;

/**
 * @param {object} opts
 * @param {string} opts.brief          Brief cell contents ('' = empty cell)
 * @param {string|null} opts.tasklist  leader-tasklist.md contents (null = do not create the file)
 */
function scaffold({ brief = 'ship the thing', tasklist = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hopper-content-'));
  const hopperDir = join(root, '.hopper');
  mkdirSync(join(hopperDir, 'tasks'), { recursive: true });
  mkdirSync(join(hopperDir, 'handoffs'), { recursive: true });
  writeFileSync(join(hopperDir, 'queue.md'), [
    '## Tasks',
    '',
    '| ID | Task-type | Status | Brief |',
    '|----|-----------|--------|-------|',
    `| T-1 | code-impl | pending | ${brief} |`,
    '',
  ].join('\n'));
  writeFileSync(join(hopperDir, 'tasks', 'code-impl.md'), '# Frame\nImplement.');
  if (tasklist !== null) {
    writeFileSync(join(hopperDir, 'handoffs', 'leader-tasklist.md'), tasklist);
  }
  writeFileSync(join(hopperDir, 'AGENTS.md'), [
    '## Approved Vendors',
    '',
    '| Vendor | Approved |',
    '|---|---|',
    '| codex | yes |',
    '',
    '## Task-type → vendor default preference',
    '',
    '| Task-type | Default vendor | Why |',
    '|---|---|---|',
    '| code-impl | codex | x |',
    '',
  ].join('\n'));
  return { root, hopperDir };
}

// ─── (a) detailed spec AND brief: both survive into the prompt ──────────────

test('task content (a): detailed spec + queue Brief are BOTH composed, spec first, precedence stated', async () => {
  const { root, hopperDir } = scaffold({
    brief: 'add the retry loop',
    tasklist: '## T-1\n\nFull spec body: retry three times with backoff.\n',
  });
  try {
    const r = await resolveDispatch({ hopperDir, taskId: 'T-1' });
    assert.match(r.taskSpec, /Full spec body: retry three times with backoff\./, 'detailed spec present');
    assert.match(r.taskSpec, /add the retry loop/, 'queue Brief present');
    assert.ok(
      r.taskSpec.indexOf('Full spec body') < r.taskSpec.indexOf(QUEUE_BRIEF_HEADING),
      'detailed spec comes before the brief section',
    );
    assert.ok(r.taskSpec.includes(QUEUE_BRIEF_HEADING), 'brief is labeled with its source heading');
    assert.ok(r.taskSpec.includes(QUEUE_BRIEF_PRECEDENCE_NOTE), 'conflict precedence is stated for the vendor');
    // The composed handoff the vendor actually receives carries both halves — this
    // is what the EXECUTION_MODE_GUARDRAIL's "brief and Task spec below are the
    // complete, closed loop" promises.
    assert.ok(r.composedPrompt.includes('add the retry loop'), 'brief reaches the vendor prompt');
    assert.ok(r.composedPrompt.includes('Full spec body'), 'spec reaches the vendor prompt');
    assert.equal(r.specNotice, null, 'nothing missing → no operator notice');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ─── (b) leader-tasklist.md exists, but has no section for this task ────────

test('task content (b): tasklist exists without a section for the id → the Brief IS the spec (was: dropped)', async () => {
  const { root, hopperDir } = scaffold({
    brief: 'migrate the parser',
    tasklist: '## T-OTHER\n\nSome unrelated task.\n',
  });
  try {
    assert.equal(await loadTaskSpec(hopperDir, 'T-1'), null, 'missing section reports absence, not prose');
    const r = await resolveDispatch({ hopperDir, taskId: 'T-1' });
    assert.equal(r.taskSpec, 'migrate the parser', 'brief becomes the spec (mirrors the ad-hoc path)');
    assert.ok(r.composedPrompt.includes('migrate the parser'), 'brief reaches the vendor prompt');
    assert.doesNotMatch(r.composedPrompt, PLACEHOLDER_RE, 'no placeholder sentence smuggled into the prompt');
    assert.match(r.specNotice, /No detailed spec section for T-1 in leader-tasklist\.md/);
    assert.match(r.specNotice, /task content comes from queue\.md Brief/);
    assert.doesNotMatch(r.composedPrompt, /task content comes from queue\.md Brief/, 'the notice is for the operator, not the vendor');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ─── (c) no leader-tasklist.md at all ──────────────────────────────────────

test('task content (c): no leader-tasklist.md at all → the Brief IS the spec (was: dropped)', async () => {
  const { root, hopperDir } = scaffold({ brief: 'delete the dead flag', tasklist: null });
  try {
    assert.equal(await loadTaskSpec(hopperDir, 'T-1'), null, 'ENOENT reports absence, not prose');
    const r = await resolveDispatch({ hopperDir, taskId: 'T-1' });
    assert.equal(r.taskSpec, 'delete the dead flag');
    assert.ok(r.composedPrompt.includes('delete the dead flag'), 'brief reaches the vendor prompt');
    assert.doesNotMatch(r.composedPrompt, PLACEHOLDER_RE, 'no placeholder sentence smuggled into the prompt');
    assert.match(r.specNotice, /leader-tasklist\.md is absent at .*leader-tasklist\.md/);
    assert.match(r.specNotice, /task content comes from queue\.md Brief/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ─── (d) neither source has content → fail closed ──────────────────────────

test('task content (d): empty Brief AND no detailed spec → throws instead of dispatching an empty task', async () => {
  const { root, hopperDir } = scaffold({ brief: '', tasklist: null });
  try {
    await assert.rejects(
      () => resolveDispatch({ hopperDir, taskId: 'T-1' }),
      /Task T-1 has no task content: queue\.md Brief is empty and no detailed spec was found/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('task content (d2): empty Brief + tasklist present but sectionless → also throws (fail closed)', async () => {
  const { root, hopperDir } = scaffold({ brief: '   ', tasklist: '## T-OTHER\n\nnot ours\n' });
  try {
    await assert.rejects(
      () => resolveDispatch({ hopperDir, taskId: 'T-1' }),
      /has no task content/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('task content (d3): tasklist has a matched-but-bodyless "## T-1" heading + empty Brief → still throws (fail closed)', async () => {
  // Counter-example this pins: a section that MATCHES the task-id marker but has
  // no body after it (just the bare heading) used to satisfy `section.length > 0`
  // in loadTaskSpec and come back as a non-null "spec" — so the fail-closed throw
  // below never fired, and a vendor would have been dispatched a handoff whose
  // entire "## Task spec" was the bare heading "## T-1" and nothing else.
  const { root, hopperDir } = scaffold({ brief: '', tasklist: '## T-1\n' });
  try {
    assert.equal(await loadTaskSpec(hopperDir, 'T-1'), null, 'matched-but-bodyless heading is no spec');
    await assert.rejects(
      () => resolveDispatch({ hopperDir, taskId: 'T-1' }),
      /Task T-1 has no task content: queue\.md Brief is empty and no detailed spec was found/,
      'must fail closed instead of dispatching a bare-heading "spec"',
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ─── loadTaskSpec contract ────────────────────────────────────────────────

test('loadTaskSpec returns the section text when present, and never returns a self-describing placeholder', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\nthe real spec\n' });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1');
    assert.match(spec, /the real spec/);
    assert.doesNotMatch(spec, PLACEHOLDER_RE);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('loadTaskSpec propagates a non-ENOENT read error instead of degrading to "no spec"', async () => {
  const { root, hopperDir } = scaffold({ tasklist: null });
  try {
    // A DIRECTORY where the file should be → readFile throws EISDIR, not ENOENT.
    mkdirSync(join(hopperDir, 'handoffs', 'leader-tasklist.md'), { recursive: true });
    await assert.rejects(() => loadTaskSpec(hopperDir, 'T-1'), (err) => err.code !== 'ENOENT');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('loadTaskSpec treats a whitespace-only section as no section', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '**T-1**\n' });
  try {
    // The matched section is just the id marker itself; there is no body. Strict
    // equality (not the old `spec === null || spec.trim().length > 0`, which
    // passed vacuously for ANY non-empty spec, whitespace or not) — this must be
    // exactly null, or the fail-closed throw downstream never fires.
    const spec = await loadTaskSpec(hopperDir, 'T-1');
    assert.equal(spec, null, 'matched-but-bodyless marker is no spec');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ─── ad-hoc parity (the path that was always correct) ──────────────────────

test('ad-hoc dispatch keeps brief-as-spec and reports no spec notice (shape parity)', async () => {
  const { root, hopperDir } = scaffold({});
  try {
    const r = await resolveAdhocDispatch({ hopperDir, taskType: 'code-impl', brief: 'one-off thing', id: 'adhoc-1' });
    assert.equal(r.taskSpec, 'one-off thing');
    assert.equal(r.specNotice, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ─── operator surface (CLI) ───────────────────────────────────────────────

function runCli(args, hopperDir) {
  try {
    const stdout = execFileSync(process.execPath, [DISPATCH_BIN, ...args], {
      env: { ...process.env, HOPPER_DIR: hopperDir, HOPPER_HOST_VENDOR: 'test-harness-neutral-host' },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
      exitCode: err.status,
    };
  }
}

test('--resolve echoes the task-content provenance as an operator notice', () => {
  const { root, hopperDir } = scaffold({ brief: 'brief only task', tasklist: null });
  try {
    const r = runCli(['--resolve', 'T-1'], hopperDir);
    assert.equal(r.exitCode, 0, `expected success, got stderr: ${r.stderr}`);
    assert.match(r.stdout, /notice:\s+leader-tasklist\.md is absent at .*; task content comes from queue\.md Brief\./);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--resolve on a content-free task fails closed with an actionable message', () => {
  const { root, hopperDir } = scaffold({ brief: '', tasklist: null });
  try {
    const r = runCli(['--resolve', 'T-1'], hopperDir);
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /has no task content/);
    assert.match(r.stderr, /Fill the Brief cell for T-1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
