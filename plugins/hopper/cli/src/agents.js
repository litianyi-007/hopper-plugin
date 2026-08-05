// AGENTS.md parser + vendor router (T-PLUGIN-04)
// Anchor: cli/src/agents.js
//
// Per spec §3 #4 + codex F1: routing is a PURE FUNCTION of (taskType, agents).
// NO memoization across dispatches. NO retry-aware vendor selection.
// NO round-robin. NO load-balance state. Deterministic static lookup ONLY.

import { readFile } from 'node:fs/promises';

/**
 * Parse a .hopper/AGENTS.md file.
 *
 * @param {string} filePath
 * @returns {Promise<{ agents: import('./types.js').AgentBinding[], preferences: Record<string, string> }>}
 */
export async function parseAgentsFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return parseAgentsContent(content);
}

/**
 * Parse AGENTS content directly (for testing).
 *
 * @param {string} content
 * @returns {{ agents: import('./types.js').AgentBinding[], preferences: Record<string, string> }}
 */
export function parseAgentsContent(content) {
  const lines = content.split(/\r?\n/);
  const agents = [];
  const preferences = {};
  // Batch 2 (2026-07): raw Effort policy / Model rule cells per task-type, keyed
  // the same as `preferences`. Captured independently of vendor-binding status
  // (a row can have a policy cell filled in even while its vendor is still
  // `(bind per project)`) — additive, does not change `preferences` semantics.
  const policies = {};
  // Batch 3 (2026-07-31, TH-approved-vendors): project-level vendor whitelist,
  // independent of routing (agents/preferences above decide WHICH vendor a
  // task-type prefers; this decides whether that vendor may be dispatched to
  // AT ALL in this project). `present` tracks whether the "## Approved
  // Vendors" header itself was seen — kept separate from `list` being empty
  // so assertVendorApproved can distinguish "section missing" (fail-closed,
  // distinct error) from "section present but this vendor has no row / is
  // not yes" (also rejected, different error+message).
  const approvedVendorsList = [];
  let approvedVendorsSeen = false;

  // Sections of interest:
  // 1. "Active Agent Instances" table — nickname → vendor binding
  // 2. "Task-type → vendor default preference" table — task-type → vendor
  //    (+ optional Effort policy / Model rule columns, batch 2)
  // 3. "Approved Vendors" table — project vendor whitelist (batch 3)

  let currentSection = null;     // 'agents' | 'preferences' | 'approvedVendors' | null
  let inTable = false;
  let columnMap = null;
  let pastSeparator = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Detect section headers
    if (/^##\s+/.test(line)) {
      currentSection = null;
      inTable = false;
      columnMap = null;
      pastSeparator = false;
      if (/active agent instances/i.test(line)) currentSection = 'agents';
      else if (/task-type.*vendor.*preference|task-type.*preference|vendor default preference/i.test(line)) currentSection = 'preferences';
      else if (/approved vendors/i.test(line)) {
        currentSection = 'approvedVendors';
        approvedVendorsSeen = true;
      }
      continue;
    }

    if (!currentSection || !line.startsWith('|')) {
      if (inTable && pastSeparator) {
        inTable = false;
        columnMap = null;
        pastSeparator = false;
      }
      continue;
    }

    const cells = parseRowCells(line);

    if (columnMap == null) {
      columnMap = mapColumns(cells, currentSection);
      if (columnMap == null) continue;
      inTable = true;
      continue;
    }

    if (!pastSeparator) {
      if (cells.every((c) => /^:?-+:?$/.test(c.trim()))) {
        pastSeparator = true;
      }
      continue;
    }

    if (currentSection === 'agents') {
      const binding = extractAgentRow(cells, columnMap);
      if (binding) agents.push(binding);
    } else if (currentSection === 'preferences') {
      const pref = extractPreferenceRow(cells, columnMap);
      if (pref) {
        const { taskType, vendor, effortPolicyRaw, modelRuleRaw } = pref;
        // First non-null wins (deterministic, per codex F1 — no round-robin)
        if (vendor && !preferences[taskType]) preferences[taskType] = vendor;
        // Policy cells are captured regardless of whether the vendor column is
        // bound yet — a project may fill in Effort policy / Model rule before
        // picking a vendor, and the setup lint (batch 2) needs to see that.
        if (!policies[taskType]) policies[taskType] = { effortPolicy: effortPolicyRaw, modelRule: modelRuleRaw };
      }
    } else if (currentSection === 'approvedVendors') {
      const row = extractApprovedVendorRow(cells, columnMap);
      if (row) approvedVendorsList.push(row);
    }
  }

  return {
    agents,
    preferences,
    policies,
    approvedVendors: { present: approvedVendorsSeen, list: approvedVendorsList },
  };
}

function parseRowCells(line) {
  const trimmed = line.replace(/^\|/, '').replace(/\|\s*$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function mapColumns(cells, section) {
  const lower = cells.map((c) => c.toLowerCase());
  if (section === 'agents') {
    const map = {
      nicknameIdx: indexOfAny(lower, ['nickname']),
      uuidIdx: indexOfAny(lower, ['uuid']),
      vendorIdx: indexOfAny(lower, ['vendor', 'cli', 'vendor (cli)']),
      prefIdx: indexOfAny(lower, ['task-vendor-preference', 'task-type preference', 'default invocation', 'preference']),
    };
    if (map.nicknameIdx == null || map.vendorIdx == null) return null;
    return map;
  }
  if (section === 'preferences') {
    const map = {
      taskTypeIdx: indexOfAny(lower, ['task-type', 'task type']),
      vendorIdx: indexOfAny(lower, ['default vendor', 'vendor', 'preferred vendor']),
      // Batch 2: optional columns — older/scaffolded-before-batch-2 AGENTS.md
      // files simply won't have them (indexOfAny returns null, handled below).
      effortPolicyIdx: indexOfAny(lower, ['effort policy']),
      modelRuleIdx: indexOfAny(lower, ['model rule']),
    };
    if (map.taskTypeIdx == null || map.vendorIdx == null) return null;
    return map;
  }
  if (section === 'approvedVendors') {
    const map = {
      vendorIdx: indexOfAny(lower, ['vendor']),
      approvedIdx: indexOfAny(lower, ['approved']),
      // Optional columns — a minimal 2-column table (Vendor | Approved) is legal.
      approvedByIdx: indexOfAny(lower, ['approved by']),
      dateIdx: indexOfAny(lower, ['date']),
      notesIdx: indexOfAny(lower, ['scope / notes', 'scope/notes', 'notes', 'scope']),
    };
    if (map.vendorIdx == null || map.approvedIdx == null) return null;
    return map;
  }
  return null;
}

function indexOfAny(arr, candidates) {
  for (const cand of candidates) {
    const idx = arr.indexOf(cand);
    if (idx !== -1) return idx;
  }
  return null;
}

function extractAgentRow(cells, map) {
  const nickname = stripBackticks(cells[map.nicknameIdx]);
  if (!nickname) return null;
  const uuid = map.uuidIdx != null ? stripBackticks(cells[map.uuidIdx]) : '';
  // First token = CLI name; normalize to adapter ID (strip -cli/-CLI suffix
  // so "codex-cli (gpt-5.5-xhigh)" → "codex" matching cli/src/vendors/codex.js)
  // Per codex Phase 1 audit F2 fix.
  let vendor = stripBackticks(cells[map.vendorIdx]).split(/\s+/)[0];
  vendor = vendor.replace(/-cli$/i, '').replace(/_cli$/i, '');
  const prefRaw = map.prefIdx != null ? cells[map.prefIdx] : '';
  const taskTypePref = prefRaw
    .split(',')
    .map((s) => stripBackticks(s.trim()))
    .filter(Boolean);
  return { nickname, uuid, vendor, taskTypePref };
}

function extractPreferenceRow(cells, map) {
  const taskType = stripBackticks(cells[map.taskTypeIdx]);
  if (!taskType) return null;
  const vendorCell = cells[map.vendorIdx] || '';
  const effortPolicyRaw = map.effortPolicyIdx != null ? (cells[map.effortPolicyIdx] || '') : '';
  const modelRuleRaw = map.modelRuleIdx != null ? (cells[map.modelRuleIdx] || '') : '';
  // Skip OOB markers: cells that START with parens are notes, not bindings.
  // e.g. "(Strategy invokes OOB /codex)" means this task-type is handled
  // out-of-band, NOT dispatched through queue.md to a vendor. Unlike before
  // batch 2, this no longer short-circuits the WHOLE row — the policy cells
  // (Effort policy / Model rule) may still be filled in and are worth
  // returning even when the vendor itself is still unbound.
  let vendor = null;
  if (!/^\s*\(/.test(vendorCell)) {
    // Vendor cell may have annotations: "kimi-builder *(static default — codex F1)*"
    // Match first nickname-shaped token (lowercase-starting alphanumeric + hyphens)
    const match = vendorCell.match(/`?([a-z][\w-]+)`?/);
    if (match) vendor = stripBackticks(match[1]);
  }
  return { taskType, vendor, effortPolicyRaw, modelRuleRaw };
}

function stripBackticks(s) {
  if (!s) return s;
  return s.replace(/^`/, '').replace(/`$/, '').trim();
}

function extractApprovedVendorRow(cells, map) {
  const vendorCell = stripBackticks(cells[map.vendorIdx] || '');
  const vendor = vendorCell.split(/\s+/)[0].toLowerCase();
  if (!vendor) return null;
  const approvedRaw = cells[map.approvedIdx] || '';
  const approved = parseApprovedCell(approvedRaw);
  const approvedBy = map.approvedByIdx != null ? stripBackticks(cells[map.approvedByIdx]) : '';
  const date = map.dateIdx != null ? stripBackticks(cells[map.dateIdx]) : '';
  const notes = map.notesIdx != null ? (cells[map.notesIdx] || '').trim() : '';
  return { vendor, approved, approvedBy, date, notes };
}

/**
 * Parse an "Approved" table cell to a boolean. Tolerates markdown emphasis
 * (`**no**`, `*yes*`) and trailing prose in the same cell (e.g. a Chinese
 * rationale after the yes/no token, as this project's own AGENTS.md does) —
 * only the LEADING token after stripping `*`/backtick emphasis decides the
 * verdict. Anything other than a leading "yes" (case-insensitive) is treated
 * as not-approved; this includes blank cells, "no", "TBD", etc. — deliberately
 * fail-closed (see assertVendorApproved's docstring for why).
 */
function parseApprovedCell(raw) {
  const cleaned = String(raw || '').replace(/[*`]/g, '').trim();
  const match = cleaned.match(/^[A-Za-z]+/);
  return !!match && match[0].toLowerCase() === 'yes';
}

/** Copy-pasteable skeleton surfaced in the E_APPROVED_VENDORS_SECTION_MISSING error. */
const APPROVED_VENDORS_SKELETON = [
  '## Approved Vendors',
  '',
  '<!-- Vendors this project permits dispatching to. A vendor that is absent, or present with Approved=no, is refused — an explicit --vendor override does not bypass this. -->',
  '',
  '| Vendor | Approved | Approved by | Date | Scope / Notes |',
  '|---|---|---|---|---|',
  '| `<vendor>` | yes | `<you>` | `YYYY-MM-DD` | |',
].join('\n');

/** Error code: `.hopper/AGENTS.md` has no "## Approved Vendors" section at all. */
export const E_APPROVED_VENDORS_SECTION_MISSING = 'E_APPROVED_VENDORS_SECTION_MISSING';
/** Error code: the section exists but this vendor has no row, or its row is not `yes`. */
export const E_VENDOR_NOT_APPROVED = 'E_VENDOR_NOT_APPROVED';

/**
 * Enforce the project-level "Approved Vendors" whitelist parsed from
 * `.hopper/AGENTS.md` (see `parseAgentsContent`'s `approvedVendors` field).
 *
 * This is a SEPARATE control from `resolveVendor`/routing above: routing
 * decides WHICH vendor a task-type prefers; this decides whether that
 * resolved vendor may be dispatched to AT ALL in this project. Callers must
 * invoke this AFTER resolving the vendor (including after an explicit
 * `--vendor` override) — see dispatch.js's two call sites — precisely so an
 * override cannot bypass the whitelist. It is also independent of, and does
 * NOT replace, the host!=vendor isomorphism guard
 * (`validateHostVendorSeparation` in validation.js): a vendor can be approved
 * here and still be rejected there (e.g. a Claude Code host dispatching to
 * the `claude` vendor), and vice versa — the two gates never short-circuit
 * each other.
 *
 * Polarity is deliberately FAIL-CLOSED: an AGENTS.md with no "## Approved
 * Vendors" section rejects EVERY vendor, rather than defaulting to "allow
 * everything until told otherwise." This project has direct empirical
 * history with the opposite polarity turning "delete one line" into a silent
 * global kill-switch (see CLAUDE.md's `.codex-plugin/plugin.json` /
 * hopper-plugin manifest drift incidents) — an allow-by-default vendor gate
 * would recreate exactly that failure shape, just one layer up (a missing
 * section instead of a missing manifest entry). So: no section → refuse, not
 * "no section → permit."
 *
 * @param {{ approvedVendors?: { present: boolean, list: Array<{vendor: string, approved: boolean}> } }} agentsData
 * @param {string} vendor  resolved vendor name (already lowercase adapter id)
 * @throws {Error} `.code === E_APPROVED_VENDORS_SECTION_MISSING` or `E_VENDOR_NOT_APPROVED`
 */
export function assertVendorApproved(agentsData, vendor) {
  const approvedVendors = agentsData && agentsData.approvedVendors;
  if (!approvedVendors || !approvedVendors.present) {
    const err = new Error(
      `${E_APPROVED_VENDORS_SECTION_MISSING}: dispatch refused — .hopper/AGENTS.md has no ` +
      `"## Approved Vendors" section. Vendor dispatch is fail-closed: an absent section ` +
      `approves NOTHING, including --vendor overrides. Add this section to AGENTS.md:\n\n` +
      `${APPROVED_VENDORS_SKELETON}`
    );
    err.code = E_APPROVED_VENDORS_SECTION_MISSING;
    throw err;
  }
  const normalized = String(vendor || '').toLowerCase();
  const entry = approvedVendors.list.find((e) => e.vendor === normalized);
  if (!entry || !entry.approved) {
    const known = approvedVendors.list.length > 0
      ? approvedVendors.list.map((e) => `${e.vendor}=${e.approved ? 'yes' : 'no'}`).join(', ')
      : '(no rows in the Approved Vendors table)';
    const err = new Error(
      `${E_VENDOR_NOT_APPROVED}: dispatch refused — vendor '${vendor}' is not approved in ` +
      `.hopper/AGENTS.md's "## Approved Vendors" table. Known entries: ${known}. Add a row for ` +
      `'${vendor}' (or flip its Approved cell to "yes") to allow it — this applies to --vendor ` +
      `overrides too.`
    );
    err.code = E_VENDOR_NOT_APPROVED;
    throw err;
  }
}

/**
 * Resolve which vendor adapter should handle a task.
 *
 * Resolution order (deterministic — codex F1 — no round-robin / no state):
 *   1. If task.vendor is set (per-row override in queue.md) → use that
 *   2. Look up preferences[task.taskType] → use that vendor
 *   3. Fall back to first agent with this taskType in taskTypePref array
 *   4. Throw — caller decides whether to escalate or default
 *
 * @param {import('./types.js').TaskRow} task
 * @param {{ agents: import('./types.js').AgentBinding[], preferences: Record<string, string> }} agentsData
 * @returns {string}                  Vendor CLI name (e.g. "codex", "kimi", "agy")
 * @throws {Error} If no vendor can be resolved
 */
export function resolveVendor(task, agentsData) {
  // 1. Row override
  if (task.vendor) return task.vendor;

  // 2. Task-type → vendor lookup
  const pref = agentsData.preferences[task.taskType];
  if (pref) {
    // Pref may be a nickname (e.g. "kimi-builder"); resolve to vendor CLI name
    const binding = agentsData.agents.find((a) => a.nickname === pref);
    if (binding) return binding.vendor;
    // If pref isn't a known nickname, treat it as a direct vendor name
    return pref;
  }

  // 3. Search agents for one that prefers this task-type
  const match = agentsData.agents.find((a) => a.taskTypePref.includes(task.taskType));
  if (match) return match.vendor;

  // 4. No resolution — caller decides
  throw new Error(
    `No vendor binding for task-type '${task.taskType}'. ` +
    `Bind a vendor in .hopper/AGENTS.md's task-vendor-preference table ` +
    `(fill in the Default vendor column — a blank/'(bind per project)' row is unbound), ` +
    `OR set the Vendor column in queue.md for task '${task.id}'.`
  );
}
