// Discipline for adapter failure classifiers.
// Anchor: cli/src/vendor-signal.js
//
// WHY THIS EXISTS (2026-08-05 incident, confirmed by adversarial review)
// ---------------------------------------------------------------------
// Two paid grok reviews completed successfully — full envelopes, `end_turn`,
// 16854 characters of findings, $0.32 — and were recorded as `auth-fail`.
// Nothing about authentication had failed. The chain:
//
//   1. In BACKGROUND mode the runner writes vendor stdout, vendor stderr and its
//      own notices to ONE interleaved file, then hands that same string to
//      parseResult as BOTH `raw.stdout` AND `raw.stderr` (hopper-runner, with a
//      comment saying so). Every "stderr-only" classifier was therefore scanning
//      assistant prose.
//   2. The vendor's own startup warning about a malformed `~/.cursor/hooks.json`
//      contained the word `invalid`.
//   3. grok's auth matcher spelled the qualifier as OPTIONAL —
//      `invalid(?:\s+(?:api\s*)?key)?` — so a bare `invalid` matched.
//
// This module exists so no classifier can repeat that by accident. It does not
// separate the streams (that needs an in-process tee in the same code region as a
// known idle-watchdog false-kill, and does not belong in the same change as the
// parser fix). What it does is remove the lie and force each site to decide
// knowingly.
//
// THE RULE
// --------
// A substring heuristic may never override the vendor's own evidence that it
// finished. Heuristics answer "what went wrong"; they must not be allowed to
// answer "did anything go wrong" when the vendor already answered it.
//
// The veto is deliberately NARROW. It covers only vendor-reported outcomes.
// Infrastructure failures — timeout, prompt-delivery failure, a sandbox/subject
// guard violation, a missing binary proven by exit 127 — are established by the
// harness, not by parsing vendor text, and are checked BEFORE any of this. A rule
// of "a parseable envelope can never be overridden" would be unsafe, and is not
// what this implements.

/**
 * The text a failure classifier is allowed to scan, plus whether the streams it
 * came from were actually separated.
 *
 * `separated: false` is the background case and means: this text contains the
 * assistant's own prose. Any classifier reading it is matching against whatever
 * the model happened to write, so it MUST be gated (see `heuristicsAllowed`)
 * rather than trusted on its own.
 *
 * @param {{stdout?: string, stderr?: string, combined?: string, streamsSeparated?: boolean}} raw
 * @returns {{ text: string, separated: boolean }}
 */
export function diagnosticSignal(raw = {}) {
  if (raw.streamsSeparated === false) {
    return { text: String(raw.combined ?? raw.stdout ?? ''), separated: false };
  }
  return { text: `${raw.stdout || ''}\n${raw.stderr || ''}`, separated: true };
}

/**
 * May text heuristics decide this run's outcome?
 *
 * No, when the adapter extracted a parser-designated answer AND the vendor
 * reported a successful terminal state AND the process exited 0. In that case the
 * vendor has already told us it finished; scanning its prose for scary words can
 * only produce a false negative.
 *
 * @param {object} o
 * @param {number|null|undefined} o.exitCode
 * @param {boolean} o.hasAnswer          a parser-designated, non-empty answer was extracted
 * @param {boolean} o.terminalSuccess    the vendor's own terminal marker says it completed
 * @returns {boolean}
 */
export function heuristicsAllowed({ exitCode, hasAnswer, terminalSuccess }) {
  return !(exitCode === 0 && hasAnswer === true && terminalSuccess === true);
}

/**
 * Normalize a vendor terminal-reason token for comparison.
 *
 * Vendors spell the same state differently across versions and output modes —
 * grok's own logs carry `end_turn` while the adapter only recognized `EndTurn`,
 * so even a correctly extracted envelope would have been filed as
 * `unknown-completeness`. Comparing normalized forms means a casing or separator
 * change cannot silently downgrade a verified-complete run.
 *
 * @param {unknown} reason
 * @returns {string} lowercased, separators stripped ('' when absent)
 */
export function normalizeTerminalReason(reason) {
  return String(reason ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Does this terminal reason mean "the vendor finished normally"?
 * @param {unknown} reason
 * @returns {boolean}
 */
export function isSuccessfulTerminalReason(reason) {
  const n = normalizeTerminalReason(reason);
  return n === 'endturn' || n === 'stop' || n === 'complete' || n === 'completed';
}

/**
 * Does this terminal reason mean "the vendor stopped for a bad reason"?
 * Kept separate from the success test on purpose: an UNRECOGNIZED reason is
 * neither — it is unknown, and unknown must not be read as failure.
 * @param {unknown} reason
 * @returns {boolean}
 */
export function isUnsuccessfulTerminalReason(reason) {
  return /cancel|abort|refus|error|fatal|denied|timeout/i.test(String(reason ?? ''));
}
