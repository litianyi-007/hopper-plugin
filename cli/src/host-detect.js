// Host self-detection for the host!=vendor isomorphism guard (validation.js).
// Anchor: cli/src/host-detect.js
//
// BACKGROUND: every Tier-C bash wrapper (hosts/{codex-cli,copilot-cli,grok-cli,
// cursor-cli,opencode}/bin/hopper-*) exports HOPPER_HOST_VENDOR explicitly before
// exec'ing hopper-dispatch, so validateHostVendorSeparation always had a value to
// compare for those 5 hosts. Tier B (Claude Code) has NO such wrapper —
// hosts/claude-code/bin does not exist; commands/*.md invoke hopper-dispatch
// directly — so HOPPER_HOST_VENDOR was never set under Claude Code and the guard
// silently no-opped for every real dispatch from inside a Claude Code session
// (confirmed empirically 2026-07-31: `echo $HOPPER_HOST_VENDOR` inside a live
// session is empty). This module adds narrow self-detection so Tier B gets a
// host identity too, without requiring a wrapper.
//
// SCOPE: this detects ONLY the Claude Code CLI itself. It deliberately does NOT
// attempt to self-detect codex-cli / grok-cli / copilot-cli / cursor-cli /
// opencode — those already have explicit, deliberate wrappers, and inferring
// them from ambient env vars is unreliable (see the TRAP note below). A host
// that cannot be confidently identified reports HOST_UNKNOWN rather than
// guessing; validateHostVendorSeparation treats HOST_UNKNOWN as "present but
// unrecognized" and surfaces an explicit notice instead of silently no-opping
// (see cli/src/validation.js).
//
// TRAP, discovered empirically (2026-07-31): a third-party Codex plugin running
// INSIDE a normal Claude Code session sets CODEX_COMPANION_SESSION_ID /
// CODEX_COMPANION_TRANSCRIPT_PATH — env vars that exist even though the actual
// host is Claude Code, not the Codex CLI. `env | grep -iE '^(CLAUDE|CODEX)'` in
// that exact session showed BOTH CLAUDECODE=1 and CODEX_COMPANION_SESSION_ID=<id>
// simultaneously. A detector that treats "a CODEX_* var is present" as "host is
// codex" would misidentify this as the Codex CLI host. So detection below keys
// ONLY on markers Claude Code sets about ITSELF, and never branches on another
// vendor's env vars (CODEX_* / GROK_* / etc.) at all — presence or absence of
// those is simply not evidence this module looks at.

/** Host identity returned when Claude Code itself is confidently detected. */
export const HOST_CLAUDE_CODE = 'claude-code';

/** Sentinel returned when no host can be confidently identified (never guess). */
export const HOST_UNKNOWN = 'unknown';

/**
 * Detect whether the current process is running inside a Claude Code session,
 * using markers Claude Code itself sets. Never throws; never returns undefined —
 * returns HOST_UNKNOWN rather than guessing when no known marker is present.
 *
 * Markers (any one is sufficient; all three were observed set together live,
 * 2026-07-31): CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_SESSION_ID.
 * These are Claude-Code-specific — NOT to be confused with CODEX_COMPANION_*
 * (a plugin's own marker; see TRAP note above), which this function ignores.
 *
 * @param {NodeJS.ProcessEnv} env defaults to process.env; pass an explicit
 *   object in tests to avoid depending on the ambient test-runner environment.
 * @returns {string} HOST_CLAUDE_CODE or HOST_UNKNOWN
 */
export function detectHost(env = process.env) {
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_CODE_SESSION_ID) {
    return HOST_CLAUDE_CODE;
  }
  return HOST_UNKNOWN;
}

/**
 * Resolve the effective host identity for validateHostVendorSeparation.
 *
 * Precedence: an explicit HOPPER_HOST_VENDOR (set by every Tier-C wrapper) is
 * the deliberate, unambiguous signal and always wins when present. Only when
 * it is unset/empty do we fall back to self-detection (currently: Claude Code
 * only; see detectHost() scope note above).
 *
 * @param {NodeJS.ProcessEnv} env defaults to process.env
 * @returns {{ id: string, source: 'env' | 'detected' }}
 */
export function resolveHostIdentity(env = process.env) {
  if (env.HOPPER_HOST_VENDOR) {
    return { id: env.HOPPER_HOST_VENDOR, source: 'env' };
  }
  return { id: detectHost(env), source: 'detected' };
}
