// Task-type policy cell parsing — Effort policy / Model rule columns in the
// .hopper/AGENTS.md task-vendor-preference table (batch 2, 2026-07: mechanizes
// the two columns that used to be pure prose so dispatch can actually CONSUME
// them, not just display them).
// Anchor: cli/src/policy.js
//
// Pure parsing + resolution helpers — no I/O, no vendor knowledge beyond the
// (vendor, knownGood) values the caller passes in. Consumed by:
//   - dispatch.js  (resolveAdapterOptsForTask: --reasoning / --model fallback chains)
//   - setup.js     (--setup "Task-type policy" lint section)
//
// Shared OOB convention (same as the Default-vendor column, see agents.js):
// a cell that STARTS WITH '(' is a note, not a binding — e.g. `(bind per
// project)`. Parsed as unbound, never as an error.

/** OOB convention shared with the Default-vendor column. */
export function isOobCell(raw) {
  return typeof raw === 'string' && /^\s*\(/.test(raw.trim());
}

function stripBackticks(s) {
  if (!s) return s;
  return s.replace(/^`/, '').replace(/`$/, '').trim();
}

// Duplicated (not imported) from validation.js's ALLOWED_REASONING on purpose:
// this module must stay dependency-free of validation.js's CLI-flag concerns
// (e.g. HOPPER_DEFAULT_REASONING resolution) — it only needs the vocabulary.
// Kept byte-identical; a unit test cross-checks the two stay in sync.
export const ALLOWED_REASONING_LEVELS = Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh']);

/** Canonical ordinal scale (index = ordinal position), used by clamp-direction labeling. */
const CANONICAL_EFFORT_ORDER = ALLOWED_REASONING_LEVELS;

/**
 * Parse an Effort policy cell for a specific vendor. Two accepted forms:
 *   - single token:      `medium`                      (vendor-agnostic)
 *   - per-vendor table:  `codex:xhigh, grok:high`       (comma-separated pairs)
 *
 * @param {string} raw     the raw table-cell text
 * @param {string} vendor  the resolved vendor for this task-type (may be '' /
 *                         null if the task-type has no vendor binding yet —
 *                         the single-token form still resolves in that case;
 *                         the per-vendor form cannot select an entry)
 * @returns {{ status: 'ok'|'unbound'|'unparseable', value: string|null }}
 *   - 'ok':          a concrete reasoning level was resolved for this vendor
 *   - 'unbound':     empty / OOB cell, OR a well-formed per-vendor table that
 *                    simply doesn't name this vendor — NOT an error, just
 *                    "no policy for you", falls back to the next chain level
 *   - 'unparseable': the cell has content but matches neither accepted form
 */
export function parseEffortPolicyCell(raw, vendor) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed || isOobCell(trimmed)) return { status: 'unbound', value: null };

  // Per-vendor table form: comma-separated `vendor:level` pairs.
  if (trimmed.includes(':')) {
    const pairs = trimmed.split(',').map((s) => stripBackticks(s.trim())).filter(Boolean);
    if (pairs.length === 0) return { status: 'unparseable', value: null };
    const map = {};
    for (const pair of pairs) {
      const m = pair.match(/^([a-z][a-z0-9-]*)\s*:\s*([a-z]+)$/i);
      if (!m || !ALLOWED_REASONING_LEVELS.includes(m[2].toLowerCase())) {
        return { status: 'unparseable', value: null };
      }
      map[m[1].toLowerCase()] = m[2].toLowerCase();
    }
    const v = (vendor || '').toLowerCase();
    if (v && Object.prototype.hasOwnProperty.call(map, v)) {
      return { status: 'ok', value: map[v] };
    }
    // Parses fine, just doesn't name this vendor (or there is no vendor yet) —
    // no value FOR THIS VENDOR; the next fallback level takes over.
    return { status: 'unbound', value: null };
  }

  // Single-token form — vendor-agnostic, applies to whichever vendor dispatches.
  const token = stripBackticks(trimmed).toLowerCase();
  if (ALLOWED_REASONING_LEVELS.includes(token)) return { status: 'ok', value: token };
  return { status: 'unparseable', value: null };
}

/**
 * Model-rule sentinel registry. `verified-latest` is the only entry today
 * (resolves to the vendor adapter's `capabilities.modelArg.knownGood[0]` —
 * see resolveVerifiedLatest below and the ordering convention documented on
 * codex.js's knownGood array). Extend this array, not the call sites, when a
 * second sentinel is added.
 */
export const MODEL_SENTINELS = Object.freeze(['verified-latest']);

/**
 * Parse a Model rule cell. The column holds a SENTINEL NAME, never a literal
 * vendor model id — that keeps the AGENTS.md binding decoupled from any one
 * vendor's naming scheme (a project should not have to hand-write "gpt-5.5"
 * into a vendor-neutral policy table).
 * @param {string} raw
 * @returns {{ status: 'ok'|'unbound'|'unparseable', sentinel: string|null }}
 */
export function parseModelRuleCell(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed || isOobCell(trimmed)) return { status: 'unbound', sentinel: null };
  const bare = stripBackticks(trimmed);
  if (MODEL_SENTINELS.includes(bare)) return { status: 'ok', sentinel: bare };
  return { status: 'unparseable', sentinel: null };
}

/**
 * Resolve the `verified-latest` sentinel for a vendor to the model hopper
 * prefers for hopper-shaped work.
 *
 * READS `capabilities.modelArg.hopperDefault` — an EXPLICIT declaration, not an
 * inference from array order.
 *
 * WHY THE FIELD EXISTS (2026-08-11). This used to return `knownGood[0]`, which
 * silently conflated two different things: `knownGood` is "models known to
 * work" (a catalog, used for normalization and drift reconciliation), while the
 * sentinel needs "the model hopper wants" (an intent). codex's knownGood
 * documents an ordering convention that makes index 0 meaningful; `claude`'s
 * does not — its knownGood is an UNORDERED alias set (`sonnet, opus, haiku,
 * fable, …`) and its own sourceNote says the adapter deliberately omits
 * `--model` because reachable tiers depend on the account's entitlements. So
 * `verified-latest` resolved to `sonnet` for claude and would silently DOWNGRADE
 * an opus account — on the scaffold's own default task-type table, which writes
 * `Model rule: verified-latest` for every review type.
 *
 * Hopper's preference deliberately need NOT match the vendor agent's own
 * default: work dispatched through hopper is adversarial review, blindspot
 * hunting and high-reasoning judgment, which can justify a different (usually
 * stronger) model than the vendor picks for interactive use.
 *
 * Returns null when there is nothing usable to pin — an explicit
 * `hopperDefault: null`, an empty catalog, or a documentation placeholder like
 * opencode's `<provider>/<model>` — so callers OMIT `--model` and let the vendor
 * choose, rather than forwarding a placeholder as a real argv value.
 *
 * @param {{hopperDefault?: string|null, knownGood?: string[]}|string[]} modelArg
 *   the adapter's `capabilities.modelArg` (a bare knownGood array is accepted
 *   as a legacy form)
 * @returns {string|null}
 */
export function resolveVerifiedLatest(modelArg) {
  const caps = modelArg && typeof modelArg === 'object' && !Array.isArray(modelArg) ? modelArg : null;

  // An adapter that DECLARES hopperDefault has answered the question, including
  // when it answers `null`. `null` is a statement ("hopper has no preference for
  // this vendor — let the account/CLI decide"), which is materially different
  // from not having been asked yet, so it is honored rather than falling through.
  if (caps && Object.hasOwn(caps, 'hopperDefault')) {
    const declared = caps.hopperDefault;
    if (declared === null) return null;
    return isUsableSelector(declared) ? declared.trim() : null;
  }

  // Legacy fallback for an adapter that predates the field: infer from
  // knownGood[0]. This is exactly the inference that made `claude` resolve to
  // `sonnet` — see the field's jsdoc — so it stays only as a floor for an
  // adapter that has not yet stated its intent.
  const list = Array.isArray(modelArg) ? modelArg : (caps ? caps.knownGood : null);
  const first = Array.isArray(list) ? list[0] : null;
  return isUsableSelector(first) ? first : null;
}

/** A selector hopper may actually pass to a vendor: a non-empty, non-placeholder string. */
function isUsableSelector(value) {
  // `<provider>/<model>` (opencode) is documentation of a FORMAT, not a model.
  return typeof value === 'string' && value.trim() !== '' && !/^<.*>$/.test(value.trim());
}

/**
 * Generic effort clamp: map a requested reasoning level onto the nearest
 * level a vendor's `reasoningArg.knownGood` enum actually supports, by
 * canonical-ordinal distance. This reproduces what grok/copilot's adapter-
 * private clamp functions already do (xhigh->high, minimal->low) WITHOUT
 * needing a vendor-specific function — any vendor whose knownGood is a
 * (possibly sparse) subset of the canonical 5-level scale gets a sensible
 * clamp for free. Vendors with an EMPTY knownGood (Kimi/Claude/Agy, plus
 * OpenCode because its variants are provider/model-specific) are correctly
 * treated as "not applicable" (returns null), not "everything is out of range".
 * @param {string} requested
 * @param {string[]} vendorKnownGood
 * @returns {string|null} the clamped level, or null if not applicable/no clamp needed
 */
export function genericClampEffort(requested, vendorKnownGood) {
  if (!Array.isArray(vendorKnownGood) || vendorKnownGood.length === 0) return null;
  if (vendorKnownGood.includes(requested)) return requested; // already in range — no clamp
  const reqIdx = CANONICAL_EFFORT_ORDER.indexOf(requested);
  if (reqIdx === -1) return null; // not even a canonical level — nothing to clamp
  let best = null;
  let bestDist = Infinity;
  for (const level of vendorKnownGood) {
    const idx = CANONICAL_EFFORT_ORDER.indexOf(level);
    if (idx === -1) continue;
    const dist = Math.abs(idx - reqIdx);
    if (dist < bestDist) { bestDist = dist; best = level; }
  }
  return best;
}

/**
 * Compute a human-readable clamp notice (req #2: "clamp visibility" — no more
 * silent vendor-side remapping). Returns `{ inRange, clamped, notice }`;
 * `notice` is null when no clamp happened (in-range, or vendor doesn't clamp
 * at all — e.g. Kimi/Claude/Agy, plus OpenCode whose variants have no universal
 * adapter enum).
 * @param {string} vendor
 * @param {string} requested          the resolved effort BEFORE vendor clamping
 * @param {string[]} vendorKnownGood  vendor's capabilities.reasoningArg.knownGood
 * @returns {{ inRange: boolean, clamped: string|null, notice: string|null }}
 */
export function computeEffortClamp(vendor, requested, vendorKnownGood = []) {
  if (!requested) return { inRange: true, clamped: null, notice: null };
  if (!Array.isArray(vendorKnownGood) || vendorKnownGood.length === 0) {
    return { inRange: true, clamped: null, notice: null }; // no universal adapter enum to clamp against
  }
  if (vendorKnownGood.includes(requested)) return { inRange: true, clamped: null, notice: null };
  const clamped = genericClampEffort(requested, vendorKnownGood);
  if (!clamped || clamped === requested) return { inRange: false, clamped: null, notice: null };
  const reqIdx = CANONICAL_EFFORT_ORDER.indexOf(requested);
  const clampedIdx = CANONICAL_EFFORT_ORDER.indexOf(clamped);
  const bound = reqIdx > clampedIdx ? ' max' : (reqIdx < clampedIdx ? ' min' : '');
  return {
    inRange: false,
    clamped,
    notice: `effort ${requested} → clamped to ${clamped} (${vendor}${bound})`,
  };
}
