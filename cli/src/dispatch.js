// Dispatch orchestrator (Phase 1 integration glue)
// Anchor: cli/src/dispatch.js
//
// Per spec §3 #4 + #5: this is the THIN router. It reads protocol files,
// resolves task → vendor, composes prompt, and... STOPS. Actual subprocess
// spawn happens in T-PLUGIN-05a-e adapter implementations (Phase 2 / not
// yet wired in Phase 1 deliverable).
//
// Phase 1 deliverable: dispatch() returns a ResolvedTask + composed prompt
// without spawning. T-PLUGIN-05a-e adapters + final wiring lands in Phase 2+.

import { parseQueue, findEligibleTask, summarizeQueue } from './queue.js';
import { loadTaskFrame, composePrompt } from './tasks.js';
import { parseAgentsFile, resolveVendor, assertVendorApproved, vendorDefaultModel } from './agents.js';
import { resolveGovernance } from './governance.js';
import { getAdapter } from './vendors/index.js';
import { codexSandboxBypassActive } from './vendors/codex.js';
import { normalizeModel } from './model-normalize.js';
import { parseEffortPolicyCell, parseModelRuleCell, resolveVerifiedLatest, computeEffortClamp, MODEL_SENTINELS } from './policy.js';
import { resolveCommandWithKnownPaths } from './path-resolve.js';
import { runSubprocessOnce, resolveDispatchTimeouts } from './subprocess.js';
import { prepareSubjectRootGuard } from './subject-root-guard.js';
import { resolveVendorCwd } from './background.js';
import { resolvePromptDelivery } from './prompt-delivery.js';
import {
  resolveDefaultReasoning, resolveDefaultSandbox,
  READ_ONLY_DEFAULT_TASK_TYPES, WEB_SEARCH_TASK_TYPES,
  validateTaskId, TASK_TYPE_PATTERN, VENDOR_PATTERN,
} from './validation.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const READ_ONLY_TASK_RE = /\b(?:read[-_\s]?only|readonly)\b|只读/i;
const NEGATED_READ_ONLY_RE = /\b(?:not|non|is\s+not|isn't)\s+(?:read[-_\s]?only|readonly)\b|(?:不是|非)\s*只读/i;

/**
 * Announce that a PLATFORM ROUTER is about to run unpinned, with the provider
 * ids needed to fix it. No-op for any vendor that does not declare itself one.
 *
 * A platform router (pi) serves users on gpt / claude / kimi / qwen / glm…, so
 * hopper must not guess a model for it — but running unannounced is how a swarm
 * panelist ran on `gpt-5.5` out of ~/.pi/agent/settings.json while every other
 * dispatch in that project used the 5.6 line, with `requested_selector: null`
 * and nothing to show it. Warn rather than refuse (operator decision
 * 2026-08-11): a refusal would break every existing unpinned dispatch, and the
 * run is still attested after the fact by `observed_models`.
 *
 * The ids are load-bearing, not decoration: pi rejects every intuitive name
 * (`kimi`, `qwen`, `gemini`, `claude`, `grok` → `provider_not_found`), so a
 * caller told only "pin a model" cannot act on it.
 *
 * @param {string[]} notices  collected policyNotices, appended in place
 * @param {string} vendor
 */
function pushUnpinnedPlatformNotice(notices, vendor) {
  let providers;
  try { providers = getAdapter(vendor)?.capabilities?.modelArg?.platformProviders; } catch (_) { return; }
  if (!Array.isArray(providers) || providers.length === 0) return;
  notices.push(
    `NOT PINNED: '${vendor}' is a multi-provider platform and hopper does not guess a model for it — `
    + `this dispatch runs on whatever ${vendor} picks itself, and only the recorded observed_models will `
    + 'say which. Settle it once in .hopper/AGENTS.md `## Approved Vendors` → `Default model` '
    + `(or HOPPER_${String(vendor).toUpperCase()}_MODEL), as \`<provider>/<model>\`. Provider ids: `
    + `${providers.map((p) => p.id).join(', ')} — \`hopper-dispatch --capabilities ${vendor}\` maps each `
    + 'to its vendor and auth method (the intuitive names are rejected).',
  );
}

/** Raw Effort policy / Model rule cells for a task-type, or the unbound-shaped default. */
function policyForTaskType(agentsData, taskType) {
  return (agentsData && agentsData.policies && agentsData.policies[taskType]) || { effortPolicy: '', modelRule: '' };
}

/**
 * Resolve a task for dispatch (Phase 1 stops here; Phase 2 calls vendor adapter).
 *
 * @param {object} args
 * @param {string} args.hopperDir          Path to .hopper/ directory
 * @param {string} args.taskId             Task ID to dispatch
 * @returns {Promise<{
 *   task: import('./types.js').TaskRow,
 *   frame: string,
 *   vendor: string,
 *   composedPrompt: string,
 *   taskSpec: string,
 *   specNotice: string|null
 * }>}
 */
export async function resolveDispatch({ hopperDir, taskId, vendorOverride = null }) {
  // 1. Read queue.md, find task by ID
  const queuePath = join(hopperDir, 'queue.md');
  const tasks = await parseQueue(queuePath);
  const { task, reason } = findEligibleTask(tasks, taskId);
  if (!task) {
    throw new Error(`Task not eligible: ${reason}`);
  }

  // 2. Load task-type frame
  const frame = await loadTaskFrame(hopperDir, task.taskType);

  // 3. Resolve vendor via AGENTS.md (deterministic, no retry state)
  const agentsPath = join(hopperDir, 'AGENTS.md');
  const agentsData = await parseAgentsFile(agentsPath);
  // --vendor override wins over the AGENTS.md routing tables; host != vendor and
  // unknown-vendor checks still apply downstream (the dispatcher validates both).
  const vendor = vendorOverride || resolveVendor(task, agentsData);
  // Project-level Approved Vendors whitelist (batch 3, TH-approved-vendors):
  // enforced AFTER vendor resolution so a --vendor override is checked too,
  // not just AGENTS.md-routed dispatches. Independent of, and does not
  // short-circuit, the host!=vendor isomorphism guard applied downstream.
  assertVendorApproved(agentsData, vendor);

  // 4. Build the task CONTENT: the detailed spec section from
  //    handoffs/leader-tasklist.md (when there is one) MERGED with the queue.md
  //    Brief cell — never one silently standing in for the other.
  //
  //    WHY MERGE (and not "pick one"): the execution-mode guardrail composed into
  //    every handoff states, verbatim, "The brief and Task spec below are the
  //    complete, closed loop." (cli/src/tasks.js). Dropping either half would make
  //    that sentence false for the vendor reading it — the very class of defect
  //    this path used to have: loadTaskSpec's two miss branches returned a
  //    PLACEHOLDER STRING claiming "using queue.md brief only" which then became
  //    the spec, so the brief never reached the vendor at all and the vendor got a
  //    frame with no task in it (and still exited 0 / status done).
  const { taskSpec, specNotice } = await composeTaskContent({
    hopperDir, taskId, task,
    // Every other known task id, so loadTaskSpec's section-END search can stop
    // at the next OTHER task's exact marker (any of the three forms) instead of
    // pattern-guessing — see loadTaskSpec's doc comment (root cause (b) fix).
    otherTaskIds: tasks.map((t) => t.id),
  });

  // 5. Resolve optional governance overlay (keyed on the resolved vendor) and
  // compose. resolveGovernance is pure file I/O — no subprocess (spec §3 #4).
  const governance = await resolveGovernance({ hopperDir, vendor, task });
  const composedPrompt = composePrompt(frame, taskSpec, { governance });

  // Batch 2: raw Effort policy / Model rule cells for this task-type, consumed by
  // resolveAdapterOptsForTask's --reasoning / --model fallback chains below.
  const policy = policyForTaskType(agentsData, task.taskType);

  return { task, frame, vendor, composedPrompt, taskSpec, specNotice, policy, vendorDefaultModel: vendorDefaultModel(agentsData, vendor) };
}

/**
 * Resolve an AD-HOC dispatch — a one-off task with NO queue.md row; the brief IS
 * the spec. Used by the directed commands (/hopper:review|research|market) and the
 * swarm so they need not author (and pollute) queue.md. Returns the same shape as
 * resolveDispatch, so the caller's single-spawn / host!=vendor guarantees apply
 * identically. Read-only/web-search task-type defaults still come from
 * resolveAdapterOptsForTask downstream.
 *
 * @param {object} args
 * @param {string} args.hopperDir
 * @param {string} args.taskType        a scaffolded task-type (its frame must exist)
 * @param {string} args.brief           the task brief (becomes the spec)
 * @param {string} args.id              the synthetic task-id (for output files)
 * @param {string|null} [args.vendorOverride]
 * @returns {Promise<{task: object, frame: string, vendor: string, composedPrompt: string, taskSpec: string}>}
 */
export async function resolveAdhocDispatch({ hopperDir, taskType, brief, id, vendorOverride = null }) {
  validateTaskId(id);
  if (typeof taskType !== 'string' || !TASK_TYPE_PATTERN.test(taskType)) {
    throw new Error(`Invalid --task-type "${taskType}" (expected lowercase like prd-research / code-review-acceptance).`);
  }
  if (typeof brief !== 'string' || brief.trim().length === 0) {
    throw new Error('Ad-hoc dispatch requires a non-empty --brief.');
  }
  // Frame must exist for the task-type (same loader as the queued path).
  const frame = await loadTaskFrame(hopperDir, taskType);
  const task = { id, taskType, brief, status: 'pending', depends: [] };  // shape parity with queue TaskRow
  const agentsData = await parseAgentsFile(join(hopperDir, 'AGENTS.md'));
  const vendor = vendorOverride || resolveVendor(task, agentsData);
  if (!vendor) {
    throw new Error(`No vendor resolved for ad-hoc task-type "${taskType}". Pass --vendor <name> (no AGENTS.md preference found).`);
  }
  // Approved Vendors whitelist — same enforcement as resolveDispatch's queue path,
  // covering the ad-hoc path (/hopper:review|research|market, swarm panelists).
  assertVendorApproved(agentsData, vendor);
  const taskSpec = brief;
  const governance = await resolveGovernance({ hopperDir, vendor, task });
  const composedPrompt = composePrompt(frame, taskSpec, { governance });
  const policy = policyForTaskType(agentsData, taskType);
  // specNotice: shape parity with resolveDispatch. Always null here — an ad-hoc
  // dispatch has no leader-tasklist lookup to miss (the brief IS the spec, and an
  // empty one was already rejected above).
  return { task, frame, vendor, composedPrompt, taskSpec, specNotice: null, policy, vendorDefaultModel: vendorDefaultModel(agentsData, vendor) };
}

/**
 * Plan a multi-vendor SWARM (panel) — fan the SAME qualitative brief out to N vendors,
 * each as its own ad-hoc dispatch (one single-spawn per panelist; N tasks, not N retries).
 * PURE: validates + returns the per-panelist plan; the caller dispatches each via the
 * normal ad-hoc path. Restricted to READ-ONLY/qualitative task-types — swarming a write
 * task would have N vendors edit the same files. The vendor *selection* + per-vendor config
 * is a host-side confirmation gate; this only executes the confirmed list.
 *
 * @param {object} args
 * @param {string} args.taskType   a read-only/qualitative task-type (review/research/audit)
 * @param {string} args.brief
 * @param {string[]|string} args.vendors   panelists (array or comma-separated)
 * @param {string} [args.idBase]
 * @returns {Array<{ vendor: string, id: string, taskType: string, brief: string }>}
 */
export function planSwarm({ taskType, brief, vendors, idBase, now = Date.now() }) {
  if (typeof taskType !== 'string' || !TASK_TYPE_PATTERN.test(taskType)) {
    throw new Error(`Invalid --task-type "${taskType}".`);
  }
  if (!READ_ONLY_DEFAULT_TASK_TYPES.includes(taskType)) {
    throw new Error(`--swarm only supports read-only/qualitative task-types (${READ_ONLY_DEFAULT_TASK_TYPES.join(', ')}); got "${taskType}". Swarming a write task would have N vendors edit the same files.`);
  }
  if (typeof brief !== 'string' || brief.trim().length === 0) {
    throw new Error('--swarm requires a non-empty --brief.');
  }
  const list = (Array.isArray(vendors) ? vendors : String(vendors || '').split(','))
    .map((v) => v.trim()).filter(Boolean);
  const uniq = [...new Set(list)];
  if (uniq.length < 2) {
    throw new Error('--swarm needs at least 2 vendors (--vendors v1,v2,...). Use --adhoc for a single vendor.');
  }
  for (const v of uniq) {
    if (!VENDOR_PATTERN.test(v)) throw new Error(`Invalid vendor name "${v}" in --vendors.`);
  }
  const base = idBase || `swarm-${taskType}-${now.toString(36)}`;
  validateTaskId(base);
  return uniq.map((vendor) => ({ vendor, id: `${base}-${vendor}`, taskType, brief }));
}

/** Absolute path of the optional detailed-spec file. Single source of truth. */
export function leaderTasklistPath(hopperDir) {
  return join(hopperDir, 'handoffs', 'leader-tasklist.md');
}

/** Escape a literal string for embedding in a RegExp source. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the alternation of the three section-marker forms hopper recognizes, for
 * one escaped id or an already-alternated group of escaped ids (`a|b|c`):
 * `**<idsPattern>**`, `^##+\s+<idsPattern>\b`, `^|\s*<idsPattern>\s*|`. Shared by
 * section-START detection (a single task id) and section-END/boundary detection
 * (root cause (b) fix below — the END search used to only recognize the heading
 * form, so a following task written as `**T-2** …` or `| T-2 | … |` was never a
 * boundary at all and got swallowed into the current section).
 * @param {string} idsPattern  one escaped id, or `id1|id2|...` (already escaped)
 */
function markerAlternation(idsPattern) {
  return `\\*\\*(?:${idsPattern})\\*\\*|^##+\\s+(?:${idsPattern})\\b|^\\|\\s*(?:${idsPattern})\\s*\\|`;
}

// ─── structural-only body detection (docs/archive/ISSUES.md#task-spec-structural-
// only-body-accepted) ─────────────────────────────────────────────────────────
//
// The rule is "is there anything BESIDES structural markup", never "does it
// CONTAIN structural markup" — a legitimate spec may (and often does) contain
// tables, horizontal rules, and blockquotes. Every check below is therefore
// scoped to a single LINE, and the body as a whole is judged by the union
// across lines: the instant ONE line carries real content, the whole section
// is accepted, no matter how much structural noise surrounds it.
//
// Verified against real markdown and extended slightly past the reported
// examples (documented in CHANGELOG.md under this fix): the table check
// covers any cell count (not just 2 columns) and treats an all-empty row
// (`| | |`) — INCLUDING a bare single `|` with no cells at all — the same as
// a delimiter row (`|---|---|`) with one rule; the horizontal-rule check
// accepts tab-separated spaced variants in addition to space-separated ones;
// the bare-list-marker check accepts `)` as well as `.` after an ordered-list
// digit (`1)` as well as `1.`), and recognizes an empty/unchecked checkbox
// item (`- [ ]` / `- [x]`) as its own case; the bare-blockquote check accepts
// nested empty markers (`> >`), not only a lone `>`; a borderless table-
// separator row (`--- | ---`, no outer pipes) is recognized alongside the
// piped form; an HTML `<hr>` tag is recognized alongside the markdown
// thematic break; and a line holding only zero-width/invisible formatting
// characters (U+200B ZERO WIDTH SPACE and its siblings U+200C/U+200D/U+FEFF)
// is treated as blank, since JS's `.trim()` does not strip them and a naive
// blank check would otherwise see one as "non-whitespace content".
//
// Deliberately NOT included (named here, not silently dropped, per the
// project's stated preference for a LITTLE under-rejection over any
// over-rejection): a bare subheading with nothing under it (`### 背景` alone),
// a line of pure emphasis markup with no words (`**`), and an HTML comment
// (`<!-- ... -->`) all still count as "content" and are ACCEPTED — none of
// them appear in the reported structural-token list, and guessing past that
// list risks fail-closing a real spec that happens to use one of them as a
// section divider. See CHANGELOG.md for the full residual-gap statement.
//
// CODE-BLOCK EXEMPTION (2026-08-13, REWORK — over-rejection found by
// adversarial review and independently reproduced against the code above,
// before this fix): a fenced (``` or ~~~) or 4-space/tab-INDENTED code block
// is content the author explicitly marked as literal — the structural-noise
// checks above must never even look at a line INSIDE one, no matter what
// that line looks like. Reproduced: a spec whose real content was an
// indented `    ---` (an indented code block showing a literal horizontal
// rule), an indented `\t> ` (a tab-indented literal blockquote marker), or
// an indented `    | | |` (an indented literal table skeleton) was WRONGLY
// rejected as structural-only — exactly the "over-rejection fail-closes a
// task that would otherwise have run correctly" harm the original scope-lock
// warned against, because isStructuralOnlyLine trims each line before
// judging it and trimming DESTROYS the very indentation that marks it as
// literal code. Fixed in hasSubstantiveContent below: a fence's OPEN/CLOSE
// delimiter lines are themselves structural (they carry no task content),
// but every line strictly BETWEEN them counts as content unconditionally —
// including a blank one, since the code makes no attempt to interpret fenced
// content at all. An immediately-empty fenced block (open fence, zero lines,
// close fence) therefore still contributes nothing, which is the corollary
// this principle predicts (see the "empty fenced block" under-rejection
// case). A line starting with 4+ spaces or a tab — checked on the UNTRIMMED
// line, before any structural regex would strip that indentation and
// misread it — gets the same unconditional treatment without needing fence-
// state tracking, provided it has real (non-whitespace) characters after the
// indent; a purely blank line stays blank regardless of how much leading
// whitespace it has.

/** A table-row line (`| a | b |`) whose cells are ALL either empty or a
 * delimiter-cell pattern (`---`, `:---`, `---:`, `:---:`) — an empty skeleton
 * or delimiter row, not real content. A row with real text in ANY cell
 * (including a header row) returns false: that row DOES carry content. Naive
 * split-on-`|` is deliberate — this is a noise heuristic, not a parser, and a
 * mis-split can only ever make a cell look non-empty (never empty), which can
 * only push the verdict toward "content", the safe direction for this rule.
 * No minimum-length guard: a bare single `|` (or `||`) degenerates to one (or
 * more) empty cells via the same slice/split, so it is caught here too — a
 * lone `|` used to slip through as "content" (REWORK P3). */
function isStructuralTableRow(trimmedLine) {
  if (!trimmedLine.startsWith('|') || !trimmedLine.endsWith('|')) return false;
  const cells = trimmedLine.slice(1, -1).split('|');
  return cells.every((cell) => {
    const c = cell.trim();
    return c === '' || /^:?-+:?$/.test(c);
  });
}

// A table-separator row WITHOUT the outer pipes (`--- | ---`, `-|-|-`) — the
// piped form is covered by isStructuralTableRow above; this is the
// borderless variant (REWORK P3).
const BORDERLESS_TABLE_DELIM_RE = /^:?-+:?(?:\s*\|\s*:?-+:?)+$/;
// Horizontal rule: 3+ of the SAME `-`/`*`/`_` character, optionally separated
// by spaces/tabs (CommonMark thematic-break shapes, `---`/`***`/`___` and
// their spaced variants `- - -` / `* * *` / `_ _ _`). The backreference `\1`
// keeps this to a SINGLE repeated character — `-*-` (mixed) is not a rule and
// correctly falls through to "content".
const HR_LINE_RE = /^([-*_])(?:[ \t]*\1){2,}$/;
// The HTML thematic-break tag, any case, self-closed or not (REWORK P3).
const HTML_HR_RE = /^<hr\s*\/?\s*>$/i;
// A blockquote marker, possibly nested (`> >`), with nothing after it.
const BARE_BLOCKQUOTE_RE = /^>[>\s]*$/;
// A single list marker (bullet or ordered) alone on a line — no item text.
const BARE_LIST_MARKER_RE = /^(?:[-*+]|\d+[.)])$/;
// An empty/unchecked task-list checkbox item — no text after the box (REWORK P3).
const BARE_CHECKBOX_RE = /^[-*+]\s*\[[ xX]\]$/;
// Zero-width / invisible formatting characters. `.trim()` does NOT strip
// these (Unicode category Cf, not the Zs/whitespace set JS trims), so a line
// holding only one of them reads as "non-whitespace" to a naive check — this
// makes it blank explicitly (REWORK P3: U+200B specifically reported;
// siblings ZWNJ/ZWJ/BOM added here as the same class of invisible marker).
const INVISIBLE_ONLY_RE = /^[​‌‍﻿]+$/;

/**
 * True when `line` is structural markdown noise that carries no task content
 * by itself: blank (including zero-width-only), a horizontal rule (markdown
 * thematic break or `<hr>`), a table delimiter/all-empty/borderless-
 * separator row, a bare blockquote marker, an empty checkbox item, or a bare
 * list marker. False for everything else — INCLUDING a table row /
 * blockquote / list item that has real text, and INCLUDING a bare heading,
 * which is not in the reported structural-token list (see the residual-gap
 * note above). Deliberately unaware of code fences or indentation — that is
 * hasSubstantiveContent's job below, which is responsible for never calling
 * this on a line that is inside a code block (see "CODE-BLOCK EXEMPTION").
 */
function isStructuralOnlyLine(line) {
  const t = line.trim();
  if (t === '') return true;
  if (INVISIBLE_ONLY_RE.test(t)) return true;
  if (isStructuralTableRow(t)) return true;
  if (BORDERLESS_TABLE_DELIM_RE.test(t)) return true;
  if (HR_LINE_RE.test(t)) return true;
  if (HTML_HR_RE.test(t)) return true;
  if (BARE_BLOCKQUOTE_RE.test(t)) return true;
  if (BARE_CHECKBOX_RE.test(t)) return true;
  if (BARE_LIST_MARKER_RE.test(t)) return true;
  return false;
}

// Code-fence delimiter shape: 0-3 leading spaces then a run of 3+ backticks
// or 3+ tildes (CommonMark fence syntax). Used both to detect an OPEN
// candidate (may carry a trailing info string, e.g. a "diff" or "js" language
// tag) and, with the extra "nothing else on the line" constraint below, a
// CLOSE candidate.
const FENCE_MARKER_RE = /^ {0,3}(`{3,}|~{3,})/;
// A CLOSING fence must contain NOTHING but the fence run itself (optionally
// re-indented, with only trailing whitespace after) — an info string only
// makes sense on the OPEN side, so a fence-shaped line carrying one while
// INSIDE an open fence is content (e.g. a nested example), not a close.
const FENCE_CLOSE_ONLY_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
// A line starting with 4+ spaces or a tab — checked on the RAW, untrimmed
// line, since trimming would destroy the very indentation this is looking
// for. Real (non-whitespace) content must remain after the indent; a purely
// blank indented line is still blank, not code content.
const INDENTED_CODE_LINE_RE = /^(?:\t| {4,})/;

/** Does `rawLine` open a fenced code block? Returns the fence character and
 * run length (needed to recognize the eventual closing fence), or null. */
function matchFenceOpen(rawLine) {
  const m = rawLine.match(FENCE_MARKER_RE);
  return m ? { char: m[1][0], len: m[1].length } : null;
}

/** Does `rawLine` close a fence previously opened with `fenceChar` repeated
 * `fenceLen` times? Per CommonMark, a closing fence must use the SAME
 * character and be AT LEAST as long as the opening one, with nothing else on
 * the line. */
function isFenceClose(rawLine, fenceChar, fenceLen) {
  const m = rawLine.match(FENCE_CLOSE_ONLY_RE);
  return !!m && m[1][0] === fenceChar && m[1].length >= fenceLen;
}

/**
 * A section body carries real content the instant AT LEAST ONE line is not
 * pure structural noise — deliberately permissive: a legitimate spec that is
 * MOSTLY structure (a table, a horizontal rule, a blockquote, a code sample)
 * still passes as soon as it has one line of real prose, table data, or code
 * anywhere in it. Only a body that is ENTIRELY structural noise (or blank)
 * is rejected.
 *
 * Code is opaque (see "CODE-BLOCK EXEMPTION" above): a fenced block's
 * OPEN/CLOSE delimiter lines are structural, but every line strictly between
 * them counts as content unconditionally — isStructuralOnlyLine is never
 * even consulted for them. An indented-code line gets the same unconditional
 * treatment without needing fence-state tracking.
 */
function hasSubstantiveContent(text) {
  const lines = text.split('\n');
  let fence = null; // { char, len } while inside an open fence, else null
  for (const rawLine of lines) {
    if (fence) {
      if (isFenceClose(rawLine, fence.char, fence.len)) {
        fence = null; // the closing delimiter line itself is structural
        continue;
      }
      return true; // any line strictly inside an open fence is content, verbatim
    }
    const opener = matchFenceOpen(rawLine);
    if (opener) {
      fence = opener; // the opening delimiter line itself is structural
      continue;
    }
    if (INDENTED_CODE_LINE_RE.test(rawLine) && rawLine.trim() !== '') return true;
    if (!isStructuralOnlyLine(rawLine)) return true;
  }
  return false;
}

/** Reason codes loadTaskSpec reports via `options.diagnostics.reason` on every
 * `null`-returning path — see "DIAGNOSABLE NULL REASON" on loadTaskSpec's doc
 * comment below. Exported so callers/tests can compare against the constant
 * instead of a hand-typed string literal. */
export const SPEC_MISS_REASON = Object.freeze({
  /** leader-tasklist.md does not exist at all (ENOENT). */
  NO_TASKLIST_FILE: 'no-tasklist-file',
  /** leader-tasklist.md exists, but has no section marker for this task id. */
  NO_SECTION: 'no-section',
  /** A section marker for this task id was found, but its body is judged
   * structural-only (docs/archive/ISSUES.md#task-spec-structural-only-body-accepted). */
  STRUCTURAL_ONLY_BODY: 'structural-only-body',
});

/**
 * Load the DETAILED spec section for a task from .hopper/handoffs/leader-tasklist.md.
 *
 * Returns the section text, or `null` when there is no detailed spec — either
 * because the file has no section for this task-id, or because the file does not
 * exist at all. It NEVER returns prose describing its own failure: this function
 * used to return placeholder strings like
 *   "(no detailed spec found for T-1 in leader-tasklist.md; using queue.md brief only)"
 * which the caller then handed to composePrompt AS the task spec — so the vendor
 * received a handoff whose entire "Task spec" section was a sentence about a
 * missing file, the queue.md Brief was never composed in at all, and the sentence
 * itself was false ("using queue.md brief only" while using nothing). Missing data
 * is now reported as absence (`null`); the caller decides the fallback.
 *
 * Any non-ENOENT I/O error still throws — an unreadable/permission-denied
 * leader-tasklist.md is a real fault and must not be laundered into "no spec".
 *
 * CROSS-TASK LEAK FIX (2026-08-12): section-END detection used to be broken two
 * independent ways, so a task's "spec" could contain ANOTHER task's content —
 * worse than a missing spec, since the vendor executes someone else's task:
 *   (a) `rest.slice(50)` skipped a fixed 50 characters before searching for the
 *       next boundary. A section shorter than 50 chars let the NEXT task's
 *       heading fall inside that skipped window, so it was never seen and the
 *       slice ran on into it. Fixed by searching from right after the matched
 *       marker TEXT instead of a fixed offset — nothing is ever skipped.
 *   (b) the END search only recognized a `^##\s+` heading, while the START
 *       search (and therefore what actually marks a new task) recognizes THREE
 *       forms (bold / heading / table-row). A following task written in bold or
 *       table-row form was never a boundary at all, regardless of section
 *       length. Fixed via `options.otherTaskIds` (see below) — the section now
 *       ends at the next marker naming any OTHER known task id, in any of the
 *       three forms.
 *
 * FOLLOW-UP FIX (same day, adversarial review of the first pass): the boundary
 * is the UNION of two independent checks, not an either/or choice between them —
 * an earlier version made them mutually exclusive (id-aware search REPLACED the
 * heading search whenever `otherTaskIds` was supplied) and that regressed the
 * real dispatch path, which always supplies `otherTaskIds`:
 *   - a plain H2 heading (`^##\s+`, EXACTLY two hashes) always ends a section,
 *     in both modes. This is what lets a task that exists in
 *     leader-tasklist.md but has no queue.md row (e.g. anything dispatched via
 *     `--adhoc`, so it never appears in `otherTaskIds`) still correctly
 *     terminate the PREVIOUS task's section — the union-not-replacement bug
 *     otherwise leaked such a task's content into its predecessor's "spec".
 *   - a bold / any-level-heading / table-row marker naming a KNOWN OTHER task
 *     id (from `otherTaskIds`) ALSO ends a section — this is what recognizes a
 *     following task written in bold or table-row form (root cause (b) above).
 *   The two checks run independently and the EARLIEST match wins; known ids
 *   only ever ADD boundaries beyond the plain-H2 check, they never remove it.
 *   Deliberately H2-ONLY (not `^##+\s+`, any level) for the unconditional
 *   heading check: a spec body legitimately contains its OWN `###`/`####`
 *   subsections (e.g. `### 背景` / `### 验收`), and those must survive intact —
 *   widening to `##+` would cut a spec off at its first subsection.
 *
 * STRUCTURAL-ONLY BODY FIX (2026-08-13,
 * docs/archive/ISSUES.md#task-spec-structural-only-body-accepted): the
 * fail-closed check below used to be "is there any non-whitespace character
 * after the marker" — so a section whose entire body was a horizontal rule
 * (`---`), an empty table skeleton (`|---|---|`), or a bare blockquote marker
 * (`>`) was non-whitespace and therefore ACCEPTED as a real spec, same as the
 * bodyless-heading bug this function already fixed once. The rule is now "is
 * there anything BESIDES structural markup" (isStructuralOnlyLine /
 * hasSubstantiveContent, above) — deliberately NOT "does it contain
 * structural markup", since a legitimate spec may (and often does) contain
 * tables, horizontal rules, and blockquotes. A section is rejected only when
 * EVERY line is blank or one of the enumerated structural-only shapes; one
 * real line anywhere in the body is enough to accept the whole section.
 *
 * DIAGNOSABLE NULL REASON (2026-08-13, REWORK — found by adversarial review,
 * independently reproduced): this function has always had THREE distinct
 * reasons to return `null` — no leader-tasklist.md at all, a leader-
 * tasklist.md with no section for this id, and (as of the fix directly
 * above) a section that matched but whose body is structural-only — yet the
 * plain `string|null` return value collapses all three into the same `null`,
 * indistinguishable to the caller. composeTaskContent used to word its
 * operator notice as "No detailed spec section for <id>" regardless of which
 * of the three actually happened, which is FALSE for the third case: the
 * section is right there, and was correctly rejected on the merits, not
 * absent. A maintainer reading that notice would go looking for a section
 * that already exists, chasing the wrong cause — the same family of
 * misdiagnosis this file has repeatedly fixed elsewhere (self-describing
 * placeholder text; a boundary leak masquerading as a full spec). Fixed via
 * an optional out-param, `options.diagnostics` — when the caller passes an
 * object, this function sets `.reason` to one of the `SPEC_MISS_REASON`
 * values below on every `null`-returning path (left untouched on success).
 * This does NOT change the return type or any existing caller's success-path
 * semantics: every caller that does not pass `diagnostics` sees the exact
 * same `string|null` contract as before.
 *
 * @param {string} hopperDir
 * @param {string} taskId
 * @param {{ otherTaskIds?: string[], diagnostics?: { reason?: string } }} [options]
 *   `otherTaskIds` — every other known task id (e.g. every id in queue.md).
 *   Exact ids beat pattern-guessing: when supplied, a bold / heading /
 *   table-row marker naming one of them ALSO ends the section (in addition to
 *   the unconditional H2-heading check below) — a legitimate `**Bold**` line
 *   or markdown table inside THIS task's own body can never be mistaken for a
 *   boundary, because it does not spell another KNOWN task's id. Omitted /
 *   empty (e.g. a direct/test caller with no queue.md id list to hand) simply
 *   means this half of the union contributes no extra boundaries — the plain
 *   H2-heading check below still applies either way.
 *   `diagnostics` — optional out-param object; see "DIAGNOSABLE NULL REASON"
 *   above. Mutated only when this function returns `null`.
 * @returns {Promise<string|null>}  section text, or null when there is none
 */
export async function loadTaskSpec(hopperDir, taskId, options = {}) {
  const path = leaderTasklistPath(hopperDir);
  const diagnostics = options.diagnostics && typeof options.diagnostics === 'object' ? options.diagnostics : null;
  let content;
  try {
    content = await readFile(path, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (diagnostics) diagnostics.reason = SPEC_MISS_REASON.NO_TASKLIST_FILE;
      return null;
    }
    throw err;
  }
  // Find a section starting with **<task-id>** or ## <task-id> or ### <task-id>
  const escapedId = escapeRegExp(taskId);
  const markerRe = new RegExp(markerAlternation(escapedId), 'm');
  const markerMatch = content.match(markerRe);
  if (!markerMatch) {
    if (diagnostics) diagnostics.reason = SPEC_MISS_REASON.NO_SECTION;
    return null;
  }
  const sectionStart = markerMatch.index;
  const markerText = markerMatch[0];
  const rest = content.slice(sectionStart);
  // Boundary search space: everything AFTER the matched marker text itself — see
  // root cause (a) in the doc comment above. No fixed offset is skipped.
  const searchSpace = rest.slice(markerText.length);

  const otherIds = Array.isArray(options.otherTaskIds)
    ? [...new Set(options.otherTaskIds.filter((id) => typeof id === 'string' && id.length > 0 && id !== taskId))]
    : [];

  // Boundary = the EARLIEST of two independent checks (union, not either/or —
  // see the doc comment's "FOLLOW-UP FIX"):
  let boundaryOffset = -1; // offset into `searchSpace`, or -1 when no boundary found

  // (i) a plain H2 heading — EXACTLY two hashes — always ends a section, in
  //     both modes. This is what lets an adhoc task with no queue.md row (so
  //     it's absent from otherTaskIds) still terminate the PREVIOUS task's
  //     section via its own heading. H2-only (not `^##+\s+`) so a spec's own
  //     `###`/`####` subsections are never mistaken for a boundary.
  const headingOffset = searchSpace.search(/^##\s+/m);
  if (headingOffset !== -1) boundaryOffset = headingOffset;

  // (ii) a bold / any-level-heading / table-row marker naming a KNOWN OTHER
  //      task id ALSO ends a section — this recognizes a following task
  //      written in bold or table-row form (root cause (b)). Only ADDS
  //      boundaries beyond (i); never removes the plain-H2 check above.
  if (otherIds.length > 0) {
    const idsPattern = otherIds.map(escapeRegExp).join('|');
    const boundaryRe = new RegExp(markerAlternation(idsPattern), 'm');
    const idOffset = searchSpace.search(boundaryRe);
    if (idOffset !== -1 && (boundaryOffset === -1 || idOffset < boundaryOffset)) {
      boundaryOffset = idOffset;
    }
  }
  const end = boundaryOffset === -1 ? Math.min(rest.length, 8000) : markerText.length + boundaryOffset;
  const section = rest.slice(0, end).trim();
  // Fail-closed rule: decide on "is there actual BODY after the matched marker",
  // not "is the section non-empty" — the section always includes the marker line
  // itself, so a bare "## T-1" heading with nothing under it previously satisfied
  // `section.length > 0` and returned a non-null "spec" that was just the heading.
  // That let the marker slip past composeTaskContent's fail-closed throw entirely
  // (a matched-but-bodyless section looked identical to a real spec). Strip the
  // matched marker text itself off the front — `rest` starts exactly at the
  // match, so `section` does too.
  const afterMarker = section.startsWith(markerText) ? section.slice(markerText.length) : section;
  // Then require actual BODY, not just non-whitespace — see "STRUCTURAL-ONLY BODY
  // FIX" above. A body of pure structural markdown noise (horizontal rule, empty
  // table skeleton, bare blockquote/list marker) is non-whitespace but still
  // carries no task content, and must fail closed exactly like the bodyless-
  // heading case this same rule already covers.
  if (hasSubstantiveContent(afterMarker)) return section;
  if (diagnostics) diagnostics.reason = SPEC_MISS_REASON.STRUCTURAL_ONLY_BODY;
  return null;
}

/** Header that labels the queue.md Brief inside a merged task spec. */
export const QUEUE_BRIEF_HEADING = '### Queue brief';

/**
 * Precedence line appended to a MERGED spec. The vendor sees two sources of task
 * content; it must be told which wins, or a stale Brief cell can silently
 * out-argue the detailed spec it was supposed to summarize.
 */
export const QUEUE_BRIEF_PRECEDENCE_NOTE =
  '(Source: the Brief column of .hopper/queue.md. Where it conflicts with the detailed spec above, the detailed spec wins.)';

/**
 * Assemble the task CONTENT for a queued dispatch out of its two possible
 * sources, and say (to the operator, never to the vendor) when one is missing.
 *
 * Rules:
 *   - both present  → detailed spec first, then the Brief under `### Queue brief`,
 *                     with an explicit "detailed spec wins on conflict" line
 *   - spec only     → the spec verbatim
 *   - brief only    → the brief verbatim (mirrors the ad-hoc path, where the brief
 *                     IS the spec) + an operator notice explaining why there is no
 *                     detailed section
 *   - neither       → THROW (fail closed). Dispatching a content-free prompt is how
 *                     a vendor "succeeds" (exit 0, status done) at nothing. Matches
 *                     the ad-hoc/swarm paths, which already reject an empty brief.
 *
 * Note `??` is unusable here: queue.js gives a missing Brief cell the EMPTY STRING,
 * and `'' ?? brief` is `''` — nullish coalescing only catches null/undefined.
 * Everything below is emptiness-aware via .trim().
 *
 * DIAGNOSABLE NULL REASON (2026-08-13, REWORK): the "spec only"/"neither" notice
 * and throw text below used to be worded from a simple ENOENT-or-not check
 * (`fileExists(path)`), which only ever distinguished two situations — but
 * loadTaskSpec can now report a THIRD (`SPEC_MISS_REASON.STRUCTURAL_ONLY_BODY`):
 * a section exists and was read, but its body was judged structural-only. That
 * third case used to fall into the "no section" wording ("No detailed spec
 * section for <id>"), which is FALSE — the section is there; it was correctly
 * rejected on the merits. Both messages below now branch on
 * `specDiagnostics.reason` (the out-param loadTaskSpec fills in) instead of a
 * fresh existence check, so each of the three reasons gets its own true
 * sentence. The wording for the two PRE-EXISTING reasons (no file at all; no
 * section for this id) is BYTE-IDENTICAL to before — only the previously-
 * mislabeled third case gets new text. `fileExists()` is gone: its only job
 * was approximating this same distinction less precisely.
 *
 * @param {{hopperDir: string, taskId: string, task: {brief?: string}, otherTaskIds?: string[]}} args
 *   `otherTaskIds` — passed straight through to loadTaskSpec's exact-boundary
 *   resolution (every other known task id from queue.md); see its doc comment.
 * @returns {Promise<{taskSpec: string, specNotice: string|null}>}
 */
async function composeTaskContent({ hopperDir, taskId, task, otherTaskIds }) {
  // out-param: loadTaskSpec sets .reason on every null-return path (see
  // SPEC_MISS_REASON / "DIAGNOSABLE NULL REASON" above); read below only when
  // `detailed` turns out empty.
  const specDiagnostics = {};
  const detailed = (await loadTaskSpec(hopperDir, taskId, { otherTaskIds, diagnostics: specDiagnostics }) || '').trim();
  const brief = typeof task?.brief === 'string' ? task.brief.trim() : '';

  if (detailed && brief) {
    return {
      taskSpec: `${detailed}\n\n${QUEUE_BRIEF_HEADING}\n\n${brief}\n\n${QUEUE_BRIEF_PRECEDENCE_NOTE}`,
      specNotice: null,
    };
  }
  if (detailed) return { taskSpec: detailed, specNotice: null };

  // No detailed section reached the vendor. Report WHY, truthfully, using the
  // reason loadTaskSpec actually observed — not a re-derived approximation.
  const path = leaderTasklistPath(hopperDir);
  const reason = specDiagnostics.reason;
  if (brief) {
    let specNotice;
    if (reason === SPEC_MISS_REASON.STRUCTURAL_ONLY_BODY) {
      specNotice = `leader-tasklist.md HAS a section for ${taskId}, but its body is only structural markdown (no real content — see docs/archive/ISSUES.md#task-spec-structural-only-body-accepted); task content comes from queue.md Brief.`;
    } else if (reason === SPEC_MISS_REASON.NO_TASKLIST_FILE) {
      specNotice = `leader-tasklist.md is absent at ${path}; task content comes from queue.md Brief.`;
    } else {
      // SPEC_MISS_REASON.NO_SECTION, or (defensively) an unset reason.
      specNotice = `No detailed spec section for ${taskId} in leader-tasklist.md; task content comes from queue.md Brief.`;
    }
    return { taskSpec: brief, specNotice };
  }
  let reasonDetail;
  if (reason === SPEC_MISS_REASON.STRUCTURAL_ONLY_BODY) {
    reasonDetail = ` (a section for ${taskId} exists in ${path}, but its body is only structural markdown — no real content)`;
  } else if (reason === SPEC_MISS_REASON.NO_TASKLIST_FILE) {
    reasonDetail = ` (${path} does not exist)`;
  } else {
    reasonDetail = ` (no section for ${taskId} in ${path})`;
  }
  throw new Error(
    `Task ${taskId} has no task content: queue.md Brief is empty and no detailed spec was found`
    + reasonDetail
    + `. Fill the Brief cell for ${taskId} in .hopper/queue.md, or add a "## ${taskId}" section to leader-tasklist.md.`
  );
}

/**
 * Status summary for --status command.
 *
 * @param {string} hopperDir
 */
export async function getStatus(hopperDir) {
  const queuePath = join(hopperDir, 'queue.md');
  const tasks = await parseQueue(queuePath);
  return summarizeQueue(tasks);
}

/**
 * Return true only when the queue brief or detailed task spec explicitly says
 * the task is read-only. We intentionally do not infer read-only from task-type
 * names like "review"; the product default is full vendor write access unless
 * the task description itself says read-only / 只读.
 *
 * @param {object} resolved
 */
export function taskTextRequestsReadOnly(resolved) {
  const text = [
    resolved?.task?.brief,
    resolved?.taskSpec,
  ].filter(Boolean).join('\n');
  if (!text) return false;
  if (NEGATED_READ_ONLY_RE.test(text)) return false;
  return READ_ONLY_TASK_RE.test(text);
}

/**
 * Apply the product-level default permission policy to adapter opts.
 * Explicit --sandbox always wins; otherwise read-only text downgrades, and all
 * other tasks default to danger-full-access.
 *
 * @param {object} resolved
 * @param {import('./types.js').AdapterOpts} [adapterOpts]
 * @returns {import('./types.js').AdapterOpts}
 */
export function resolveAdapterOptsForTask(resolved, adapterOpts = {}) {
  const out = { ...adapterOpts };
  const taskType = resolved?.task?.taskType;
  // Preserve argv provenance before policy/sentinel resolution and advisory
  // selector normalization mutate out.model. Runtime attestation must compare
  // only the effective selector, never this requested audit value.
  const requestedSelector = Object.hasOwn(adapterOpts, 'requestedSelector')
    ? (typeof adapterOpts.requestedSelector === 'string' ? adapterOpts.requestedSelector : null)
    : (typeof adapterOpts.model === 'string' ? adapterOpts.model : null);
  const carriesEffectiveSelector = Object.hasOwn(adapterOpts, 'effectiveSelector');
  const inheritedEffectiveSelector = carriesEffectiveSelector && typeof adapterOpts.effectiveSelector === 'string'
    ? adapterOpts.effectiveSelector
    : null;
  const inheritedEffectiveSource = adapterOpts.effectiveSelectorSource;
  let modelResolvedByPolicy = false;
  // Batch 2: notices surfaced by the fallback chains below (policy-cell resolution,
  // sentinel resolution, effort clamp visibility) — collected here and read by the
  // CLI print layer as `effectiveAdapterOpts.policyNotices` immediately after this
  // call. Deliberately attached NON-ENUMERABLE so it is invisible to JSON.stringify
  // (background.js forwards adapterOpts to the runner via an env-JSON blob) and to
  // any `{ ...effectiveAdapterOpts, ... }` spread (background/sync build effectiveOpts
  // that way) — this is print-time metadata, not a real adapter option.
  const notices = [];
  Object.defineProperty(out, 'policyNotices', { value: notices, enumerable: false, configurable: true });

  // ── --model fallback chain (batch 2): flag > AGENTS.md Model rule cell > vendor CLI default ──
  // V4 normalizes a user-specified model to the vendor's canonical name (fuzzy-match
  // against knownGood; advisory — passthrough if no confident match). Single
  // chokepoint — every dispatch path (sync / background / adhoc / swarm) flows
  // through resolveAdapterOptsForTask.
  if (!out.model && !carriesEffectiveSelector && resolved?.policy?.modelRule) {
    const parsedRule = parseModelRuleCell(resolved.policy.modelRule);
    if (parsedRule.status === 'ok') {
      out.model = parsedRule.sentinel; // resolved to a real name below (sentinel-or-normalize)
      modelResolvedByPolicy = true;
      notices.push(`model resolved from AGENTS.md Model rule (task-type '${taskType}'): ${parsedRule.sentinel}`);
    } else if (parsedRule.status === 'unparseable') {
      notices.push(`Model rule cell for task-type '${taskType}' references an unrecognized sentinel ('${String(resolved.policy.modelRule).trim()}') — ignoring; vendor CLI default will be used.`);
    }
    // status 'unbound' (empty / OOB `(bind per project)`) is silent — same convention
    // as an unbound Default-vendor cell; falls through to the vendor's own default.
  }
  // ── per-vendor default (2026-08-11) ──
  // Reached only when nothing more specific pinned a model. Two more levels
  // before giving up and letting the vendor choose:
  //
  //   1. the project's `Default model` cell in AGENTS.md `## Approved Vendors`
  //      — a per-vendor literal. This is the level that closes the staleness
  //      gap: when a vendor ships a newer model than hopper's shipped preset,
  //      a project pins it here instead of waiting for a hopper release.
  //   2. the adapter's declared `hopperDefault` — hopper's own preference for
  //      hopper-shaped work, which need NOT equal the vendor agent's default
  //      (review/judgment tasks can justify a stronger model than the vendor
  //      picks for interactive use).
  //
  // Without these, an unpinned dispatch silently inherited whatever the vendor
  // CLI felt like: a `--swarm` panelist ran pi on gpt-5.5 out of
  // ~/.pi/agent/settings.json while every other pi dispatch used the 5.6 line,
  // and the handoff recorded `requested_selector: null` so nothing said so.
  if (!out.model && !carriesEffectiveSelector && resolved?.vendor) {
    // Machine-level override, above the project file because it describes THIS
    // machine (a provider that is not logged in here, a model this account
    // cannot reach) — but below an explicit --model or task-type Model rule,
    // which are per-dispatch intent. Same naming as HOPPER_PI_THINKING /
    // HOPPER_GROK_EFFORT.
    const envKey = `HOPPER_${String(resolved.vendor).toUpperCase()}_MODEL`;
    const envDefault = typeof process.env[envKey] === 'string' && process.env[envKey].trim()
      ? process.env[envKey].trim()
      : null;
    const projectDefault = envDefault || (typeof resolved.vendorDefaultModel === 'string' && resolved.vendorDefaultModel.trim()
      ? resolved.vendorDefaultModel.trim()
      : null);
    if (envDefault) {
      out.model = envDefault;
      modelResolvedByPolicy = true;
      notices.push(`model resolved from ${envKey}: ${envDefault}`);
    } else if (projectDefault) {
      out.model = projectDefault;
      modelResolvedByPolicy = true;
      notices.push(`model resolved from AGENTS.md Approved Vendors 'Default model' for '${resolved.vendor}': ${projectDefault}`);
    } else {
      try {
        const declared = resolveVerifiedLatest(getAdapter(resolved.vendor)?.capabilities?.modelArg);
        if (declared) {
          out.model = declared;
          modelResolvedByPolicy = true;
          notices.push(`model resolved from the '${resolved.vendor}' adapter's hopper default: ${declared} (override per project in AGENTS.md 'Approved Vendors' → 'Default model')`);
        }
        if (!declared) pushUnpinnedPlatformNotice(notices, resolved.vendor);
      } catch (_) { /* unknown vendor is handled by the dispatcher; leave unpinned */ }
    }
  }
  if (out.model && resolved?.vendor) {
    try {
      const modelArg = getAdapter(resolved.vendor)?.capabilities?.modelArg || {};
      const kg = modelArg.knownGood || [];
      if (MODEL_SENTINELS.includes(out.model)) {
        // `verified-latest` (the only sentinel today) resolves to the adapter's
        // DECLARED `hopperDefault` — see resolveVerifiedLatest in cli/src/policy.js
        // for why that replaced the old knownGood[0] inference. The RESOLVED REAL
        // NAME (not the sentinel literal) is what reaches argv + output.md
        // frontmatter, because out.model is overwritten here, upstream of every
        // consumer of this opts object.
        const resolvedName = resolveVerifiedLatest(modelArg);
        if (resolvedName) {
          notices.push(`model sentinel '${out.model}' → ${resolvedName} (${resolved.vendor} hopper default)`);
          out.model = resolvedName;
        } else {
          notices.push(`model sentinel '${out.model}': vendor '${resolved.vendor}' declares no hopper default — omitting --model so the vendor/account picks.`);
          out.model = undefined;
          // The sentinel path ALSO ends unpinned, and it is the path most
          // dispatches actually take: the scaffold writes `Model rule:
          // verified-latest` for every review task-type, which sets out.model
          // above and therefore skips the per-vendor block entirely. Without
          // this call the platform warning would almost never fire — verified
          // live, the first version of it never printed once.
          pushUnpinnedPlatformNotice(notices, resolved.vendor);
        }
      } else {
        out.model = normalizeModel(resolved.vendor, out.model, kg);
      }
    } catch (_) { /* normalization is advisory; keep the original on any error */ }
  }
  out.requestedSelector = requestedSelector;
  out.effectiveSelector = carriesEffectiveSelector ? inheritedEffectiveSelector : (out.model || null);
  out.effectiveSelectorSource = ['user-argv', 'policy', 'vendor-default'].includes(inheritedEffectiveSource)
    ? inheritedEffectiveSource
    : (out.effectiveSelector === null
      ? 'vendor-default'
      : (modelResolvedByPolicy ? 'policy' : 'user-argv'));
  // Permission default (precedence, most specific first):
  //   1. explicit --sandbox (already in out.sandbox) wins
  //   2. read-only task TEXT (brief/spec says read-only / 只读)
  //   3. read-only-by-default TASK-TYPE (review / research — must not edit the repo)
  //   4. global HOPPER_DEFAULT_SANDBOX, else the product default (danger-full-access)
  // codex's sandbox-BYPASS is platform-split (2026-07-31; see codexSandboxBypassActive()
  // in vendors/codex.js): on Windows the `-s` harness cannot spawn ANY child (1326), so
  // bypass stays the default there and codex ALWAYS runs full-access regardless of the
  // requested sandbox — force the resolved sandbox to full-access so the displayed value
  // matches what the adapter actually runs (this overrides even an explicit --sandbox;
  // showing read-only while actually running full-access would be a lie). On macOS/Linux
  // codex's own `-s <mode>` sandbox is verified working, so bypass is OFF by default there
  // and the normal precedence below applies (a read-only-default task-type genuinely gets
  // `-s read-only`). `adapterOpts.platform` is a test-only override (real dispatch always
  // reads the host's actual process.platform); production callers never set it.
  const platformForCodex = adapterOpts.platform ?? process.platform;
  const codexAlwaysFullAccess = resolved?.vendor === 'codex'
    && codexSandboxBypassActive(platformForCodex);
  if (codexAlwaysFullAccess) {
    out.sandbox = 'danger-full-access';
  } else if (!out.sandbox) {
    if (taskTextRequestsReadOnly(resolved)) out.sandbox = 'read-only';
    else if (taskType && READ_ONLY_DEFAULT_TASK_TYPES.includes(taskType)) out.sandbox = 'read-only';
    else out.sandbox = resolveDefaultSandbox();
  }
  // Web search: auto-enable for web-needing task-types (prd-research / market-research)
  // unless the caller already decided. An explicit --web-search sets out.webSearch=true
  // before this runs; only web-capable adapters (codex/claude/copilot) act on it.
  // HOPPER_WEB_SEARCH=0 opts out of the auto-enable (not out of an explicit
  // --web-search, which is set above and is a decision rather than a default).
  // A research task over a purely local corpus does not want live web search
  // pulling external content in.
  if (out.webSearch == null && process.env.HOPPER_WEB_SEARCH !== '0'
      && taskType && WEB_SEARCH_TASK_TYPES.includes(taskType)) {
    out.webSearch = true;
  }
  // ── --reasoning fallback chain (batch 2): flag > AGENTS.md Effort policy cell >
  // HOPPER_DEFAULT_REASONING > xhigh. Record the source as part of the effective
  // adapter contract: OpenCode can forward an operator's explicit CLI choice as
  // its provider-specific --variant, while safely omitting a synthesized global
  // default for arbitrary/custom providers. The source survives a second resolver
  // pass in executeWithAdapter() and the background runner's JSON handoff.
  // This is safe BY DESIGN together with the idle-timeout
  // primitive: a slower max-effort run is not killed for being slow, only for going
  // silent. Injected at the DISPATCH layer (not in each adapter), so adapters' own
  // opt-in defaults — and their unit tests — are unaffected.
  const inheritedReasoningSource = ['user-argv', 'policy', 'default'].includes(adapterOpts.reasoningSource)
    ? adapterOpts.reasoningSource
    : null;
  let reasoningSource = inheritedReasoningSource
    || (out.reasoning != null ? 'user-argv' : null);
  if (out.reasoning == null) {
    let fromPolicy = null;
    if (resolved?.policy?.effortPolicy) {
      const parsedEffort = parseEffortPolicyCell(resolved.policy.effortPolicy, resolved?.vendor);
      if (parsedEffort.status === 'ok') {
        fromPolicy = parsedEffort.value;
        notices.push(`effort resolved from AGENTS.md Effort policy (task-type '${taskType}'): ${fromPolicy}`);
      } else if (parsedEffort.status === 'unparseable') {
        notices.push(`Effort policy cell for task-type '${taskType}' is unparseable ('${String(resolved.policy.effortPolicy).trim()}') — falling back to HOPPER_DEFAULT_REASONING/xhigh.`);
      }
      // 'unbound' (empty / OOB / table doesn't name this vendor) is silent — falls
      // through to the next level, same convention as an unbound Default-vendor cell.
    }
    out.reasoning = fromPolicy || resolveDefaultReasoning();
    reasoningSource = fromPolicy ? 'policy' : 'default';
  }
  out.reasoningSource = reasoningSource;
  // Clamp visibility (req #2): a vendor that cannot accept the resolved level
  // (whichever chain step it came from — flag, policy, or default) used to remap it
  // SILENTLY inside the adapter (grok/copilot: xhigh->high, minimal->low). Surface
  // that as an explicit notice instead. computeEffortClamp is a no-op (null notice)
  // for vendors that don't clamp at all (in-range, or reasoningArg.knownGood is empty —
  // Kimi/Claude/Agy and OpenCode, which has no universal provider enum).
  if (out.reasoning && resolved?.vendor) {
    try {
      const reasoningKg = getAdapter(resolved.vendor)?.capabilities?.reasoningArg?.knownGood || [];
      const clamp = computeEffortClamp(resolved.vendor, out.reasoning, reasoningKg);
      if (clamp.notice) notices.push(clamp.notice);
    } catch (_) { /* clamp visibility is advisory; never block dispatch */ }
  }
  return out;
}

/**
 * Dispatch gate: refuse to dispatch to a vendor whose adapter declares `dispatchDisabled`
 * unless the caller has explicitly opted in via that adapter's `enableEnv` (=== '1'). This is
 * the single chokepoint enforced by BOTH the sync and background dispatch paths (and swarm,
 * which fans out through the background path), so a disabled vendor cannot be reached by any
 * route — `--vendor`, AGENTS.md routing, adhoc, or panel. Non-dispatch surfaces (doctor /
 * --vendors / --resolve) do NOT call this, so a disabled vendor is still listed + introspectable.
 * Throws a clear, actionable Error when blocked; returns silently otherwise.
 * @param {string} vendor
 * @param {Record<string,string|undefined>} [env]
 */
export function assertVendorDispatchable(vendor, env = process.env) {
  let adapter;
  try { adapter = getAdapter(vendor); } catch (_) { return; } // unknown vendor handled elsewhere
  const gate = adapter && adapter.dispatchDisabled;
  if (!gate) return;
  if (env[gate.enableEnv] === '1') return; // explicit opt-in
  throw new Error(
    `Dispatch to vendor '${vendor}' is DISABLED: ${gate.reason} `
    + `If you understand the limitation and still want to dispatch, set ${gate.enableEnv}=1.`,
  );
}

/**
 * Refuse an effective read-only dispatch when the selected adapter explicitly
 * declares that it cannot enforce that sandbox. This is the shared sync and
 * background gate; callers must pass opts after resolveAdapterOptsForTask().
 */
export function assertAdapterSandboxEnforceable(adapter, effectiveAdapterOpts) {
  const permissions = adapter?.capabilities?.features?.permissions;
  const readOnlySandbox = permissions?.readOnlySandbox;
  const sandbox = effectiveAdapterOpts?.sandbox;
  if (adapter?.name === 'kimi' && sandbox === 'read-only' && readOnlySandbox?.enforceable === false) {
    const failureCode = readOnlySandbox.failureCode;
    const error = new Error(
      `${failureCode}: Kimi prompt mode has no permission or sandbox flag that can enforce read-only. `
      + '`--write` is a Hopper-only output-artifact option, not a Kimi launch or permission flag; it does not change vendor permissions or make read-only enforceable. '
      + 'An explicit non-read-only sandbox would instead run with unverified Kimi prompt-mode permissions and is incompatible with a read-only lane. '
      + 'Use an enforceable read-only vendor, or only a Hopper-supported proven external process guard. Kimi is rejected before any vendor process or external guard can run.',
    );
    error.code = failureCode;
    error.exitCode = 2;
    throw error;
  }

  // Generic, DECLARATION-DRIVEN gate (added 2026-08-10 alongside the pi adapter).
  // The Kimi branch above is name-keyed and stays byte-identical because its
  // guidance is bespoke prose; everything else is driven by what the adapter
  // declares, so a new vendor that cannot express one of hopper's sandbox modes
  // is refused without another edit here.
  //
  // Why refuse rather than approximate: hopper's modes are ordered
  // read-only < workspace-write < danger-full-access. When an adapter cannot
  // express the requested mode, the only two options are to grant LESS than
  // asked (the task cannot do its job) or MORE (the caller believes they are
  // confined and are not). pi is the live case — it has no per-path permission
  // model, so `workspace-write` would silently become unrestricted host access.
  // Refusing makes the operator name the access they actually want.
  const declaration = permissions?.[SANDBOX_DECLARATION_KEY[sandbox]];
  if (!declaration || declaration.enforceable !== false) return;
  const failureCode = declaration.failureCode || 'E_SANDBOX_UNENFORCEABLE';
  const error = new Error(
    `${failureCode}: vendor '${adapter?.name}' cannot enforce the requested \`${sandbox}\` sandbox. `
    + `${declaration.mechanism || ''} `
    + 'Refused before spawn: a sandbox hopper cannot enforce must not be presented as one that it can.',
  );
  error.code = failureCode;
  error.exitCode = 2;
  throw error;
}

/** hopper sandbox mode → the adapter capability key that declares its enforceability. */
const SANDBOX_DECLARATION_KEY = Object.freeze({
  'read-only': 'readOnlySandbox',
  'workspace-write': 'workspaceWriteSandbox',
  'danger-full-access': 'dangerFullAccessSandbox',
});

/**
 * Execute dispatch end-to-end: resolve + adapter preflight + subprocess spawn + parse.
 *
 * Per spec §3 #4 (no harness reaction core): ONE adapter call = ONE subprocess
 * spawn attempt. No retry on failure. If adapter.envPreflight() returns ok=false,
 * we abort BEFORE spawning (no point invoking known-broken environment).
 *
 * @param {object} args
 * @param {string} args.hopperDir
 * @param {string} args.taskId
 * @param {import('./types.js').AdapterOpts} [args.adapterOpts]
 * @returns {Promise<{
 *   task: import('./types.js').TaskRow,
 *   vendor: string,
 *   output: import('./types.js').TaskOutput,
 *   raw: import('./types.js').SubprocessResult,
 * }>}
 */
export async function executeDispatch({ hopperDir, taskId, adapterOpts = {} }) {
  const resolved = await resolveDispatch({ hopperDir, taskId });
  const adapter = getAdapter(resolved.vendor);
  // Retro #3 fix: sync-mode vendor runs in the repo root that owns .hopper/
  // (or $HOPPER_VENDOR_CWD if set), not the dir hopper-dispatch was invoked from.
  return executeWithAdapter({ resolved, adapter, adapterOpts, cwd: resolveVendorCwd(hopperDir), hopperDir });
}

/**
 * Lower-level dispatch entry: takes already-resolved task + adapter directly.
 * Enables E2E testing per codex Phase 2 audit F3 (inject a fake adapter +
 * counter-binary to prove one-spawn-per-dispatch end-to-end).
 *
 * @param {object} args
 * @param {object} args.resolved      Output of resolveDispatch
 * @param {import('./types.js').VendorAdapter} args.adapter
 * @param {import('./types.js').AdapterOpts} [args.adapterOpts]
 */
export async function executeWithAdapter({ resolved, adapter, adapterOpts = {}, cwd = null, hopperDir = null }) {
  const { task, vendor, composedPrompt } = resolved;
  // Dispatch gate — the canonical sync spawn chokepoint (covers the CLI sync path AND any other
  // caller, e.g. executeDispatch). A vendor disabled by capability (agy headless-output) is
  // blocked here unless explicitly opted in. Throws before any subprocess is spawned.
  assertVendorDispatchable(vendor);
  const dispatchAdapterOpts = resolveAdapterOptsForTask(resolved, adapterOpts);
  assertAdapterSandboxEnforceable(adapter, dispatchAdapterOpts);
  // An explicit subject root is a forced process guard. Validate it before
  // adapter preparation and before any vendor spawn; unsupported macOS backend
  // or a non-read-only effective sandbox fail closed.
  prepareSubjectRootGuard({
    subjectRoot: dispatchAdapterOpts.subjectRoot,
    sandbox: dispatchAdapterOpts.sandbox,
  });

  // envPreflight — if not ok, fail FAST without spawning subprocess
  const preflight = adapter.envPreflight();
  if (!preflight.ok) {
    return {
      task,
      vendor,
      output: {
        text: '',
        status: 'auth-fail',
        error: `Adapter ${vendor} preflight failed: ${preflight.missing.join(' | ')}`,
      },
      raw: { exitCode: -1, stdout: '', stderr: '', timedOut: false, durationMs: 0 },
    };
  }

  // Prepare log file if adapter wants one (codex F2 silent-fail detection)
  let logPath = null;
  if (typeof adapter.prepareLog === 'function') {
    const hint = adapter.prepareLog(task.id, adapter.name);
    logPath = hint.logPath || null;
  }

  // Build args (adapter may want logFile threaded through opts).
  // Phase 6c F1: include task.taskType so timeoutMs can apply review-task floor.
  // Thread the resolved vendor CWD through opts so adapters that take a
  // working-dir flag (e.g. opencode --dir) can pass it explicitly.
  const effectiveOpts = { ...dispatchAdapterOpts, logFile: logPath, taskType: task.taskType, cwd: cwd || undefined };

  // Spawn subprocess ONCE (per spec §3 #4).
  // Phase 6c F2: resolve adapter.command with deterministic known-install
  // paths (NOT vendor-retry orchestration) so installers that don't add
  // their bin to PATH (agy on Windows) still work. Resolved FIRST so size-gated
  // prompt delivery knows the OS command-line regime (cmd.exe shim vs native .exe).
  const resolvedCmd = resolveCommandWithKnownPaths(adapter.command, adapter.knownInstallPaths || []);
  const spawnCommand = resolvedCmd ? resolvedCmd.command : adapter.command;
  const prependArgs = resolvedCmd ? resolvedCmd.prependArgs : [];

  // Size-gated prompt delivery (ISSUE-codex-bypass-flag-missing-from-argv): inline
  // small prompts; for an over-budget command line write handoffs/<task>-prompt.md
  // and pass the vendor a small "read this file" pointer. Needs hopperDir to locate
  // handoffs/; without it (e.g. direct-injected E2E adapters) fall back to inline.
  let args;
  let delivery = null;
  if (hopperDir) {
    delivery = resolvePromptDelivery({
      adapter, composedPrompt, opts: effectiveOpts,
      resolvedCmd: spawnCommand, prependArgs,
      handoffsDir: join(hopperDir, 'handoffs'), taskId: task.id,
    });
    if (delivery.fallbackReason) {
      // Pointer delivery was wanted but unusable → INLINE with bytes > budget (the
      // silent-no-op risk class). Surface it instead of falling back quietly.
      process.stderr.write(`hopper: WARNING prompt-file delivery fell back to INLINE — ${delivery.fallbackReason}. Command line ${delivery.bytes}B (budget ${delivery.budget}B, ${delivery.regime}); may be truncated on Windows cmd.exe.\n`);
    }
    args = delivery.args;
  } else {
    args = adapter.args(composedPrompt, effectiveOpts);
  }
  const spawnArgs = prependArgs.length > 0 ? [...prependArgs, ...args] : args;

  // STDIN delivery (win-cmd-shim): the delivery layer routes the full prompt to stdin
  // (adapter emitted a sentinel in argv). Prefer it over the static stdinMode check.
  const stdinInput = (delivery && delivery.channel === 'stdin' && delivery.stdinPrompt != null)
    ? delivery.stdinPrompt
    : (adapter.stdinMode === 'pipe' ? composedPrompt : null);
  // HOPPER-3: optional adapter env (e.g. codex CODEX_HOME auto-isolation).
  const adapterEnv = typeof adapter.env === 'function' ? adapter.env(effectiveOpts) : undefined;
  // 乙: idle + ceiling instead of a single total cap. The per-vendor
  // adapter.timeoutMs() now seeds the ceiling (floored to ≥30 min); idle (silence)
  // is the real "stuck" detector. --timeout / HOPPER_DISPATCH_TIMEOUT_MS override
  // the ceiling; HOPPER_IDLE_TIMEOUT_MS overrides idle.
  const { idleMs, ceilingMs } = resolveDispatchTimeouts(adapter.timeoutMs(effectiveOpts), effectiveOpts);
  const raw = await runSubprocessOnce({
    command: spawnCommand,
    args: spawnArgs,
    stdinInput,
    timeoutMs: ceilingMs,
    idleMs,
    // ISSUE-grok-claude-buffered-output-idle-falsekill: hopper-runner already skips
    // arming its idle poll for an adapter that declares `bufferedOutput: true`
    // (`Boolean(adapter && adapter.bufferedOutput === true)` in cli/bin/hopper-runner);
    // this sync path (hopper-dispatch -> executeWithAdapter -> runSubprocessOnce) was
    // the other consumer of the idle timer and silently ignored the same flag, so a
    // grok/claude dispatch here was unconditionally idle-killed ~idleMs after spawn —
    // before the end-buffered vendor ever wrote its single trailing blob. Read the
    // flag off the adapter (already in scope, same as vendorName below) rather than
    // widening runSubprocessOnce to accept a whole adapter object: subprocess.js stays
    // a plain-data, adapter-agnostic primitive, and this mirrors hopper-runner's own
    // resolution point almost verbatim for easy side-by-side audit.
    bufferedOutput: adapter.bufferedOutput === true,
    logFilePath: logPath,
    vendorName: adapter.name,
    cwd: cwd || undefined,
    env: adapterEnv,
    subjectRoot: dispatchAdapterOpts.subjectRoot,
    sandbox: dispatchAdapterOpts.sandbox,
  });

  // Parse result (adapter-specific failure classification)
  const output = adapter.parseResult(raw);

  return { task, vendor, output, raw };
}
