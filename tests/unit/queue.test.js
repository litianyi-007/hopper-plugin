// Unit tests for queue.js (T-PLUGIN-02)
// Anchor: tests/unit/queue.test.js
//
// Uses Node's built-in test runner (node 18+). No external deps.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseQueueContent, findEligibleTask, summarizeQueue, E_ROW_CELL_COUNT_MISMATCH, E_DUPLICATE_TASK_ID } from '../../cli/src/queue.js';

const SAMPLE_QUEUE_V2 = `
# Test queue

## Tasks

| ID | Task-type | Status | Depends | Priority | Brief |
|----|-----------|--------|---------|----------|-------|
| T-PLUGIN-00 | spec-blindspot-hunt | done | | high | Phase 0 spike |
| T-PLUGIN-01 | code-impl | pending | T-PLUGIN-00 | normal | Repo init |
| T-PLUGIN-02 | code-impl | in-progress | T-PLUGIN-01 | normal | Queue parser |
`;

const SAMPLE_QUEUE_V1_LEGACY = `
## Tasks

| ID | Role | Status | Depends | Brief |
|----|------|--------|---------|-------|
| T-OLD-01 | builder | done | | Old-school role-based task |
`;

test('parseQueueContent extracts v2 schema task rows', () => {
  const rows = parseQueueContent(SAMPLE_QUEUE_V2);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, 'T-PLUGIN-00');
  assert.equal(rows[0].taskType, 'spec-blindspot-hunt');
  assert.equal(rows[0].status, 'done');
  assert.equal(rows[1].id, 'T-PLUGIN-01');
  assert.equal(rows[1].status, 'pending');
  assert.deepEqual(rows[1].depends, ['T-PLUGIN-00']);
  assert.equal(rows[1].priority, 'normal');
});

test('parseQueueContent falls back to Role column if Task-type absent (v1 legacy)', () => {
  const rows = parseQueueContent(SAMPLE_QUEUE_V1_LEGACY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'T-OLD-01');
  assert.equal(rows[0].taskType, 'builder'); // Fell back to Role since no Task-type
});

test('parseQueueContent treats Task-type as canonical when both present', () => {
  const both = `
| ID | Task-type | Role | Status | Depends | Brief |
|----|-----------|------|--------|---------|-------|
| T-X | code-impl | builder | pending | | Both columns |
`;
  const rows = parseQueueContent(both);
  assert.equal(rows[0].taskType, 'code-impl', 'Task-type should win over Role');
});

test('parseQueueContent ignores non-table content', () => {
  const noisy = `
# Some heading

Random prose. Should be ignored.

| ID | Task-type | Status | Depends | Brief |
|----|-----------|--------|---------|-------|
| T-A | code-impl | pending | | test |

More prose afterward.

## Activity log

- some log entry
`;
  const rows = parseQueueContent(noisy);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'T-A');
});

test('parseQueueContent defaults priority to normal if missing', () => {
  const noPrio = `
| ID | Task-type | Status | Depends | Brief |
|----|-----------|--------|---------|-------|
| T-A | code-impl | pending | | test |
`;
  const rows = parseQueueContent(noPrio);
  assert.equal(rows[0].priority, 'normal');
});

test('parseQueueContent parses comma-separated dependencies', () => {
  const q = `
| ID | Task-type | Status | Depends | Brief |
|----|-----------|--------|---------|-------|
| T-A | code-impl | pending | T-B, T-C, T-D | test |
`;
  const rows = parseQueueContent(q);
  assert.deepEqual(rows[0].depends, ['T-B', 'T-C', 'T-D']);
});

test('findEligibleTask returns task when pending + deps done', () => {
  const rows = parseQueueContent(SAMPLE_QUEUE_V2);
  const { task, reason } = findEligibleTask(rows, 'T-PLUGIN-01');
  assert.ok(task);
  assert.equal(task.id, 'T-PLUGIN-01');
  assert.equal(reason, null);
});

test('findEligibleTask rejects non-pending status', () => {
  const rows = parseQueueContent(SAMPLE_QUEUE_V2);
  const { task, reason } = findEligibleTask(rows, 'T-PLUGIN-00');
  assert.equal(task, null);
  assert.match(reason, /status is 'done'/);
});

test('findEligibleTask rejects in-progress status', () => {
  const rows = parseQueueContent(SAMPLE_QUEUE_V2);
  const { task, reason } = findEligibleTask(rows, 'T-PLUGIN-02');
  assert.equal(task, null);
  assert.match(reason, /status is 'in-progress'/);
});

test('findEligibleTask rejects when dep not done', () => {
  const q = `
| ID | Task-type | Status | Depends | Brief |
|----|-----------|--------|---------|-------|
| T-A | code-impl | pending | | A |
| T-B | code-impl | pending | T-A | B |
`;
  const rows = parseQueueContent(q);
  const { task, reason } = findEligibleTask(rows, 'T-B');
  assert.equal(task, null);
  assert.match(reason, /dependency T-A status is 'pending'/);
});

test('findEligibleTask returns clear error for unknown task', () => {
  const rows = parseQueueContent(SAMPLE_QUEUE_V2);
  const { task, reason } = findEligibleTask(rows, 'T-NONEXISTENT');
  assert.equal(task, null);
  assert.match(reason, /not found in queue/);
});

test('summarizeQueue counts by status', () => {
  const rows = parseQueueContent(SAMPLE_QUEUE_V2);
  const s = summarizeQueue(rows);
  assert.equal(s.total, 3);
  assert.equal(s.done, 1);
  assert.equal(s.pending, 1);
  assert.equal(s['in-progress'], 1);
});

test('parseQueueContent reads an optional Govern column', () => {
  const md = `
| ID | Task-type | Status | Govern |
|----|-----------|--------|--------|
| T-1 | code-impl | pending | off |
| T-2 | code-impl | pending |  |
`;
  const rows = parseQueueContent(md);
  assert.equal(rows[0].govern, 'off');
  assert.equal(rows[1].govern, null);
});

test('parseQueueContent leaves govern null when the column is absent', () => {
  const md = `
| ID | Task-type | Status |
|----|-----------|--------|
| T-1 | code-impl | pending |
`;
  assert.equal(parseQueueContent(md)[0].govern, null);
});

// --- queue-brief-truncated-by-unescaped-pipe (docs/archive/ISSUES.md) ---
//
// cells[map.briefIdx] / cells[map.vendorIdx] used to be read purely by index,
// with no check that a row actually split into as many cells as the header
// declares. A literal '|' inside the Brief cell shifted every column after
// it, silently truncating the brief and misassigning Vendor — with NO error,
// because the shifted-in token often happened to be an approved vendor name.
// These tests pin the fail-closed cell-count guard that replaces that
// silent-indexing behavior.

const QUEUE_HEADER = '| ID | Task-type | Status | Depends | Priority | Brief | Vendor |';
const QUEUE_SEP = '|----|-----------|--------|---------|----------|-------|--------|';

test('parseQueueContent rejects (fail-closed) a row whose unescaped Brief pipe produces extra cells, instead of silently truncating the brief and shifting Vendor', () => {
  // Exact repro from the issue: brief="前半段任务" vendor="codex" used to come
  // out with NO error and the tail silently dropped. It must now throw.
  const badRow = '| T-C | code-review-adversarial | pending | | high | 前半段任务 | codex | 后半段被吃掉的关键要求 |';
  const content = `${QUEUE_HEADER}\n${QUEUE_SEP}\n${badRow}\n`;

  let caught = null;
  let rows = null;
  try {
    rows = parseQueueContent(content);
  } catch (err) {
    caught = err;
  }

  assert.equal(rows, null, 'must not return a parsed rows array for a mismatched row');
  assert.ok(caught, 'must throw instead of silently indexing into the shifted row');
  assert.equal(caught.code, E_ROW_CELL_COUNT_MISMATCH);
  assert.match(caught.message, /8 cell\(s\)/, 'error must state the actual (wrong) cell count');
  assert.match(caught.message, /7 column\(s\)/, 'error must state the header-declared column count');
  // Guard against the exact old silent-truncation symptom re-appearing under
  // a different code path: the old (defective) behavior produced this pair.
  assert.notDeepEqual(
    rows && rows[0] && { brief: rows[0].brief, vendor: rows[0].vendor },
    { brief: '前半段任务', vendor: 'codex' }
  );
});

test('parseQueueContent error message does not instruct an escape mechanism the parser fails to honor', () => {
  // Design constraint: if the error tells the user to escape '|' as '\|',
  // parseRowCells() must actually treat '\|' as literal — otherwise this is
  // exactly the "lying message" failure family the issue belongs to.
  const badRow = '| T-C | code-impl | pending | | high | a | b | c |';
  const content = `${QUEUE_HEADER}\n${QUEUE_SEP}\n${badRow}\n`;
  assert.throws(() => parseQueueContent(content), (err) => {
    assert.match(err.message, /\\\|/, 'message must mention the \\| escape it claims to support');
    return true;
  });
  // The other half of the constraint (that \| really is honored) is proven
  // by the round-trip test below.
});

test('parseQueueContent still parses a normal row with no pipes in the Brief identically to before (no over-rejection)', () => {
  const goodRow = '| T-A | code-impl | pending | | normal | plain brief text, no literal pipes here | codex |';
  const content = `${QUEUE_HEADER}\n${QUEUE_SEP}\n${goodRow}\n`;
  const rows = parseQueueContent(content);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'T-A');
  assert.equal(rows[0].brief, 'plain brief text, no literal pipes here');
  assert.equal(rows[0].vendor, 'codex');
});

test('parseQueueContent unescapes \\| to a literal pipe inside a cell, round-tripping the FULL text (including what used to be truncated)', () => {
  const escRow = '| T-B | code-impl | pending | | normal | 前半段任务 \\| 后半段仍完整保留的关键要求 | codex |';
  const content = `${QUEUE_HEADER}\n${QUEUE_SEP}\n${escRow}\n`;
  const rows = parseQueueContent(content);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].brief, '前半段任务 | 后半段仍完整保留的关键要求');
  assert.equal(rows[0].vendor, 'codex');
});

test('parseQueueContent rejects a row with FEWER cells than the header declares (missing column, not just an extra one)', () => {
  // Six cells where the header declares seven (Depends column dropped) — the
  // same guard must also catch under-count, not just over-count from a pipe.
  const shortRow = '| T-C | code-impl | pending | normal | short row missing a column | codex |';
  const content = `${QUEUE_HEADER}\n${QUEUE_SEP}\n${shortRow}\n`;
  assert.throws(() => parseQueueContent(content), (err) => {
    assert.equal(err.code, E_ROW_CELL_COUNT_MISMATCH);
    assert.match(err.message, /6 cell\(s\)/);
    assert.match(err.message, /7 column\(s\)/);
    return true;
  });
});

// --- REWORK 2026-08-13 (code-review-adversarial verdict, user-ruled Plan A) ---
//
// The first pass (above) required exact cell-count equality but that alone
// surfaced three further problems once tested against this repo's OWN
// tests/integration/ fixture and duplicate-ID paths:
//
//   1. It broke every real row that used the previously-legitimate shorthand
//      of omitting an optional trailing column (e.g. no Vendor override) —
//      .hopper/queue.md ships 18 such rows and the whole file failed to parse.
//   2. Naively "fixing" #1 by allowing an omitted TRAILING column reopens the
//      original defect: a row genuinely one cell short, plus one stray
//      unescaped '|' anywhere in it, can reassemble into exactly the header's
//      cell count and sail through silently mis-columned. This is why the
//      user ruled Plan A (mandatory equal width, no leniency at all) instead
//      of Plan B (allow trailing omission) — see CHANGELOG [0.56.0] Fixed².
//   3. A fully content-free row (`| |`) and a fully content-free row with the
//      "right" number of pipes (`| | | | | | | |`) were treated inconsistently
//      — one threw, one was silently ignored — for no reason other than pipe
//      count. Both carry zero data, so both must be treated the same way.
//   4. Two rows reusing the same task ID were accepted, with findEligibleTask's
//      Array.find() silently returning only the first — the second row (and
//      whatever it was meant to override) was unreachable with no error.

test('parseQueueContent now REJECTS the previously-legitimate shorthand of omitting a trailing optional column (mandatory equal width, BREAKING)', () => {
  // 6 cells, no Vendor column at all — this used to parse fine (vendor: null).
  // Plan A makes this illegal: the omission must be an explicit empty cell.
  const omittedVendorRow = '| T-C | code-impl | pending | | normal | brief with no vendor column at all |';
  const content = `${QUEUE_HEADER}\n${QUEUE_SEP}\n${omittedVendorRow}\n`;
  assert.throws(() => parseQueueContent(content), (err) => {
    assert.equal(err.code, E_ROW_CELL_COUNT_MISMATCH);
    assert.match(err.message, /6 cell\(s\)/);
    assert.match(err.message, /7 column\(s\)/);
    return true;
  }, 'omitting the trailing Vendor column must now be a loud parse error, not a silent null');
});

test('parseQueueContent still accepts the same row once the omitted trailing column is written as an explicit empty cell (the required migration)', () => {
  const explicitEmptyVendorRow = '| T-C | code-impl | pending | | normal | brief with an explicit empty vendor cell | |';
  const content = `${QUEUE_HEADER}\n${QUEUE_SEP}\n${explicitEmptyVendorRow}\n`;
  const rows = parseQueueContent(content);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].vendor, null);
  assert.equal(rows[0].brief, 'brief with an explicit empty vendor cell');
});

test('parseQueueContent skips a fully-empty row (all cells blank) BEFORE the cell-count guard, regardless of how many pipes it has', () => {
  // Both shapes carry zero data. Neither should throw, and neither should
  // produce a row — matching the old pre-guard behavior for content-free
  // lines (extractRow's `if (!id) return null`), just applied consistently.
  const sparse = '| |'; // 1 empty cell — wildly short of the 7-column header
  const fullWidth = '| | | | | | | |'; // 7 empty cells — exactly matches the header
  const goodRow = '| T-A | code-impl | pending | | normal | a real row so the table stays open | |';
  const content = `${QUEUE_HEADER}\n${QUEUE_SEP}\n${goodRow}\n${sparse}\n${fullWidth}\n`;
  const rows = parseQueueContent(content);
  assert.equal(rows.length, 1, 'only the one real row should come out; both blank rows must be silently skipped');
  assert.equal(rows[0].id, 'T-A');
});

test('parseQueueContent does NOT extend the fully-empty exemption to a row with SOME content but the wrong cell count (no auto-padding)', () => {
  // A row with a couple of real cells but the wrong total count is a genuine
  // structural error, not "no data" — it must still throw. The exemption is
  // narrowly for ALL cells empty, not "mostly empty".
  const partial = '| T-Z | code-impl |'; // 2 cells, header wants 7 — NOT all-empty
  const content = `${QUEUE_HEADER}\n${QUEUE_SEP}\n${partial}\n`;
  assert.throws(() => parseQueueContent(content), (err) => {
    assert.equal(err.code, E_ROW_CELL_COUNT_MISMATCH);
    return true;
  }, 'a partially-filled row must still fail closed, not be treated as exempt');
});

test('parseQueueContent rejects (fail-closed) two data rows that declare the same task ID', () => {
  const first = '| T-DUP | code-impl | done | | normal | first (correct) row | |';
  const second = '| T-DUP | code-impl | pending | | normal | second row reusing the same ID | |';
  const content = `${QUEUE_HEADER}\n${QUEUE_SEP}\n${first}\n${second}\n`;
  assert.throws(() => parseQueueContent(content), (err) => {
    assert.equal(err.code, E_DUPLICATE_TASK_ID);
    assert.match(err.message, /T-DUP/);
    assert.match(err.message, /line 3/, 'must cite the first occurrence\'s line number');
    assert.match(err.message, /line 4/, 'must cite the second occurrence\'s line number');
    return true;
  });
});

test('parseQueueContent accepts distinct task IDs that merely share a prefix (duplicate-ID guard is exact-match, not prefix-match)', () => {
  const a = '| T-1 | code-impl | done | | normal | first task | |';
  const b = '| T-10 | code-impl | pending | | normal | unrelated task, just shares a text prefix with T-1 | |';
  const content = `${QUEUE_HEADER}\n${QUEUE_SEP}\n${a}\n${b}\n`;
  const rows = parseQueueContent(content);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id), ['T-1', 'T-10']);
});
