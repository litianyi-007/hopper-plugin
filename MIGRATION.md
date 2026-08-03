# Migration Guide

For projects that already have a `.hopper/` workspace and are picking up a newer
hopper-plugin. Read newest-first; find your starting version and apply every
entry between it and the top. Each entry states: what changed / whether an
EXISTING project breaks / what to do about it.

**If your `.hopper/` predates 2026-07-31 (v0.40.0), jump straight to that
entry below — it is almost certainly the reason dispatch is failing right now.**
It is the only BREAKING entry in this file.

---

## v0.43.0 (2026-08-03) — no action for existing projects

**What changed.** `--resolve <task-id> --vendor <v>` now actually applies the
override (it was silently ignored), and reports a refusal when that vendor is not
approved — so a dry run stops disagreeing with what a real dispatch would do.
Repo-internal work otherwise: CI added (there was none), a stale integration-test
fixture migrated to v0.40.0's Approved Vendors gate, and `engines.node` corrected
from `>=18` to `>=22.18.0` (a claim correction — Node 18 never actually worked).

**Will your project break?** No. Nothing in an existing `.hopper/` is read
differently. One behavior you may notice: a `--resolve` that used to print a
vendor now prints an error if you passed `--vendor` with a vendor your project
has not approved. That output was wrong before, not permissive.

**What to do.** Nothing — unless you run hopper on Node < 22.18.0, in which case
its test suite never worked and `engines.node` now says so.

---

## v0.42.0 (2026-08-03) — no action for existing projects

**What changed.** Onboarding and documentation only. `--init-tasks`'s
generated `.hopper/AGENTS.md` now lists all eight adapters in
`## Active Agent Instances` (previously `claude` and `mimo` were missing
entirely) and annotates `opencode` / `copilot` / `agy` / `mimo` as not
supported per the 2026-07-31 product decision; no row was deleted. The
catch-all `hopper` skill gained a first-run/after-upgrade path that points at
`--init-tasks` instead of asking the user for a path, and `--help` now points
at `## Approved Vendors` and this file. Two doc defects were corrected:
`skills/hopper-dispatch/SKILL.md` described `--check` as taking a task-id (it
takes an optional vendor) and neither doc mentioned that `--resolve` ignores
`--vendor` (see `ISSUE-resolve-ignores-vendor-override.md` — a confirmed
defect, recorded rather than fixed this round).

**Will your project break?** No. Nothing in an existing `.hopper/` is read
differently, and no vendor argv changed. The scaffold change only affects
`.hopper/` workspaces created **after** upgrading; it does not rewrite an
existing one.

**What to do.** Nothing. If you want the corrected `Active Agent Instances`
table in an existing project, copy it from a fresh `--init-tasks` run in a
scratch directory — do not run `--init-tasks --force` in a real project, it
overwrites the workspace.

---

## v0.41.1 (2026-08-02) — non-functional, nothing to do

GitHub owner handle renamed `surebeli` → `litianyi-007` across manifests,
README, and host-adapter docs. No code or behavior changed; the old handle
still redirects. No migration action needed.

---

## v0.41.0 (2026-07-31) — BEHAVIOR CHANGE: codex now honors read-only for real on macOS/Linux

**What changed.** Before this release, codex *always* dispatched with
`--dangerously-bypass-approvals-and-sandbox` on every platform — a Windows-only
workaround (`CreateProcessWithLogonW` 1326) that had been applied universally.
From this release, that bypass is platform-split: **Windows is unchanged**
(bypass stays default); on **macOS/Linux the bypass is now OFF by default** —
codex's own `-s <mode>` sandbox is honored, including a genuine `read-only`
request that denies writes.

**Will your project break?** Only if you were relying — knowingly or not — on
a "read-only" codex dispatch on macOS/Linux actually having write access.
Read-only-defaulting task-types (`code-review-adversarial`,
`code-review-acceptance`, `spec-blindspot-hunt`, `prd-research`,
`market-research`) or any dispatch with an explicit `--sandbox read-only` /
`workspace-write` routed to **codex** will now genuinely be denied writes on
macOS/Linux where they previously succeeded silently with full access. A
task that used to complete (by writing something it technically shouldn't
have) can start failing.

**What to do.** This is very unlikely to be something you actually want to
revert — the five read-only-default task-types are review/research work that
should not write in the first place. But if a project-specific task was
quietly depending on the old always-full-access codex behavior on
macOS/Linux, set `HOPPER_CODEX_SANDBOX_BYPASS=1` to restore it globally, or
pass an explicit `--sandbox danger-full-access` for that one dispatch. Windows
is unaffected either way — no action needed there.

---

## v0.40.0 (2026-07-31) — BREAKING: every existing `.hopper/AGENTS.md` now needs a new section, or ALL dispatch is refused

**What changed.** `.hopper/AGENTS.md` gained a second, independent gate: a
`## Approved Vendors` table. Before this release, AGENTS.md was only a routing
table (which vendor a task-type prefers); any registered adapter could be
dispatched to, including via an explicit `--vendor` override. From this release,
a vendor must ALSO appear in `## Approved Vendors` with `Approved = yes` before
`hopper-dispatch` will spawn it — and the check is fail-closed both ways:

- No `## Approved Vendors` section at all → **every** vendor is refused
  (`E_APPROVED_VENDORS_SECTION_MISSING`), including an explicit `--vendor`
  override.
- Section present but a vendor has no row, or its row isn't `yes` →
  that vendor is refused (`E_VENDOR_NOT_APPROVED`).

**Will your project break?** Yes, unconditionally, if `.hopper/AGENTS.md` was
generated (or last hand-edited) before 2026-07-31. `--init-tasks` before this
release never wrote this section, so it does not exist in any pre-upgrade
project — there is no partial-credit case here.

This is not hypothetical: hopper-plugin's own dogfood project (this repo's
`.hopper/AGENTS.md`, generated 2026-05-20) hit exactly this. It sat broken
— `E_APPROVED_VENDORS_SECTION_MISSING` on every dispatch, including
`--resolve`'s underlying vendor-resolution path — from the moment v0.40.0
shipped on 2026-07-31 until an audit caught it on 2026-08-03. Three days is
short only because someone happened to look: nothing surfaced the breakage on
its own. There is no warning at upgrade time, no check that runs until a
dispatch is attempted, and the release that introduced the gate did not
migrate the very repo it shipped from.

**What to do.** Add a `## Approved Vendors` section to your project's
`.hopper/AGENTS.md`, then fill in a row (`Approved = yes`) for each vendor this
project should actually be allowed to dispatch to. This is a security-relevant
whitelist decision — a human should decide which vendors go in it, not an
agent guessing. The exact skeleton hopper itself prints in the error message
(`cli/src/agents.js`'s `APPROVED_VENDORS_SKELETON`) is copy-pasteable:

```markdown
## Approved Vendors

<!-- 本项目允许派发的 vendor。未列或 Approved=no 的一律拒绝，--vendor 覆盖也不例外。 -->

| Vendor | Approved | Approved by | Date | Scope / Notes |
|---|---|---|---|---|
| `<vendor>` | yes | `<you>` | `YYYY-MM-DD` | |
```

Add one row per approved vendor (vendor names are the adapter ids from
`hopper-dispatch --vendors`, e.g. `codex`, `grok`, `claude`, `kimi`). This
table is a SEPARATE control from the `## Active Agent Instances` /
task-vendor-preference tables above it — a vendor can be routing-bound there
and still get refused here if it's missing from this table, and vice versa.

---

## v0.39.0 (2026-07-31) — BEHAVIOR CHANGE: the host≠vendor guard starts actually running (and matching) under Claude Code

**What changed.** Two independent, compounding defects in the guard that stops
a host from dispatching a task back to itself as a vendor
(`validateHostVendorSeparation`):

1. The guard's host identity came only from `HOPPER_HOST_VENDOR`, an env var
   set exclusively by the Tier-C wrapper hosts (codex-cli, copilot-cli,
   grok-cli, cursor-cli, opencode). Claude Code has no such wrapper — its slash
   commands call `hopper-dispatch` directly — so under Claude Code the env var
   was **never set**, and the guard's own `if (!hostVendor) return;` silently
   skipped the check for every dispatch from inside a Claude Code session.
2. Even with a host identity present, the comparison was raw string equality
   (`hostVendor === resolvedVendor`). Claude Code's natural self-identifier
   (`claude-code`) never equals the vendor name (`claude`), so the one case
   the guard exists for — a Claude Code host dispatching to the `claude`
   vendor, i.e. `claude -p` calling itself through another entry point — could
   never have been caught even if the env var had been set.

Both are fixed together: Claude Code is now self-detected (no wrapper env var
needed), and the comparison is by **vendor family**
(`cli/src/validation.js`'s `VENDOR_FAMILY` map — `claude`/`claude-code` both
map to `anthropic`), not literal string equality.

**Will your project break?** Only the specific case the guard exists to catch:
a Claude Code session dispatching a task to the `claude` vendor. Before this
release that silently succeeded (the guard was a no-op under Claude Code); from
this release it is rejected. Dispatch to every other vendor from Claude Code is
unaffected, and dispatch to `claude` from any OTHER host (codex, grok,
opencode, ...) remains a legitimate heterogeneous dispatch and is unaffected.

**What to do.** If a task-type's AGENTS.md binding routes to `claude` and you
sometimes run hopper from inside Claude Code, that combination will now be
refused where it previously ran (with the same vendor identity dispatching to
itself, which is generally not a configuration you want anyway). Route that
task-type to a different vendor when dispatching from a Claude Code session, or
dispatch it from a non-Claude-Code host.

---

## v0.38.0 (2026-07-29) — documentation fix, NOT a capability change

**What changed.** `commands/review.md`, `research.md`, `market.md`, `swarm.md`,
`setup.md`, `README.md`, and `skills/hopper-setup/SKILL.md` previously claimed
codex and grok's default dispatch was "read-only" / that a reviewer "never
edits the repo". That was **false** and had been false since those vendors'
adapters were written: codex always ran with
`--dangerously-bypass-approvals-and-sandbox` and grok always ran with
`--permission-mode bypassPermissions`, regardless of the requested sandbox.
This release corrected the docs to say so, and fixed a related
misclassification in `cli/src/setup.js`'s `sandboxControl()` (which had
reported grok as `'argv'`/downgradable when it never was).

**Will your project break?** No. **No vendor argv changed and no sandbox
behavior changed in this release** — codex and grok were exactly as
full-access before this release as after it. What changed is that the docs
stopped claiming otherwise.

**What to do.** Nothing is required. But re-read this one carefully if you
were relying on the old doc's claim: if you assumed a codex- or grok-routed
review/research task was actually sandboxed to read-only, that assumption was
never true at any point — not before this release, not after. If you need a
genuinely enforced read-only dispatch, use a vendor whose read-only sandbox is
real (`hopper-dispatch --setup`'s classification, or
`hopper-dispatch --capabilities <vendor>`) or the macOS-only
`--subject-root` process guard, not codex/grok's default sandbox.

*(This project treats "declaring a security capability weaker than it is" as a
distinct, worse failure mode than "declaring it accurately" — this entry is
deliberately NOT written as a capability downgrade, because it wasn't one.)*

