---
description: Reconcile a hopper upgrade — compare installed vs upstream, surface BREAKING entries, migrate this project's .hopper/ config, and check vendor binary drift. Reports and hands you the install command; never installs anything itself.
allowed-tools: Bash, Read
argument-hint: [--offline] [--apply]
---

Bring an existing hopper install and an existing project back into agreement after
(or before) an upgrade.

**This does NOT install the plugin.** Installing plugin code belongs to the host —
Claude Code's marketplace owns `installed_plugins.json`, the version pin and the
cache layout; npm owns the global link; each other host has its own path. A plugin
that fetched and replaced its own running code would create a second source of
truth and would have to reimplement six install paths correctly. So this flow
**reports** and prints the host's own upgrade command for you to run.

What nobody else does — and what this actually exists for — is everything *after*
the upgrade: the project's `.hopper/` is still shaped for the OLD plugin, and the
vendor CLIs on this machine may have drifted independently.

## Steps

### 1. Report
```bash
node "$HOPPER_BIN" --update-check
```
Add `--offline` to skip the single read-only upstream query (it degrades to a
local-only report on its own if the network is unavailable — an upgrade check that
fails closed on a flaky network would be worse than none).

Three sections come back: **Install** (running version + how it was installed),
**Upstream** (latest version, plus any BREAKING entries between here and there),
**Workspace** (what in this project's `.hopper/` no longer matches the running
schema).

### 2. If the plugin itself is behind
Surface the printed upgrade command and let the user run it. Do not run it for
them unless they explicitly ask — it replaces the code that is currently executing.

If BREAKING entries were listed, read those `MIGRATION.md` sections **before**
upgrading and tell the user what will change for them specifically.

### 3. Migrate the project config
```bash
node "$HOPPER_BIN" --migrate-config             # dry run — this is the default
node "$HOPPER_BIN" --migrate-config --yes       # apply, after the user has seen the diff
```
Always show the dry-run diff and get confirmation before `--yes`. `.hopper/AGENTS.md`
records **who approved which vendor and when**; it is a governance file, not a
config file.

Migrations are additive only — a missing column is added filled with
`(bind per project)`, a missing section is added empty, a fully-generated file is
regenerated. Nothing bound is ever changed, no row is deleted, no `Approved` cell
is flipped. Originals are copied to `.hopper/.migrations/` and every run appends to
`.hopper/.migrations/log.md`.

**The `approved-vendors-section` migration deliberately leaves the table empty.**
Approval is a human decision; a migrator that pre-approved vendors would manufacture
consent that was never given. Dispatch stays fail-closed until the user fills it in
— that is correct, not a bug. Say so plainly rather than filling it in for them.

A migration that cannot locate its target structure REFUSES instead of guessing.
Relay the refusal and the manual steps; do not hand-edit around it.

### 4. Check the machine, not just the config
```bash
node "$HOPPER_BIN" --setup            # Vendor binaries section: path-free summary
node "$HOPPER_BIN" --binaries --deep  # absolute paths + per-file versions
```
A vendor name resolving to several files at different versions is worth fixing
before anything else: hopper spawns whichever PATH resolves first, PATH order
differs between shells, and the failure surfaces downstream as model rejections or
protocol errors that read like account problems.

### 5. Re-verify
Re-run `--update-check`. The Workspace section should report agreement, and
`--setup`'s "Task-type policy" lint should show the policy columns as `bound` or a
deliberate `unbound` rather than missing.

## MUST NOT
- Do NOT install, download, or replace plugin code.
- Do NOT run `--migrate-config --yes` without showing the dry-run diff first.
- Do NOT fill in `## Approved Vendors` on the user's behalf.
- Do NOT hand-edit around a REFUSED migration.
- Do NOT edit `queue.md` — it is immutable history.
