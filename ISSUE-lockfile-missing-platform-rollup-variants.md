# ISSUE: `npm ci` is broken on every non-Windows machine (lockfile carries only win32 rollup binaries)

- **Status**: open (worked around in CI, not fixed)
- **Found**: 2026-08-03, by the first CI run this repo has ever had (v0.43.0)
- **Severity**: anyone cloning this repo and running `npm ci` on linux or macOS
  gets a broken install. Not CI-specific.

## Symptom

```
Error: Cannot find module @rollup/rollup-linux-x64-gnu. npm has a bug related to
optional dependencies (https://github.com/npm/cli/issues/4828).
  [cause]: Error: Cannot find module '@rollup/rollup-linux-x64-gnu'
```

Observed on `ubuntu-latest` (`rollup-linux-x64-gnu`) and `macos-latest`
(`rollup-darwin-arm64`) — 2 failing unit test files on each
(`tests/unit/dashboard-queue.test.js`, `tests/unit/dashboard-task.test.js`,
both of which load vite → rollup).

## Root cause

`vite` (devDependency) depends on `rollup@4.60.4`, which declares **26** optional
platform-specific native binaries. `package-lock.json` records **two**:

```
node_modules/@rollup/rollup-win32-x64-gnu    | optional: true | dev: true
node_modules/@rollup/rollup-win32-x64-msvc   | optional: true | dev: true
```

Both are win32, i.e. the lockfile was generated on a Windows machine and npm
recorded only the variants matching that platform. `npm ci` installs strictly
from the lockfile and never re-resolves optional deps, so on any other platform
the needed binary is absent.

## Why it was invisible until now

The repo had **no CI**. Every "tests pass" was a local run on a machine whose
`node_modules` had been populated by `npm install` (which *does* re-resolve
optional deps per platform), never by `npm ci`. The lockfile's incompleteness
therefore never mattered to anyone actually running the suite.

## Reproduction

```bash
mkdir /tmp/ncitest && cp package.json package-lock.json /tmp/ncitest/
cd /tmp/ncitest && npm ci
ls node_modules/@rollup/          # empty on macOS/linux
```

Confirmed on macOS with npm 10.9.8 / node 22.22.3.

## What was tried and did not work

`npm install --package-lock-only` (npm 10.9.8, macOS) — regenerated lockfile
still records only the same two win32 entries; it does not add the host
platform's variant, let alone all 26.

## Current workaround

`.github/workflows/validate.yml` uses `npm install` instead of `npm ci`.
This re-resolves optional deps per platform and works on all three runners.
**Cost: CI is no longer strictly lockfile-pinned** — a transitive dependency can
float within its semver range between runs.

## Fix directions (none chosen)

1. Regenerate `package-lock.json` such that all 26 optional variants are
   recorded, and restore `npm ci`. Needs a reliable way to make npm record
   non-host optional deps — the obvious `--package-lock-only` does not.
2. Declare the platform variants actually needed as explicit
   `optionalDependencies` in `package.json`. Keeps `npm ci`, but hardcodes a
   platform list that will rot — the failure mode this repo has been repeatedly
   bitten by.
3. Decouple the dashboard unit tests from vite/rollup so a missing native
   rollup binary cannot fail the CLI's test suite at all. Narrowest blast
   radius, but only removes the symptom from the test suite; `npm ci` stays
   broken for anyone building the dashboard.

## Not claimed

This issue does not claim any of the three directions is correct, and the
workaround is not a fix — `npm ci` remains broken on a fresh non-Windows clone.
