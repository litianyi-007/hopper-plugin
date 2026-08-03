# ISSUE: `npm ci` is broken on every non-Windows machine (lockfile carries only win32 rollup binaries)

- **Status**: RESOLVED 2026-08-03 — lockfile regenerated, `npm ci` restored in CI
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

## Workaround that did NOT work

Switching CI to `npm install` was tried first and **failed**: ubuntu (both Node
versions) and macOS/Node 22 still died with the same missing-module error. Only
macOS/Node 24 passed, presumably because of the newer bundled npm. Recorded here
because "npm install instead of npm ci" is the answer most search results give
for npm/cli#4828, and for this repo it was not sufficient.

## Resolution

Direction 1. `package-lock.json` was regenerated **with no `node_modules`
present** — that detail is the whole fix. Regenerating while `node_modules`
exists makes npm reproduce the installed tree, which on this macOS machine
yielded **1** variant (worse than the 2 it started with). From a bare
`package.json` it records **25**, including `rollup-linux-x64-gnu` and
`rollup-darwin-arm64`.

Verified locally: `npm ci` now installs `@rollup/rollup-darwin-arm64` where it
previously installed nothing; unit 1132/1130 pass and integration 53/52 pass on
the new tree. CI restored to `npm ci`.

**Side effect, stated plainly:** regenerating from bare resolved 85 transitive
packages to newer versions (mostly `@babel/*` patch bumps) and added 48 packages
/ removed 1. Every one is inside a semver range `package.json` already declares,
but this was a dependency refresh as well as a lockfile repair, not a pure
metadata fix.

## Fix directions considered (for the record)

1. **(chosen)** Regenerate `package-lock.json` so all optional variants are
   recorded, and restore `npm ci`. `--package-lock-only` works — but only from a
   bare `package.json`, with `node_modules` absent.
2. Declare the platform variants actually needed as explicit
   `optionalDependencies` in `package.json`. Keeps `npm ci`, but hardcodes a
   platform list that will rot — the failure mode this repo has been repeatedly
   bitten by.
3. Decouple the dashboard unit tests from vite/rollup so a missing native
   rollup binary cannot fail the CLI's test suite at all. Narrowest blast
   radius, but only removes the symptom from the test suite; `npm ci` stays
   broken for anyone building the dashboard.

## Not claimed

Verification was on macOS only at the time of writing; that `npm ci` now works on
linux and windows follows from the lockfile carrying their variants, but the
proof is the CI run, not this file. If a future lockfile regeneration is done
with `node_modules` present, this defect returns silently — nothing guards it.
