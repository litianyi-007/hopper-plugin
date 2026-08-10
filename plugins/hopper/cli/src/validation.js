// Centralized task-id and flag validation (codex Phase 4 audit P1 fix)
// Anchor: cli/src/validation.js
//
// Per Phase 4 audit: previously the regex `^[A-Za-z][A-Za-z0-9._-]{0,99}$`
// was duplicated across:
//   - commands/dispatch.md (prose in Claude Code slash command)
//   - hosts/codex-cli/bin/hopper-codex (bash wrapper)
//   - hosts/opencode/bin/hopper-opencode (bash wrapper)
//   - cli/src/output.js (validateTaskId function)
// and the dispatcher CLI itself had no equivalent validation at entry point.
//
// This module exports the canonical validation. The dispatcher CLI now calls
// it before any work. Wrappers keep their inline regex (defense in depth +
// fast-fail before subprocess invocation) but tests assert the patterns are
// byte-equivalent.

import { isSafeModelIdentifier } from './public-identifiers.js';

/** Canonical task-id pattern. Matches what dispatch.md / hopper-codex / hopper-opencode enforce. */
export const TASK_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,99}$/;

/** Canonical bare flag whitelist for dispatch invocations. */
export const ALLOWED_DISPATCH_FLAGS = Object.freeze(['--write', '--force', '--background', '--web-search']);

/** Value-taking flag whitelist (each consumes the next argv as its value). */
export const ALLOWED_DISPATCH_VALUE_FLAGS = Object.freeze(['--model', '--reasoning', '--sandbox', '--timeout', '--vendor', '--subject-root']);

/** Vendor-name pattern (mirrors registered adapter naming: lowercase alnum/dash). */
export const VENDOR_PATTERN = /^[a-z][a-z0-9-]{0,29}$/;

/**
 * Validate a `--vendor` override name (pattern only; the dispatcher additionally
 * checks it is a REGISTERED adapter and still enforces host != vendor). Throws on reject.
 */
export function validateVendor(name) {
  if (typeof name !== 'string' || !VENDOR_PATTERN.test(name)) {
    throw new Error(`--vendor "${name}" is not a valid vendor name (expected lowercase like codex / grok / kimi).`);
  }
  return name;
}

/**
 * Model-name pattern: alphanumeric + . - _ / : for namespaced model strings
 * (`gpt-5.5`, `claude-opus-4-7`, `deepseek/v4-flash`, `org/model:tag`), PLUS
 * space ( ) [ ] for the display-label aliases some vendors accept verbatim
 * (claude `opus[1m]`/`sonnet[1m]`; agy `Gemini 3.5 Flash (High)`) — these are
 * exactly the V4 normalizer's canonical outputs, so a user must be able to type
 * them too. Injection-safe: every spawn passes the value as one argv element
 * (no `shell: true`), and the leading [A-Za-z] still blocks `-flag` injection;
 * shell metacharacters (; | & $ ` ' ") remain disallowed.
 * Scope note: this relaxed regex applies to the JS dispatcher (CLI + dispatch.md),
 * where every model value is passed as a discrete argv element (no shell). The Tier
 * C bash wrappers under hosts/ (hopper-codex, hopper-cursor, etc.) deliberately keep
 * the STRICTER pre-relaxation pattern, because they interpolate `--model $1` UNQUOTED
 * into a prompt-embedded shell command — so spaces/parens must stay out there.
 * Display-label aliases are therefore a JS-dispatcher feature, not a Tier C one.
 */
export const MODEL_PATTERN = /^[A-Za-z][A-Za-z0-9._/:()[\] -]{0,99}$/;

/**
 * Reasoning effort whitelist. Matches codex CLI's vocabulary; OpenCode forwards
 * an explicitly requested value as its provider-specific --variant, while Kimi
 * and Claude have no prompt-mode effort argv. Other adapters may clamp or ignore
 * the canonical values according to their own contracts.
 *
 * Per Phase 6b vendor-introspection research 2026-05-21: codex actually
 * supports 5 levels (`minimal | low | medium | high | xhigh`), not 4.
 * Our prior whitelist missed `minimal`. Source: official codex config-reference.
 */
export const ALLOWED_REASONING = Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh']);

/**
 * Default reasoning/effort when a dispatch does not pass --reasoning. Product
 * decision (owner 2026-06-16): max out by default; explicit --reasoning or
 * HOPPER_DEFAULT_REASONING overrides. OpenCode deliberately does NOT forward this
 * synthesized default: only a caller's explicit --reasoning becomes OpenCode's
 * provider-specific --variant. Safe together with the idle-timeout primitive (a
 * slow max-effort run is killed only for going SILENT, not for being slow).
 */
export const DEFAULT_DISPATCH_REASONING = 'xhigh';

/**
 * Resolve the effective default reasoning: HOPPER_DEFAULT_REASONING (if a legal
 * level) > DEFAULT_DISPATCH_REASONING. Never throws (invalid env is ignored).
 * @returns {string}
 */
export function resolveDefaultReasoning() {
  const env = process.env.HOPPER_DEFAULT_REASONING;
  if (env && ALLOWED_REASONING.includes(env)) return env;
  return DEFAULT_DISPATCH_REASONING;
}

/**
 * Canonical sandbox / permission vocabulary for dispatch.
 *
 * `danger-full-access` is the product default for implementation work. The
 * dispatcher only downgrades to `read-only` when the task text explicitly says
 * it is read-only, or when the user passes --sandbox read-only.
 */
export const ALLOWED_SANDBOXES = Object.freeze(['read-only', 'workspace-write', 'danger-full-access']);
export const DEFAULT_DISPATCH_SANDBOX = 'danger-full-access';

/**
 * Resolve the effective DEFAULT sandbox when a dispatch neither passes --sandbox
 * nor matches a more-specific rule (read-only task text or a read-only task-type).
 * HOPPER_DEFAULT_SANDBOX (if a legal mode) > DEFAULT_DISPATCH_SANDBOX. Lets a
 * safety-conscious operator flip the global baseline (e.g. to workspace-write or
 * read-only) without editing each dispatch. Never throws (invalid env ignored).
 * @returns {string}
 */
export function resolveDefaultSandbox() {
  const env = process.env.HOPPER_DEFAULT_SANDBOX;
  if (env && ALLOWED_SANDBOXES.includes(env)) return env;
  return DEFAULT_DISPATCH_SANDBOX;
}

/**
 * Task-types that default to a READ-ONLY vendor sandbox — review / research work
 * that must not edit the repo. This is the opt-in policy layer that DOES infer
 * read-only from task-type, sitting BELOW explicit --sandbox and read-only task
 * text in precedence. A task that genuinely needs to write still wins by passing
 * --sandbox workspace-write / danger-full-access.
 */
export const READ_ONLY_DEFAULT_TASK_TYPES = Object.freeze([
  'code-review-adversarial',
  'code-review-acceptance',
  'decision-review',
  'spec-blindspot-hunt',
  'prd-research',
  'tech-research',
  'market-research',
]);

/**
 * Task-types that AUTO-ENABLE web search (defined as web-needing). The dispatch
 * layer sets opts.webSearch=true for these unless an explicit --web-search has
 * already set it; only web-capable adapters act on it (codex/claude/copilot).
 */
export const WEB_SEARCH_TASK_TYPES = Object.freeze([
  'prd-research',
  // `tech-research` evaluates implementation approaches, which almost always means
  // reading current upstream docs, release notes and issue trackers — the same
  // web-needing shape as product research, so it auto-enables the same way.
  // `decision-review` deliberately does NOT: adjudicating a fork the host has
  // already framed is a judgment over supplied context, not a survey.
  'tech-research',
  'market-research',
]);

/**
 * Legal queue status values per .hopper/queue.md schema convention.
 * Per codex final strict audit P1 (Category A): the parser previously mapped
 * unknown statuses to 'pending' silently, which meant a "failure-detected"
 * task would be re-eligibilized. Statuses are now validated explicitly.
 */
export const LEGAL_QUEUE_STATUSES = Object.freeze([
  'pending',
  'in-progress',
  'done',
  'failed',
  'removed',
]);

/**
 * Task-type pattern. Names a .hopper/tasks/<type>.md file directly, so it
 * needs the same path-safety guarantees as task-id.
 * Per codex final strict audit P1 (Category E): tasks.js previously did
 * `join(hopperDir, 'tasks', `${taskType}.md`)` without validation; a
 * malicious queue row could escape via '../' or absolute path.
 */
export const TASK_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,49}$/;

/**
 * Validate a task ID. Throws on rejection.
 * Per codex Phase 3 F3 + Phase 4 P1: regex + explicit '..' rejection.
 */
export function validateTaskId(id) {
  if (typeof id !== 'string') throw new Error(`task-id must be string, got ${typeof id}`);
  if (id.length === 0) throw new Error('task-id must not be empty');
  if (id.length > 100) throw new Error(`task-id exceeds 100 chars (got ${id.length})`);
  if (!TASK_ID_PATTERN.test(id)) {
    throw new Error(`task-id "${id}" contains unsafe characters. ` +
      `Allowed: ^[A-Za-z][A-Za-z0-9._-]{0,99}$ (no slashes, no leading dot).`);
  }
  if (id.includes('..')) {
    throw new Error(`task-id "${id}" contains '..' (path traversal).`);
  }
}

/**
 * Validate that all bare flags are in the allowed whitelist. Throws on rejection.
 * @param {string[]} flags
 */
export function validateDispatchFlags(flags) {
  for (const f of flags) {
    if (!ALLOWED_DISPATCH_FLAGS.includes(f)) {
      throw new Error(`Invalid flag "${f}". Allowed: ${ALLOWED_DISPATCH_FLAGS.join(', ')}.`);
    }
  }
}

/**
 * Validate a model name. Throws on rejection.
 *
 * Note: model strings are passed as argv to vendor CLIs, not used as file
 * paths, so the regex enforces shell-safety (no metachars, no spaces) rather
 * than path-safety. The character class intentionally permits `/` and `:`
 * because real model names like `deepseek/v4-flash` and `org/model:tag` use
 * them; these are not interpreted as path separators by the receiving CLI.
 */
export function validateModelName(model) {
  if (typeof model !== 'string') throw new Error(`--model value must be string, got ${typeof model}`);
  if (model.length === 0) throw new Error('--model value must not be empty');
  if (!MODEL_PATTERN.test(model) || !isSafeModelIdentifier(model)) {
    throw new Error('--model contains unsafe characters or an unsafe model identifier. ' +
      `Allowed: ${MODEL_PATTERN.source} — letters/digits . _ / : plus space ( ) [ ] for ` +
      `display-label aliases; no shell metachars (; | & $ \` ' " < >) and no leading '-'.`);
  }
}

/**
 * Validate a reasoning effort level. Throws on rejection.
 */
export function validateReasoning(reasoning) {
  if (typeof reasoning !== 'string') throw new Error(`--reasoning value must be string, got ${typeof reasoning}`);
  if (!ALLOWED_REASONING.includes(reasoning)) {
    throw new Error(`--reasoning "${reasoning}" invalid. Allowed: ${ALLOWED_REASONING.join(', ')}.`);
  }
}

/**
 * Validate a per-dispatch --timeout value (the absolute ceiling, in ms). Throws
 * on rejection. Range-guarded so a typo can neither be 0/negative nor absurdly
 * large. Returns the parsed integer.
 * @param {string|number} value
 * @returns {number}
 */
export const MIN_DISPATCH_TIMEOUT_MS = 1_000;
export const MAX_DISPATCH_TIMEOUT_MS = 21_600_000;  // 6h hard sanity ceiling
export function validateTimeout(value) {
  // codex review P2: reject partial/float inputs ("600000abc", "1000.5") rather
  // than letting Number.parseInt truncate them. Require a whole, all-digits value.
  let ms;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`--timeout ${value} is not an integer (milliseconds).`);
    ms = value;
  } else {
    const s = String(value).trim();
    if (!/^\d+$/.test(s)) throw new Error(`--timeout "${value}" is not an integer (milliseconds).`);
    ms = Number.parseInt(s, 10);
  }
  if (ms < MIN_DISPATCH_TIMEOUT_MS) throw new Error(`--timeout ${ms} too small (min ${MIN_DISPATCH_TIMEOUT_MS}ms).`);
  if (ms > MAX_DISPATCH_TIMEOUT_MS) throw new Error(`--timeout ${ms} too large (max ${MAX_DISPATCH_TIMEOUT_MS}ms = 6h).`);
  return ms;
}

/**
 * Validate a dispatch sandbox / permission mode. Throws on rejection.
 */
export function validateSandbox(sandbox) {
  if (typeof sandbox !== 'string') throw new Error(`--sandbox value must be string, got ${typeof sandbox}`);
  if (!ALLOWED_SANDBOXES.includes(sandbox)) {
    throw new Error(`--sandbox "${sandbox}" invalid. Allowed: ${ALLOWED_SANDBOXES.join(', ')}.`);
  }
}

/**
 * Vendor/host FAMILY map for the host!=vendor isomorphism guard. Two identities
 * in the SAME family are the same underlying product/company self-dispatching
 * through a different invocation surface — e.g. a Claude Code session (host
 * identity 'claude-code', see cli/src/host-detect.js) calling out to the
 * `claude` vendor adapter (`claude -p`) is literally Anthropic's own Claude
 * Code CLI talking to itself, just via a different entry point.
 *
 * Comparison is by family, NOT raw string equality, because the host identity
 * and the vendor name are not always the same string (host 'claude-code' vs
 * vendor 'claude' — there is no Tier-C wrapper that could ever set
 * HOPPER_HOST_VENDOR=claude-code, so a plain `===` check would never catch
 * this pair). For the 5 existing Tier-C wrappers, HOPPER_HOST_VENDOR already
 * equals the vendor's own name (codex, grok, copilot, opencode, cursor), so
 * this map's entries double as both the "host" and "vendor" side lookup key
 * for those.
 *
 * Basis for each mapped entry (checked against cli/src/vendors/*.js headers +
 * behavior 2026-07-31, not guessed):
 * - claude / claude-code -> anthropic: cli/src/vendors/claude.js — "Anthropic's
 *   first-party agentic coding CLI 'Claude Code'". 'claude-code' is the host
 *   identity produced by host-detect.js's self-detection (no wrapper sets it).
 * - codex -> openai: cli/src/vendors/codex.js — wraps `codex exec`, OpenAI's
 *   own Codex CLI; hosts/codex-cli's wrapper dispatches through the SAME CLI.
 * - grok -> xai: cli/src/vendors/grok.js header — "xAI's official first-party
 *   agentic coding CLI 'Grok Build'".
 * - kimi -> moonshot: cli/src/vendors/kimi.js header (Kimi Code CLI, Moonshot
 *   AI's own product); hosts/claude-code's auth table lists MOONSHOT_API_KEY.
 *
 * Deliberately NOT mapped (do not guess a family for these — checked and found
 * genuinely multi-backend, per 2026-07-31 audit):
 * - copilot: cli/src/vendors/copilot.js capabilities.modelArg.knownGood spans
 *   claude-family, gpt-family, AND gemini-family model names depending on the
 *   user's GitHub Copilot subscription tier — Copilot is a multi-backend
 *   router, not one model company. An unmapped name never matches any family,
 *   so copilot-cli host +
 *   copilot vendor (the one case that IS the same product self-dispatching)
 *   is NOT currently blocked by this guard — a known gap, out of scope here
 *   (only `claude` was in scope for this pass).
 * - opencode / mimo: both adapters document themselves as provider-agnostic
 *   routers — opencode.js: "actual catalog depends on the user's opencode auth
 *   configuration... NOT on this adapter"; mimo.js: "MiMoCode fork" accepting
 *   arbitrary `--model <provider/model>` pairs. No single family applies.
 * - agy: cli/src/vendors/agy.js capabilities.modelArg.knownGood is all
 *   Gemini-labeled (suggesting Google), but the same comment notes Claude/
 *   GPT-OSS labels also appear in the picker (plan-gated) — i.e. agy is ALSO
 *   multi-backend, just Gemini-default. Left unmapped rather than guessed.
 * - pi: cli/src/vendors/pi.js is explicitly a multi-provider router — its
 *   `--model` takes `<provider>/<id>` across openai-codex / anthropic / google /
 *   others, and `pi --list-models` returns whatever THAT machine is logged into.
 *   No single model company owns it, so no family applies. Consequence: a
 *   (hypothetical) pi host dispatching to the pi vendor would not be blocked by
 *   this guard — same known gap as copilot, and for the same reason.
 * - cursor: hosts/cursor-cli sets HOPPER_HOST_VENDOR=cursor, but there is no
 *   registered `cursor` vendor adapter at all (cli/src/vendors/index.js) —
 *   nothing to map on the vendor side, so this host can never self-match.
 */
export const VENDOR_FAMILY = Object.freeze({
  claude: 'anthropic',
  'claude-code': 'anthropic',
  codex: 'openai',
  grok: 'xai',
  kimi: 'moonshot',
});

/**
 * Enforce the product rule that a host must not dispatch back into the same
 * vendor identity/family.
 *
 * hostVendor may be omitted entirely (`undefined`/empty) by a caller that has
 * no signal at all — that legacy standalone path stays fully silent (returns
 * `{ enforced: false }`) for backward compatibility. But once a caller HAS a
 * hostVendor value (whether from the explicit HOPPER_HOST_VENDOR env, set by
 * every Tier-C wrapper, or from host-detect.js's self-detection, which always
 * returns a concrete string — see HOST_UNKNOWN there), this function never
 * silently no-ops again: if that value's family cannot be resolved (including
 * the literal 'unknown' self-detection sentinel, or any future/unrecognized
 * host string), it returns `{ enforced: false, notice }` where `notice`
 * explicitly says the isomorphism check did not run — callers MUST surface
 * this, not swallow it (this project treats silent skips as a defect class).
 *
 * @param {string | undefined} hostVendor
 * @param {string} resolvedVendor
 * @returns {{ enforced: boolean, notice?: string }}
 */
export function validateHostVendorSeparation(hostVendor, resolvedVendor) {
  if (!hostVendor) return { enforced: false };
  if (typeof resolvedVendor !== 'string' || resolvedVendor.length === 0) {
    throw new Error(`resolved vendor must be non-empty string, got ${typeof resolvedVendor}`);
  }
  const hostFamily = VENDOR_FAMILY[hostVendor];
  if (!hostFamily) {
    return {
      enforced: false,
      notice: `host '${hostVendor}' not recognized (no known vendor-family mapping) — ` +
        `host != vendor isomorphism check NOT run for this dispatch.`,
    };
  }
  const vendorFamily = VENDOR_FAMILY[resolvedVendor];
  if (vendorFamily && hostFamily === vendorFamily) {
    throw new Error(
      `Host '${hostVendor}' cannot dispatch to the same vendor '${resolvedVendor}' (both are ${hostFamily}: host != vendor). ` +
      `hopper-plugin requires host != vendor. Choose a different vendor in .hopper/AGENTS.md or invoke from a different host.`
    );
  }
  return { enforced: true };
}

/**
 * Validate a task-type string. Per codex final strict audit P1 (Category E):
 * task-type names a `.hopper/tasks/<type>.md` file path, so it must be
 * lowercase, kebab-case, no path separators, no '..'.
 */
export function validateTaskType(taskType) {
  if (typeof taskType !== 'string') throw new Error(`task-type must be string, got ${typeof taskType}`);
  if (taskType.length === 0) throw new Error('task-type must not be empty');
  if (!TASK_TYPE_PATTERN.test(taskType)) {
    throw new Error(`task-type "${taskType}" contains unsafe characters. ` +
      `Allowed: ^[a-z][a-z0-9-]{0,49}$ (lowercase kebab-case, no slashes, no '..').`);
  }
  if (taskType.includes('..')) {
    throw new Error(`task-type "${taskType}" contains '..' (path traversal).`);
  }
}

/**
 * Returns true if status is a legal queue status, false otherwise.
 * Caller decides whether to throw or just warn.
 */
export function isLegalQueueStatus(status) {
  return LEGAL_QUEUE_STATUSES.includes(status);
}
