# Changelog

All notable changes to hopper-plugin are documented in this file. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); versioning follows the
project's established convention (see "Versioning" below) rather than strict
SemVer patch/minor semantics.

This file starts at 0.32.0 — prior releases (0.1.0 through 0.31.0) are documented
in git commit history (`git log --oneline`) and `.hopper/MANIFEST.md`'s 修改记录
table; they are not backfilled here.

## Versioning

Historically every release (0.20.0 → 0.31.0, 12 releases) bumps the **minor**
digit and leaves patch at `0`, regardless of whether the change was tagged
`fix:` or `feat:` in the commit message — patch-digit releases (0.7.1, 0.8.1,
0.11.1) are rare early-project exceptions. New entries here follow that
convention: any user-observable behavior change (new capability, fixed defect,
changed default) bumps minor; patch is reserved for the rare non-functional
tweak.

## [0.47.1] - 2026-08-05

0.47.0 的 CI 修复。两条都是**本地跑不出来、只有 CI 能发现**的问题——本机装了 8 个
vendor CLI，而 Windows 的路径大小写又恰好把泄漏遮住了。

### Fixed — `--setup` 的 Runtime 块输出绝对 workspace 路径

`Workspace <绝对路径>` 这一行在整段渲染器是 dead code 期间一直存在，所以 0.47.0
把报告复活的同时也复活了一条契约违规：`--setup` / `--check` / `--models` /
`--capabilities` 是 public discovery 面，不得输出本地文件系统路径
（`model-attestation-contract.test.js` 会把 workspace 种在临时目录里，输出中出现该
目录即失败）。Linux 与 macOS 的 CI 抓到了，Windows 因路径大小写差异碰巧漏过。

改为**相对 cwd** 显示，且只在「纯向上走到 `.hopper`」时才显示路径
（`.hopper` / `../.hopper` / `../../.hopper`）——那只暴露层级、不暴露目录名，
而层级正是有用的那部分（`findHopperDir()` 会向上遍历，所以「我挂在哪个 workspace
上」才是真问题）。横向穿进别的树、或 `HOPPER_DIR` 指向别处时，只报「found (outside cwd)」。

### Fixed — 新增的 path-free 契约测试假设本机装了 vendor CLI

`--setup stays path-free while --binaries carries the paths` 断言 `--binaries` 至少
打印了一个路径。这在装了 8 个 vendor 的开发机上成立，在**三个 CI runner 上全部失败**
——那里一个 vendor 都没装，每一行都是 "not found on PATH"。改为自己种一个假 binary
到临时 PATH 上，使断言在任何环境下都由构造成立。

同时补了一条断言 Workspace 行不含绝对路径的测试。

## [0.47.0] - 2026-08-05

一次外部事故报告的排查，牵出四个互相遮蔽的缺陷。它们放在一起才解释得通：
每一个都让另一个更难被发现。

### Fixed — `--setup` 的大半份报告是 dead code，包括唯一的配置漂移 lint

`runSetup()` 里有一个无条件 `return;`（`03330ea`，2026-07-22 引入），挡在整份报告
之前。已登记为 `ISSUE-setup-sandbox-column-dead-code.md`（2026-07-29），但当时把范围
记成了「Sandbox 一列」。**实际被挡掉的是**：Runtime/Workspace 块、verdict、vendors
表（含 Sandbox 列）、Auth notes、`--deep` 的两个 drift 段、Task-type policy lint、
Next steps。

其中 Task-type policy lint 的丢失代价最大：它是**唯一**会报告 `.hopper/AGENTS.md`
有没有 batch-2 机器解析列（`Effort policy` / `Model rule`）的界面。它死掉之后，
batch 2 之前 scaffold 的项目没有任何信号说自己需要迁移。实测发现一个外部项目仍停在
**v0.28.0** 的 scaffold（落后 18 版），`--model` fallback 链第二级整条失效，
现场把症状误判成了「`--swarm` 不传 model」。**本插件自己的 dogfood workspace
也有同样的漂移**，且 `code-impl` / `sidecar-polish` 指向未获批准的 vendor
（自 v0.40.0 fail-closed 起必然被拒），一并修正。

`03330ea` 合法引入的闭合 inventory 投影与 grok auth-context 边界**保留**，
折进完整报告而非替换它。新增测试逐段断言，任何位置的下一个提前 return 都会失败。

### Fixed — 经软链调用时静默 exit 0、零输出

直接执行守卫比较的是 `resolve(process.argv[1])` 与 realpath 过的 `import.meta.url`。
`path.resolve()` 不跟随软链/junction，所以经 npm-global 软链调用时两者永不相等，
`main()` 根本不跑——**exit 0，零输出**，对自动化调用方而言与成功无法区分。

修复同时关掉第二条同样后果的路径：**Windows 上 `realpathSync` 不规范化大小写**
（实证：`F:/workspace/…` 与 `F:/WORKSPACE/…` 都能解析且结果不字符串相等），
任何交出不同大小写 argv[1] 的启动器都会重新制造同一个故障。现在两侧都 realpath、
都各自 try/catch（此前 `realpathSync(__filename)` 无保护，抛出即模块顶层未捕获异常），
win32 折叠大小写而 POSIX 不折叠。判定逻辑抽成 `isDirectInvocation()` 并单测。

守卫必须在「否」方向保持严格——`cli/bin/hopper-dispatch` 被测试 import
（`parseProbeCacheRecoveryArgs`），误判为真会让 `main()` 在测试进程里跑起来。已加断言。

### Fixed — `binary_availability` / `binary_basename` 是硬编码的占位符

`cli/src/setup.js` 在探针缓存缺失时传入字面量 `'unknown'` / `null`，于是每台机器上
`--setup` 与每份 handoff frontmatter 的这两个字段永远是 unknown。
`installCheckForAdapter` 早就知道答案，只是没人问。现改为真实观测。

### Added — `--binaries`：一个 vendor 名在 PATH 上究竟解析到几个文件

事故根因不是模型也不是配置，是**一台机器上装了两份 codex**：hopper spawn 到
`~/bin/codex` 的 0.131.0，而用户 PowerShell 解析到 nvm4w 的 0.146.0。派发因此对
需要 ≥0.144 的模型报 400，症状看上去像账号或能力问题。hopper 此前无法观测到这件事——
它只解析 PATH 的第一个命中。

`hopper-dispatch --binaries [<vendor>] [--deep]` 列出每一个命中、dispatch 实际
spawn 的是哪个、以及（`--deep`）各自版本；版本分歧会升级为 `--setup` 的 Next steps 一条。
枚举是纯 fs（默认层即可用），版本查询每个文件一次 spawn（仅 `--deep`），
沿用 `vendor-compat.js` 的 spawn 隔离约定。

**绝对路径只出现在 `--binaries`。** `--setup` / `--check` / `--models` /
`--capabilities` 是 public discovery 面，按 `model-attestation-contract.test.js`
的契约不得输出本地路径——`--setup` 给的是无路径摘要（计数、裁决、已解析版本号）。
`--binaries` 放在 `.hopper/` 工作区闸之上：机器上装了什么是机器的属性，不是队列的。

### Changed — 仓库身份统一，并打了第一个 tag

`git remote` 仍指向重命名前的用户名，而三份元数据已是 `litianyi-007`。GitHub 的
重命名重定向掩盖了它，但旧用户名可被他人重新注册。已统一。同时打上首个 tag
`v0.46.0`——此前 0 个 tag，上游版本发现没有可依赖的锚点。

## [0.46.0] - 2026-08-03

### Changed — license is now MIT, and the LICENSE file finally contains a license

All three sibling plugins (harnessloop, hopper, kata) were unified on MIT. MIT
asks the least of downstream: keep the notice, and that is all. Apache-2.0 also
requires shipping a LICENSE copy, preserving NOTICE, and **stating your changes**
— the last of which is the obligation people most often violate without noticing.

**Stated plainly, because it is a real trade-off:** MIT carries no express patent
grant and no patent-retaliation clause. For enterprise adopters Apache-2.0's
patent grant is arguably the friendlier half. That protection was given up
deliberately, not overlooked.

**The change applies from this release onward. v0.45.2 and earlier remain under
Apache-2.0 — that cannot be undone; do not read the whole history as MIT.**

### Fixed — the LICENSE file was a stub, and had been since the beginning

`LICENSE` was **19 lines**: the Apache *file-header* boilerplate (the block meant
to go at the top of a source file) plus a "Full license text: <url>" line. The
entire TERMS AND CONDITIONS body — sections 1 through 9 — was absent. Meanwhile
`package.json`, five other manifests and three README badges all declared
`Apache-2.0`. `gh repo view --json licenseInfo` returned **`Other`**: GitHub could
not identify it. Anyone relying on this repo's license was reading a claim with
no terms behind it.

Nothing caught it because everything that existed — `version consistency`,
`release metadata` — guards *declared fields*. Not one check ever opened the
LICENSE file. **The declaration was verified; the fact was not.**

### Added

- `tests/unit/license-integrity.test.js`. Asserts `LICENSE` carries the
  substantive MIT text (grant sentence, `without restriction`, the AS-IS
  disclaimer) — existence and a title line both pass for a stub, which is exactly
  how the stub survived. Then it walks every `*.json` in the repo, collecting
  every `license` value at any nesting depth, and requires them all to equal
  `package.json`'s — discovery-based, so a new manifest is covered without
  touching a list. `package-lock.json` is deliberately narrowed to its own root
  entry: dependencies' licenses are third-party facts, and six of them are still
  Apache-2.0. Rewriting those would be fabricating provenance, not relicensing.

  Destructive proof: restoring the old 19-line stub → red on both tests; flipping
  one manifest to `Apache-2.0` → red, naming the file and path.

npm test 1140 / 1138 pass / 0 fail / 2 skipped; integration 53 / 52 pass / 0 fail.

## [0.45.2] - 2026-08-03

### Fixed

- **`setVendorCache` touched the shared cache file outside its own lock.** The
  function opened `readCacheWithOutcome()` unconditionally at the top, before
  `acquireLock()` — its result was needed by exactly one rare branch (the
  parent-owner-only hardening failure), but it ran on every call. That read could
  land while another process, holding the lock, was mid-`renameSync` over the same
  destination. On POSIX a concurrent reader never disturbs a rename; on Windows
  the `MoveFileEx`-based replace can raise a transient sharing violation
  (EBUSY/EPERM) when another handle holds the destination open. The read is now
  inside the one branch that needs it, so **every touch of the shared file happens
  under the lock**.

  No retry, no sleep, no timeout change — those would have made the light green
  without making the check hold. Atomicity is unchanged (write-to-temp + atomic
  rename), and the fail-closed paths are byte-for-byte untouched.

### Not established

Why `windows-latest` + Node 22 passed while Node 24 failed. The failure could not
be reproduced on macOS at all — 50 runs on each of Node 22 and 24, before *and*
after the fix, all green — so the specific scheduling difference is unknown and is
not being guessed at. What is established: the unlocked read existed, it is the
only unsynchronized access to the shared file in that path, and removing it costs
nothing. The destructive counter-proof (disabling the lock entirely → 10/10
failures with lost vendor entries) confirms the test still detects real loss, so
the fix is not vacuous. Confirmation that it resolves the reported failure can
only come from a green `windows-latest, 24` CI run.

## [0.45.1] - 2026-08-03

Test-and-CI only; the shipped plugin is unchanged from 0.45.0.

### Fixed (tests)

- Three tests carried platform assumptions that only a real Windows/Node-24 lane
  could disprove:
  - `execute-dispatch-e2e`'s "sync call creates no handoff artifact" was never
    platform-universal. On Windows a non-stdin vendor reached through a cmd.exe
    shim always takes the pointer-file delivery channel — `composePrompt()`
    always emits multi-line text, so the newline gate fires regardless of size.
    The test now excludes exactly `<taskId>-prompt.md` and still asserts nothing
    **else** landed. `-prompt.md` is a first-class artifact (`archive.js`'s
    `ARTIFACT_SUFFIXES`), not a stray file, so the code was left alone.
  - `lifecycle-regression`'s "content-free process_alive" readiness poll returned
    on the log file being merely non-empty. stdout and stderr are separate pipes
    with separate append fds; whichever lands first satisfied it. **This is a
    latent race, not a Node 24 or Windows behavior change** — reproduced locally
    on macOS + Node 22 (failed on iteration 7 of 40) with a failure signature
    byte-identical to CI's. The poll now waits for both sentinels. 60 isolated
    repeats on each of Node 22 and 24: 0 failures.
  - `setup`/`vendor-probe` cache assumptions were aligned with the Windows
    fail-closed behavior in 0.45.0, and the probe-redaction assertion moved onto
    the in-memory `probe()` result so it runs on every platform instead of only
    where the cache is writable.

### Removed

- The temporary `scripts/diag-windows-acl.mjs` and its CI step. It did its job:
  it turned "Windows hardening is broken" from a hypothesis into an observation,
  after the first hypothesis-driven fix had already failed.

### Recorded, not fixed

- `ISSUE-prompt-artifact-lifecycle-and-windows-permissions.md` — `-prompt.md`
  holds the complete composed prompt inside the project, nothing ever deletes any
  of the five artifact types, and its `0600` is best-effort on Windows where we
  now know permission hardening does not take effect.

## [0.45.0] - 2026-08-03

### Changed — Windows vendor cache now fails closed (user ruling)

The 23 Windows failures were **true positives**. A diagnostic step run on the
real `windows-latest` runner printed raw `icacls` output: after the hardening
command reported `status 0 / Successfully processed 1 files`, the DACL was
**byte-identical to before it** — `NT AUTHORITY\SYSTEM`, `BUILTIN\Administrators`
and the runner identity all still held `(OI)(CI)(F)`. None of the three carried
an `(I)` marker, i.e. they are explicit rather than inherited ACEs, so
`/inheritance:r` (which removes *inherited* ACEs) removed nothing and `/grant:r`
only replaced the named identity's own grant. **Owner-only hardening on Windows
had never actually worked; the assertion was right.** Nobody knew because
nothing had ever executed that code path.

Per the user's ruling, hopper **fails closed**: if owner-only cannot be
established, the cache write is refused. The alternatives — removing SYSTEM /
Administrators, or accepting them as permitted principals and relaxing the
assertion — were both declined. Consequence, stated plainly in all three
READMEs: **the vendor probe cache is unavailable on Windows**; capabilities are
re-probed every time.

- A refusal now carries a `diagnostic_message` alongside the existing
  `diagnostic_code`, saying what could not be established, that the cache is
  therefore disabled, and that this is a deliberate fail-closed decision rather
  than a bug. `cli/bin/hopper-dispatch` prints it — a bare code is not "visible."
- The win32 ACL helpers take an injectable `spawnIcacls`, so **the decision logic
  now executes on macOS/Linux too**. Previously it ran only on a real Windows
  box, which is exactly why a non-functioning security control survived.
- Tests assert the refusal on Windows rather than skipping — skipping would have
  left this boundary unguarded there, which is the failure mode this whole batch
  keeps rediscovering.

### Corrected

- 0.44.0's "exclude `Mandatory Label` lines from the ACE count" was written
  against a hypothesis the runner **disproved** — that output contains no
  Mandatory Label line at all. The exclusion is kept (a SACL integrity label is
  genuinely never a discretionary grant, and it carries its own regression
  tests), but its comment no longer presents a refuted inference as the
  established cause. Had that change "worked," it would have masked the real
  defect.

### Not verified

Whether `/inheritance:r` fails to strip explicit ACEs on every Windows image, or
only this runner, is unconfirmed. The destructive counter-proofs establish the
decision logic in both directions — a stuck ACL is refused with no tmp residue,
a genuinely clean one is accepted — so the assertion is not vacuously
always-reject. Only real Windows CI establishes the OS behavior itself.

## [0.44.0] - 2026-08-03

Everything here was found by the CI added in 0.43.0, on its first runs. All three
are pre-existing defects, not regressions from that batch — they were simply
never executed before.

### Fixed

- **`verifyPidImage` returned `mismatch` for a legitimate node process on
  Linux + Node 24** (`cli/src/subprocess.js`). It read `ps -p <pid> -o comm=`,
  i.e. the kernel's `TASK_COMM`, capped at 15 visible characters. Confirmed from
  real Actions logs: under Node 24 on `ubuntu-latest` a plain `node --test`
  process's comm does not contain "node", while the identical setup-node install
  shape under Node 22 on the same image does. `background.js` treats `mismatch`
  as "never kill", so this did not risk killing an unrelated process — it
  silently broke `--stop`'s ability to stop a job it legitimately owned. Now
  resolves `/proc/<pid>/exe` first on Linux (kernel-maintained, untruncated,
  not rewritable by process-title tricks) and falls back to `ps` for
  permission-denied / no-procfs cases. Deliberately does **not** fall back to a
  full command-line substring match, which could false-`match` on an argument
  containing "node". Net risk movement: fewer false `mismatch`, no new path to a
  false `match`. The exact upstream Node change was not identified — recorded as
  such in `ISSUE-verifypidimage-linux-node24-comm-mismatch.md` rather than
  guessed at.
- **All 23 Windows cache failures were one bug** (`cli/src/cache.js`). Every one
  carried the same `inventory-cache-parent-owner-only-failed` diagnostic from
  `prepareCacheParent()` — the first step of every cache write; the file-level
  ACL helpers were never even reached. `icacls <path>`'s listing interleaves
  SACL **Mandatory Label** (integrity level) entries with real DACL ACEs using
  the same `principal:(flags)` shape, and the "exactly one ACE" assertion counted
  the label as a second, competing grant — so hardening that genuinely succeeded
  was reported as failed. A Mandatory Label grants no one access, so excluding it
  from that count is a correctness fix, not a relaxation: the exactly-one-grant
  requirement and the identity check are unchanged. Verified fail-closed is
  intact by injecting a real competing grant (`Everyone:(F)`) — write refused,
  no tmp file leaked.

### Added

- **`windowsAclLines` is exported and unit-tested on every platform**
  (4 tests, incl. the `Everyone:(F)` counter-proof as a permanent regression
  test). The parser is pure string handling; only its callers are win32-gated.
  That this logic had never run outside a real Windows box is precisely why the
  bug above survived — the tests now run everywhere `npm test` does.
- `icacls` failure messages now carry `status` and `stderr` instead of a bare
  string. Inert today (an outer `catch(_)` still swallows them), but a future
  real Windows failure is diagnosable rather than a black box.

### Not verified

Both fixes were developed and tested on macOS. The `/proc/<pid>/exe` branch and
the real `icacls` path **never executed locally** — local runs prove no
regression and correct fallback, not that either platform-specific branch works.
Only the CI run for this commit can establish that.

## [0.43.0] - 2026-08-03

### Fixed

- **`--resolve` now applies `--vendor`** (`cli/bin/hopper-dispatch`). The branch
  called `runResolve(hopperDir, taskId)` and never read `--vendor` at all, so a
  dry run silently reported the routed vendor while claiming nothing was wrong —
  at either flag position. It now threads the override through the same
  `vendorOverride || resolveVendor(...)` formula and the same `assertVendorApproved`
  gate real dispatch uses, plus `validateHostVendorSeparation` (pure — env + static
  table, no spawn). A dry run that would be refused now says so, with the same
  error code. `assertVendorDispatchable` stays excluded on purpose: its own doc
  comment requires non-dispatch surfaces to skip it so a disabled vendor remains
  introspectable. Closes `ISSUE-resolve-ignores-vendor-override.md`.
- **`tests/integration/execute-dispatch-e2e.test.js` fixture** — its
  `.hopper/AGENTS.md` had no `## Approved Vendors`, so v0.40.0's fail-closed gate
  refused it and 2 of its 7 tests sat red from 2026-07-31. **Nothing noticed
  because `npm test` globs `tests/unit/` only** — the same reason this repo's own
  dogfood `.hopper/AGENTS.md` broke undetected in the same release. A discovery
  scan of every fixture carrying an `Active Agent Instances` table found all four
  unit fixtures migrated and only the integration one missed: the miss tracks
  exactly what does and does not get executed.
- **`engines.node` was inaccurate** — declared `>=18`, but
  `tests/unit/dashboard-log.test.js` imports a raw `.ts` file with no transpile
  step, which needs Node's type-stripping (backported in **22.18.0**), and
  `npm test`'s unquoted glob only resolves from the Node 22 line onward on shells
  that do not expand it. Corrected to `>=22.18.0`. This is a claim correction, not
  a capability change — nothing worked on Node 18 before this release either.

### Added

- **CI** (`.github/workflows/validate.yml`) — this repo had none; every prior
  "tests pass" was one person's local macOS run. 3 OS × Node 22/24, `fail-fast:
  false`, running `npm ci`, unit tests, the vendored-copy sync check, the
  standalone smoke banner, and **integration tests** (quoted glob, so node's own
  `--test` resolves it identically on every platform).
- **`tests/unit/resolve-vendor-override.test.js`** (6 tests) — override honored at
  both flag positions, refused when not approved, unchanged without an override.
- **`tests/unit/readme-hosts-badge.test.js`** — asserts every `README*.md`'s hosts
  badge equals the `hosts/` directory count + 1 (standalone). Both sides
  discovered, neither hardcoded. That badge read `4` against an actual `7` for two
  months across several releases while three host directories were added.

### Changed

- The tests badge no longer carries a count. It went stale within the session that
  last corrected it (adding four guard tests invalidated the number immediately),
  and a test asserting the count would alter the count it asserts. `hosts` is
  different — it is discoverable, so it got a guard instead.

## [0.42.0] - 2026-08-03

### Added

- **`MIGRATION.md`** (new, repo root) — a version-ordered (newest-first) guide for
  projects that already have a `.hopper/` workspace: what changed / whether an
  existing project breaks / what to do, covering v0.38.0 through v0.41.1. Written
  because v0.40.0's Approved Vendors gate had already silently broken this very
  repo's own dogfood `.hopper/AGENTS.md` — for three days, and only that short
  because an audit happened to look; nothing surfaces the breakage on its own —
  see that entry for the full account. Explicitly does not restate v0.38.0's
  documentation fix as a capability change (that file's own prior mistake pattern).
- **`ISSUE-resolve-ignores-vendor-override.md`** (new) — records a confirmed code
  defect found while writing this batch: `--resolve <task-id> --vendor <v>` never
  reads `--vendor` (the branch at `cli/bin/hopper-dispatch`'s `--resolve` handler
  calls `runResolve(hopperDir, taskId)` with no vendor param, unlike `--adhoc`/sync
  dispatch/`--background`, which all thread `--vendor` through as `vendorOverride`).
  `--resolve` always prints the unmodified AGENTS.md/queue.md routing result, with
  no notice that the override was ignored. Deliberately NOT fixed in this release
  (this batch already changes generated-artifact + skill behavior; scope is capped
  here) — `--help` and `skills/hopper-dispatch/SKILL.md` now say so honestly instead.

### Changed — BEHAVIOR CHANGE (scaffold + first-run/upgrade guidance)

- **`hopper-dispatch --init-tasks`'s generated `.hopper/AGENTS.md`** — the
  `## Active Agent Instances` table (`cli/src/scaffold.js`) now includes `claude`
  and `mimo` rows (both are registered adapters that were simply missing from the
  table before) and annotates `opencode` / `copilot` / `agy` / `mimo` as
  **not supported (2026-07-31 product decision)** — the current product-supported
  set is `codex` / `grok` / `claude` / `kimi`. No adapter files removed, nothing
  hardcoded to block dispatch to the unsupported four (that stays purely a docs/
  positioning note) — a new paragraph above the table says explicitly that this
  table only inventories known CLIs, and that `## Approved Vendors` (below it) is
  the sole real execution gate. `agy`'s pre-existing technical
  `HOPPER_ENABLE_AGY=1` disablement note is preserved verbatim, unchanged.
- **`skills/hopper/SKILL.md`** (catch-all skill) gains a new `## First Run And
  After An Upgrade` section, read before `## Locate The Target`: (1) no `.hopper/`
  found → run `hopper-dispatch --init-tasks` first, not "ask the user for a path"
  (that's now the fallback for a project living somewhere `--init-tasks` shouldn't
  run from cwd); (2) `.hopper/` exists but `AGENTS.md` has no `## Approved Vendors`
  section → this is a pre-v0.40.0 project, dispatch is fail-closed-refused, point
  at `MIGRATION.md`, and — since Safety Rules already forbids editing AGENTS.md
  without the user asking — explicitly tell the agent to ask the user which
  vendors to approve rather than getting stuck on that constraint; (3) clarify
  `--setup`/`--doctor` (what's installed/authed on this machine) vs. `##
  Approved Vendors` (what this project allows) are two separate gates that both
  must pass.
- **`cli/bin/hopper-dispatch --help`** — the `--init-tasks` line now notes that
  dispatch also requires `.hopper/AGENTS.md`'s `## Approved Vendors` table, with
  a pointer to `MIGRATION.md` for upgraded projects. The `--vendor` line's
  outdated `host != vendor still enforced` wording (a literal reading implies
  string equality, which v0.39.0 replaced with `VENDOR_FAMILY`-based comparison)
  is corrected, and now states plainly that the override does not apply to
  `--resolve` (see the new issue file above).

### Fixed — documentation accuracy (`skills/hopper-dispatch/SKILL.md`)

- **`--check <task-id>` was documented as an alternative dry-routing-check to
  `--resolve <task-id>`; it is not.** `--check [<vendor>]` shows a vendor CLI's
  install/auth status (all vendors if omitted) — it has nothing to do with task
  routing, and passing a task-id to it fails with `unknown vendor '<task-id>'`.
  The flag-whitelist list and the "dry routing check" step now describe `--check`
  correctly and reserve the dry-run framing for `--resolve <task-id>` alone.

### Fixed

- `tests/unit/vendored-plugin-sync.test.js`'s hardcoded release-metadata version
  literal rolled from `0.41.1` to `0.42.0` alongside this release (per this
  file's own convention: the test hardcodes the CURRENT release and must roll
  every time, not just when its own assertions change).

### Added — teeth (so this batch's fixes cannot silently drift back)

- **`PRODUCT_SUPPORTED_VENDORS`** (`cli/src/vendors/index.js`) — the 2026-07-31
  product-supported set (`codex` / `grok` / `claude` / `kimi`) previously lived
  ONLY in prose. `cli/src/scaffold.js` now derives both the row set (from
  `listAdapters()`) and the "not supported" annotations from it, instead of
  hand-listing them. Generated `AGENTS.md` output is byte-identical to the
  hand-fixed version; only the source of truth moved.
- **`tests/unit/scaffold-vendor-coverage.test.js`** (new, 4 assertions, all
  discovery-driven — no hardcoded vendor names): every registered adapter has a
  row; every non-supported adapter is annotated; no supported adapter is
  mislabeled; every name in the constant is a real adapter id. The first
  assertion is the one that would have caught this release's original bug
  (`claude` and `mimo` missing from the table entirely).
  **Known limit:** these prove *scaffold output matches the constant*, not that
  the constant matches the product decision. Editing the constant to a different
  but valid set keeps everything green.
- **`tests/unit/vendor-security-claims.test.js`** — `scanTargets()` no longer
  hardcodes `'README.md'`; it globs `README*.md` at the repo root, so new language
  versions are in scan range automatically. **Known limit:** the DENYLIST entries
  are English regexes, so `README.en.md` gets real coverage while `README.ja.md`
  effectively does not — a Japanese-worded restatement of the same false claim
  would not be caught.

### Added — documentation

- **`README.en.md`** / **`README.ja.md`** (new); `README.md` is now Chinese and is
  the authoritative version, restructured product-first: the supported-vendor set
  and the two-layer vendor control (machine scan vs. project `Approved Vendors`,
  fail-closed) are stated up front instead of 58 lines in, a first-run walkthrough
  (`--setup` → `--init-tasks` → fill Approved Vendors → dispatch) replaces the gap
  where `--init-tasks` was never mentioned at all, and a "what it cannot do"
  section states the sandbox reality (read-only is a request; grok is always
  `bypassPermissions`; codex is platform-split) rather than leaving it implied.
  Corrected two badges that had gone stale unnoticed across multiple releases:
  hosts 4 → 7 (unchanged since the repo was created, while three host dirs were
  added) and the test count.
  The architecture description's `host != vendor` phrasing is now stated as
  family comparison — read literally it implies the guard is a no-op for exactly
  the pair it exists to catch.

## [0.41.1] - 2026-08-02

### Changed — non-functional (GitHub username rename)

- **GitHub owner handle renamed `surebeli` → `litianyi-007`** (account rename;
  the old handle still redirects, so this is a text-only follow-up, not an
  urgent fix). Updated every currently-effective reference to the new handle:
  `package.json` (`author`, `homepage`, `repository.url`), `.claude-plugin/plugin.json`
  (`description`, `author`), `.codex-plugin/plugin.json` (`author`, `homepage`,
  `repository`, `interface.developerName`, `interface.websiteURL` — synced to
  `plugins/hopper/.codex-plugin/plugin.json` via `npm run sync:plugin`),
  `.claude-plugin/marketplace.json` (top-level `homepage`/`repository`/`owner.name`
  and the `plugins[0]` entry's `author.name`/`homepage`/`repository` — `owner.email`
  deliberately left untouched, it is not a GitHub-identity field), `plugins/hopper/kimi.plugin.json`
  (`author`, `homepage`, `interface.developerName`, `interface.websiteURL`),
  `LICENSE`, `README.md` badge, and the three host-adapter READMEs
  (`hosts/{claude-code,codex-cli,opencode}/README.md`).
- Historical references to the old handle inside already-published CHANGELOG
  entries above and inside `docs/spikes/T-PLUGIN-00b-vendors.md` (a literal
  email address in a completed spike log, not a GitHub handle) are left as-is
  — they record what was true at the time.
- Patch-only per this file's own versioning convention ("Versioning" above):
  non-functional tweak, no user-observable behavior change.

## [0.41.0] - 2026-07-31

### Changed — BEHAVIOR CHANGE (codex read-only dispatch on macOS/Linux)

- **codex's sandbox-bypass default is now platform-split, reversing part of
  the 0.34.0-era "codex has NO read-only scenario" decision.** That decision
  applied the Windows-only rationale (`-s <mode>` sandbox harness cannot spawn
  ANY child process there — `CreateProcessWithLogonW` 1326,
  ISSUE-codex-callchain-windows) to **every** platform, so codex always ran
  full-access via `--dangerously-bypass-approvals-and-sandbox` regardless of
  platform or requested sandbox. Manually verified 2026-07-31 on macOS that
  this was unnecessarily broad: `codex exec -s read-only` genuinely denies a
  write (`operation not permitted`, file never created) while
  `--dangerously-bypass-approvals-and-sandbox` with the identical command
  creates it — codex's own sandbox works fine on macOS/Linux; only Windows is
  broken.

  `codexSandboxBypassActive(platform)` (new, exported from
  `cli/src/vendors/codex.js`) now branches on `process.platform`:

  ```js
  export function codexSandboxBypassActive(platform = process.platform) {
    return platform === 'win32'
      ? process.env.HOPPER_CODEX_SANDBOX_BYPASS !== '0'
      : process.env.HOPPER_CODEX_SANDBOX_BYPASS === '1';
  }
  ```

  - **Windows: unchanged.** Bypass stays the default; `HOPPER_CODEX_SANDBOX_
    BYPASS=0` still reverts to the (broken) real `-s` sandbox.
  - **macOS/Linux: reversed.** Bypass is now OFF by default — codex honors the
    *requested* `-s <mode>` for real, including `read-only`.
    `HOPPER_CODEX_SANDBOX_BYPASS=1` opts back into the old always-full-access
    behavior.
  - **The escape hatch's default polarity is intentionally OPPOSITE per
    platform** — same env var, `=0` disables bypass on Windows but `=1`
    enables it on macOS/Linux. This is documented in the function's own JSDoc,
    in `cli/src/rules.js`'s generated `--sandbox` note, and in every affected
    user-facing doc (see below) specifically so a reader does not assume "=0
    always means off."

  `cli/src/dispatch.js`'s `resolveAdapterOptsForTask` (the `codexAlwaysFullAccess`
  check that used to force codex to `danger-full-access` unconditionally) and
  `cli/src/setup.js`'s `sandboxControl()` (the `--setup`/`doctor` classifier)
  both now re-derive from the same `codexSandboxBypassActive()` helper instead
  of duplicating the old unconditional formula — `sandboxControl(codex)` is
  therefore `'full'` on Windows and `'argv'` on macOS/Linux (previously
  unconditionally `'full'`); `sandboxControl()` gained an optional `{ platform
  }` test-only override to make both branches assertable without a real
  Windows host.

  `--skip-git-repo-check` now rides along on **every** sandbox mode and
  platform (previously bypass-path only). Manually verified: `codex exec -s
  read-only` in a non-git directory hits the exact same "Not inside a trusted
  directory" trust-gate error that the bypass path hit before
  `--skip-git-repo-check` was added for it — the gate is not specific to
  bypass mode, so a `HOPPER_VENDOR_CWD` pointed at a non-git root would have
  silently broken every macOS/Linux read-only codex dispatch under this
  release without this change. `HOPPER_CODEX_SKIP_GIT_CHECK=0` still restores
  codex's default trust-gate behavior on every mode/platform.

  **`--subject-root`'s reachable surface widens as a side effect.** It requires
  the *effective* sandbox to be `read-only`; before this change codex's
  effective sandbox was always forced to `danger-full-access`, so
  `--subject-root` + codex was dead-on-arrival on every platform (the
  precondition could never hold). On macOS it can now hold for real, and
  `--subject-root`'s outer `sandbox-exec` guard composes cleanly with codex's
  own inner `-s read-only` — manually verified: nesting them denies the write
  with no hang, crash, or conflict (Seatbelt sandboxes nest fine; both layers
  only ever narrow permissions).

  **Who is affected / how to roll back:** any *existing* dispatch on macOS or
  Linux that relies on a `read-only`-defaulting task-type (`code-review-
  adversarial`, `code-review-acceptance`, `spec-blindspot-hunt`, `prd-research`,
  `market-research` — see `validation.js`'s `READ_ONLY_DEFAULT_TASK_TYPES`) or
  an explicit `--sandbox read-only`/`workspace-write` routed to **codex**, and
  which was until now silently getting full write access, will start actually
  being denied writes. Audited: the five read-only-default task-types are
  documented review/research work that should not write
  (`code-review-adversarial`/`-acceptance` are explicitly annotated "read-only
  sandbox REQUIRED" in `cli/src/scaffold.js`'s task-frame template) — none of
  them are expected to need write access. `code-impl` and other genuinely
  writable task-types are unaffected (they default to `danger-full-access`,
  which still gets full access on every platform, just via `-s
  danger-full-access` instead of the bypass flag on macOS/Linux — verified
  functionally equivalent). If a project-specific brief was quietly relying on
  a "read-only" codex dispatch actually having write access on macOS/Linux, set
  `HOPPER_CODEX_SANDBOX_BYPASS=1` (globally) to restore the pre-0.41.0
  always-full-access behavior on those platforms, or pass an explicit
  `--sandbox danger-full-access`/`workspace-write` for that dispatch. Windows
  dispatches are completely unaffected either way.

  Docs updated in the same change: `README.md` (both the Scenario-1 permission
  paragraph and the Core Skills footnote), `commands/dispatch.md`,
  `review.md`, `research.md`, `market.md`, `swarm.md`, `setup.md`,
  `skills/hopper-setup/SKILL.md`, `cli/src/rules.js`'s generated `--sandbox`
  note (plus `HOPPER_CODEX_SANDBOX_BYPASS`/`HOPPER_CODEX_SKIP_GIT_CHECK` added
  to `rules.js`'s env-neutralization list so the generated matrix doesn't pick
  up a generating shell's env), and a new dated row in
  `docs/specs/vendor-io-protocol-current-vs-target.md` (the 2026-06-25 row
  this partially reverses is left as historical record, per this file's
  append-only convention).

  Tests: `tests/unit/codex-isolation.test.js`, `dispatch-flags.test.js`,
  `prompt-delivery.test.js`, `setup.test.js`, `vendor-security-claims.test.js`,
  and `vendors-contract.test.js` all gained platform-injected fixtures
  (`win32`/`darwin`/`linux` via a test-only `opts.platform` /
  `adapterOpts.platform` override — real dispatch never sets it) plus a
  destructive counter-proof that pins the platform branch as load-bearing (a
  return to the old unconditional-bypass formula flips the darwin/linux
  fixtures red). Windows fixtures are necessarily injected, not run for real
  (no Windows host available); this is called out explicitly in the test
  comments rather than silently assumed.

## [0.40.0] - 2026-07-31

### Added

- **`.hopper/AGENTS.md` gains a "## Approved Vendors" whitelist section**,
  upgrading AGENTS.md from a pure routing table into an actual per-project
  vendor gate. Previously the `Notes` column's "入选/未入选" (approved/not
  approved) annotations were prose only — nothing in the code read them, so
  `--vendor <anything-registered>` dispatched regardless of what a project
  had actually approved. Now `cli/src/agents.js`'s `parseAgentsContent`
  parses a `| Vendor | Approved | Approved by | Date | Scope / Notes |`
  table into a new `approvedVendors` field, and a new
  `assertVendorApproved(agentsData, vendor)` enforces it at **both**
  vendor-resolution call sites in `cli/src/dispatch.js` — `resolveDispatch`
  (the queue.md path) and `resolveAdhocDispatch` (the ad-hoc
  review/research/market/swarm path) — running immediately AFTER
  `vendorOverride || resolveVendor(...)`, so an explicit `--vendor` override
  is checked too, not just AGENTS.md-routed dispatches.
- **Polarity is fail-closed by design**: an AGENTS.md with no "## Approved
  Vendors" section refuses EVERY vendor (`E_APPROVED_VENDORS_SECTION_MISSING`),
  and a section that exists but doesn't list a vendor as `yes` also refuses
  it (`E_VENDOR_NOT_APPROVED`, listing the known entries). This project has
  direct history with the opposite polarity ("missing = allow") turning one
  deleted line into a silent global kill-switch (see the `.codex-plugin/
  plugin.json` version-drift incidents in this same file); the new gate
  deliberately does not repeat that shape one layer up.
- This is a **separate, independent control from the existing host!=vendor
  isomorphism guard** (`validateHostVendorSeparation`) — a vendor can be
  Approved-Vendors-whitelisted and still rejected by host!=vendor (e.g. a
  Claude Code host dispatching to the approved `claude` vendor), and neither
  gate short-circuits the other. Covered by new tests in
  `tests/unit/host-detect.test.js` (approving `claude` in the fixture's
  Approved Vendors table, then confirming the CLI still rejects it via
  host!=vendor) and new cases in `tests/unit/agents.test.js`.
- The scaffold template (`cli/src/scaffold.js`, `hopper-dispatch
  --init-tasks`) now generates the new section (present but empty) alongside
  the existing "Active Agent Instances" table — unchanged/still generated —
  with a note that every dispatch is refused until the project fills it in.
- **Documentation-only vendor support-tier decision**: `commands/vendors.md`
  and `README.md` now note that the actively product-supported vendor set is
  `codex` / `grok` / `claude` / `kimi`; `agy` / `copilot` / `mimo` /
  `opencode` are marked **not supported** (distinct from `agy`'s pre-existing
  technical `dispatchDisabled` gate). No adapter files were removed and
  nothing is hardcoded in code to enforce a 4-vendor limit — the Approved
  Vendors table above is the single execution point, so this note and that
  mechanism cannot drift apart the way a hardcoded list would.

## [0.39.0] - 2026-07-31

### Fixed

- **The host!=vendor isomorphism guard (`validateHostVendorSeparation`) was a
  no-op for the Claude Code host, and even a fixed version of the same guard
  would have stayed a no-op under pure string equality.** Two independent
  defects, both real, both confirmed empirically:
  1. `hostVendor` came ONLY from `process.env.HOPPER_HOST_VENDOR`, which is
     set exclusively by the 5 Tier-C bash wrappers (`hosts/{codex-cli,
     copilot-cli,grok-cli,cursor-cli,opencode}/bin/hopper-*`). `hosts/
     claude-code/bin` does not exist — Claude Code's slash commands invoke
     `hopper-dispatch` directly (see `commands/dispatch.md`) — so the env var
     was NEVER set under Claude Code, and `validateHostVendorSeparation`'s own
     `if (!hostVendor) return;` guard silently skipped the check for every
     real dispatch from inside a Claude Code session.
  2. The comparison itself was `hostVendor === resolvedVendor` — even had a
     host identity been supplied for Claude Code, the natural value ('claude-
     code') would never equal the vendor name ('claude'), so string equality
     could not have caught the one case the guard exists for (a Claude Code
     host dispatching back to the `claude` vendor, i.e. `claude -p` calling
     itself through a different entry point).

  Fixed with two additions: `cli/src/host-detect.js` self-detects the Claude
  Code host from markers Claude Code itself sets (`CLAUDECODE`,
  `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID`) whenever
  `HOPPER_HOST_VENDOR` is unset — deliberately NOT branching on any other
  vendor's env vars, because a Codex Claude-Code-plugin was observed setting
  `CODEX_COMPANION_SESSION_ID`/`CODEX_COMPANION_TRANSCRIPT_PATH` INSIDE a real
  Claude Code session; a naive "sees a `CODEX_*` var → host is codex" rule
  would have misidentified that session as the Codex CLI host. And
  `cli/src/validation.js` now exports a `VENDOR_FAMILY` map (`claude`/
  `claude-code` → `anthropic`, `codex` → `openai`, `grok` → `xai`, `kimi` →
  `moonshot`) so `validateHostVendorSeparation` compares FAMILY, not raw
  strings — bridging the `claude-code`/`claude` naming mismatch while still
  allowing `claude` as a legal vendor for every OTHER host (a Codex/Grok/etc.
  host dispatching to the `claude` vendor remains a legitimate heterogeneous
  dispatch and is unaffected). `copilot`/`opencode`/`mimo`/`agy` are
  deliberately left OUT of the family map — each is documented in its own
  adapter file as multi-backend (spanning multiple model companies depending
  on subscription/config), so guessing a single family for them would be
  fabricated, not derived; see the map's own comment in `validation.js` for
  the per-vendor citation trail. When a host identity has no family mapping
  (including a host that self-detection could not confidently identify), the
  guard no longer silently no-ops: it returns a `notice` that the isomorphism
  check did not run, and `hopper-dispatch` prints it (never a silent skip).

  `commands/dispatch.md` and `hosts/claude-code/README.md` previously claimed
  "host≠vendor still enforced" / the guard "blocks... a Claude Code host
  dispatching back to the claude vendor" — both now describe the actual
  (fixed) behavior, including the family-based comparison and the
  host-unrecognized upper bound. No vendor adapter argv changed.

## [0.38.0] - 2026-07-29

### Fixed

- **User-facing docs asserted a "read-only" sandbox was enforced when it isn't,
  for the two vendors that route there by default.** `commands/review.md`,
  `research.md`, `market.md`, `swarm.md`, and `README.md` said things like
  "so the reviewer never edits the repo" and labeled `/hopper:review` /
  `research` / `market` as flatly "(ad-hoc, read-only)". That was false for
  **codex** (the default reviewer for acceptance review, research, and market;
  a common swarm panelist) and **grok** (the default adversarial reviewer; also
  a common swarm panelist): codex *always* runs full-access via
  `--dangerously-bypass-approvals-and-sandbox` (`cli/src/vendors/codex.js:292`
  — a deliberate Windows-sandbox workaround, not a bug), and grok *always* runs
  `--permission-mode bypassPermissions` (`cli/src/vendors/grok.js`) regardless
  of the requested sandbox. The engine's own generated dispatch rules already
  said this honestly (`cli/src/rules.js:153`, `.hopper/DISPATCH.md`); the
  plugin's own command docs and README did not, until now.

  All five files now say "read-only" is a *request* carried by the executor
  prompt frame, name codex/grok's actual always-full-access behavior, and point
  at `--subject-root` (macOS, opt-in) for a genuine per-process guard —
  including its own already-documented limits (pre-existing hard links, reads,
  and network/IPC are out of scope; not a confidentiality boundary). No vendor
  sandbox behavior changed — only the doc's description of it.

  `commands/setup.md:25,39` and `skills/hopper-setup/SKILL.md:20` were audited
  too ("prefer a vendor whose Sandbox=argv so read-only is actually enforced").
  That phrasing itself is a conditional vendor-*selection* recommendation, not
  an unconditional claim about every dispatch — but the audit found the
  classification it leans on, `cli/src/setup.js`'s `sandboxControl()`, was
  itself wrong for grok (see the same-day follow-up fix directly below).

- **`sandboxControl()` classified grok as `'argv'` (downgradable via flags)
  when grok never actually honors a read-only request.** The classifier's only
  test was "does the argv differ between full-access and read-only requests" —
  true for grok (`--always-approve` toggles), so it read as downgradable. But
  grok's `--permission-mode` stays `bypassPermissions` regardless of the
  requested sandbox (`cli/src/vendors/grok.js`), so the "read-only" argv it was
  comparing never actually restricted anything — the exact gap the pin tests
  added above already proved at the argv level, just not yet reflected in the
  classifier a human (or `/hopper:setup`) would read. Fixed by having
  `sandboxControl()` additionally check whether the *read-only* argv itself
  still carries an unconditional-access flag/permission-mode
  (`argvPinsUnconditionalAccess()`, covering `--dangerously-bypass-*`,
  `--dangerously-skip-*`, `--always-approve`, and `--permission-mode
  bypassPermissions`); grok now reports `'full'` — the same bucket as codex,
  which the fix leaves unchanged. Verified this does not point "prefer
  Sandbox=argv" at an empty set: `opencode`, `copilot`, `agy`, `mimo`, and
  `claude` all remain genuinely `'argv'` (their read-only argv carries no such
  flag), so the recommendation stays true and actionable in general — it's
  just that hopper's two *built-in reviewer defaults* (codex, grok) were never
  (codex) or are no longer misreported as (grok) members of that set.
  `commands/setup.md:25,39` and `skills/hopper-setup/SKILL.md:20` were updated
  in the same change to spell out the `'full'` value and name codex+grok as
  both `'full'`.

### Added

- **`tests/unit/vendor-security-claims.test.js`** — pins codex/grok's real
  argv for a `sandbox: 'read-only'` request (so a future genuine fix to either
  vendor's read-only support fails this test, forcing the docs above to be
  updated in the same change) and denylist-scans `commands/*.md` (excl.
  `setup.md`) + `README.md` for recurrence of the exact false phrasings fixed
  above. Explicitly documented as a denylist, not a semantic checker: it
  catches recurrence of these phrasings, not a differently-worded false claim.
  Same-day follow-up added T-a/T-b/T-c: `sandboxControl(grok)` must not be
  `'argv'` (must be `'full'`); `sandboxControl(codex)` stays `'full'`
  (no regression); and a fake adapter with a genuinely downgradable read-only
  argv still reports `'argv'` (positive control — proves the fix targets the
  specific unconditional-access-flag case rather than collapsing every vendor
  into `'full'`).

## [0.37.0] - 2026-07-28

### Fixed

- **codex `--search` was placed after the `exec` subcommand, so every web-search
  dispatch to codex died on argv.** `--search` is a TOP-LEVEL codex flag; codex
  rejects it after the subcommand with `error: unexpected argument '--search'
  found` and never starts. Because `prd-research` / `market-research` auto-enable
  webSearch, **no research task could be dispatched to codex at all** — it failed
  before doing any work. Verified live on codex-cli 0.145.0: `codex exec --search
  <prompt>` → unexpected argument; `codex --search exec <prompt>` → rc=0 with real
  output; `codex exec --help` does not list the flag while `codex --help` does.
  The adapter now emits `--search` before `exec`, verified end-to-end by spawning
  the adapter's own argv (rc=0, expected output, no argv error).

  The pre-existing test — under a section header literally reading "the
  load-bearing `--search` fix" — asserted only that `--search` appeared
  *somewhere* in argv. It did; presence was never the defect. That test stayed
  green for the entire time the feature was broken. Its replacement asserts the
  index, plus a generalized guard that no known top-level-only flag drifts behind
  the subcommand.

### Added

- **`HOPPER_WEB_SEARCH=0`** opts out of the research-task web-search auto-enable.
  Distinct from the fix above: with argv now correct, a research task over a
  purely local corpus still may not want live web search pulling external content
  in. Suppresses only the *default* — an explicit `--web-search` still wins, and
  only the exact string `0` opts out.

### Changed

- `package-lock.json`'s own `version` field is now part of the release bump. It
  had been left at `0.8.1` across two dozen releases — harmless to npm, but it
  made the lockfile useless as a record of which release it belongs to.

## [0.36.0] - 2026-07-24

### Fixed

- **OpenCode on Windows no longer receives truncated task briefs.** On the win-cmd-shim regime (`cmd.exe /c opencode.cmd`), a multi-line composed prompt now takes the pointer-file channel regardless of size when the vendor cannot read the prompt from stdin — previously only prompts over the byte budget used the pointer, so small multi-line briefs arrived cut to their first segment and opencode answered "your message seems to be cut off" (commit `6aa10d3`, ISSUE-opencode-windows-multiline-prompt-truncation).
- **Grok no longer false-fails successful runs.** `parseResult` now recovers a pretty-printed multi-line JSON result envelope framed by runner log lines, instead of declaring `adapter-protocol-invalid` on an exit-0 run with a complete `EndTurn` answer (commit `6aa10d3`, ISSUE-grok-adapter-protocol-invalid-false-fail).
- **OpenCode exit-0 successes are no longer misclassified from log-shaped output.** The adapter drops `--print-logs` so stdout stays a clean NDJSON event stream, strips ANSI escape sequences before per-line JSON parsing, and conservatively recovers readable plain text (as unverified evidence, never flipping a run to success) when zero JSON events parse (commit `a1fe9fd`, ISSUE-opencode-ansi-log-output-not-parsed).

### Improved

- Pointer instructions are single-line with the prompt-file path front-loaded, so the pointer itself is safe on the same argv channel it works around; prompt-delivery results now carry consistent `channel` labels (`stdin` / `argv-inline` / `argv-pointer`) (commit `7a1e9b2`).

### Added

- **Kimi Work plugin support**: `plugins/hopper/kimi.plugin.json` lets Kimi Work install hopper as a managed plugin (skills under `plugins/hopper/skills/`).
- 19 new unit tests across prompt-delivery, grok, and opencode parsing (suite: 1024 tests total; the 7 dashboard-* environment suites + 1 flaky lifecycle test that fail also fail on the unmodified baseline).

## [0.35.1] - 2026-07-24

### Improved

- Failed task views now front-load the next safe action when parser-designated vendor text was recovered. The task remains `failed`; users are directed to the guarded result surface rather than raw logs.

## [0.35.0] - 2026-07-23

### Fixed

- Failed background dispatches now retain only parser-designated vendor answer text when the adapter can prove its provenance. The task remains `failed`; recovered text is labelled `verified-complete` or advisory `unknown-completeness`.
- Grok readiness reports launcher credential context as unverified instead of claiming remote authentication, narrows transport-vs-auth attribution, and its outer host wrapper now defaults to `grok-4.5`.

### Security

- `--result --full` no longer emits raw vendor log tails. It can show only the guarded parser-designated sidecar or sanitized output body.

## [0.34.2] - 2026-07-22

### Added

- **OpenCode explicit reasoning forwarding.** An explicitly supplied Hopper
  `--reasoning <level>` now becomes `opencode run --variant <level>`. A
  provider-specific `HOPPER_OPENCODE_VARIANT` still has higher precedence and
  is passed through unchanged. Hopper deliberately omits `--variant` when its
  reasoning value was inherited from AGENTS policy or the global default, so
  arbitrary/custom OpenCode providers are not assumed to support a universal
  variant set.

## [0.34.1] - 2026-07-22

### Fixed

- **Corrected Kimi's read-only fail-closed order and diagnostic.** Kimi prompt
  mode still has no permission or sandbox flag that can enforce read-only;
  Hopper now returns `E_KIMI_READ_ONLY_UNENFORCEABLE` before optional
  subject-root setup, with no vendor process, external guard, or output
  artifact started. `--write` controls only Hopper's synchronous `output.md`
  artifact and does not change Kimi or any vendor's permissions.

## [0.34.0] - 2026-07-22

### Fixed

- **Read-only Kimi requests now stop before any vendor process starts when its
  command mode cannot enforce the requested sandbox.** This prevents a task
  from being described as read-only while it can still modify files.
- **Long-running background work now reports that the process is alive without
  exposing prompt text, vendor output, paths, account data, or model details.**
  Terminal updates clear that liveness signal, so completed work does not keep
  appearing active.
- **Public command, watch, and dashboard views now consistently hide raw
  adapter, model, cache, and process diagnostics.** Users receive a stable
  actionable status instead of sensitive implementation details.
- **Windows cleanup, workspace validation, and cache handling now fail safely
  and remain stable across interrupted or concurrent runs.**

### Changed

- **OpenCode and Fable-backed flows now preserve their explicit runtime
  behavior while refusing unsupported or unsafe execution paths.**

### Tests

- Added regression coverage for read-only refusal, content-free liveness,
  closed public diagnostics, cache/workspace recovery, one-spawn execution,
  and root-to-vendored plugin synchronization.

## [0.33.0] - 2026-07-22

### Fixed

- **Grok no longer misclassifies a successful trailing JSON result as an auth
  failure merely because the merged runner log contains an unrelated MCP
  authentication warning.** For exit-0 Grok runs, a parsed JSON envelope with
  non-empty text and a normal stop reason is preferred before existing auth
  detection; genuine non-structured plain stdout keeps its legacy success
  behavior when no auth signal is present. Cancelled, empty, error, malformed,
  and nonzero structured results retain their failure behavior.
- `--result --full` now exits naturally so piped stdout drains completely before process termination.

### Tests

- Added unit and runner regression coverage for merged stderr authentication
  warnings plus a valid Grok JSON result, and for cancelled/empty and nonzero
  auth failures. The runner case also proves one vendor spawn and a nonempty
  parsed output body.

## [0.32.0] - 2026-07-18

### Fixed

- **grok adapter `knownGood` was stale, breaking every `verified-latest`
  dispatch to grok.** xAI rotated the Grok Build CLI's model line between
  2026-06-02 and 2026-07-16: `grok-build` and `grok-composer-2.5-fast` (the
  prior `knownGood`) both now return `Couldn't set model '<x>': Invalid
  params: "unknown model id"`. `knownGood` is now `['grok-4.5']`
  (`cli/src/vendors/grok.js`, live-verified 2026-07-18 via
  `grok -p ... -m grok-4.5` micro-test), and `DEFAULT_MODEL` follows.
  See `ISSUE-grok-model-line-rotation-stale-knownGood.md`.

### Changed

- **`hopper-dispatch --probe grok` now live-parses `grok models` instead of
  returning a hardcoded static catalog.** This was the deeper root cause
  behind the knownGood staleness above: the old probe admitted in its own
  comments that live introspection was an unimplemented follow-up, so
  `--probe grok` could never self-heal a model-line rotation — it just wrote
  the same stale hardcoded list back to the cache. `cli/src/vendor-probe/grok.js`
  now spawns `grok models` (one subprocess, 30s timeout, no retry — mirrors
  the codex/opencode/kimi probe pattern), parses the "Available models:"
  bullet list (new exported pure parser `parseGrokModelsList`), and reports
  `introspection_supported: 'full'` with the live catalog. On spawn/parse
  failure it degrades honestly to the adapter's static `knownGood`
  (`introspection_supported: 'partial'`, notes explain why) instead of
  silently reporting stale or empty data. `estimateSpawns()` in
  `cli/bin/hopper-dispatch` updated (grok: 0 → 1 subprocess per probe).

### Documentation

- `docs/release/INSTALL-MATRIX.md`, `commands/models.md`,
  `cli/src/scaffold.js`'s example vendor table: grok references updated from
  `grok-build` to `grok-4.5` and from "static" to "live `grok models` parse
  with static fallback".
- Recorded a follow-up hardening idea in
  `ISSUE-grok-model-line-rotation-stale-knownGood.md`: `--check-model`'s
  `verified` verdict and the `verified-latest` sentinel resolution
  (`cli/src/model-check.js`, `cli/src/policy.js`) trust the static
  `knownGood` list unconditionally and never cross-check it against a fresh
  probe cache, so a stale `knownGood` entry (as above) produces a false
  "verified" even on a machine that has already probed and knows better.
  `cli/src/setup.js`'s `--setup --deep` / `--doctor --deep` path already has
  a live-vs-static reconciliation mechanism (`modelReconcile` /
  `reconcileModels`) but `--check-model` and `verified-latest` don't reuse
  it. Not fixed in this release — flagged for follow-up.

### Tests

- `tests/unit/vendor-probe.test.js`: 8 new grok cases — 4 pure-function
  fixtures for `parseGrokModelsList` (single model, multiple models with
  dash/asterisk leaders, missing header, header with no bullets) + 3
  fake-binary integration tests covering the `full` / `partial`-fallback /
  `none` introspection paths.
- Updated 3 existing tests that read the live grok adapter state and
  asserted the now-retired `grok-build` value: `tests/unit/
  dispatch-fallback-chain.test.js`, `tests/unit/vendor-model-auth.test.js`,
  `tests/unit/vendors-contract.test.js`.

### Sync points touched

`package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
`.claude-plugin/marketplace.json` (catalog + plugin entry), `commands/smoke.md`,
`commands/vendors.md`; `plugins/hopper/` vendored copy refreshed via
`node scripts/sync-vendored-plugin.mjs`.
