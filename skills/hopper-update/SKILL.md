---
name: hopper-update
description: "Use when the user asks Hopper to check for updates, upgrade the plugin, reconcile a project after upgrading, migrate .hopper/ config to a newer schema, or explain why an existing project stopped dispatching after a version bump. Triggers: 'hopper update', 'update hopper', 'is hopper up to date', 'migrate my .hopper config', 'my project stopped dispatching after upgrading', 'hopper-dispatch --update-check', '--migrate-config'."
---

# Hopper Update / Migrate

Reconcile three things that drift apart independently: the **installed plugin**, the
**project's `.hopper/` config**, and the **vendor CLIs on this machine**.

**This never installs plugin code.** Installing is the host's job — Claude Code's
marketplace owns the install record and version pin, npm owns the global link, and
each of the other hosts has its own path. This skill reports and hands over the
host's own upgrade command.

## Steps

1. Locate `hopper-dispatch` from `PATH` or the plugin root near this `SKILL.md`.
   `--update-check` needs no `.hopper/` project; `--migrate-config` does.

2. `hopper-dispatch --update-check` (add `--offline` to skip the single read-only
   upstream query; it also degrades on its own when the network is unavailable).
   Read back all three sections: Install, Upstream, Workspace.

3. **Plugin behind?** Surface the printed upgrade command. Do not run it unless
   explicitly asked — it replaces the code currently executing. If BREAKING entries
   were listed, read those `MIGRATION.md` sections and say what changes for this
   user specifically before they upgrade.

4. **Workspace drifted?** Run `--migrate-config` (dry run is the DEFAULT), show the
   diff, get confirmation, then `--migrate-config --yes`.

5. **Machine drifted?** `--setup`'s "Vendor binaries" section, and
   `--binaries --deep` for absolute paths. Several installs of one vendor at
   different versions is the highest-priority finding: hopper spawns whichever PATH
   resolves first, that differs per shell, and it surfaces downstream as model or
   protocol errors that look like account problems.

6. Re-run `--update-check` to confirm agreement.

## What the migrator will and will not do

Additive only: adds a missing column filled with `(bind per project)`, adds a
missing section empty, regenerates a fully-generated file. It never changes a bound
value, deletes a row, or flips an `Approved` cell. Originals go to
`.hopper/.migrations/`; every run appends to `.hopper/.migrations/log.md`.

`.hopper/AGENTS.md` records **who approved which vendor and when** — a governance
file, not a config file. Two consequences worth stating to the user rather than
working around:

- The `approved-vendors-section` migration leaves the table **empty on purpose**.
  Approval is a human decision; pre-filling it would manufacture consent that was
  never given. Dispatch stays fail-closed until the user fills it in — correct, not
  a bug.
- A migration that cannot locate its target structure **REFUSES** rather than
  guessing. Relay the refusal and its manual steps.

## Why an out-of-date `.hopper/` is worth chasing

Its failures are quiet and get misattributed:

- v0.40.0 made `## Approved Vendors` a fail-closed gate — every project scaffolded
  before it silently stopped dispatching, including hopper's own dogfood workspace.
- batch 2 added the machine-parsed `Effort policy` / `Model rule` columns, which the
  parser treats as optional and skips silently, so the `--model` / `--reasoning`
  fallback chains just lose a level. A real project was found 18 releases behind,
  and the resulting `effective_selector: null` was misdiagnosed as a dispatch bug.

## MUST NOT

- Do NOT install, download, or replace plugin code.
- Do NOT run `--migrate-config --yes` without showing the dry-run diff first.
- Do NOT fill in `## Approved Vendors` for the user.
- Do NOT hand-edit around a REFUSED migration.
- Do NOT edit `queue.md` — it is immutable history.
