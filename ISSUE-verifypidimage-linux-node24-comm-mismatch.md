# ISSUE (HOPPER-6b): `verifyPidImage` false-`mismatch`es on Linux under Node 24

- **Status**: FIXED in `cli/src/subprocess.js` (pending real-CI confirmation — see "Not verified" below)
- **Found**: 2026-08-03, `test (ubuntu-latest, 24)` red on `stop-job.test.js`;
  `test (ubuntu-latest, 22)` and both macOS legs green (run 30782809366)
- **Severity**: does not risk killing an unrelated process (the caller,
  `background.js:stopBackgroundJob`, treats `'mismatch'` as "never kill" — the
  safe direction). It does silently break `--stop`'s ability to actually stop
  a job it legitimately owns, on Linux, under Node 24.

## Symptom (real CI logs, not simulated)

```
✖ HOPPER-6: verifyPidImage matches the running node process
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    actual: 'mismatch', expected: 'match'
  at tests/unit/stop-job.test.js:156:10
```
(A second assertion in the same file, `stopBackgroundJob records a completed
tree cleanup for an owned node child` at line 106, failed the same way for the
same reason — `res.killed` stayed `false` because `verifyPidImage` reported
`'mismatch'` for a legitimate, freshly-spawned node child.)

## Root cause

`verifyPidImage`'s POSIX branch (`cli/src/subprocess.js`) determined
node-ness solely from `ps -p <pid> -o comm=`, i.e. the kernel's `TASK_COMM`
field, which Linux caps at 15 visible characters.

Confirmed via two real `actions/setup-node@v4` job logs on the *same* CI run,
*same* runner image, *same* install layout shape
(`/opt/hostedtoolcache/node/<version>/x64/bin/node`), differing only in Node
major version:

- `test (ubuntu-latest, 22)`: installed at
  `/opt/hostedtoolcache/node/22.23.1/x64` → `comm` matches `node` → test green.
- `test (ubuntu-latest, 24)`: installed at
  `/opt/hostedtoolcache/node/24.18.0/x64` → `comm` does **not** contain
  `node` → test red (`actual: 'mismatch'`, not `'unknown'` — `ps` succeeded
  and returned a definite, wrong answer).

Path depth and OS were held constant; only the Node major version differed
and only 24 broke. That rules out "just an unlucky long path" as the whole
story — by plain Linux `execve()` semantics, kernel `comm` defaults to the
*basename* of the exec'd file ("node", 4 chars), which should stay well under
the 15-char cap regardless of install depth, unless something actively
renames the process afterward (`prctl(PR_SET_NAME, ...)`, which is what
`ps -o comm=` actually reads).

**We could not pin the exact upstream Node commit responsible.** `deps/uv` is
byte-identical (1.51.0) between the two installed builds used here
(v22.22.3 and v24.14.1/v24.18.0), and the one call site in Node's own C++
layer that invokes `uv_set_process_title` (`src/node.cc`, `src/node_process_object.cc`)
is gated behind the `--title` CLI flag in both versions, unchanged between
them — so the obvious explanations don't hold up under a source diff. The
behavioral difference is real and deterministic (reproduces on demand in CI),
just not traced to a specific line.

## Fix

On Linux, resolve the executable via `/proc/<pid>/exe` — a kernel-maintained
symlink to the literal binary that was `exec`'d, which cannot be renamed by
`prctl`/process-title tricks the way `comm` apparently can — and check *its*
basename first. `ps -o comm=` remains as a fallback for when `/proc/<pid>/exe`
isn't readable (`EACCES` for a different-UID process — this is what
preserves the original "flag a genuinely different owner's process" behavior
that Windows PID-reuse protection depends on — or `/proc` unavailable in some
containers) or the PID is gone (`ENOENT`).

Deliberately **not** implemented as "fall back to the full command line
(`ps -o args=`) and substring-match against that" — a CLI argument could
coincidentally contain the word "node" (e.g. a task brief or file path passed
to an unrelated program), which would turn a genuinely-different process into
a false `'match'` — the dangerous direction (risk of killing the wrong
thing). The chosen fix only ever turns a previously-false `'mismatch'` for a
real node PID into `'match'`; a genuinely non-node PID still reports
`'mismatch'` (verified locally with a spawned `sleep` process on both Node
22 and 24 — see below).

## Verified locally (macOS, both Node 22.22.3 and Node 24.14.1 via nvm)

- `npm test`: 1132 tests / 1130 pass / 0 fail / 2 skipped on **both** Node
  versions (matches the pre-existing baseline; this repo's suite is fully
  green on macOS regardless of this bug, since macOS's `ps -o comm=` already
  returns an untruncated path and was never affected).
- `tests/unit/stop-job.test.js` in isolation: 11/11 pass on both versions.
- Destructive counter-test (not in the automated suite, run manually): spawned
  a real `sleep 30` child and called `verifyPidImage(child.pid, { expectImageIncludes: 'node' })`
  — returned `'mismatch'` on both Node 22 and Node 24. Confirms the fix does
  not weaken the "flag a non-node process" guarantee.
- `node scripts/sync-vendored-plugin.mjs --check`: in sync (`plugins/hopper/`
  updated via `npm run sync:plugin`).

## Not verified (honest gap)

The new Linux-specific code path (`readlinkSync('/proc/<pid>/exe')`) has
**never actually executed** in any of the above — this machine is macOS,
where `platform() === 'linux'` is false and that branch is skipped entirely.
Everything above proves: (1) no regression on macOS for either Node version,
and (2) the *fallback* logic (ps-comm, mismatch classification, unknown
classification) still behaves correctly. It does **not** prove the
`/proc/<pid>/exe` branch itself works on real Linux — no Docker/container
runtime, Linux VM, or other Linux environment was available on this machine
to test it directly, and per task constraints this session did not commit or
push to trigger real `ubuntu-latest` CI. The next `ubuntu-latest, 22` and
`ubuntu-latest, 24` CI run against this change is the actual proof; until
then this is "should work by construction" (`/proc/<pid>/exe` is a standard,
long-documented Linux facility, not a guess), not "confirmed working."
