// Queue parser (T-PLUGIN-02)
// Anchor: cli/src/queue.js
//
// Parses .hopper/queue.md v2 schema (Task-type column primary; Role column
// optional for backwards-compat with myWriteAssistant lineage projects).
//
// Per spec §3 #5 + USAGE-GUIDE §3.4: Task-type is the canonical routing key.

import { readFile } from 'node:fs/promises';

/**
 * Parse a .hopper/queue.md file.
 *
 * @param {string} filePath
 * @returns {Promise<import('./types.js').TaskRow[]>}
 */
export async function parseQueue(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return parseQueueContent(content);
}

/**
 * Parse queue content directly (separated for testing without filesystem).
 *
 * @param {string} content
 * @returns {import('./types.js').TaskRow[]}
 */
export function parseQueueContent(content) {
  const lines = content.split(/\r?\n/);
  const rows = [];

  // Find the table — locate header row containing "Task-type" column
  let inTable = false;
  let columnMap = null;
  let pastSeparator = false;
  // id -> line number of first occurrence, for the duplicate-ID guard below
  // (E_DUPLICATE_TASK_ID). Scoped to the whole parse, not per-table: a
  // duplicate ID is a defect wherever it appears in the file.
  const seenIds = new Map();

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    const line = rawLine.trim();
    if (!line.startsWith('|')) {
      // Exiting table or pre-table content
      if (inTable && pastSeparator) {
        inTable = false;
        columnMap = null;
        pastSeparator = false;
      }
      continue;
    }

    // Inside a markdown table row
    const cells = parseRowCells(line);

    if (columnMap == null) {
      // First | row = column headers
      columnMap = mapColumns(cells);
      if (columnMap.taskTypeIdx == null && columnMap.roleIdx == null) {
        // Not a queue table; reset
        columnMap = null;
        continue;
      }
      // Number of columns the header declares. Every data row below is
      // required to split into exactly this many cells — see the
      // cell-count guard below for why (E_ROW_CELL_COUNT_MISMATCH).
      columnMap.cellCount = cells.length;
      inTable = true;
      continue;
    }

    if (!pastSeparator) {
      // Should be the |---|---|... separator row
      if (cells.every((c) => /^:?-+:?$/.test(c.trim()))) {
        pastSeparator = true;
      }
      continue;
    }

    // Data row.
    //
    // Fully-empty-row exemption (REWORK, 2026-08-13): a row where every cell
    // is the empty string carries no data at all — an accidental blank
    // spacer line like `| |` or a fully-blank `| | | | | | | |`. The old
    // (pre-guard) code tolerated both uniformly, via extractRow()'s
    // `if (!id) return null`. The cell-count guard below must not reintroduce
    // an asymmetry where one shape of "no data" throws and another is
    // silently ignored purely because it happens to contain the "right"
    // number of pipes — so this exemption is checked, and rows are skipped,
    // BEFORE the cell-count guard, regardless of cell count. Deliberately
    // narrow: only ALL-empty rows are exempted. A row with SOME content but
    // the wrong cell count still throws — there is no reliable way to tell
    // "trailing column omitted" from "middle column omitted", so a partial
    // row is never auto-padded.
    if (cells.every((c) => c === '')) {
      continue;
    }

    // Fail-closed cell-count guard (queue-brief-truncated-by-unescaped-pipe,
    // docs/archive/ISSUES.md): extractRow() below reads cells purely BY INDEX
    // (cells[map.briefIdx], cells[map.vendorIdx], ...). A literal '|' inside
    // a cell — most commonly the Brief — used to split that row into extra
    // cells and silently shift every column after it: the tail of the Brief
    // (and whatever came after it) got dropped with no error, and dispatch
    // proceeded on the truncated text. Refuse to index into a row whose cell
    // count doesn't match the header's declared column count instead of
    // guessing which cells are "real".
    //
    // MANDATORY EQUAL WIDTH (REWORK, 2026-08-13, BREAKING): every data row
    // must split into EXACTLY as many cells as the header declares — trailing
    // optional columns (e.g. Vendor) may no longer be omitted; an omitted
    // column must be written as an explicit empty cell instead. This is
    // deliberate, not an oversight: allowing an omitted trailing column would
    // let a row that was WRITTEN as N-1 cells but happens to contain one
    // stray unescaped '|' in its Brief silently reassemble into exactly N
    // cells — the omission and the accidental split cancel each other out in
    // the COUNT while still shifting every field after the pipe. Requiring
    // exact equality with no leniency closes that off: there is no cell count
    // that is simultaneously "one short" and "matches", so this collision
    // cannot produce a silently-accepted row.
    if (cells.length !== columnMap.cellCount) {
      const err = new Error(
        `${E_ROW_CELL_COUNT_MISMATCH}: queue.md row at line ${lineNo} has ${cells.length} ` +
        `cell(s) but the header declares ${columnMap.cellCount} column(s): ${line}\n` +
        `A literal '|' inside a cell (e.g. Brief) must be escaped as \\| — parseRowCells() ` +
        `honors \\| as a literal pipe character, not a column separator. Optional trailing ` +
        `columns (e.g. Vendor) must be written as an explicit empty cell, not omitted. ` +
        `Escape/pad and re-run; refusing to guess which cells are which.`
      );
      err.code = E_ROW_CELL_COUNT_MISMATCH;
      throw err;
    }

    const row = extractRow(cells, columnMap);
    if (row) {
      // Duplicate-ID guard (REWORK, 2026-08-13): findEligibleTask() (below)
      // and every other consumer key off task.id via Array.find(), which
      // silently returns the FIRST match. A second row reusing an already-
      // seen ID would never be reachable — dispatch would act on stale/wrong
      // task data with no indication the row it actually wanted was shadowed.
      // Same family as the cell-count guard above: fail closed at parse time
      // instead of letting a downstream `.find()` paper over it.
      if (seenIds.has(row.id)) {
        const err = new Error(
          `${E_DUPLICATE_TASK_ID}: task ID '${row.id}' appears more than once in queue.md ` +
          `(line ${seenIds.get(row.id)} and line ${lineNo}). Each task ID must be unique — ` +
          `duplicate IDs make findEligibleTask()'s Array.find() silently pick the first row ` +
          `and ignore the rest. Rename or remove one of the two rows.`
        );
        err.code = E_DUPLICATE_TASK_ID;
        throw err;
      }
      seenIds.set(row.id, lineNo);
      rows.push(row);
    }
  }

  return rows;
}

/** Error code: a queue.md data row's cell count doesn't match the header's declared column count. */
export const E_ROW_CELL_COUNT_MISMATCH = 'E_ROW_CELL_COUNT_MISMATCH';
/** Error code: two queue.md data rows declare the same task ID. */
export const E_DUPLICATE_TASK_ID = 'E_DUPLICATE_TASK_ID';

function parseRowCells(line) {
  // Remove leading and trailing pipes, then split on '|', except a
  // backslash-escaped pipe ('\|') which is honored as a literal '|'
  // character and does NOT start a new cell (see E_ROW_CELL_COUNT_MISMATCH
  // above — this is the half of the fix that makes the guard's own error
  // message true: it tells the caller to escape with \|, so this parser
  // must actually treat \| as a literal pipe rather than lying about it).
  // Markdown table syntax: | a | b | c |
  const trimmed = line.replace(/^\|/, '').replace(/\|\s*$/, '');
  const cells = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i++; // consume the escaped pipe too
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function mapColumns(headerCells) {
  const lower = headerCells.map((c) => c.toLowerCase());
  return {
    idIdx: indexOfAny(lower, ['id', 'task id', 'task-id']),
    taskTypeIdx: indexOfAny(lower, ['task-type', 'task_type', 'tasktype', 'type']),
    roleIdx: indexOfAny(lower, ['role']),
    statusIdx: indexOfAny(lower, ['status']),
    dependsIdx: indexOfAny(lower, ['depends', 'dependencies', 'deps']),
    priorityIdx: indexOfAny(lower, ['priority']),
    briefIdx: indexOfAny(lower, ['brief', 'summary', 'description']),
    vendorIdx: indexOfAny(lower, ['vendor']),
    governIdx: indexOfAny(lower, ['govern', 'governance']),
  };
}

function indexOfAny(arr, candidates) {
  for (const cand of candidates) {
    const idx = arr.indexOf(cand);
    if (idx !== -1) return idx;
  }
  return null;
}

function extractRow(cells, map) {
  const id = map.idIdx != null ? stripBackticks(cells[map.idIdx]) : null;
  if (!id) return null;

  const taskType = map.taskTypeIdx != null ? stripBackticks(cells[map.taskTypeIdx]) : null;
  const role = map.roleIdx != null ? stripBackticks(cells[map.roleIdx]) : null;

  // Per USAGE-GUIDE §3.4: Task-type is the primary routing key.
  // Role is decorative (legacy). If both present, Task-type wins.
  const effectiveType = taskType || role || 'unknown';

  // Per codex final strict audit P1 (Category A): previously unknown statuses
  // silently mapped to 'pending', which re-eligibilizes failed tasks. We now
  // preserve unknown status verbatim and surface it as 'unknown' for the
  // caller; findEligibleTask only treats 'pending' as eligible. A row with
  // illegal status will fail eligibility check rather than silently re-run.
  const rawStatus = map.statusIdx != null ? cells[map.statusIdx].toLowerCase() : 'pending';
  const validStatuses = ['pending', 'in-progress', 'done', 'failed', 'removed'];
  const finalStatus = validStatuses.includes(rawStatus) ? rawStatus : `unknown:${rawStatus}`;

  const dependsRaw = map.dependsIdx != null ? cells[map.dependsIdx] : '';
  const depends = dependsRaw
    .split(',')
    .map((d) => stripBackticks(d.trim()))
    .filter(Boolean);

  const priorityRaw = map.priorityIdx != null ? cells[map.priorityIdx].toLowerCase() : 'normal';
  const validPriorities = ['high', 'normal', 'low'];
  const priority = validPriorities.includes(priorityRaw) ? priorityRaw : 'normal';

  const brief = map.briefIdx != null ? cells[map.briefIdx] : '';
  const vendor = map.vendorIdx != null && cells[map.vendorIdx] ? stripBackticks(cells[map.vendorIdx]) : null;
  const govern = map.governIdx != null && cells[map.governIdx] ? stripBackticks(cells[map.governIdx]) : null;

  return { id, taskType: effectiveType, status: finalStatus, depends, priority, brief, vendor, govern };
}

function stripBackticks(s) {
  if (!s) return s;
  return s.replace(/^`/, '').replace(/`$/, '').trim();
}

/**
 * Find a task by ID; validate it's eligible to dispatch (pending + deps done).
 *
 * @param {import('./types.js').TaskRow[]} tasks
 * @param {string} taskId
 * @returns {{ task: import('./types.js').TaskRow | null, reason: string|null }}
 */
export function findEligibleTask(tasks, taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    return { task: null, reason: `task ${taskId} not found in queue.md` };
  }
  if (task.status !== 'pending') {
    return { task: null, reason: `task ${taskId} status is '${task.status}', expected 'pending'` };
  }
  for (const depId of task.depends) {
    const dep = tasks.find((t) => t.id === depId);
    if (!dep) {
      return { task: null, reason: `dependency ${depId} not found in queue.md` };
    }
    if (dep.status !== 'done') {
      return { task: null, reason: `dependency ${depId} status is '${dep.status}', expected 'done'` };
    }
  }
  return { task, reason: null };
}

/**
 * Summarize queue by status (for --status command).
 *
 * @param {import('./types.js').TaskRow[]} tasks
 */
export function summarizeQueue(tasks) {
  const counts = { pending: 0, 'in-progress': 0, done: 0, failed: 0, removed: 0 };
  for (const t of tasks) {
    if (counts[t.status] != null) counts[t.status]++;
  }
  return { total: tasks.length, ...counts };
}
