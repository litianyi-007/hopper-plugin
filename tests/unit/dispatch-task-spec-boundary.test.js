// Cross-task content LEAK fix in loadTaskSpec()'s section-END detection.
// Anchor: tests/unit/dispatch-task-spec-boundary.test.js
//
// Found by an adversarial review of the queue-brief-dropped-without-leader-tasklist
// fix (docs/archive/ISSUES.md) and independently reproduced. loadTaskSpec()'s
// section-END detection was broken TWO INDEPENDENT ways, so a task's "spec" could
// contain ANOTHER task's content — worse than a missing spec, since the vendor
// then executes someone else's task instead of its own:
//
//   (a) `rest.slice(50)` skipped a fixed 50 characters before searching for the
//       next section boundary. A section shorter than 50 chars let the NEXT
//       task's heading fall inside that skipped window, so it was never seen
//       and the slice ran on into (and swallowed) that next task.
//   (b) the END search only ever recognized a `^##\s+` heading, while the START
//       search (what actually MARKS a new task, per the same file) recognizes
//       THREE forms: `**<id>**` (bold), `^##+\s+<id>` (heading), and
//       `^|\s*<id>\s*|` (table row). A following task written in bold or
//       table-row form was therefore never a boundary at all, REGARDLESS of
//       section length.
//
// Fix: loadTaskSpec(hopperDir, taskId, { otherTaskIds }) — resolveDispatch (which
// already parses queue.md and holds every known task id) now passes every OTHER
// known id, and the section ends at the exact next marker (any of the three
// forms) naming one of them. Exact ids beat pattern-guessing: a legitimate
// `**Bold**` line or markdown table inside a task's OWN body can never be
// mistaken for a boundary, because it does not spell another task's id. The
// `rest.slice(50)` magic number is gone entirely — the search now starts right
// after the matched marker TEXT, in both the id-aware and no-id-list fallback
// modes.
//
// FOLLOW-UP (same day, adversarial review of the first pass — two more defects,
// both in the union/either-or shape of the boundary check, not the marker forms
// themselves):
//
//   Defect 1 — the first pass made the boundary an EITHER/OR: id-aware search
//   ONLY when `otherTaskIds` was supplied, heading-only search ONLY when it was
//   not. Since `resolveDispatch` (the real dispatch path) ALWAYS supplies
//   `otherTaskIds`, a plain markdown heading stopped being a boundary at all on
//   that path — any task present in leader-tasklist.md but ABSENT from
//   queue.md (e.g. anything dispatched via `--adhoc`, which never gets a
//   queue.md row) could no longer terminate the PREVIOUS task's section, and
//   its content leaked backwards. Fixed: the boundary is now the UNION of (i)
//   an unconditional H2-heading check and (ii) the known-other-id check —
//   whichever comes first — so known ids only ever ADD boundaries, never
//   remove the heading one.
//
//   Defect 2 — the heading half of that union (and the original no-id
//   fallback) used `^##+\s+` (two OR MORE hashes), so a spec body's own
//   legitimate `###`/`####` subsections (e.g. `### 背景` / `### 验收`) were
//   mistaken for a boundary and cut the spec off at the first one. Fixed:
//   narrowed to `^##\s+` — EXACTLY two hashes — matching what the pre-round
//   code used for its (correct, if magic-numbered) H2 check.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveDispatch, loadTaskSpec } from '../../cli/src/dispatch.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * @param {object} opts
 * @param {string} opts.tasklist     leader-tasklist.md contents
 * @param {string} [opts.brief1]     T-1's queue.md Brief cell
 * @param {string} [opts.brief2]     T-2's queue.md Brief cell
 */
function scaffold({ tasklist, brief1 = 'do T-1 things', brief2 = 'do T-2 things' }) {
  const root = mkdtempSync(join(tmpdir(), 'hopper-boundary-'));
  const hopperDir = join(root, '.hopper');
  mkdirSync(join(hopperDir, 'tasks'), { recursive: true });
  mkdirSync(join(hopperDir, 'handoffs'), { recursive: true });
  writeFileSync(join(hopperDir, 'queue.md'), [
    '## Tasks',
    '',
    '| ID | Task-type | Status | Brief |',
    '|----|-----------|--------|-------|',
    `| T-1 | code-impl | pending | ${brief1} |`,
    `| T-2 | code-impl | pending | ${brief2} |`,
    '',
  ].join('\n'));
  writeFileSync(join(hopperDir, 'tasks', 'code-impl.md'), '# Frame\nImplement.');
  writeFileSync(join(hopperDir, 'handoffs', 'leader-tasklist.md'), tasklist);
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

// ─── root cause (a): the `rest.slice(50)` magic number ──────────────────────

test('(a) short section (<50 chars): T-1 does not swallow T-2 (was: leaked)', async () => {
  const { root, hopperDir } = scaffold({
    tasklist: [
      '## T-1',
      '',
      '## T-2',
      'SECRET_T2_BODY_ONLY belongs to T-2 alone.',
      '',
    ].join('\n'),
  });
  try {
    // T-1's own section is just the bare heading — no body of its own. Correctly
    // finding the T-2 boundary means loadTaskSpec reports "no spec" (null), not a
    // leaked chunk of T-2's content pretending to be T-1's.
    const spec1 = await loadTaskSpec(hopperDir, 'T-1');
    assert.equal(spec1, null, 'T-1 has no body of its own once the T-2 boundary is found correctly');
    assert.doesNotMatch(String(spec1), /SECRET_T2_BODY_ONLY/);
    // Control: T-2 itself still sees its own real content.
    const spec2 = await loadTaskSpec(hopperDir, 'T-2');
    assert.match(spec2, /SECRET_T2_BODY_ONLY/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('(a) control: padding T-1 past 50 chars finds the boundary correctly (isolates the magic number as the cause)', async () => {
  const { root, hopperDir } = scaffold({
    tasklist: [
      '## T-1',
      '',
      'Real T-1 body padded well past fifty characters of legitimate content so the',
      'old fixed-offset skip would have found this boundary too.',
      '',
      '## T-2',
      'SECRET_T2_BODY_ONLY belongs to T-2 alone.',
      '',
    ].join('\n'),
  });
  try {
    const spec1 = await loadTaskSpec(hopperDir, 'T-1');
    assert.match(spec1, /Real T-1 body padded/);
    assert.doesNotMatch(spec1, /SECRET_T2_BODY_ONLY/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ─── root cause (b): boundary detection narrower than marker detection ──────

test('(b) bold-form next task ("**T-2** ...") is a boundary regardless of section length (was: never a boundary)', async () => {
  const { root, hopperDir } = scaffold({
    tasklist: [
      '## T-1',
      '',
      'Real T-1 body that is intentionally long enough to rule out the magic-number',
      'cause entirely — well past fifty characters describing what T-1 actually',
      'needs to do, on its own, before any other task marker appears below.',
      '',
      '**T-2** SECRET_T2_BOLD belongs to T-2 alone.',
      '',
    ].join('\n'),
  });
  try {
    const spec1 = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1', 'T-2'] });
    assert.match(spec1, /Real T-1 body that is intentionally long/, 'T-1 own body preserved');
    assert.doesNotMatch(spec1, /SECRET_T2_BOLD/, 'T-2 bold-form section must not leak into T-1');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('(b) table-row-form next task ("| T-2 | ... |") is a boundary regardless of section length (was: never a boundary)', async () => {
  const { root, hopperDir } = scaffold({
    tasklist: [
      '## T-1',
      '',
      'Real T-1 body that is intentionally long enough to rule out the magic-number',
      'cause entirely — well past fifty characters describing what T-1 actually',
      'needs to do, on its own, before any other task marker appears below.',
      '',
      '| T-2 | code-impl | pending | | high | SECRET_T2_TABLE | codex |',
      '',
    ].join('\n'),
  });
  try {
    const spec1 = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1', 'T-2'] });
    assert.match(spec1, /Real T-1 body that is intentionally long/, 'T-1 own body preserved');
    assert.doesNotMatch(spec1, /SECRET_T2_TABLE/, 'T-2 table-row-form section must not leak into T-1');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('(b) control: heading-form next task ("## T-2") was already a correct boundary before this fix', async () => {
  const { root, hopperDir } = scaffold({
    tasklist: [
      '## T-1',
      '',
      'Real T-1 body that is intentionally long enough to rule out the magic-number',
      'cause entirely — well past fifty characters describing what T-1 needs to do.',
      '',
      '## T-2',
      'SECRET_T2_HEADING belongs to T-2 alone.',
      '',
    ].join('\n'),
  });
  try {
    const spec1 = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1', 'T-2'] });
    assert.match(spec1, /Real T-1 body that is intentionally long/);
    assert.doesNotMatch(spec1, /SECRET_T2_HEADING/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ─── over-truncation guard (hard constraint) ─────────────────────────────────
// A spec body legitimately containing bold text at the start of a line, or a
// markdown table, must NOT be mistaken for a section boundary — even when an
// id-shaped token (but NOT a real, OTHER, known task id) appears inside it.

test('over-truncation guard: a bold line — including one naming an id-shaped token that is NOT a known other task — stays in the body', async () => {
  const { root, hopperDir } = scaffold({
    tasklist: [
      '## T-1',
      '',
      '**Bold** statement at the start of a line, part of T-1\'s own legitimate body text.',
      '',
      'It also mentions **T-9** inline, which is NOT a real task id in this queue (only',
      'T-1 and T-2 exist) and must not be treated as a section boundary.',
      '',
      'REST_OF_T1_BODY_MARKER: the rest of T-1\'s body continues here and must survive intact.',
      '',
    ].join('\n'),
  });
  try {
    const spec1 = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1', 'T-2'] });
    assert.match(spec1, /\*\*Bold\*\* statement/, 'the bold line at the top of the body is not cut');
    assert.match(spec1, /\*\*T-9\*\*/, 'a bold id-shaped token that is not a KNOWN other task stays in the body');
    assert.match(spec1, /REST_OF_T1_BODY_MARKER/, 'content after the bold lines is not truncated');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('over-truncation guard: a markdown table inside the body (not naming another known task) stays in the body', async () => {
  const { root, hopperDir } = scaffold({
    tasklist: [
      '## T-1',
      '',
      'Here is a table describing something unrelated to task ids:',
      '',
      '| Name | Value |',
      '|------|-------|',
      '| foo | bar |',
      '| baz | qux |',
      '',
      'BODY_CONTINUES_AFTER_TABLE_MARKER: this line must still be included.',
      '',
    ].join('\n'),
  });
  try {
    const spec1 = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1', 'T-2'] });
    assert.match(spec1, /\| foo \| bar \|/, 'table rows survive');
    assert.match(spec1, /BODY_CONTINUES_AFTER_TABLE_MARKER/, 'content after the table is not truncated');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ─── full pipeline (resolveDispatch): the wiring, not just the unit ─────────

test('resolveDispatch: T-1 never receives T-2\'s bold-form content in its composed prompt (end-to-end)', async () => {
  const { root, hopperDir } = scaffold({
    tasklist: [
      '## T-1',
      '',
      'Real T-1 body that is intentionally long enough to rule out the magic-number',
      'cause entirely — well past fifty characters describing what T-1 needs to do.',
      '',
      '**T-2** SECRET_T2_BOLD_E2E belongs to T-2 alone.',
      '',
    ].join('\n'),
  });
  try {
    const r1 = await resolveDispatch({ hopperDir, taskId: 'T-1' });
    assert.match(r1.taskSpec, /Real T-1 body that is intentionally long/);
    assert.doesNotMatch(r1.taskSpec, /SECRET_T2_BOLD_E2E/, 'taskSpec must not leak T-2 content');
    assert.doesNotMatch(r1.composedPrompt, /SECRET_T2_BOLD_E2E/, 'composed vendor prompt must not leak T-2 content');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolveDispatch: T-2 (last section, no trailing boundary) still gets its own full content', async () => {
  const { root, hopperDir } = scaffold({
    tasklist: [
      '## T-1',
      '',
      'Real T-1 body that is intentionally long enough to rule out the magic-number',
      'cause entirely — well past fifty characters describing what T-1 needs to do.',
      '',
      '**T-2** SECRET_T2_BOLD_E2E belongs to T-2 alone.',
      '',
    ].join('\n'),
  });
  try {
    const r2 = await resolveDispatch({ hopperDir, taskId: 'T-2' });
    assert.match(r2.taskSpec, /SECRET_T2_BOLD_E2E/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ─── re-verifies docs/archive/ISSUES.md's fail-closed claim ─────────────────
// The Resolution section of queue-brief-dropped-without-leader-tasklist claims
// "spec 与 brief 皆空 → 抛错（fail-closed）". That claim was FALSIFIED by this very
// leak: a task with NO real content of its own (a bodyless "## T-1" heading) and
// an empty Brief should fail-closed — but under the broken boundary detection,
// a following task in bold/table form was never seen as a boundary, so
// loadTaskSpec silently returned that OTHER task's leaked content as if it were
// T-1's own non-empty spec, and the fail-closed throw never fired. With both
// root causes fixed, this must throw again.
test('fail-closed re-verified: empty Brief + bodyless T-1 immediately followed by a bold-form T-2 still throws (was: leaked content silently defeated the fail-closed guard)', async () => {
  const { root, hopperDir } = scaffold({
    brief1: '',
    tasklist: [
      '## T-1',
      '',
      '**T-2** SECRET_T2_BOLD real content that belongs to T-2 alone.',
      '',
    ].join('\n'),
  });
  try {
    const spec1 = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1', 'T-2'] });
    assert.equal(spec1, null, 'T-1 has no body of its own once the bold-form T-2 boundary is found correctly');
    await assert.rejects(
      () => resolveDispatch({ hopperDir, taskId: 'T-1' }),
      /Task T-1 has no task content: queue\.md Brief is empty and no detailed spec was found/,
      'fail-closed must fire — not silently substitute T-2\'s leaked content',
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ─── union defect 1: a plain H2 heading must ALWAYS terminate a section, even ──
// ─── for an id that is NOT in otherTaskIds (e.g. an --adhoc task with no ────────
// ─── queue.md row) ───────────────────────────────────────────────────────────
// Reproduced by the coordinator: with otherTaskIds supplied (the real dispatch
// path, which ALWAYS supplies it), an earlier version of the fix made the
// id-aware search REPLACE the heading search instead of adding to it — so a
// following task written as a plain "## T-91" heading, when T-91 has no
// queue.md row (and is therefore absent from otherTaskIds), was no longer a
// boundary AT ALL, and its content leaked into the previous task's spec.

test('union defect 1: T-1 spec called with otherTaskIds does NOT leak into a following "## T-91" whose id is absent from otherTaskIds', async () => {
  const { root, hopperDir } = scaffold({
    tasklist: [
      '## T-1',
      '',
      'Real T-1 body that is intentionally long enough to rule out the magic-number',
      'cause entirely — well past fifty characters describing what T-1 actually',
      'needs to do, on its own, before any other task marker appears below.',
      '',
      '## T-91',
      'SECRET_ADHOC belongs to T-91, which was dispatched via --adhoc and has no queue.md row.',
      '',
    ].join('\n'),
  });
  try {
    // otherTaskIds mirrors the real queue.md id set — T-91 is NOT in it, exactly
    // like an --adhoc task (T-091..T-100 in the real repo) that never gets a
    // queue.md row.
    const spec1 = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1', 'T-2'] });
    assert.match(spec1, /Real T-1 body that is intentionally long/, 'T-1 own body preserved');
    assert.doesNotMatch(spec1, /SECRET_ADHOC/, 'a plain heading must terminate the section even for an UNKNOWN id');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ─── union defect 2: the unconditional heading check must be H2-ONLY ────────
// ─── (`^##\s+`, not `^##+\s+`) so a spec's own ###/#### subsections survive ──
// Reproduced by the coordinator: widening the heading check to "any level"
// mistakes a spec's own `### 背景` / `### 验收` subsections for a section
// boundary and truncates the spec at the first one. Checked in BOTH modes —
// with and without otherTaskIds — since the heading check is unconditional.

function subsectionTasklist() {
  return [
    '## T-1',
    '',
    '开头正文。',
    '',
    '### 背景',
    '… KEEPME_SUB',
    '',
    '### 验收',
    '… KEEPME_END',
    '',
  ].join('\n');
}

test('union defect 2: a spec\'s own ### subsections survive intact — WITH otherTaskIds (real dispatch path)', async () => {
  const { root, hopperDir } = scaffold({ tasklist: subsectionTasklist() });
  try {
    const spec1 = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1', 'T-2'] });
    assert.match(spec1, /开头正文/);
    assert.match(spec1, /### 背景/);
    assert.match(spec1, /KEEPME_SUB/);
    assert.match(spec1, /### 验收/);
    assert.match(spec1, /KEEPME_END/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('union defect 2: a spec\'s own ### subsections survive intact — WITHOUT otherTaskIds (no-id-list mode)', async () => {
  const { root, hopperDir } = scaffold({ tasklist: subsectionTasklist() });
  try {
    const spec1 = await loadTaskSpec(hopperDir, 'T-1');
    assert.match(spec1, /开头正文/);
    assert.match(spec1, /### 背景/);
    assert.match(spec1, /KEEPME_SUB/);
    assert.match(spec1, /### 验收/);
    assert.match(spec1, /KEEPME_END/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('union defect 2 (end-to-end): resolveDispatch keeps a spec\'s own ### subsections intact in the composed prompt', async () => {
  const { root, hopperDir } = scaffold({ tasklist: subsectionTasklist() });
  try {
    const r1 = await resolveDispatch({ hopperDir, taskId: 'T-1' });
    assert.match(r1.taskSpec, /KEEPME_SUB/);
    assert.match(r1.taskSpec, /KEEPME_END/);
    assert.match(r1.composedPrompt, /KEEPME_SUB/);
    assert.match(r1.composedPrompt, /KEEPME_END/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
