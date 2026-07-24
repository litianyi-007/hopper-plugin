// Size-gated pointer prompt delivery.
// Anchor: cli/src/prompt-delivery.js
//
// Follow-up to ISSUE-codex-bypass-flag-missing-from-argv. On Windows a vendor
// reached through a cmd.exe `.cmd` shim inherits cmd.exe's ~8191-char command-
// line limit; an over-long line is silently truncated (dropping trailing flags
// or the prompt tail). Native `.exe` vendors get CreateProcess's 32767-char cap.
//
// Strategy (size-gated): if the composed prompt would push the vendor command
// line past a conservative per-regime budget, write the prompt to a file under
// .hopper/handoffs/ and pass the vendor a SMALL pointer instruction ("read file
// X and follow it"). Every hopper vendor is an agentic coding CLI that can read
// a file in its workspace, so the pointer covers ALL vendors uniformly
// (empirically validated). Small prompts stay inline (deterministic), so only
// large prompts take on the soft "agent must read the file" dependency.
//
// ENCODING-AWARE by design: the budget is measured in UTF-8 BYTES of the whole
// would-be command line, not character count. A Chinese char is 1 UTF-16 code
// unit but 3 UTF-8 bytes; UTF-8 byte length is the conservative upper bound
// across every interpretation (UTF-16 units, GBK/ANSI bytes, mixed scripts,
// emoji), so the gate is safe for English / Chinese / other languages / mixed
// content with one formula and no per-script branching.
//
// NEWLINE-GATED companion rule (ISSUE-opencode-windows-multiline-prompt-
// truncation): on the win-cmd-shim regime cmd.exe ALSO truncates a multi-line
// argv positional at the FIRST newline, at any size. Vendors that cannot read
// the prompt from stdin (no `promptStdin: 'supported'`) therefore take the
// pointer-file channel for ANY multi-line composed prompt, even a tiny one.

import { writeFileSync, mkdirSync, chmodSync, existsSync, lstatSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { platform } from 'node:os';
import { validateTaskId } from './validation.js';

// Conservative defaults (UTF-8 bytes of the FULL command line incl. cmd path +
// flags). All overridable via env. The headroom between the budget and the real
// OS limit is INTENTIONAL: the naive space-join measurement does not model Node's
// win32 argv quoting/caret-escaping, which can grow the on-the-wire command line
// up to ~2x for a prompt dense in cmd metacharacters (" & | < > ^ ( ) % !). So:
//   - cmd-shim 4000 vs cmd.exe ~8191  → safe even at ~2x worst-case escaping.
//   - native-exe 28000 vs CreateProcess 32767 → fits realistic escaping growth.
//   - posix effectively unbounded for real prompts; still gates pathological sizes.
export const DEFAULT_INLINE_BUDGETS = {
  'cmd-shim': 4000,
  'native-exe': 28000,
  'posix': 100000,
};

const REGIME_ENV = {
  'cmd-shim': 'HOPPER_INLINE_PROMPT_MAX_CMDSHIM',
  'native-exe': 'HOPPER_INLINE_PROMPT_MAX_NATIVE',
  'posix': 'HOPPER_INLINE_PROMPT_MAX_POSIX',
};

/**
 * Which OS command-line limit applies to this spawn.
 *   - 'cmd-shim'   : Windows, reached via cmd.exe (a `.cmd`/`.bat` shim) → ~8191
 *   - 'native-exe' : Windows, a real `.exe`/`.com` → CreateProcess 32767
 *   - 'posix'      : Linux/macOS → ARG_MAX (very large)
 * @param {string} resolvedCmd       the command that will be spawned
 * @param {string[]} [prependArgs]   args prepended by command resolution (e.g. ['/c', 'x.cmd'])
 * @returns {'cmd-shim'|'native-exe'|'posix'}
 */
export function commandLineRegime(resolvedCmd, prependArgs = [], { isWindows = platform() === 'win32' } = {}) {
  if (!isWindows) return 'posix';
  const cmd = String(resolvedCmd || '');
  const viaCmdShim = /cmd\.exe$/i.test(cmd) || prependArgs.some((a) => /\.(cmd|bat)$/i.test(String(a)));
  return viaCmdShim ? 'cmd-shim' : 'native-exe';
}

/**
 * UTF-8 byte length of a command line approximated by joining argv parts with
 * single spaces. UTF-8 is the conservative cross-encoding upper bound (see file
 * header) — Chinese = 3 bytes/char, emoji = 4, ASCII = 1.
 * @param {string[]} parts
 * @returns {number}
 */
export function commandLineBytes(parts) {
  return Buffer.byteLength(parts.join(' '), 'utf8');
}

/**
 * Inline-prompt budget (UTF-8 bytes) for a regime, with per-regime env override.
 * @param {'cmd-shim'|'native-exe'|'posix'} regime
 * @param {Record<string,string>} [env]
 * @returns {number}
 */
export function inlineBudgetBytes(regime, env = process.env) {
  const v = Number.parseInt(env?.[REGIME_ENV[regime]] ?? '', 10);
  if (Number.isFinite(v) && v > 0) return v;
  return DEFAULT_INLINE_BUDGETS[regime] ?? DEFAULT_INLINE_BUDGETS['cmd-shim'];
}

/**
 * Should this dispatch deliver the prompt over STDIN instead of an argv positional?
 *
 * TRUE only on the **win-cmd-shim** regime — where `cmd.exe /c <vendor>.CMD "<prompt>"`
 * truncates a multi-line argv positional at the first newline — for a vendor whose CLI
 * reads the prompt from stdin (`adapter.promptStdin === 'supported'`). Native-exe and
 * POSIX argv are multi-line-safe, so stdin is NOT used there (smaller blast radius).
 *   - default-ON vendors (codex, claude): on unless `HOPPER_<VENDOR>_STDIN=0`
 *   - opt-in vendors (`promptStdinDefault:false`, e.g. copilot): only if `HOPPER_<VENDOR>_STDIN=1`
 * @returns {boolean}
 */
export function useStdinPrompt(adapter, regime, env = process.env) {
  if (regime !== 'cmd-shim') return false;
  if (!adapter || adapter.promptStdin !== 'supported') return false;
  const flag = env[`HOPPER_${String(adapter.name || '').toUpperCase()}_STDIN`];
  if (flag === '0') return false;                       // explicit per-vendor opt-out
  if (adapter.promptStdinDefault === false) return flag === '1';  // opt-in vendors
  return true;                                          // default-ON, not opted out
}

/**
 * The small instruction that replaces a large prompt on the command line: it
 * points the vendor agent at the on-disk prompt file. Forceful wording (the
 * file IS the task) because this is a soft, behavioral delivery.
 * @param {string} absPromptPath  forward-slashed absolute path
 * @returns {string}
 */
export function buildPointerInstruction(absPromptPath) {
  return [
    'Your complete task brief — including all instructions and any governance — is in the file at the absolute path below.',
    'FIRST read that entire file, then follow its instructions exactly. That file is your only source of the task; do not ask for it and do not act before reading it.',
    '',
    'Task file: ' + absPromptPath,
  ].join('\n');
}

/**
 * Decide inline vs pointer delivery for a dispatch and return the argv to spawn.
 *
 * Builds the candidate INLINE argv, measures the full command line, and if it
 * exceeds the regime budget, writes the composed prompt to
 * `<handoffsDir>/<taskId>-prompt.md` (owner-only 0600) and rebuilds argv with a
 * small pointer instruction instead. Pure aside from the optional file write;
 * a write failure falls back to inline delivery (never breaks dispatch — the
 * runner's over-long-cmdline WARNING remains the backstop).
 *
 * @returns {{ args: string[], promptFilePath: string|null, inlined: boolean,
 *             regime: string, bytes: number, budget: number, fallbackReason?: string }}
 */
export function resolvePromptDelivery({
  adapter, composedPrompt, opts = {}, resolvedCmd, prependArgs = [],
  handoffsDir, taskId, isWindows = platform() === 'win32', env = process.env,
}) {
  const regime = commandLineRegime(resolvedCmd, prependArgs, { isWindows });

  // STDIN delivery (win-cmd-shim fix): pipe the FULL prompt over stdin instead of an
  // argv positional. A stdin pipe never touches cmd.exe's command-line parser, so it
  // is immune to the newline truncation (and the 8191 cap). The adapter emits a stdin
  // sentinel instead of the prompt (opts.promptViaStdin). The prompt is written to a
  // 0600 file so the BACKGROUND runner can read+pipe it; the SYNC path pipes
  // `stdinPrompt` in-process and ignores the file.
  if (useStdinPrompt(adapter, regime, env)) {
    const args = adapter.args(composedPrompt, { ...opts, promptViaStdin: true });
    let promptFilePath = null;
    if (handoffsDir && taskId) {
      try {
        validateTaskId(taskId);
        const p = join(handoffsDir, `${taskId}-prompt.md`);
        assertPromptPathSafe(p, handoffsDir);
        mkdirSync(handoffsDir, { recursive: true });
        writeFileSync(p, composedPrompt, { mode: 0o600 });
        try { chmodSync(p, 0o600); } catch (_) { /* best-effort on Windows */ }
        promptFilePath = p;
      } catch (_) { promptFilePath = null; /* sync still works via stdinPrompt */ }
    }
    return { args, channel: 'stdin', stdinPrompt: composedPrompt, promptFilePath, inlined: false, regime, bytes: 0, budget: 0 };
  }

  const inlineArgs = adapter.args(composedPrompt, opts);
  const budget = inlineBudgetBytes(regime, env);
  const bytes = commandLineBytes([String(resolvedCmd || ''), ...prependArgs, ...inlineArgs]);

  // win-cmd-shim MULTI-LINE truncation gate (ISSUE-opencode-windows-multiline-
  // prompt-truncation): `cmd.exe /c <vendor>.CMD "<prompt>"` truncates a
  // multi-line argv positional at the FIRST newline regardless of size, so a
  // small multi-line brief arrives cut off at its header. Stdin-capable
  // vendors were handled above; vendors whose CLI CANNOT read the prompt from
  // stdin (opencode: message is argv-positional-only, `stdinMode: 'none'`)
  // must take the pointer-file channel for ANY multi-line prompt — the size
  // gate alone never fires because the truncation victim is usually small.
  // Native-exe and POSIX argv are multi-line-safe → untouched.
  const multilineCmdShimTruncationRisk =
    regime === 'cmd-shim'
    && adapter.promptStdin !== 'supported'
    && /\r?\n/.test(composedPrompt);

  if (bytes <= budget && !multilineCmdShimTruncationRisk) {
    return { args: inlineArgs, channel: 'argv-inline', stdinPrompt: null, promptFilePath: null, inlined: true, regime, bytes, budget };
  }

  // Over budget → deliver via a pointer file. Any condition that makes the file
  // unusable falls back to INLINE (never break dispatch; the runner's over-long
  // WARNING is the backstop) and sets fallbackReason so the caller can warn.
  const promptFilePath = join(handoffsDir, `${taskId}-prompt.md`);

  // Read-scope guard: the vendor AGENT must be able to open the prompt file under
  // its own cwd/sandbox. A widened HOPPER_VENDOR_CWD can put the file outside the
  // vendor cwd → the agent can't read it → silent no-op. Fall back to inline
  // rather than relocate the very failure this change eliminates.
  if (opts && opts.cwd) {
    const vendorCwd = resolve(opts.cwd);
    const target = resolve(promptFilePath);
    if (target !== vendorCwd && !target.startsWith(vendorCwd + sep)) {
      return {
        args: inlineArgs, promptFilePath: null, inlined: true, regime, bytes, budget,
        fallbackReason: `prompt file ${promptFilePath} is outside the vendor cwd ${opts.cwd} (HOPPER_VENDOR_CWD?) — kept inline so the agent still receives the prompt`,
      };
    }
  }

  try {
    validateTaskId(taskId);                          // defense in depth (sync path lacks it)
    assertPromptPathSafe(promptFilePath, handoffsDir); // containment + symlink guard
    mkdirSync(handoffsDir, { recursive: true });
    // 0600: the composed brief + governance is sensitive. The vendor process
    // (same user as hopper) opens it itself, so owner-read is sufficient.
    writeFileSync(promptFilePath, composedPrompt, { mode: 0o600 });
    // writeFileSync's mode is honored only on CREATE; a re-dispatch overwrites an
    // existing file in place and would keep its old (possibly looser) perms —
    // re-tighten explicitly. Advisory on Windows (rely on the parent dir ACL).
    try { chmodSync(promptFilePath, 0o600); } catch (_) { /* best-effort */ }
    const pointer = buildPointerInstruction(promptFilePath.replace(/\\/g, '/'));
    return { args: adapter.args(pointer, opts), promptFilePath, inlined: false, regime, bytes, budget };
  } catch (err) {
    return { args: inlineArgs, promptFilePath: null, inlined: true, regime, bytes, budget, fallbackReason: err.message };
  }
}

/**
 * Containment + symlink guard for the prompt file, mirroring background.js
 * assertPathSafe. Throws if the path escapes handoffsDir or the target already
 * exists as a symlink (a redirect attack) — the caller catches → inline fallback.
 */
function assertPromptPathSafe(promptFilePath, handoffsDir) {
  const rp = resolve(promptFilePath);
  const rh = resolve(handoffsDir);
  if (rp !== rh && !rp.startsWith(rh + sep)) {
    throw new Error(`prompt path escapes handoffs/: ${rp}`);
  }
  if (existsSync(promptFilePath) && lstatSync(promptFilePath).isSymbolicLink()) {
    throw new Error(`prompt path is a symlink — refusing: ${promptFilePath}`);
  }
}
