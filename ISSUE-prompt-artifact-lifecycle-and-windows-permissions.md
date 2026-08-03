# ISSUE: `-prompt.md` artifacts hold the full task brief, accumulate forever, and are unprotected on Windows

- **Status**: open — recorded, not fixed
- **Found**: 2026-08-03, while fixing a Windows CI failure that was itself unrelated
- **Severity**: not a credential leak (this repo's brief discipline forbids real
  credentials in briefs), but a file containing the complete composed prompt sits
  on disk indefinitely, with permissions that are unverified on Windows.

## What the file is

`cli/src/prompt-delivery.js`'s `resolvePromptDelivery()` writes
`<hopperDir>/handoffs/<taskId>-prompt.md` — **inside the project**, not a system
temp dir — with a best-effort `chmodSync(0600)`. It contains the **entire
composed prompt**: execution-mode guardrail + governance constitution and
per-vendor overlay (when `.hopper/GOVERNANCE.md` exists) + the task-type frame +
the task spec. That is everything the vendor would otherwise receive on argv or
stdin, not a fragment.

It is written from two call sites: the sync path (`cli/src/dispatch.js:533`) and
the background path (`cli/bin/hopper-dispatch:1148`).

**This is a necessary mechanism, not a stray artifact.** `cli/src/archive.js:26`
already lists `-prompt.md` in `ARTIFACT_SUFFIXES` alongside `-output.md`,
`-output.log`, `-output-raw.txt` and `-progress.log` as one of the five canonical
per-task artifacts, and the background path documents that the runner pipes this
file into the vendor's stdin precisely because the dispatcher process has already
exited. Deleting it eagerly would break that.

## Two problems

### 1. It fires far more often on Windows than the size gate suggests

Two independent gates trigger pointer-file delivery:

- **size-gated**: the inline command line exceeds the OS-regime budget
  (cmd-shim 4000B / native-exe 28000B / posix 100000B).
- **newline-gated**: on Windows, when the vendor is reached through a
  `.cmd`/`.bat` cmd.exe shim **and** the adapter cannot read stdin
  (`adapter.promptStdin !== 'supported'`) **and** the prompt contains any
  newline — **regardless of size**.

`composePrompt()` (`cli/src/tasks.js:143-154`) always joins sections with
`'\n\n---\n\n'`, so every real prompt is multi-line. Kimi
(`cli/src/vendors/kimi.js:32`, `stdinMode: 'none'`) is exactly the non-stdin
case. Net effect: on Windows, **essentially every dispatch to a non-stdin vendor
writes one of these**, not just oversized ones.

### 2. Nothing ever deletes them

`archive.js`'s own header states archival is "EXPLICIT — hopper has no reaction
core, so nothing auto-archives," and `--archive` only **moves** files into
`.hopper/archive/<date>/`. There is no retention window, no purge, no delete path
anywhere for any of the five artifact types. A `-prompt.md` persists until a
human removes it out of band. Combined with (1), Windows accumulates them fastest.

### 3. The `0600` is best-effort, and on Windows we now know it does not hold

The code comments the `chmodSync` as best-effort because NTFS ACLs do not map to
POSIX mode bits. Independently confirmed the same day (see
`CHANGELOG.md` 0.45.0 and the `windows-latest` diagnostic): hopper's own
owner-only hardening does not actually take effect on Windows —
`icacls /inheritance:r /grant:r` leaves explicit `NT AUTHORITY\SYSTEM` and
`BUILTIN\Administrators` full-control ACEs in place. There is no reason to expect
`chmodSync` to do better. So on Windows these files are, in practice, readable by
every administrator on the machine — which for a single-user dev box is close to
"no protection at all."

## Why it was invisible

The same reason as everything else surfaced in this batch: **nothing executed
it.** The repo had no CI, so the Windows delivery path had never run in a test
environment, and no test asserts anything about artifact retention on any
platform.

## Not claimed

- No evidence any real credential has ever been written to one of these files;
  this repo's `.hopper/AGENTS.md` discipline is that briefs carry parameter names,
  never values. The concern is task context and governance text, not secrets.
- No fix direction is endorsed here. Eager deletion is **wrong** (the background
  runner reads the file after the dispatcher exits). A retention window, an
  explicit purge command, or moving delivery to a mode-enforced temp location are
  all plausible; none has been evaluated.
