// Shared subprocess wrapper (T-PLUGIN-04.5)
// Anchor: cli/src/subprocess.js
//
// Per spec v2.0.3 §3 #4 (no harness reaction core):
//   ONE dispatch = ONE selected vendor = ONE subprocess spawn attempt = success OR specific failure.
//   No retry. No fallback. No backoff. No circuit breaker.
//
// Per codex v2.0.3 audit F3 (subprocess kill strategy):
//   Windows: taskkill /PID <pid> /T /F  (kill tree, force)
//   Unix:    spawn detached + process.kill(-pid, 'SIGKILL')  (negative PID = process group)
//   NOT by port — children may be unrelated.

import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { prepareSubjectRootGuard, wrapSubjectRootInvocation } from './subject-root-guard.js';

// Phase 6c F1: task-type-aware timeout floors.
// Adapter-native timeoutMs is tuned for code-impl (short tasks). Review tasks
// inherently need 30+ min because the reviewer reads dozens of files, runs the
// test suite, then writes findings. Without this floor, the 5-vendor dogfood
// audit on 2026-05-21 had all 5 vendors timeout before writing a verdict.
// See docs/audit/phase-6b-dogfood-5vendor.md for the meta-finding.
const REVIEW_TASK_TYPES = new Set([
  'code-review-adversarial',
  'code-review-acceptance',
]);
const REVIEW_TASK_FLOOR_MS = 1_800_000;  // 30 min floor for any review task
const SERIAL_VENDOR_LOCK_POLL_MS = 250;
const SERIAL_VENDOR_LOCK_STALE_MS = 3_600_000;
const SERIALIZED_VENDORS = new Set(['codex']);

/**
 * Apply task-type-aware floor to an adapter-native timeout.
 * - For review task-types: returns max(native, REVIEW_TASK_FLOOR_MS).
 *   Lets a vendor like codex with reasoning=xhigh still extend beyond the
 *   floor if it wants more time; capped vendors get raised TO the floor.
 * - For non-review task-types: returns native unchanged.
 *
 * Adapters call this from their `timeoutMs(opts)` implementation. The
 * dispatch/runner path is responsible for setting `opts.taskType`.
 */
export function applyTaskTypeFloor(nativeMs, opts) {
  if (!opts || !opts.taskType) return nativeMs;
  if (REVIEW_TASK_TYPES.has(opts.taskType)) {
    return Math.max(nativeMs, REVIEW_TASK_FLOOR_MS);
  }
  return nativeMs;
}

export { REVIEW_TASK_TYPES, REVIEW_TASK_FLOOR_MS };

// ── idle + ceiling timeout primitive (replaces the single total-wall-clock cap) ──
// The old design hard-killed at one per-vendor TOTAL timeout, which could not
// tell "hung" from "legitimately working on a long task" — see
// ISSUE-mimo-codeimpl-timeout (a 41-edit code-impl killed at the flat 180s).
// New design (two timers):
//   - idle timeout: kill ONLY after idleMs of ZERO output (stdout+stderr) — the
//     real "is it stuck" detector. An actively-streaming long task keeps
//     resetting it and is NOT killed (most agentic vendors stream json / log /
//     tool-call events under hopper's --format json / --print-logs flags).
//   - absolute ceiling: a generous safety net so a runaway can't live forever.
// Both env-overridable; an explicit per-task --timeout sets the ceiling.
const DEFAULT_IDLE_TIMEOUT_MS = 180_000;   // 3 min of silence ⇒ treat as stuck
const CEILING_FLOOR_MS = 1_800_000;        // ≥30 min absolute ceiling (safety net)
const WINDOWS_TIMEOUT_CLOSE_GRACE_MS = 250;

function envPositiveInt(name) {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Resolve {idleMs, ceilingMs} for a dispatch from the adapter baseline + env +
 * an optional explicit per-task override (--timeout → opts.timeoutOverrideMs).
 *
 * Ceiling precedence: explicit --timeout > HOPPER_DISPATCH_TIMEOUT_MS >
 *   max(adapter baseline, CEILING_FLOOR_MS).
 * Idle: HOPPER_IDLE_TIMEOUT_MS > DEFAULT_IDLE_TIMEOUT_MS, never above ceiling.
 *
 * @param {number} adapterBaselineMs  adapter.timeoutMs(opts) (per-vendor tuned)
 * @param {object} [opts]             may carry timeoutOverrideMs (ms)
 * @returns {{ idleMs: number, ceilingMs: number }}
 */
export function resolveDispatchTimeouts(adapterBaselineMs, opts = {}) {
  const idleMs = envPositiveInt('HOPPER_IDLE_TIMEOUT_MS') ?? DEFAULT_IDLE_TIMEOUT_MS;
  const override = Number.isFinite(opts?.timeoutOverrideMs) && opts.timeoutOverrideMs > 0
    ? opts.timeoutOverrideMs
    : null;
  const ceilingMs = override
    ?? envPositiveInt('HOPPER_DISPATCH_TIMEOUT_MS')
    ?? Math.max(Number(adapterBaselineMs) || 0, CEILING_FLOOR_MS);
  return { idleMs: Math.min(idleMs, ceilingMs), ceilingMs };
}

export { DEFAULT_IDLE_TIMEOUT_MS, CEILING_FLOOR_MS, WINDOWS_TIMEOUT_CLOSE_GRACE_MS };

/**
 * Idle-detection helper for vendors that emit a periodic heartbeat to their log even when
 * otherwise idle (e.g. mimo's `--print-logs` GET /session/status poll). Raw log-size growth
 * never goes quiet for those, so the idle timer's "no growth = stuck" detector never fires and
 * a delivered-but-non-exiting process (the mimo background-exit hang) waits out the full
 * ceiling. Given a freshly-appended log chunk and a heartbeat matcher, returns true iff the
 * chunk contains at least one NON-empty line that is NOT a heartbeat line (i.e. real progress).
 * The runner resets the idle clock only on such substantive growth. Pure; exported for tests.
 * @param {string} chunk         newly-appended log bytes (decoded)
 * @param {RegExp} heartbeatRe   matches a heartbeat (noise) line; non-global
 * @returns {boolean}
 */
export function chunkHasSubstantiveLine(chunk, heartbeatRe) {
  if (!chunk) return false;
  for (const line of chunk.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (heartbeatRe && heartbeatRe.test(t)) continue;
    return true;
  }
  return false;
}

import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Serialize selected vendors across processes when the upstream CLI cannot
 * safely share auth/session state concurrently. Current scope: codex only.
 *
 * @param {string | undefined} vendorName
 * @returns {Promise<() => void>} release callback
 */
export async function acquireVendorLock(vendorName) {
  if (!vendorName || !SERIALIZED_VENDORS.has(vendorName)) {
    return () => {};
  }

  const lockPath = join(tmpdir(), `hopper-${vendorName}.lock`);
  const lockToken = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

  while (true) {
    try {
      writeFileSync(lockPath, lockToken, { flag: 'wx' });
      return () => releaseVendorLock(lockPath, lockToken);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (isVendorLockStale(lockPath)) {
        try {
          unlinkSync(lockPath);
          continue;
        } catch (_) {
          // Another process may have reclaimed it first.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, SERIAL_VENDOR_LOCK_POLL_MS));
    }
  }
}

function releaseVendorLock(lockPath, lockToken) {
  try {
    if (!existsSync(lockPath)) return;
    const current = readFileSync(lockPath, 'utf-8');
    if (current === lockToken) unlinkSync(lockPath);
  } catch (_) {
    // best-effort; stale lock recovery handles crash leftovers
  }
}

function isVendorLockStale(lockPath) {
  try {
    return (Date.now() - statSync(lockPath).mtimeMs) > SERIAL_VENDOR_LOCK_STALE_MS;
  } catch (_) {
    return false;
  }
}

/**
 * Run a vendor subprocess EXACTLY ONCE with hard timeout + process-tree kill.
 *
 * @param {object} args
 * @param {string} args.command          CLI command (e.g. "codex", "kimi", "agy")
 * @param {string[]} args.args           Argv array
 * @param {string|null} args.stdinInput  Input to pipe to stdin (null = none)
 * @param {number} args.timeoutMs        Hard timeout (absolute ceiling)
 * @param {number} [args.idleMs]         Idle (silence) timeout; 0/falsy disables the idle watchdog
 * @param {boolean} [args.bufferedOutput] Adapter-declared hint (mirrors hopper-runner's
 *   `adapter.bufferedOutput`, ISSUE-grok-claude-buffered-output-idle-falsekill): when true, skip
 *   arming the idle watchdog entirely — an end-buffered vendor writes stdout/stderr ONCE at exit,
 *   so idle-on-silence would otherwise degenerate into an unconditional kill ~idleMs after spawn.
 *   The absolute ceiling (timeoutMs) still applies as the safety net. ADDITIVE: default false, so
 *   existing callers that only pass idleMs/timeoutMs keep today's single-ceiling-or-idle behavior.
 * @param {object} [args.env]            Extra env vars (merged with process.env)
 * @param {string} [args.cwd]            Working directory
 * @param {string|null} [args.logFilePath]  Path to vendor --log-file (read after exit if set)
 * @param {string} [args.vendorName]     Logical vendor name for serialization guard
 * @param {string} [args.subjectRoot]     Explicit read-only subject tree, if requested
 * @param {string} [args.sandbox]         Effective sandbox used to validate subjectRoot
 * @param {object} [args.subjectGuardOptions] Test-only dependency overrides for guard validation
 * @returns {Promise<import('./types.js').SubprocessResult>}
 */
export async function runSubprocessOnce({
  command,
  args,
  stdinInput,
  timeoutMs,
  idleMs = 0,
  bufferedOutput = false,
  env,
  cwd,
  logFilePath = null,
  vendorName,
  subjectRoot = null,
  sandbox,
  subjectGuardOptions,
}) {
  const isWindows = platform() === 'win32';
  const startedAt = Date.now();
  // Validation/backend availability is deliberately before the vendor spawn and
  // before lock acquisition: a requested guard is mandatory, never advisory.
  const subjectGuard = prepareSubjectRootGuard({ subjectRoot, sandbox, ...(subjectGuardOptions || {}) });
  const invocation = wrapSubjectRootInvocation(command, args, subjectGuard);
  const releaseVendorLock = await acquireVendorLock(vendorName);

  try {
    const child = spawn(invocation.command, invocation.args, {
      env: { ...process.env, ...(env || {}) },
      cwd: cwd || process.cwd(),
      stdio: [stdinInput == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      detached: !isWindows,                                       // Unix: detached process group for tree-kill
      windowsHide: isWindows,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeoutReason = null;     // 'idle' | 'ceiling' (diagnostic)
    let processCleanup = { status: 'not-needed', method: null };
    let killTimer = null;
    let idleTimer = null;
    let windowsCleanupTimer = null;
    let settleExit = null;
    let exitSettled = false;

    const clearTimeoutTimers = () => {
      if (killTimer) clearTimeout(killTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (windowsCleanupTimer) clearTimeout(windowsCleanupTimer);
      killTimer = null;
      idleTimer = null;
      windowsCleanupTimer = null;
    };

    const settleWindowsCleanupFallback = () => {
      if (!isWindows || !timedOut || exitSettled) return;
      // `taskkill /T /F` is synchronous, but a Windows ChildProcess can still
      // omit its `close` event after that tree has been reaped. Ask the owned
      // direct child to terminate too, then settle from the bounded cleanup
      // path if its streams never close. This is cleanup only, never a second
      // vendor invocation or dispatch retry.
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
      windowsCleanupTimer = setTimeout(() => {
        if (!exitSettled) {
          try { child.stdin?.destroy(); } catch (_) {}
          try { child.stdout?.destroy(); } catch (_) {}
          try { child.stderr?.destroy(); } catch (_) {}
          settleExit?.(child.exitCode, child.signalCode || 'SIGKILL');
        }
      }, WINDOWS_TIMEOUT_CLOSE_GRACE_MS);
    };

    const armWindowsCleanupFallback = () => {
      if (!isWindows || windowsCleanupTimer || exitSettled) return;
      windowsCleanupTimer = setTimeout(settleWindowsCleanupFallback, WINDOWS_TIMEOUT_CLOSE_GRACE_MS);
    };

    const claimTimeout = (reason) => {
      if (timedOut) return false;
      timedOut = true;
      timeoutReason = reason;
      // Clear the competing source before the synchronous tree-kill. Output
      // arriving after a best-effort cleanup must not re-arm idle either.
      clearTimeoutTimers();
      processCleanup = killProcessTree(child.pid, isWindows);
      armWindowsCleanupFallback();
      return true;
    };

    // idle timer — resets on every chunk of vendor output; fires only after
    // idleMs of total silence (hung / reverse-pressured). ADDITIVE: when idleMs
    // is falsy this is a no-op, so callers/tests passing only timeoutMs keep the
    // legacy single-ceiling behavior unchanged.
    //
    // bufferedOutput (ISSUE-grok-claude-buffered-output-idle-falsekill): mirrors
    // hopper-runner's `idlePoll = (idleMs > 0 && !bufferedOutput) ? ... : null`
    // (cli/bin/hopper-runner). grok/claude `--output-format json` are END-BUFFERED
    // — stdout/stderr are written ONCE at process exit, never incrementally — so
    // for those vendors this in-process idle watchdog (armed on spawn, reset only
    // by a 'data' event) would otherwise fire unconditionally ~idleMs after spawn,
    // before the vendor ever gets a chance to produce output. Skipping the arm
    // entirely leaves the absolute ceiling timer (below) as the sole, still-fully-
    // active safety net for a genuinely hung buffered vendor.
    const armIdle = () => {
      if (!(idleMs > 0) || bufferedOutput || timedOut) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => claimTimeout('idle'), idleMs);
      if (idleTimer.unref) idleTimer.unref();
    };

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); armIdle(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); armIdle(); });

    if (stdinInput != null && child.stdin) {
      try {
        child.stdin.write(stdinInput);
        child.stdin.end();
      } catch (_) {
        // child may have exited before stdin ready — ignore; exit code captures result
      }
    }

    // Absolute ceiling. NO retry on timeout — timeout = failure, surface it.
    if (timeoutMs > 0) {
      killTimer = setTimeout(() => claimTimeout('ceiling'), timeoutMs);
    }
    armIdle();  // start the idle clock at spawn (silence before first byte counts)

    const exitCode = await new Promise((resolve) => {
      settleExit = (code, signal) => {
        if (exitSettled) return;
        exitSettled = true;
        clearTimeoutTimers();
        // Map signal to exit-code-equivalent (POSIX convention: 128 + signal)
        resolve(code != null ? code : 128 + (signal === 'SIGKILL' ? 9 : signal === 'SIGTERM' ? 15 : 0));
      };
      child.on('close', settleExit);
      child.on('error', (_err) => settleExit(127, null)); // command-not-found convention
    });

    const durationMs = Date.now() - startedAt;

    // Read --log-file content if adapter requested one (silent-fail diagnostic per codex F2)
    let logFileContent = undefined;
    if (logFilePath) {
      try {
        logFileContent = readFileSync(logFilePath, 'utf-8');
      } catch (_) {
        // log file may not exist if subprocess died early — that's diagnostic-worthy itself
        logFileContent = undefined;
      }
    }

    return { exitCode, stdout, stderr, timedOut, timeoutReason, processCleanup, durationMs, logFileContent };
  } finally {
    releaseVendorLock();
  }
}

/**
 * Kill an entire process tree (parent + descendants).
 * Per codex v2.0.3 F3 + Phase 5 audit F1: NOT by port; tree-kill via OS-specific
 * mechanism. Exported so hopper-runner can reuse it for background-mode timeout.
 *
 * @param {number} pid
 * @param {boolean} isWindows
 */
export function killProcessTree(pid, isWindows) {
  if (!pid) return { status: 'not-requested', method: null };
  if (isWindows) {
    // taskkill /T = kill tree (all child processes), /F = force
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 5000 });
      return { status: 'succeeded', method: 'taskkill /T /F' };
    } catch (_) {
      return { status: 'failed', method: 'taskkill /T /F' };
    }
  } else {
    // Unix: negative PID kills the process group (requires detached: true at spawn)
    try {
      process.kill(-pid, 'SIGKILL');
      return { status: 'succeeded', method: 'process-group SIGKILL' };
    } catch (groupError) {
      // try direct kill as fallback
      try {
        process.kill(pid, 'SIGKILL');
        return { status: 'succeeded', method: 'direct SIGKILL' };
      } catch (directError) {
        // The process can exit naturally between timeout detection and cleanup.
        // Preserve the existing success/failure status enum while making that
        // benign race observable. Do not mask EPERM/EACCES or mixed failures.
        if (groupError?.code === 'ESRCH' && directError?.code === 'ESRCH') {
          return {
            status: 'succeeded',
            method: 'already exited (group/direct ESRCH)',
            alreadyExited: true,
          };
        }
        return { status: 'failed', method: 'direct SIGKILL' };
      }
    }
  }
}

/**
 * HOPPER-6: best-effort check that a PID currently maps to an expected process
 * image. Background jobs record the hopper-runner PID (a node process); on
 * Windows especially, PIDs are recycled aggressively, so before `--stop` kills
 * a tree we confirm the PID is still a node process and not some unrelated
 * program that inherited the number. Returns 'match' | 'mismatch' | 'unknown'.
 *
 * Subprocess-based (tasklist/ps), so callers MUST NOT use it on the single-spawn
 * dispatch path (spec §3 #4) — only in management commands like --stop, which
 * already run outside the dispatch invariant. On any ambiguity it returns
 * 'unknown' and leaves the kill/no-kill decision to the caller.
 *
 * HOPPER-6b (2026-08): on Linux, `ps -p <pid> -o comm=` reads the kernel's
 * TASK_COMM field, capped at 15 visible characters. By default (no `--title`
 * flag, which is the only call site that invokes uv_set_process_title outside
 * user code) this should just be the plain basename of the exec'd binary
 * ("node", 4 chars — well under the cap regardless of install path depth).
 * But confirmed via real GitHub Actions job logs (not simulated, not
 * reproduced by guesswork) that under Node 24 on ubuntu-latest, comm for a
 * bog-standard `node --test` process comes back as something that does NOT
 * contain "node" at all — while the exact same actions/setup-node install
 * shape (`/opt/hostedtoolcache/node/<version>/x64/bin/node`) under Node 22 on
 * the same runner image comes back matching. Path depth and OS were held
 * constant; only the Node major version differed and only 24 broke, so this
 * is a genuine Node-24-on-Linux behavior change, not a fluke of one run or a
 * property of long install paths per se. We were not able to pin the exact
 * upstream Node commit responsible (deps/uv is byte-identical at 1.51.0
 * between the two lines, and the obvious call sites are unchanged), only that
 * it reproduces deterministically in CI. Net effect: comm-only detection can
 * falsely return 'mismatch' for a perfectly legitimate node process. That does
 * not risk killing an unrelated process (background.js treats 'mismatch' as
 * "never kill"), but it does silently break `--stop`'s ability to actually
 * stop an in-progress job it legitimately owns — on Linux, under Node 24.
 *
 * Fix: on Linux, first resolve the executable via `/proc/<pid>/exe` (a
 * kernel-maintained symlink to the exact binary that was exec'd, which cannot
 * be spoofed by prctl/process-title tricks the way comm apparently can) and
 * check ITS basename — this is exactly what comm was trying to approximate.
 * `ps -o comm=` remains the fallback (permission-denied on /proc/<pid>/exe for
 * a different-UID process, non-Linux POSIX, or /proc unavailable in some
 * containers), so the original "flag a genuinely different process" guarantee
 * is unchanged: this only ever turns a previously-false 'mismatch' for a real
 * node PID into 'match'; it never turns a genuinely non-node PID into 'match'
 * (deliberately not falling back to a full-command-line substring check,
 * which could false-positive on a CLI argument that happens to contain
 * "node").
 *
 * @param {number} pid
 * @param {object} [opts]
 * @param {string} [opts.expectImageIncludes]  case-insensitive substring (default 'node')
 * @param {boolean} [opts.isWindows]
 * @returns {'match'|'mismatch'|'unknown'}
 */
export function verifyPidImage(pid, { expectImageIncludes = 'node', isWindows = platform() === 'win32' } = {}) {
  if (!pid || pid <= 0) return 'unknown';
  const needle = String(expectImageIncludes).toLowerCase();
  if (isWindows) {
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (!out || /no tasks/i.test(out)) return 'unknown';
      // CSV row: "ImageName","PID","SessionName","Session#","MemUsage"
      const image = (out.split(',')[0] || '').replace(/^"|"$/g, '').trim().toLowerCase();
      if (!image) return 'unknown';
      return image.includes(needle) ? 'match' : 'mismatch';
    } catch (_) {
      // tasklist failed, or PID not found → cannot determine
      return 'unknown';
    }
  }

  let sawEvidence = false;

  // Linux only: untruncated executable path, sidesteps the 15-char comm
  // truncation entirely (HOPPER-6b above).
  if (platform() === 'linux') {
    try {
      const exe = readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, '');
      const base = (exe.split('/').pop() || '').toLowerCase();
      if (base) {
        sawEvidence = true;
        if (base.includes(needle)) return 'match';
      }
    } catch (_) {
      // ENOENT (pid gone/no such process), EACCES (different-user process —
      // preserves the original "flag someone else's process" behavior via
      // the ps fallback below), or /proc unavailable → fall through.
    }
  }

  try {
    const out = execSync(`ps -p ${pid} -o comm=`, {
      encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().toLowerCase();
    if (out) {
      sawEvidence = true;
      if (out.includes(needle)) return 'match';
    }
  } catch (_) {
    // ps failed, or PID not found → nothing more to learn from ps
  }

  return sawEvidence ? 'mismatch' : 'unknown';
}

/**
 * Generate a unique log file path for a dispatch.
 * Per codex v2.0.3 F2: unique per-dispatch to avoid stale-log false positives.
 *
 * @param {string} taskId
 * @param {string} vendorName
 * @returns {string} Absolute temp path
 */
export function makeUniqueLogPath(taskId, vendorName) {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now();
  return join(tmpdir(), `hopper-${vendorName}-${taskId}-${ts}-${rand}.log`);
}
