// docs/archive/ISSUES.md#task-spec-structural-only-body-accepted fix.
// Anchor: tests/unit/dispatch-task-spec-structural-only.test.js
//
// loadTaskSpec()'s fail-closed check used to accept ANY section whose body had
// at least one non-whitespace character after the matched marker — so a body
// that was PURELY structural markdown noise (a horizontal rule, an empty table
// skeleton, a bare blockquote marker) passed as a real spec, same failure shape
// as the two already-fixed instances in this same function (self-describing
// placeholder text; a bare bodyless heading).
//
// Fixed: the rule is now "is there anything BESIDES structural markup" — NOT
// "does it contain structural markup" — checked line-by-line and unioned
// across the whole body (see isStructuralOnlyLine / hasSubstantiveContent in
// cli/src/dispatch.js). The instant ONE line carries real content, the whole
// section is accepted, however much structural noise surrounds it.
//
// Two suites below, ordered per the scope-lock's explicit priority:
// over-rejection is worse than under-rejection here (a legitimate spec wrongly
// judged "no content" fail-closes a task that would otherwise have run
// correctly, whereas the original defect only occasionally shipped an empty
// task book) — so the OVER-rejection suite is the one that matters more, even
// though it is listed second for narrative flow (structural-only cases first,
// then the guard against having gone too far).
//
// REWORK (2026-08-13, same day, adversarial review of the fix above — both
// findings independently reproduced before this file was extended):
//
//   P1 (red-line violation, over-rejection): the line-by-line check above
//   TRIMS each line before judging it, which destroys leading indentation —
//   so an indented code block showing a literal `---`/`> `/`| | |` as an
//   EXAMPLE was wrongly judged structural-only and rejected, exactly the
//   "over-rejection fail-closes a task that would otherwise run" harm the
//   scope-lock explicitly warned against. Fixed: hasSubstantiveContent now
//   tracks fenced (```/~~~) and 4-space/tab-indented code blocks and treats
//   every line inside one as content unconditionally, never even consulting
//   isStructuralOnlyLine for it. See "P1: code-block exemption" below.
//
//   P2 (diagnosis lies): loadTaskSpec's structural-only null was
//   indistinguishable from "no section at all" to composeTaskContent, so the
//   operator notice said "No detailed spec section for <id>" even when a
//   section demonstrably existed and was correctly rejected — the same
//   misdiagnosis family this file's own header describes. Fixed via
//   `options.diagnostics` (SPEC_MISS_REASON). See "P2: diagnosable null
//   reason" below.
//
//   P3 (six more under-rejection shapes, lower risk than P1): an empty fenced
//   block, a borderless table separator (`--- | ---`), an empty checkbox
//   item (`- [ ]`), an HTML `<hr>`, a line holding only U+200B, and a bare
//   `|` all used to slip through as "content". See "P3: additional
//   structural-only shapes" below.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadTaskSpec, resolveDispatch, SPEC_MISS_REASON } from '../../cli/src/dispatch.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * @param {object} opts
 * @param {string|null} opts.tasklist  full leader-tasklist.md contents, or
 *   `null` to skip creating the file at all (P2's NO_TASKLIST_FILE case).
 * @param {string} [opts.brief]    T-1's queue.md Brief cell (default: non-empty,
 *   so loadTaskSpec's verdict alone determines accept/reject in most tests —
 *   individual tests override this to '' when they need the fail-closed path).
 */
function scaffold({ tasklist, brief = 'fallback brief so the Brief cell is never the reason for a null verdict' }) {
  const root = mkdtempSync(join(tmpdir(), 'hopper-structural-'));
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

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

// ─── under-rejection suite: every structural-only shape must return null ────
// otherTaskIds: ['T-1'] mirrors the real dispatch path (resolveDispatch always
// supplies every known id from queue.md; here T-1 is the only task).

const STRUCTURAL_ONLY_CASES = [
  ['horizontal rule ---', '---'],
  ['horizontal rule ***', '***'],
  ['horizontal rule ___', '___'],
  ['horizontal rule spaced - - -', '- - -'],
  ['horizontal rule spaced * * *', '* * *'],
  ['horizontal rule spaced _ _ _', '_ _ _'],
  ['table delimiter row |---|---|', '|---|---|'],
  ['table delimiter row with alignment | :--- | ---: |', '| :--- | ---: |'],
  ['table row, all cells empty | | |', '| | |'],
  ['table skeleton across two lines (delimiter + all-empty row)', '|---|---|\n| | |'],
  ['bare blockquote marker >', '>'],
  ['bare list marker -', '-'],
  ['bare list marker *', '*'],
  ['bare list marker +', '+'],
  ['bare list marker 1.', '1.'],
  ['blank lines / whitespace only', '\n   \n\t\n'],
  ['combination of several structural-only shapes', '---\n\n|---|---|\n\n>\n\n-\n'],
];

for (const [label, body] of STRUCTURAL_ONLY_CASES) {
  test(`under-rejection: ${label} -> loadTaskSpec returns null`, async () => {
    const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
    try {
      const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
      assert.equal(spec, null,
        `expected null for structural-only body ${JSON.stringify(body)}, got ${JSON.stringify(spec)}`);
    } finally { cleanup(root); }
  });
}

// ─── over-rejection suite (matters MORE): every legitimate shape below must ──
// ─── be ACCEPTED, with its content coming back intact ────────────────────────

test('over-rejection: a table with at least one data row with actual text is accepted', async () => {
  const body = [
    '| Name | Value |',
    '|------|-------|',
    '| foo | REAL_DATA_bar |',
  ].join('\n');
  const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null, 'a table with a real data row must be accepted');
    assert.match(spec, /REAL_DATA_bar/, 'the real cell content must come back intact');
    assert.match(spec, /\|------\|-------\|/, 'the delimiter row itself is untouched (verbatim return)');
  } finally { cleanup(root); }
});

test('over-rejection: prose plus a horizontal rule is accepted', async () => {
  const body = 'Real prose sentence describing the task.\n\n---\n';
  const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null, 'prose + a horizontal rule must be accepted');
    assert.match(spec, /Real prose sentence describing the task\./, 'the prose comes back intact');
  } finally { cleanup(root); }
});

test('over-rejection: a blockquote with actual text after `>` is accepted', async () => {
  const body = '> This is a real quoted requirement.';
  const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null, 'a blockquote with real text must be accepted');
    assert.match(spec, /> This is a real quoted requirement\./, 'the quoted text comes back intact');
  } finally { cleanup(root); }
});

test('over-rejection: list items that have text are accepted', async () => {
  const body = '- Item one with real text\n- Item two with real text';
  const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null, 'list items with real text must be accepted');
    assert.match(spec, /Item one with real text/, 'first item comes back intact');
    assert.match(spec, /Item two with real text/, 'second item comes back intact');
  } finally { cleanup(root); }
});

test('over-rejection: a single short sentence is accepted', async () => {
  const body = 'Fix the bug.';
  const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null, 'a single short sentence must be accepted');
    assert.match(spec, /Fix the bug\./, 'the sentence comes back intact');
  } finally { cleanup(root); }
});

test('over-rejection: a spec that is mostly structure but has one real sentence somewhere is accepted, and that sentence survives', async () => {
  const body = [
    '---',
    '',
    '|---|---|',
    '',
    '> ',
    '',
    'The one real sentence that actually says what to do.',
    '',
    '-',
    '',
    '***',
  ].join('\n');
  const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null, 'the section must be accepted once ANY line has real content');
    assert.match(spec, /The one real sentence that actually says what to do\./, 'the sentence survives verbatim');
  } finally { cleanup(root); }
});

// ─── end-to-end: resolveDispatch wiring, not just the loadTaskSpec unit ─────

test('end-to-end: resolveDispatch fail-closes when leader-tasklist body is structural-only AND queue.md Brief is empty (the exact reported reproduction shape)', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\n---\n', brief: '' });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.equal(spec, null, 'precondition: the structural-only body itself must be null');
    await assert.rejects(
      () => resolveDispatch({ hopperDir, taskId: 'T-1' }),
      /Task T-1 has no task content: queue\.md Brief is empty and no detailed spec was found/,
      'must fail closed instead of dispatching a horizontal-rule-only "spec"',
    );
  } finally { cleanup(root); }
});

test('end-to-end: resolveDispatch still succeeds and carries real content when leader-tasklist body mixes prose with structure', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\nReal spec content for T-1.\n\n---\n', brief: 'brief text' });
  try {
    const r = await resolveDispatch({ hopperDir, taskId: 'T-1' });
    assert.match(r.taskSpec, /Real spec content for T-1\./, 'the real content reaches resolveDispatch\'s taskSpec');
    assert.match(r.composedPrompt, /Real spec content for T-1\./, 'and the composed vendor prompt');
  } finally { cleanup(root); }
});

// ══════════════════════════════════════════════════════════════════════════
// REWORK (2026-08-13, same day) — see the file header for the three findings.
// ══════════════════════════════════════════════════════════════════════════

// ─── P1: code-block exemption (over-rejection — the red-line priority) ─────
// The exact three reproductions from the review, plus at least three more
// legitimate spec shapes containing code blocks (diff / markdown-table
// syntax / shell output), plus the tilde-fence variant and the "empty fenced
// block" corollary this same principle predicts.

test('P1 REWORK over-rejection: an indented (4-space) line showing a literal "---" is accepted, not judged a horizontal rule', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\n    ---\n' });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null, 'an indented code line must never be judged structural-only');
    assert.match(spec, /^ {4}---\s*$/m, 'the indented line survives verbatim, indentation included');
  } finally { cleanup(root); }
});

test('P1 REWORK over-rejection: a tab-indented line showing a literal "> " is accepted, not judged a bare blockquote marker', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\n\t> \n' });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null, 'a tab-indented code line must never be judged structural-only');
    assert.match(spec, /\t>/, 'the tab-indented line survives');
  } finally { cleanup(root); }
});

test('P1 REWORK over-rejection: an indented line showing a literal "| | |" is accepted, not judged an empty table row', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\n    | | |\n' });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null, 'an indented code line must never be judged structural-only');
    assert.match(spec, /^ {4}\| \| \|\s*$/m, 'the indented line survives verbatim');
  } finally { cleanup(root); }
});

test('P1 REWORK over-rejection: a fenced diff block is accepted even though its header lines look like horizontal rules', async () => {
  const body = [
    '```diff',
    '--- a/foo.txt',
    '+++ b/foo.txt',
    '@@ -1 +1 @@',
    '-old line',
    '+REAL_DIFF_MARKER new line',
    '```',
  ].join('\n');
  const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null, 'a fenced diff must be accepted, not evaluated line-by-line for structure');
    assert.match(spec, /REAL_DIFF_MARKER/, 'diff content survives verbatim');
    assert.match(spec, /--- a\/foo\.txt/, 'the diff header line survives, unevaluated as a horizontal rule');
  } finally { cleanup(root); }
});

test('P1 REWORK over-rejection: a fenced block showing markdown TABLE SYNTAX (delimiter + empty row) is accepted as literal example text', async () => {
  const body = [
    '```markdown',
    '| | |',
    '|---|---|',
    '```',
  ].join('\n');
  const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null,
      'fenced example markup — even shaped exactly like the structural-only cases above — must be accepted verbatim');
    assert.match(spec, /```markdown/, 'fence open marker survives');
    assert.match(spec, /\|---\|---\|/, 'inner content, unevaluated, survives');
  } finally { cleanup(root); }
});

test('P1 REWORK over-rejection: a fenced shell snippet whose only output line is a bare "-" is accepted', async () => {
  const body = ['```sh', '-', '```'].join('\n');
  const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null, 'a fenced shell line that LOOKS like a bare list marker must still be accepted');
    assert.match(spec, /```sh\n-\n```/, 'fenced content survives exactly, including the bare "-" line');
  } finally { cleanup(root); }
});

test('P1 REWORK over-rejection: a tilde-fenced (~~~) block is exempted the same way as a backtick fence', async () => {
  const body = ['~~~', '---', '~~~'].join('\n');
  const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null, 'tilde fences must exempt their content exactly like backtick fences do');
  } finally { cleanup(root); }
});

test('P1 REWORK corollary (under-rejection): an EMPTY fenced block (open immediately followed by close, zero lines between) is still rejected', async () => {
  const body = ['```', '```'].join('\n');
  const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.equal(spec, null,
      'a fence with nothing inside it still carries zero content — the exemption applies to lines INSIDE a fence, and there are none here');
  } finally { cleanup(root); }
});

test('P1 REWORK end-to-end: resolveDispatch delivers an indented literal "---" example to the vendor instead of fail-closing', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\n    ---\n', brief: '' });
  try {
    const r = await resolveDispatch({ hopperDir, taskId: 'T-1' });
    assert.match(r.taskSpec, /^ {4}---\s*$/m);
    assert.match(r.composedPrompt, /^ {4}---\s*$/m);
  } finally { cleanup(root); }
});

// ─── P3: additional structural-only shapes (under-rejection, lower risk) ───

const P3_STRUCTURAL_ONLY_CASES = [
  ['borderless table separator (--- | ---, no outer pipes)', '--- | ---'],
  ['borderless table separator, 3 columns, no spaces (-|-|-)', '-|-|-'],
  ['empty/unchecked checkbox item (- [ ])', '- [ ]'],
  ['checked-but-empty checkbox item (- [x])', '- [x]'],
  ['HTML <hr> tag', '<hr>'],
  ['HTML <hr/> tag (self-closed)', '<hr/>'],
  ['HTML <hr /> tag (spaced self-closed)', '<hr />'],
  ['line holding only U+200B (zero-width space)', '​'],
  ['line holding only U+200B twice', '​​'],
  ['bare single pipe (|)', '|'],
  ['bare double pipe (||)', '||'],
];

for (const [label, body] of P3_STRUCTURAL_ONLY_CASES) {
  test(`P3 REWORK under-rejection: ${label} -> loadTaskSpec returns null`, async () => {
    const { root, hopperDir } = scaffold({ tasklist: `## T-1\n\n${body}\n` });
    try {
      const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
      assert.equal(spec, null,
        `expected null for structural-only body ${JSON.stringify(body)}, got ${JSON.stringify(spec)}`);
    } finally { cleanup(root); }
  });
}

// P1's priority applies to P3 too: none of the new checks may over-reject.

test('P3 REWORK over-rejection control: a checkbox item WITH real text is accepted', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\n- [ ] REAL_TASK_TEXT do the thing\n' });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null);
    assert.match(spec, /REAL_TASK_TEXT/);
  } finally { cleanup(root); }
});

test('P3 REWORK over-rejection control: an <hr> tag followed by real prose is accepted', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\n<hr>\n\nREAL_PROSE_AFTER_HR sentence.\n' });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null);
    assert.match(spec, /REAL_PROSE_AFTER_HR/);
  } finally { cleanup(root); }
});

test('P3 REWORK over-rejection control: a zero-width space MIXED with real text on the same line is accepted (not misread as invisible-only)', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\nReal​content with real words.\n' });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null);
    assert.match(spec, /Real​content with real words\./);
  } finally { cleanup(root); }
});

test('P3 REWORK over-rejection control: a table row with a bare pipe in one cell but real text in another is accepted', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\n| REAL_CELL_TEXT | |\n' });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.notEqual(spec, null);
    assert.match(spec, /REAL_CELL_TEXT/);
  } finally { cleanup(root); }
});

// ─── P2: diagnosable null reason ────────────────────────────────────────────
// loadTaskSpec's null used to be a single undifferentiated signal. It now
// reports WHY via an optional out-param, and composeTaskContent/resolveDispatch
// must tell the operator the truth — in particular, never claim "no section"
// when a section demonstrably exists and was rejected on the merits.

test('P2 REWORK: diagnostics.reason is NO_TASKLIST_FILE when leader-tasklist.md does not exist at all', async () => {
  const { root, hopperDir } = scaffold({ tasklist: null });
  try {
    const diagnostics = {};
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'], diagnostics });
    assert.equal(spec, null);
    assert.equal(diagnostics.reason, SPEC_MISS_REASON.NO_TASKLIST_FILE);
  } finally { cleanup(root); }
});

test('P2 REWORK: diagnostics.reason is NO_SECTION when the file exists but has no section for this id', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-OTHER\n\nsomething unrelated\n' });
  try {
    const diagnostics = {};
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'], diagnostics });
    assert.equal(spec, null);
    assert.equal(diagnostics.reason, SPEC_MISS_REASON.NO_SECTION);
  } finally { cleanup(root); }
});

test('P2 REWORK: diagnostics.reason is STRUCTURAL_ONLY_BODY when a section matched but its body is structural-only', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\n---\n' });
  try {
    const diagnostics = {};
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'], diagnostics });
    assert.equal(spec, null);
    assert.equal(diagnostics.reason, SPEC_MISS_REASON.STRUCTURAL_ONLY_BODY);
  } finally { cleanup(root); }
});

test('P2 REWORK: diagnostics.reason is left untouched when a real spec is found (success path unaffected)', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\nReal content.\n' });
  try {
    const diagnostics = {};
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'], diagnostics });
    assert.notEqual(spec, null);
    assert.equal(diagnostics.reason, undefined, 'success path must not set a miss-reason');
  } finally { cleanup(root); }
});

test('P2 REWORK: loadTaskSpec works exactly as before when diagnostics is omitted (no new required argument)', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\n---\n' });
  try {
    const spec = await loadTaskSpec(hopperDir, 'T-1', { otherTaskIds: ['T-1'] });
    assert.equal(spec, null, 'omitting diagnostics must not change the return value');
  } finally { cleanup(root); }
});

test('P2 REWORK end-to-end: specNotice for a structural-only body says the section EXISTS, not "No detailed spec section"', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\n---\n', brief: 'brief text present' });
  try {
    const r = await resolveDispatch({ hopperDir, taskId: 'T-1' });
    assert.match(r.specNotice, /HAS a section for T-1/, 'notice must say the section exists');
    assert.doesNotMatch(r.specNotice, /No detailed spec section for T-1/,
      'must NOT reuse the "no section" wording — that would be false here, a section for T-1 does exist');
  } finally { cleanup(root); }
});

test('P2 REWORK end-to-end: specNotice for a genuinely MISSING section still uses the pre-existing "No detailed spec section" wording, byte-for-byte', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-OTHER\n\nnot ours\n', brief: 'brief text present' });
  try {
    const r = await resolveDispatch({ hopperDir, taskId: 'T-1' });
    assert.match(r.specNotice, /No detailed spec section for T-1 in leader-tasklist\.md; task content comes from queue\.md Brief\./,
      'the two PRE-EXISTING reasons keep their exact prior wording — only the new third reason gets new text');
  } finally { cleanup(root); }
});

test('P2 REWORK end-to-end: fail-closed throw for a structural-only body + empty brief says the section EXISTS, not "no section"', async () => {
  const { root, hopperDir } = scaffold({ tasklist: '## T-1\n\n---\n', brief: '' });
  try {
    await assert.rejects(
      () => resolveDispatch({ hopperDir, taskId: 'T-1' }),
      (err) => {
        assert.match(err.message, /a section for T-1 exists in/, 'throw text must say the section exists');
        assert.doesNotMatch(err.message, /no section for T-1 in/, 'must NOT reuse the "no section" wording');
        assert.match(err.message, /structural markdown/);
        return true;
      },
    );
  } finally { cleanup(root); }
});
