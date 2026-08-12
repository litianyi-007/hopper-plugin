# Issue archive

Field reports and defect records produced while building Hopper — one file per issue,
consolidated here on 2026-08-05 (previously 18 loose `ISSUE-*.md` files in the repository
root).

**Why consolidate.** Scattered across the root they answered no question well: you had to
open all eighteen to learn which were still open, and they crowded out the files a reader
actually needs first (README, MIGRATION, CHANGELOG). Here the status index below answers
that in one glance, which makes the OPEN ones *more* visible than they were, not less.

**Why keep them at all.** Several are cited from source comments as the reason a piece of
code is shaped the way it is; deleting them would strip that rationale. They are evidence,
so the bodies are reproduced **verbatim** — including their original mix of English and
Chinese. Historical records are not rewritten here; only this framing is new.

---

## Status index

### Open — 10

| Issue | Status | Severity |
|---|---|---|
| [`codex-bypass-flag-missing-from-argv`](#codex-bypass-flag-missing-from-argv) | open — extends/sharpens the still-open ISSUE-codex-windows-sandbox-1326.md | high on Windows — codex vendor does ZERO work; every dispatc |
| [`codex-review-hijack`](#codex-review-hijack) | 待 hopper 自查 | 高(codex 经 hopper 做"审查异仓 diff"类任务可靠失败,已 3+ 次) |
| [`codex-windows-sandbox-1326`](#codex-windows-sandbox-1326) | open | high on Windows (the codex vendor cannot execute ANY command |
| [`composeprompt-no-fail-closed-on-empty-spec`](#composeprompt-no-fail-closed-on-empty-spec) | Open — 未修，仅登记 | 低——当前 dispatch.js 已在上游拦住，属纵深防御缺失而非活跃缺陷 |
| [`mimo-codeimpl-timeout`](#mimo-codeimpl-timeout) | 待 hopper 自查 | 中(有 workaround=改派其它 vendor,但暴露 adapter 真实限制) |
| [`monitor-cross-session-crosstalk`](#monitor-cross-session-crosstalk) | open | medium-high (UX correctness: a session is woken/notified by  |
| [`progress-watch-hang`](#progress-watch-hang) | open — pre-existing, NOT introduced by the governance-fusion change (which never touched the `-- | medium (blocks the full-suite `npm test` gate; has a workaro |
| [`queue-brief-truncated-by-unescaped-pipe`](#queue-brief-truncated-by-unescaped-pipe) | Open — 未修，仅登记 | 中高——vendor 收到一份被截断的任务书，无任何报错；与已修的 queue-brief-dropped-without-leader-tasklist 同一失败形状 |
| [`stale-status-on-runner-death`](#stale-status-on-runner-death) | open — 未修，仅登记（见文末「归档说明」） | 中——不丢数据，但调用方会误判任务未完成，重复派发、浪费 vendor 调用 |
| [`task-spec-structural-only-body-accepted`](#task-spec-structural-only-body-accepted) | Open — 未修，仅登记 | 低——需要人写出这种 leader-tasklist 才会触发，但失败形状与已修两处完全相同 |

### Closed — 12

| Issue | Status | Severity |
|---|---|---|
| [`queue-brief-dropped-without-leader-tasklist`](#queue-brief-dropped-without-leader-tasklist) | CLOSED 2026-08-12 — fixed in 0.55.0（详细 spec 与 queue brief 现在合并进 prompt；缺失时 fail-closed，见 Resolution） | 高——被派发的 vendor 收到没有任务内容的框架，却仍返回 exit 0 / status: done |
| [`grok-models-succeeds-but-hopper-dispatch-auth-failed`](#grok-models-succeeds-but-hopper-dispatch-auth-failed) | CLOSED 2026-08-05 — root cause confirmed; fixed in 0.50.0 (see Resolution) | 高：两次已完成、已计费的 grok 评审被记为认证失败并丢弃 |
| [`grok-adapter-protocol-invalid-false-fail`](#grok-adapter-protocol-invalid-false-fail) | CLOSED — root cause confirmed as a line-level parse gap; fixed in this commit (see Resolution) | medium-high — the vendor actually COMPLETES the task (delive |
| [`grok-claude-buffered-output-idle-falsekill`](#grok-claude-buffered-output-idle-falsekill) | FIXED (mitigation applied below); a proper streaming-based fix is DEFERRED (see below) | high — every grok/claude BACKGROUND dispatch that legitimate |
| [`grok-model-line-rotation-stale-knownGood`](#grok-model-line-rotation-stale-knownGood) | 已修复（本 issue 记录根因 + 修复 + 一个更深的待办） | 高（`Model rule: verified-latest` 是 grok 派发的默认约定，过期即整条路径全失败，且无 |
| [`lockfile-missing-platform-rollup-variants`](#lockfile-missing-platform-rollup-variants) | RESOLVED 2026-08-03 — lockfile regenerated, `npm ci` restored in CI | anyone cloning this repo and running `npm ci` on linux or ma |
| [`opencode-ansi-log-output-not-parsed`](#opencode-ansi-log-output-not-parsed) | CLOSED — fixed in the audit-close commit (candidates 1+2 implemented; see Resolution) | medium-high — the vendor COMPLETES the task correctly (full  |
| [`opencode-windows-multiline-prompt-truncation`](#opencode-windows-multiline-prompt-truncation) | CLOSED — fixed in 6aa10d3; pointer-instruction hardening added in the audit-follow-up commit (se | high on Windows — every opencode dispatch with a multi-line  |
| [`prompt-artifact-lifecycle-and-windows-permissions`](#prompt-artifact-lifecycle-and-windows-permissions) | open — recorded, not fixed | not a credential leak (this repo's brief discipline forbids  |
| [`resolve-ignores-vendor-override`](#resolve-ignores-vendor-override) | 已修复（2026-08-03，同日）——见文末「修复记录」。选的是「实际 vs 预期」两个方向里的方向 1： | 中——不是安全问题，是「所见非所得」：`--resolve` 打印的 Vendor 与真实 dispatch 会用的 V |
| [`setup-sandbox-column-dead-code`](#setup-sandbox-column-dead-code) | CLOSED（2026-08-05 修复；影响面比原记录大得多，见下方「影响面更正」） | 中——不是安全问题，是「建议不可执行」 |
| [`verifypidimage-linux-node24-comm-mismatch`](#verifypidimage-linux-node24-comm-mismatch) | FIXED in `cli/src/subprocess.js` (pending real-CI confirmation — see "Not verified" below) | does not risk killing an unrelated process (the caller, |

### Status not machine-readable — 2

Read the body; the header did not carry a parseable status line.

| Issue | Status line | Severity |
|---|---|---|
| [`codex-callchain-windows`](#codex-callchain-windows) | — | high — codex dispatches return `status=done exit=0` while pr |
| [`codex-vendor-model-effort`](#codex-vendor-model-effort) | — | — |

---

<a id="grok-models-succeeds-but-hopper-dispatch-auth-failed"></a>

## grok-models-succeeds-but-hopper-dispatch-auth-failed

---

## ISSUE: `grok models` 成功，但 `hopper-dispatch` 真实派发终止为 `adapter-auth-failed`

> 状态：待 Hopper 开发者调查（根因未定）
>
> 首次记录：2026-08-05
> 严重性：高——已完成 OAuth 登录的同一 Grok CLI 可以取得 live model catalog，
> 但 Hopper 的真实 read-only 派发在执行阶段失败，阻断唯一允许的外部审查路线。

### 影响版本与环境

| 项目 | 已观测值 |
|---|---|
| 操作系统 | Windows |
| App host chain | `pwsh.exe -> codex.exe -> ChatGPT.exe -> explorer.exe` |
| 用户 / profile | `grok login --oauth`、`grok models` 与 Hopper 均在同一用户、同一 profile 语境中执行 |
| Hopper | `hopper-dispatch` 0.49.1 |
| Grok CLI | 0.2.118 |
| Grok binary | 唯一发现的 binary：`C:\Users\litianyi\.grok\bin\grok.exe` |
| 请求的 vendor / model / reasoning / sandbox | `grok` / `grok-4.5` / `high` / `read-only` |
| Windows sandbox 强制性 | `unknown/unverified`；本文不把请求的 `read-only` 误报为已独立验证的实际隔离 |

### 背景与期望

用户已执行 `grok login --oauth`。在上述同一 App host chain 内：

1. `grok models` 以 exit 0 完成。
2. `hopper-dispatch --setup grok --deep` 显示 `READY`；live catalog 为 1/1，模型为
   `grok-4.5`，并且它报告的是同一 Grok binary。
3. OAuth artifact 仅确认**存在**；本记录不读取、复制或输出其内容。

因此，至少应当能够区分「model catalog 可访问」与「真实 prompt 执行的认证 /
授权 / 协议问题」。如果真实派发失败，诊断应当准确、脱敏且可归因，而不能只让
已通过 catalog 探测的环境得到无可行动依据的 `adapter-auth-failed`。

补充观察：`HOME` 与 `GROK_HOME` 为空时，CLI 会给出
`auto worktree gc failed...` warning；但 `grok models` 仍以 exit 0 完成。该 warning
是待检验的影响因素，不是已确认根因。

### 实际结果

本次新建的独立任务为
`T-HAWK-VENDOR-POLICY-GROK-ONLY-REVIEW-AUTHED-20260805`。它先 `resolve` 成功，随后以
下列精确命令派发：

```text
hopper-dispatch T-HAWK-VENDOR-POLICY-GROK-ONLY-REVIEW-AUTHED-20260805 --background --vendor grok --model grok-4.5 --reasoning high --sandbox read-only
```

- 运行 PID：51648；启动时间：`2026-08-05T13:29:52.639Z`。
- progress #1 为 `starting`，#2–#7 为 `running/process_alive`，#8 为终态 `failed`。
- 诊断为 `adapter-auth-failed`；`recovered=none`。
- requested / effective model 均为 `grok-4.5`；observed model 为 `none`；resolution 为
  `unverified`。
- `--result --full` 没有 parser-designated sidecar，只显示 sanitized 的「no parsed text」。

本记录没有读取 raw log，也没有以其内容推断认证状态。

### 与旧任务的关系

旧任务 `T-HAWK-VENDOR-POLICY-GROK-ONLY-REVIEW-20260805` 同样以
`failed` / `adapter-auth-failed` / `recovered=none` 结束。新任务是用户明确授权的
**独立任务**，不是对旧任务的静默 retry、fallback 或 reroute；两者只能作为同一
故障模式的独立观察点。

### Resolution（2026-08-05，hopper 0.50.0）

**CLOSED — 根因确认。两次派发其实都成功了。**

本记录当时刻意没有读 raw log（取证纪律），而答案恰好全在里面。用真实适配器在真实
日志上复现，envelope 从 offset 149691 起可以干净解析：`stopReason: "end_turn"`、
`text` 16854 字符、`num_turns: 5`、`total_cost_usd: 0.318382`。旧任务同样完成
（7612 output tokens）。两份已付费评审被判为认证失败并丢弃。

**三个缺陷必须同时成立才会产生这个结果**，只修其中任何一个都仍会丢失结果：

1. **流来源被抹掉。** 后台模式下 runner 把一份交错日志（自身通知 + vendor stdout +
   vendor stderr）**同时**作为 `stdout` 和 `stderr` 交给 `parseResult`，代码注释里
   还写明了这么做。于是所有写成「扫 stderr 找问题」的分类器实际在扫**助手正文**。
2. **envelope 提取锚在第一个 `{`。** 0.35.1 加的 framed 候选从首个 `{` 切到末个 `}`，
   假设前导没有大括号。而 grok 基于 Rust `tracing`，它把结构体内联打印：一条关于
   `~/.cursor/hooks.json` 格式错误的警告渲染成 `ParseFile { path: ..., detail: ... }`，
   成了流里第一个 `{`（offset 145948，真 envelope 在 149691）。切片是垃圾，解析失败。
3. **auth 正则名不副实。** `hasSpecificGrokAuthFailure` 里 `invalid(?:\s+(?:api\s*)?key)?`
   的限定词是**可选**的，裸 `invalid` 即命中——而上面那条警告正好包含它。
   `\b(?:HTTP\s*)?(?:401|403)\b` 同理：行号、字节偏移、token 数都能命中。

第 4 个缺陷在修复过程中被异构评审发现：即使修好提取，`grokOutputEvidence` 只认
精确的 `"EndTurn"`，而真实 envelope 是 `end_turn`，这次运行仍会被标成
`unknown-completeness`。现有测试全部只用大写拼写，所以从未暴露。

**修复（0.50.0）**

- `cli/src/vendor-signal.js`（新）：`stderr` 不再是转录的谎言副本；分类器必须显式
  取 `combined` 并处理 `streamsSeparated: false`。定义**窄**的权威终态否决——
  vendor 自己报告完成时子串启发式不得推翻它，但 timeout / prompt 投递失败 /
  sandbox 违规等由 harness 确立的失败仍然优先。
- `cli/src/vendors/grok.js`：framed 候选改为**反向扫描**最后一个可解析的顶层对象；
  终态原因归一化比较；auth 正则的限定词改为必需。
- `claude.js` / `kimi.js` / `mimo.js` / `copilot.js`：同族整流子串分类器一并收紧
  （去掉与 exit 127 并列的 `not found` 子串、401/403 要求 HTTP 上下文、
  `invalid.*api` 这类跨转录贪婪匹配改为相邻匹配、按非零退出码门控）。
  `opencode.js` 是反例——它用逐行结构化事件，本来就没有这类分支。

**环境侧（是触发源，但不是原因）**：`~/.cursor/hooks.json` 格式错误、gitnexus 的
MCP 二进制不是有效 Win32 程序、`hawk-agent`/`stitch` 两个可选 MCP 认证失败。
grok 带着这些照样跑完 3 分 16 秒——修掉它们能移走今天的触发串，但任何含 `{`、
`invalid`、`401`、`403` 的 vendor 噪声都能复现，所以修复必须落在解析器一侧。

**仍然开着的相邻项**：grok 会自行加载 `~/.claude/settings.json`、
`~/.claude/plugins/**`、`~/.cursor/hooks.json`（`grok inspect` 从纯 shell、剥掉
所有 HOPPER_/CLAUDE_/CODEX_ 变量后仍如此），而 hopper 只给 codex 做了 env 隔离。
这是独立的确定性加固，不在本事故的因果链上——`GROK_HOME` 单独设置**不足以**隔离
（实测仍加载 138 条 Claude 权限），需要同时关闭 `[compat.claude]` / `[compat.cursor]`。

**评审**：结论经异构模型（codex gpt-5.6-sol）对抗评审，verdict `PASS_WITH_CHANGES`；
它推翻了初版分析的因果框架与修复顺序，本条记录的是修正后的版本。

### 证据范围与路径

下列文件为本 issue 的证据索引；只引用已允许的脱敏产物或路径，不复制任何
credential，也不引用 protected raw log 的内容：

- `F:\workspace\project\hawk-watcher\.hopper\queue.md`
- `F:\workspace\project\hawk-watcher\.hopper\handoffs\T-HAWK-VENDOR-POLICY-GROK-ONLY-REVIEW-20260805-task.md`
- `F:\workspace\project\hawk-watcher\.hopper\handoffs\T-HAWK-VENDOR-POLICY-GROK-ONLY-REVIEW-20260805-output.md`（仅 sanitized）
- `F:\workspace\project\hawk-watcher\.hopper\handoffs\T-HAWK-VENDOR-POLICY-GROK-ONLY-REVIEW-AUTHED-20260805-task.md`
- `F:\workspace\project\hawk-watcher\.hopper\handoffs\T-HAWK-VENDOR-POLICY-GROK-ONLY-REVIEW-AUTHED-20260805-output.md`（仅 sanitized）
- `F:\workspace\project\hawk-watcher\.harnessloop\state\current.md`

以下 `.log` 仅作为开发者可在本地按安全流程检查的**受保护原始证据路径**列出，
本文未读取、未摘录：

- `F:\workspace\project\hawk-watcher\.hopper\handoffs\T-HAWK-VENDOR-POLICY-GROK-ONLY-REVIEW-20260805-progress.log`
- `F:\workspace\project\hawk-watcher\.hopper\handoffs\T-HAWK-VENDOR-POLICY-GROK-ONLY-REVIEW-20260805-output.log`
- `F:\workspace\project\hawk-watcher\.hopper\handoffs\T-HAWK-VENDOR-POLICY-GROK-ONLY-REVIEW-AUTHED-20260805-progress.log`
- `F:\workspace\project\hawk-watcher\.hopper\handoffs\T-HAWK-VENDOR-POLICY-GROK-ONLY-REVIEW-AUTHED-20260805-output.log`

### 可复现步骤

在同一 Windows 用户 / profile / host chain 中进行；不要把 credential 内容贴入终端、
issue 或日志。

1. 交互式执行 `grok login --oauth`；只确认 OAuth artifact 存在，不读取其内容。
2. 执行 `grok models`，记录 exit code 与可见模型列表是否包含 `grok-4.5`。
3. 执行 `hopper-dispatch --setup grok --deep`，记录 `READY`、live catalog 及它解析的
   binary 路径。
4. 准备一个符合项目协议的独立 task contract，执行
   `hopper-dispatch --resolve <task-id> --vendor grok`，确认 resolve 成功。
5. 使用上文的精确 background dispatch 命令，随后通过 `--progress` 与
   `--result --full` 记录终态、`recovered`、effective/observed model 与解析产物。
6. 作为等价的最小 direct 对照，用户待执行：

   ```text
   grok -p "Reply exactly OK" --output-format json --no-auto-update -m grok-4.5 --cwd "F:\workspace\project\hawk-watcher" --permission-mode bypassPermissions --effort high
   ```

   该 direct result 目前为 **pending，等待用户补充**；本 issue 不臆造其 exit code、
   remote message 或输出。

### 根因状态与当前假设（按证据强度排序）

根因尚未确定。当前证据**不支持**把 ChatGPT App host、不同 user/profile 或 PATH
存在多个 Grok binary 作为首要解释：`grok models` 与 Hopper setup 均在所述同一 host
链和 profile 中运行，且只发现一个 binary。这不是对所有机器的一般性排除结论。

1. **catalog endpoint 与 prompt endpoint 的 scope/session 差异。** `grok models` 的
   成功只能证明 catalog 路径可用，不能证明 prompt endpoint 所需 OAuth scope、session
   或 model entitlement 可用；这是现有观测直接保留的最高优先级假设。
2. **background runner 与 direct CLI 的环境、stdio 或 cwd 差异。** detached/background
   spawn 可能没有继承 direct 调用需要的变量、stdin 语境、工作目录或 session 相关状态。
3. **adapter auth keyword classifier 的 false positive。** 当前 `adapter-auth-failed`
   没有伴随可归因的 machine-readable remote code / 匹配规则 / 来源 stream；非认证错误
   或模型正文中的关键词可能被过度归类。
4. **空 `HOME` / `GROK_HOME` 下的 `auto worktree gc failed...` warning。** 它与
   `grok models` 成功并存，尚无证据表明它影响 prompt 执行，但应通过 direct/runner
   环境对比验证。

### 开发调查建议

- 在不泄露 secret 的前提下，为 auth classifier 记录触发它的 machine-readable code、
  匹配规则标识与来源 stream（stdout / stderr / exit / parser）；将任何远端信息脱敏后
  写入诊断。
- 对比 direct 与 runner 的精确 argv、显式/继承环境、cwd、stdin/stdio、是否 detached，
  并标记每项的观测来源；特别检查 `cli/src/vendors/grok.js` 到 subprocess 的边界。
- 不要因为模型正文、prompt 回显或泛化的 `auth` 关键词就归类为认证失败；先区分认证、
  endpoint scope、model entitlement、CLI protocol 与 parser failure。
- 保持错误诊断无 token、cookie、OAuth artifact 内容或未脱敏的 remote payload。
- 增加 fixture / tests，至少覆盖：真实 auth code、非 auth remote failure、含 auth 字样的
  模型文本/回显、background 环境差异，以及无 parser-designated sidecar 的结果。

### 验收标准

1. 若上述 direct `grok -p` 成功，Hopper 使用等价 argv 时也应完成；否则必须给出准确的
   **非 auth** 诊断和可验证的分类依据。
2. 若 direct 命令失败，Hopper 必须提供脱敏后的真实远端 code/message，而不是无依据地
   泛称认证失败。
3. 任一路径不得输出 raw secret、OAuth artifact 内容或受保护原始日志内容。
4. 终态、`recovered` 与 requested/effective/observed model metadata 必须与实际运行
   一致；Windows 上 sandbox enforcement 仍须标为 `unknown/unverified`，除非有独立证据。

### 安全边界与非目标

- 不改变 Grok `read-only` 声明，不把其在 Windows 上的请求语义升级为未经验证的强制隔离。
- 不绕过权限，不自动重新登录，不自动 retry，也不改派或换 vendor。
- 本 issue 仅记录和定位诊断问题；不包含 credential、token 或原始日志内容。

### 时间线与未决问题

| 时间 / 顺序 | 事件 | 状态 |
|---|---|---|
| 2026-08-05，派发前 | OAuth 已登录；`grok models` exit 0；`--setup grok --deep` 为 `READY`，catalog 1/1 `grok-4.5` | 已观测 |
| 既有任务 | `T-HAWK-VENDOR-POLICY-GROK-ONLY-REVIEW-20260805` 终态为 `failed` / `adapter-auth-failed` / `recovered=none` | 已观测 |
| 2026-08-05T13:29:52.639Z | 新的、用户显式授权的独立任务启动；PID 51648 | 已观测 |
| progress #1 至 #8 | `starting` → #2–#7 `running/process_alive` → #8 `failed` | 已观测 |
| direct 最小命令 | 用户待执行并补充 exit code、脱敏错误/成功证据 | pending |

未决问题：direct 命令是否成功？若成功，runner 与 direct 的 argv/env/cwd/stdio 哪一项
不同？若失败，远端返回的脱敏 machine-readable code 是否真为 authentication、scope 或
model entitlement？当前 `adapter-auth-failed` 是远端 code 的映射，还是关键词 classifier
的结果？`HOME` / `GROK_HOME` warning 与失败是否存在因果关系？

### 非重复性说明

`docs/archive/ISSUES.md` 已有与 Grok 相邻的历史记录：
`grok-adapter-protocol-invalid-false-fail`、
`grok-claude-buffered-output-idle-falsekill` 与
`grok-model-line-rotation-stale-knownGood`。它们分别涉及结果解析、后台 idle watchdog
或模型 knownGood 轮换，均不是「同一 binary 的 `grok models` 成功而真实 Hopper 派发
被诊断为 `adapter-auth-failed`」这一未定根因；本记录因此不是重复 issue。

---

<a id="codex-bypass-flag-missing-from-argv"></a>

## codex-bypass-flag-missing-from-argv

> Archived from `ISSUE-codex-bypass-flag-missing-from-argv.md`. Body verbatim.

## ISSUE: codex adapter's `danger-full-access` bypass flag never reaches the spawned codex argv → still `workspace-write` → 1326 (extends ISSUE-codex-windows-sandbox-1326)

> Reporter: x-agents CEO orchestration session (Claude Code), dispatching a real code-impl fix to codex
> Date: 2026-06-19
> Severity: high on Windows — codex vendor does ZERO work; every dispatch is a silent no-op
> Env: Windows; codex-cli `0.131.0`; hopper-dispatch `0.13.0`; CLI = `<hopper>/cli/bin/hopper-dispatch` (loads `cli/src/vendors/codex.js`)
> Status: open — extends/sharpens the still-open ISSUE-codex-windows-sandbox-1326.md

### New, sharper evidence (argv inspection)

Dispatched task `S1-AGT-24-FIX-P7` (code-impl, vendor codex) **3 times** with `--sandbox danger-full-access --model gpt-5.5 --reasoning xhigh`:
1. `HOPPER_VENDOR_CWD=F:/workspace/project` (non-git parent) → codex: `Not inside a trusted directory and --skip-git-repo-check was not specified` (704ms fail). [widening CWD to a non-git root breaks codex's git-repo trust check — separate footgun for the `HOPPER_VENDOR_CWD` docs]
2. default CWD (x-agents = git repo) → codex banner `sandbox: workspace-write` → **8× `CreateProcessWithLogonW failed: 1326`**, no work.
3. `HOPPER_CODEX_EXTRA_CONFIG="sandbox_mode=danger-full-access"` (to force a `-c sandbox_mode` override) → **still** `sandbox: workspace-write` → 1326.

**Decisive check — inspected the live codex process command line (`Get-CimInstance Win32_Process`):**

```
bypass (--dangerously-bypass-approvals-and-sandbox) = FALSE
-s flag                                             = FALSE
-c sandbox_mode                                     = FALSE
```

So **none** of the sandbox arguments that `codex.js args()` is supposed to emit (`cli/src/vendors/codex.js:255-259`, `bypassSandbox ? ['--dangerously-bypass-approvals-and-sandbox'] : ['-s', sandbox]`) actually appear in the spawned codex argv. The `HOPPER_CODEX_EXTRA_CONFIG` `-c` override is also absent. codex therefore falls back to its **default** `workspace-write`, whose Windows sandbox harness calls `CreateProcessWithLogonW` (1326) on every child → the dispatched brief is never executed.

### Why this is more than ISSUE-codex-windows-sandbox-1326

The original issue hypothesized the **copied `config.toml` `sandbox_mode`** was overriding a *correctly-passed* `-s`/bypass flag. The argv evidence shows the flag is **not passed at all** — so the problem is in the **adapter→spawn argv path**, not config precedence. Candidate causes to check:
- The CLI bin may load `plugins/hopper/cli/src/vendors/codex.js` (the duplicate copy) rather than the fixed `cli/src/vendors/codex.js`; confirm which module the installed/run bin imports.
- The spawn layer (`cli/src/dispatch.js` / `background.js` / `subprocess.js`) may drop or not forward `adapter.args()`'s `sandboxArgs` for the background path.
- Arg-array composition order / a filter that strips `--dangerously-*`.

Recommended: add a debug line that logs the **final spawned argv** (not just the resolved opts), and a unit test asserting `danger-full-access` → argv contains `--dangerously-bypass-approvals-and-sandbox`, exercised through the **same code path the background runner uses**.

### Secondary: queue/runner status inconsistency

Across all 3 runs, `parseResult` correctly classifies the 1326 pattern as `permission-fail`, but the queue.md row for the task stayed `pending` while `--jobs`/`--watch` reported `status: failed`. A terminal `permission-fail` should also reflect in the queue row (or the row should be set `failed`) so a re-dispatch isn't silently blocked / the operator isn't misled.

### Impact / workaround used

codex vendor remains unusable via hopper on this Windows host (consistent with the 3 prior failed codex rows in x-agents `.hopper/queue.md`: `S1-M3-03-FINAL-P7`, `-P7-v2`, `S1-AGT-18-RVW-HX`). Workaround for the dispatched fix: routed `S1-AGT-24-FIX` to an in-environment Claude (sonnet) subagent instead. The fix handoff is vendor-agnostic; only the codex *execution channel* is blocked.

### Repro

```
## Windows, from a repo with .hopper/
hopper-dispatch <codex-routed-task> --background --sandbox danger-full-access
hopper-dispatch --result <task>     # → sandbox: workspace-write + repeated 1326, status failed
## inspect the live codex argv during the run:
##   Get-CimInstance Win32_Process | ? { $_.Name -like 'codex*' } | select CommandLine
##   → no --dangerously-bypass-approvals-and-sandbox present
```

---

### Resolution (2026-06-20, commit a0c4eff — hopper 0.14.0)

**FIXED.** Root cause confirmed exactly as the argv evidence above suggested: the sandbox
flags were never reaching the spawned codex because the large composed prompt was the
SECOND argv element (before the flags), and on Windows a vendor reached through a cmd.exe
`.cmd` shim has a ~8191-char command line that is silently truncated — so the trailing
`--dangerously-bypass-approvals-and-sandbox` / `-s` / `-c` flags were the truncation
casualty, and codex fell back to its default `workspace-write` → 1326.

Two fixes shipped in a0c4eff:
1. `cli/src/vendors/codex.js` — the PROMPT positional is now the LAST argv element, so any
   truncation eats the prompt tail rather than the safety flags; the bypass flag always
   reaches codex. Also adds `--skip-git-repo-check` on the bypass path (the non-git
   `HOPPER_VENDOR_CWD` footgun from run #1).
2. `cli/src/prompt-delivery.js` (new) — size-gated pointer delivery: when the would-be
   command line exceeds a conservative per-regime UTF-8-byte budget, the composed prompt is
   written to `handoffs/<task>-prompt.md` and the vendor gets a small "read this file" pointer,
   so the command line never approaches the cmd.exe limit. Uniform across all vendors.

Verified live (codex runs a shell command on this Windows host with no 1326 and stays on the
dispatched brief) + unit/integration tests (tests/unit/prompt-delivery.test.js,
tests/unit/codex-isolation.test.js argv-order cases). The secondary queue/runner status
inconsistency noted above is tracked separately (terminal `permission-fail` classification
is correct; surfacing it into the queue row is a runner-status follow-up).

Status: **CLOSED**.

---


<a id="codex-callchain-windows"></a>

## codex-callchain-windows

> Archived from `ISSUE-codex-callchain-windows.md`. Body verbatim.

## ISSUE: codex adapter call-chain fails on Windows — false-success hijack + `CreateProcessWithLogonW 1326`

- **Filed**: 2026-06-18
- **hopper version**: 0.6.1-phase-6c
- **Host**: Windows (PowerShell 7), codex CLI on PATH (`codex.CMD`, `--check codex` → READY, auth OK)
- **Severity**: high — codex dispatches return `status=done exit=0` while producing **off-task output**, i.e. a *false success*. Affects every codex-routed task on this host.
- **Reproduced on task**: `S1-AGT-18-RVW-HX` (spec-blindspot-hunt → codex), x-agents project `.hopper/`.

### Summary

A `spec-blindspot-hunt` task was dispatched to the `codex` adapter with a tightly scope-locked, fully-specified brief (review a design proposal; write findings to a named path). The dispatch **plumbing worked perfectly** — resolved vendor, spawned detached, ran to completion (`done`, exit 0, 277.8s, 124k tokens, clean frontmatter/log/progress). **But the codex run did not perform the dispatched task.** Two compounding failures:

1. **Global-skill hijack (codex ignores the dispatched brief).** Instead of reviewing the proposal named in the brief, codex loaded a global orchestration skill, re-derived an *unrelated* task from the project's `AGENTS.md` "current-next-step" (`S1-M0-01`), ran its own owner/reviewer meta-orchestration for *that*, and wrote 3 spurious files about it. The requested output path was never written. **Brief-level scope-locking does not prevent this** — the brief explicitly said "do NOT trigger gstack-review/whole-repo review," and codex hijacked anyway. This matches two prior failures in the same queue: `S1-M3-03-FINAL-P7` and `-v2`, both `failed` with "codex global gstack-review skill hijacked the task and performed whole-repo diff review instead."

2. **Sub-spawn sandbox failure `CreateProcessWithLogonW failed: 1326`.** Inside its hijacked meta-orchestration, codex spawned its own "owner" and "reviewer" sub-processes; both were blocked by `windows sandbox: CreateProcessWithLogonW failed: 1326` and returned `blocked`. codex then self-adjudicated "not accepted." (`1326` = `ERROR_LOGON_TYPE_NOT_GRANTED` — codex's sandbox cannot create child processes with logon credentials on this Windows host.)

Net: codex exited 0 with confident-looking output that was entirely off-task. hopper reported `done`.

### Contrast — the codex path that DID work (codex-rescue, for reference)

The same review, routed through the **codex plugin's `codex-rescue` subagent** (codex running inside the Claude Code Agent sandbox), showed:

- **1st attempt** (codex asked to read the plan + memo files): blocked by the **same `CreateProcessWithLogonW 1326`** when codex tried to shell out / spawn to read files → returned an inconclusive "NO-GO, restore file access and re-run."
- **2nd attempt** (all file content **fully inlined** in the prompt; codex needed *no* file reads and *no* sub-spawns): **substantive, correct review** — concurring verdict + ranked risks + refinements, 157s, ~17k tokens.

**Conclusion: `1326` is intrinsic to the codex CLI's sandbox on this Windows box, not to any host wrapper — it afflicts both `codex-rescue` and `hopper→codex`.** The only configuration that produced real codex output was **single-shot + fully-inlined content + no file reads + no sub-orchestration**.

### Channel comparison

| | codex-rescue (codex-in-Agent) | hopper→codex (detached `codex.CMD`) |
|---|---|---|
| Dispatch plumbing | ok | **excellent** (queue, frames, background, progress) |
| Honors dispatched brief | yes (when inlined) | **no — global-skill hijack** |
| `1326` on file-read / sub-spawn | yes (1st try) | yes (codex's own sub-spawns) |
| Substantive output | ✅ when content inlined | ❌ off-task; `done`/exit 0 anyway |

### Root-cause hypotheses

- **H1 — codex global skills override the prompt.** codex auto-loads global skills (gstack-review / superpowers-style meta-orchestration). When invoked non-interactively by the adapter, these skills run *their* agenda (whole-repo review, or "current next step" from `AGENTS.md`) instead of the piped/argv brief.
- **H2 — codex sandbox uses `CreateProcessWithLogonW`, which is not granted on this host.** Any codex action that spawns a child (shell, file read via shell, sub-agent) fails `1326`. Only codex's *native* (non-spawning) reasoning works.

### Recommendations for the codex adapter

1. **Invoke codex in a pure single-shot mode with global skills disabled.** Add a codex-adapter flag/env that suppresses skill auto-load and meta-orchestration so the dispatched brief is the only instruction (e.g. whatever codex's equivalent of `--no-skills` / minimal-profile / non-interactive-exec is). This is the single most important fix — it addresses the false-success hijack.
2. **Set / surface codex sandbox + approval mode in the adapter.** On a trusted host, the adapter should be able to request a codex sandbox mode that does not depend on `CreateProcessWithLogonW` (e.g. full-access / no-sandbox), or document that codex sub-spawns are unsupported on this Windows host so tasks are authored single-shot.
3. **Detect off-task false-success.** `executeDispatch` could verify the task's declared output path was actually written (or that the requested artifact exists) before reporting `done`; if not, mark `failed` with a `codex-did-not-honor-brief` diagnostic instead of `done exit=0`. Currently a hijacked run reads as success.
4. **Document the working recipe** in the codex adapter notes / cookbook: *codex on Windows = single-shot, fully-inlined content, no file reads, no sub-orchestration.* Until (1)/(2) land, the codex adapter should compose self-contained prompts (inline the referenced file contents) rather than pointing codex at paths.

### Evidence pointers (x-agents project, may be transient)

- Queue row `S1-AGT-18-RVW-HX` (now `failed`, with inline diagnosis).
- Run artifacts: `.hopper/handoffs/S1-AGT-18-RVW-HX-output.{md,log}` — frontmatter `status: done, exit_code: 0`; log body shows the hijacked `S1-M0-01` work + `CreateProcessWithLogonW failed: 1326` on codex's owner/reviewer sub-spawns.
- Prior occurrences: queue rows `S1-M3-03-FINAL-P7`, `S1-M3-03-FINAL-P7-v2` (both `failed`, gstack-review hijack).

---

### Resolution (2026-06-18, hopper 0.12.0+ — `cli/src/vendors/codex.js`)

1. **Sandbox / 1326 (rec #2):** for `danger-full-access` (the dispatch default) the
   adapter now invokes codex with `--dangerously-bypass-approvals-and-sandbox`
   instead of `-s danger-full-access`. On Windows `-s danger-full-access` still
   runs the sandbox harness (CreateProcessWithLogonW → 1326 on every child); the
   bypass flag runs codex with no sandbox. `read-only` / `workspace-write` keep a
   real `-s` sandbox. Escape hatch: `HOPPER_CODEX_SANDBOX_BYPASS=0`.
2. **Global-skill / plugin hijack (rec #1):** codex 0.131.0 loads global skills as
   marketplace **plugins** (`[plugins."superpowers@openai-curated"]`) + Pre/Post/Stop
   **hooks** + **multi-agent** sub-spawns — none of which the old skills-only config
   strip removed. The adapter now (a) adds `--disable multi_agent --disable hooks
   --disable plugin_hooks` to every dispatch, and (b) extends the isolated-home
   config sanitizer to strip `[plugins.*]` / `[marketplaces.*]` / `[[hooks.*]]` (not
   just `[skills.*]`). Escape hatch: `HOPPER_CODEX_KEEP_ORCHESTRATION=1`.
3. **False-success detection (rec #3):** `parseResult` now classifies a run whose
   output contains `CreateProcessWithLogonW failed: 1326` as `permission-fail`, not
   `success`, so a blocked/hijacked run is no longer reported `done`/exit 0.

Verified live on this Windows host: `codex exec --dangerously-bypass-approvals-and-sandbox
--disable multi_agent --disable hooks --disable plugin_hooks` runs a shell command
(no 1326) and stays on the dispatched brief. Unit tests: tests/unit/codex-isolation.test.js
+ tests/unit/vendors-contract.test.js.

Note (rec #4 / environment): the host's `~/.codex/config.toml` also registers an
`agent-hopper` marketplace + curated plugins; the adapter's isolated CODEX_HOME +
broadened config strip keep those out of dispatched runs, but pruning stale
marketplaces from `~/.codex/config.toml` directly is also advisable.

---


<a id="codex-review-hijack"></a>

## codex-review-hijack

> Archived from `ISSUE-codex-review-hijack.md`. Body verbatim.

## ISSUE: codex adapter — 跨仓 review 任务被 gstack/superpowers skill 劫持 + 锚错 workdir + 写错输出路径

> 报告方: x-agents CEO 编排(S1-AST-01 review + locate-pipeline review)
> 日期: 2026-06-16
> 严重度: 高(codex 经 hopper 做"审查异仓 diff"类任务**可靠失败**,已 3+ 次)
> 状态: 待 hopper 自查

### 现象(可靠复现)

派 codex 审查**另一个仓**的改动(task `S1-AST-01-REVIEW-P1`:审 `uikit_uiautomation_midscene` 的 11 个 .test.ts 的 aiQuery→aiBoolean diff),brief 明确范围锁定 + "禁止全仓 diff / 禁触发 gstack-review"。结果:

- `adapter_status: success` / exit 0 / 5.6min,但**完全没审目标**。
- codex 启动即加载 `using-superpowers`/gstack skill(raw log 行 51:"I'll load the required startup skill first, then I'll ask for the review target because the task type alone doesn't identify a diff…")。
- 之后在 **hopper workdir = x-agents** 里 `git diff`,审了**完全不相关**的 hawk_server/agent auth/exit/pipeline 缺口(G1-G5/A1-A8/7 项改造),**产物写到 `<x-agents>/.triage/codex-final.md`**,而非 brief 要求的 `planning/handoffs/S1-AST-01-review.md`。
- 队列历史同模式失败 ≥2 次:`S1-M3-03-FINAL-P7`、`-P7-v2`("codex global gstack-review skill hijacked the task and performed whole-repo diff review instead")。

### 根因假设

1. **workdir 锚错**:codex 子进程 cwd = hopper 项目根(x-agents),`git diff` 默认审 x-agents,而非 brief 指定的目标仓 `uikit_uiautomation_midscene`。`--sandbox` 我传 `read-only` 但实际 banner 显示 `workspace-write [workdir,…]`(映射不一致,另见下)。
2. **全局 skill 自动加载劫持**:codex 启动强制 `using-superpowers`,继而 gstack-review/cli-audit 等全局 skill 抢占任务语义,无视 brief 的"禁 gstack-review"。raw log 旁证:`.triage/cli-audit-codex.jsonl`(1MB)——它跑去做了 cli-audit。
3. **输出路径被 skill 约定覆盖**:产物落 `.triage/codex-final.md`(gstack 约定),而非 brief 的 `--write`/指定路径。

### 建议 hopper 自查方向

1. **codex 适配器显式设 cwd = 审查目标仓**:支持 brief/dispatch 传 `--repo <path>` 或从 task 解析目标仓,作为 codex 子进程 cwd;不要默认 hopper workdir。
2. **抑制全局 skill 自动加载**:dispatch codex 时传环境/flag 关闭 superpowers/gstack 自动注入(或 `CODEX_DISABLE_GLOBAL_SKILLS`),让 brief 成为唯一任务来源。
3. **输出路径以 brief 为准**:`.triage/codex-final.md` 约定不得覆盖 dispatch 指定的输出文件;`--write` 应落到 `.hopper/handoffs/<task>-output.md` 或 brief 指定路径。
4. **`--sandbox` 映射核对**:dispatch 传 `read-only`,codex banner 却 `workspace-write`——确认 codex 适配器对 `--sandbox` 的映射(`-s <mode>`)是否生效。
5. **(相关,非 hopper 本体)`codex:rescue` 通道**:经 Claude Code `codex:codex-rescue` 派的 locate-pipeline review(Codex 后台任务 `bcrdegm1j`)**数小时未落盘、无完成通知**;产物 `locate-pipeline-stats-and-risks-codex-review.md` 始终不存在。Codex 后台队列的完成/失败需可见。

### 备注

两次受影响任务均已 workaround:S1-AST-01 review 由 CEO 代行(对抗性 + ground-truth,已写 `planning/handoffs/S1-AST-01-review.md`);locate-pipeline doc 本身源码级自洽(file:line + 生产数据),codex 交叉审查放弃。此 issue 供 hopper 修复 codex 适配器的跨仓审查可用性。

---


<a id="codex-vendor-model-effort"></a>

## codex-vendor-model-effort

> Archived from `ISSUE-codex-vendor-model-effort.md`. Body verbatim.

## ISSUE: codex adapter ignores `--model`; cross-vendor model/effort forwarding audit

**Reported:** 2026-06 (user dogfood). **Area:** `cli/src/vendors/*.js`. **Severity:** medium (capability gap, not a crash).

### Symptom (user report)

Dispatching codex with a model/effort hint failed at the environment edge:

1. `-m gpt-5.5-xhigh` → `The 'gpt-5.5-xhigh' model is not supported when using Codex
   with a ChatGPT account`. Dropping `-m` silently used the codex account default.
2. Separately: `-s read-only` → `CreateProcessWithLogonW failed: 1326` (the Windows
   sandbox issue tracked in ISSUE-codex-callchain-windows, already fixed for the
   `danger-full-access` dispatch path).

Root cause of (1) is twofold: `gpt-5.5-xhigh` conflates a **model** (`gpt-5.5`) with a
**reasoning effort** (`xhigh`) — they are separate knobs — AND the hopper codex
adapter did **not forward `--model` at all** (it was declared `modelArg.accepted:
'ignored'`), so model selection through hopper was impossible.

### Web-validated facts (2026-06)

- **codex** `exec -m <MODEL>` works. ChatGPT-account auth accepts **bare** names only
  (`gpt-5.5`, `gpt-5.4-mini`, `gpt-5.3-codex-spark`); provider-prefixed ids like
  `openai-codex/gpt-5.1-codex` are rejected (openai/codex#12295). Effort is a separate
  `-c model_reasoning_effort` config, not part of the model name. Catalog:
  `codex debug models --bundled`.
- **copilot** has `--effort` (alias `--reasoning-effort`). Enum is **model-dependent**
  (GPT models: low|medium|high; some models add none/max) and has grown across releases.
- **opencode** has `opencode run --variant <name>` ("provider-specific reasoning
  effort") — the adapter's old note ("no reasoning knob via CLI flags") was **stale**.
  Variant values are per-model/provider and validated server-side.

### Horizontal audit — model & effort forwarding across all 8 vendors (before → after)

| vendor   | model (before) | model (after) | effort (before) | effort (after) |
|----------|----------------|---------------|-----------------|----------------|
| codex    | **ignored** (gap) | `-m` forwarded | `-c model_reasoning_effort` | unchanged |
| copilot  | `--model` ✓ | unchanged | **ignored** (gap) | `--effort` (clamped) |
| opencode | `--model` ✓ | unchanged | **ignored** (stale note) | opt-in `--variant` (env) |
| grok     | `-m` ✓ | unchanged | `--effort` (clamped) ✓ | unchanged |
| mimo     | `--model` ✓ | unchanged | `--variant` (xhigh→max) ✓ | unchanged |
| kimi     | `-m` ✓ | unchanged | none (genuine: no per-call argv) | unchanged |
| claude   | `--model` ✓ | unchanged | none (genuine: `claude -p` has no effort flag) | unchanged |
| agy      | none (genuine: `agy -p` has no --model) | unchanged | none (internal subagents) | unchanged |

Genuine CLI limitations (correctly left as-is): kimi/claude/agy effort, agy model.

### Resolution

**codex** (`cli/src/vendors/codex.js`): forward `opts.model` as `-m <MODEL>` (opt-in,
verbatim; omitted → account default). `modelArg.accepted` `ignored` → `freeform`,
`knownGood` set to the ChatGPT-account bare names. Reasoning effort stays the separate
`--reasoning` → `model_reasoning_effort` path.

**copilot** (`cli/src/vendors/copilot.js`): forward `opts.reasoning` as `--effort`,
**clamped** to copilot's universal `{low,medium,high}` (minimal→low, xhigh→high) so the
canonical `xhigh` dispatch default never trips a server-side enum rejection. Escape
hatch: `HOPPER_COPILOT_EFFORT=<raw>` passes a value verbatim (e.g. `max`/`none`), `=''`
omits `--effort`. `reasoningArg.accepted` `ignored` → `enumerated`.

**opencode** (`cli/src/vendors/opencode.js`): correct the stale note; `--variant` is
**opt-in** via `HOPPER_OPENCODE_VARIANT=<variant>` (NOT auto-forwarded — opencode runs
arbitrary provider models whose variant set is unknown, so auto-forwarding the `xhigh`
default could break non-reasoning models). Default path stays `ignored`.

#### How to use

- codex model: `/hopper:dispatch ... --model gpt-5.4-mini` (bare name; no provider prefix).
- codex effort: `--reasoning <minimal|low|medium|high|xhigh>` (default `xhigh`).
- copilot effort: `--reasoning <level>` (auto-clamped); raw override `HOPPER_COPILOT_EFFORT`.
- opencode variant: `HOPPER_OPENCODE_VARIANT=<variant>` then dispatch as usual.

Tests: `tests/unit/vendor-preset-fixes.test.js` (args), `tests/unit/discovery.test.js`
(capabilities), `tests/unit/rules.test.js` (generated matrix).

---


<a id="codex-windows-sandbox-1326"></a>

## codex-windows-sandbox-1326

> Archived from `ISSUE-codex-windows-sandbox-1326.md`. Body verbatim.

## ISSUE: codex adapter is unusable on Windows — runs codex under `workspace-write` sandbox → `CreateProcessWithLogonW failed: 1326` on every exec

> Reporter: governance-fusion migration (Claude Code session, dogfooding hopper-dispatch)
> Date: 2026-06-17
> Severity: high on Windows (the codex vendor cannot execute ANY command; every codex-routed dispatch silently does nothing)
> Status: open
> Env: Windows; codex-cli `0.131.0`; hopper-plugin `0.11.1`

### Symptoms (confirmed)

Dispatched a real task to the codex vendor via `hopper-dispatch T-FIX-PWHANG --background`. The dispatcher reported `Sandbox: danger-full-access`, but codex's own startup banner shows it actually running under `sandbox: workspace-write`:

```
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR]
reasoning effort: xhigh
```

Every shell command codex then issued failed instantly:

```
exec "...pwsh.exe" -Command "Get-Content -Raw .hopper\PING.md" in F:\workspace\ai\_x_harness\hopper-plugin
ERROR codex_core::exec: exec error: windows sandbox: CreateProcessWithLogonW failed: 1326
 exited -1 in 0ms:
execution error: Io(Custom { kind: Other, error: "windows sandbox: CreateProcessWithLogonW failed: 1326" })
```

- **17** `CreateProcessWithLogonW failed: 1326` errors in the run log; codex executed **zero** commands successfully and made **zero** file changes, then exited.
- `1326` = Windows `ERROR_LOGON_FAILURE`: codex's Windows sandbox launches each child via `CreateProcessWithLogonW` (a separate restricted logon), which fails on this host.

### Secondary bug (result misclassification)

Despite 17 sandbox-launch failures and no work done, the runner wrote `status: done` and `adapter_status: success` to `.hopper/handoffs/T-FIX-PWHANG-output.md`. A run where every `exec` failed with a sandbox-launch error should be classified as a **failure** (permission-fail / unknown-fail), not success — otherwise a doomed dispatch is reported as completed.

### Root cause / localization

- `cli/src/vendors/codex.js:224,235` sets `const sandbox = opts.sandbox ?? 'danger-full-access'` and passes `'-s', sandbox`. So hopper passes `-s danger-full-access`.
- But codex runs under `workspace-write` anyway. Likely cause: the auto-isolated `CODEX_HOME` (HOPPER-3, `resolveIsolatedCodexHome`) copies the host `~/.codex/config.toml` (sanitized), and if that config sets `sandbox_mode = "workspace-write"` it is taking precedence over (or interacting with) the `-s` flag in `codex exec`. Either way, the adapter is **not** producing a no-sandbox codex invocation for `danger-full-access` on Windows.
- On Windows, codex's `workspace-write` sandbox uses `CreateProcessWithLogonW`, which fails here (1326). The **only** invocation that works on this host is `codex exec --dangerously-bypass-approvals-and-sandbox` (verified: it runs commands fine, because it fully disables the sandbox and never calls `CreateProcessWithLogonW`).

### Impact

- The codex vendor is effectively unusable via hopper on this Windows host. This affects every codex-routed task-type (`spec-write`, `code-review-acceptance`, `spec-blindspot-hunt`) plus any row that overrides `Vendor: codex`.
- The other 7 vendors (`kimi`, `opencode`, `copilot`, `agy`, `grok`, `mimo`, `claude`) all show `READY` via `hopper-dispatch --check` and do not use codex's logon-sandbox, so they are presumably unaffected.

### Reproduction

```bash
## from a repo with .hopper/ on Windows
hopper-dispatch <any-task-routed-to-codex> --background
hopper-dispatch --result <task>   # → 1326 errors, no work, but status=done
## contrast (works):
codex exec --dangerously-bypass-approvals-and-sandbox -C <repo> "run: node --version"
```

### Suggested fix direction

1. For `danger-full-access` on Windows, invoke codex with `--dangerously-bypass-approvals-and-sandbox` (proven working) instead of (or in addition to) `-s danger-full-access`; or force `-c sandbox_mode=danger-full-access` so a copied/isolated `config.toml` cannot pin `workspace-write`.
2. In `codex.js` `parseResult`, detect the `windows sandbox: CreateProcessWithLogonW failed` / repeated `exited -1 in 0ms` pattern and classify the run as a failure (`permission-fail`), so the dispatcher does not report a no-op codex run as `success`/`done`.

---


<a id="grok-adapter-protocol-invalid-false-fail"></a>

## grok-adapter-protocol-invalid-false-fail

> Archived from `ISSUE-grok-adapter-protocol-invalid-false-fail.md`. Body verbatim.

## ISSUE: grok adapter false-fails successful runs — pretty-printed multi-line JSON envelope behind runner log lines defeats extractGrokText (adapter-protocol-invalid)

> Reporter: Kimi Work orchestration session (hawk-clawhive project), dispatching adversarial review tasks to opencode/grok
> Date: 2026-07-24
> Severity: medium-high — the vendor actually COMPLETES the task (deliverable written), but hopper records `failed` / `adapter-protocol-invalid`, blocking downstream orchestration that gates on task status
> Env: Windows; grok CLI (`grok-4.5`); hopper-dispatch `0.35.1`; CLI = `<hopper>/cli/bin/hopper-dispatch` (loads `cli/src/vendors/grok.js`)
> Status: **CLOSED** — root cause confirmed as a line-level parse gap; fixed in this commit (see Resolution)

### Evidence (task REV-GRK-001, hawk-clawhive `.hopper/handoffs/`)

The vendor run was a real success:

- `REV-GRK-001-output.log` — stdout begins with hopper's own runner notice
  line (`hopper-runner: idle watchdog disabled (bufferedOutput vendor) …`),
  followed by a **pretty-printed, multi-line** JSON envelope containing a full
  `"text"` field (the complete final response), `"stopReason": "EndTurn"`,
  `sessionId`, `usage` (input/output/cache/reasoning tokens), `num_turns: 13`,
  `total_cost_usd`, and `modelUsage`.
- `REV-GRK-001-output.md` — frontmatter records `exit_code: 0`, yet
  `adapter_diagnostic_code: adapter-protocol-invalid`,
  `adapter_status: unknown-fail`, `status: failed`, and
  `recovered_output_state: no-text`. The deliverable body itself was written
  correctly by the vendor.

### Root cause analysis

`cli/src/vendors/grok.js` `extractGrokText()` tried exactly two candidates:

1. **whole-stdout parse** — fails because the captured stdout starts with the
   hopper-runner log line (not JSON), so `JSON.parse` of the whole trimmed
   stream throws;
2. **single trailing line parse** — fails because grok `--output-format json`
   **pretty-prints** the result envelope across many lines, so the last line
   is a bare `}`.

With both candidates missing, `parsedJson: false`, and the `exitCode === 0 &&
parsedJson …` success branch in `parseResult` can never fire → the run falls
through to `unknown-fail` / `adapter-protocol-invalid` despite a complete,
successful, EndTurn-terminated answer sitting in the log.

So the classification logic was fine; the *envelope extraction* had a
line-level blind spot for the combination
`runner-preamble-lines + pretty-printed multi-line envelope`.

### Resolution (2026-07-24 — hopper 0.35.1+)

**FIXED** in `cli/src/vendors/grok.js` (synced to
`plugins/hopper/cli/src/vendors/grok.js`): `extractGrokText()` gains a third
candidate — the **framed object** spanning the FIRST `{` to the LAST `}` of
the trimmed stdout, tried only when both existing candidates miss. The
existing recognized-envelope-keys gate (`text`/`stopReason`/`usage`/…) still
rejects a mismatched slice, and the existing negative guards (error field,
cancel/abort/refus/error stop reasons, non-JSON stdout →
`adapter-protocol-invalid`) are unchanged.

Verified against the REAL `REV-GRK-001-output.log`: `parseResult` now returns
`status: success`, `diagnosticCode: none`, full 1513-char text, usage stats,
and `outputEvidence.terminalMarker: grok-end-turn`.

Tests added in `tests/unit/grok-adapter.test.js` (6 cases): framed multi-line
envelope after runner log lines → success; single-line trailing and
whole-stdout JSON (existing behavior) still succeed; non-JSON stdout on exit 0
still `adapter-protocol-invalid`; framed envelope with `Cancelled` stopReason
or an `error` field still fails. All pass.

### Impact / workaround (pre-fix)

Any orchestration that gates on hopper task status saw grok dispatches as
failed and could not chain on their results, even though the deliverable file
was correctly produced. Workaround: treat `exit_code: 0` + a parseable
envelope in `*-output.log` as success manually, or recover text from the log.

---


<a id="grok-claude-buffered-output-idle-falsekill"></a>

## grok-claude-buffered-output-idle-falsekill

> Archived from `ISSUE-grok-claude-buffered-output-idle-falsekill.md`. Body verbatim.

## ISSUE: grok/claude background dispatches are unconditionally killed by the idle watchdog ~idleMs after spawn — `--output-format json` is end-buffered, so the runner's log-growth idle detector never sees growth until the vendor is already done

> Reporter: hopper self-audit (dogfood investigation, corroborated by real dispatch timing logs)
> Date: 2026-07-08
> Severity: high — every grok/claude BACKGROUND dispatch that legitimately runs longer than the idle timeout (default 180s; env-tunable via `HOPPER_IDLE_TIMEOUT_MS`) is killed and reported as `adapter_status: timeout`, regardless of whether the vendor was actually stuck or just still working
> Env: hopper-plugin 0.29.0; affects the BACKGROUND dispatch path only (`cli/bin/hopper-runner`); the SYNC dispatch path (`cli/src/subprocess.js runSubprocessOnce`) uses a different idle mechanism (resets on stdout/stderr `data` events) and was not in scope for this fix
> Status: **FIXED** (mitigation applied below); a proper streaming-based fix is DEFERRED (see below)

### Root cause (confirmed)

1. `cli/src/vendors/grok.js` spawns grok with `-p <prompt> --output-format json` (the
   `--output-format json` flag; args() build, now at line 98 post-fix — originally
   line 87 before this fix's own comment block shifted it). Per the adapter's own
   comments (the `streaming` capability note: *"Adapter uses `json` for a single
   trailing object suited to background capture"*, and `parseResult`'s note:
   *"`--output-format json` yields a single trailing JSON object"*), grok **buffers
   all output and writes stdout exactly ONCE, at process exit**. Nothing is written
   incrementally.
2. `cli/src/vendors/claude.js` has the **identical** pattern: `-p --output-format
   json` (args() build, now at line 119 post-fix — originally line 108), with the
   same "single trailing result object" behavior documented in its own `streaming`
   capability note and `parseResult` comment.
3. The BACKGROUND idle watchdog in `cli/bin/hopper-runner` (the `idlePoll`
   `setInterval`, originally spanning ~:358-391, now ~:371-403 after this fix's
   insertion above it) resets its silence clock **only on log-FILE-size growth**
   (`statSync(logPath).size` polling — see the `sz !== lastSize` check and
   `lastGrowAt = Date.now()` reset). The runner pipes vendor stdio straight to a
   shared log file with no in-process `'data'` events (see the idle-vs-ceiling
   design comment a few lines above the poll), so "idle" is entirely a function of
   when that file's byte count changes.
4. For an end-buffered vendor, the log file does not grow **at all** until the
   process is about to exit — so the idle poll's "no growth for `idleMs`" condition
   is satisfied almost immediately after spawn and stays satisfied for the vendor's
   entire runtime. The idle timeout therefore degenerates into an **unconditional
   kill ~idleMs after spawn**, with no relationship to whether the vendor is
   actually stuck. This is architecturally the same class of bug as the mimo
   background-exit hang (see `ISSUE-mimo-codeimpl-timeout.md` and the
   `idleHeartbeatRe` mechanism it motivated) — except inverted: mimo's log grows
   *too often* (a heartbeat) and defeats the detector one way; grok/claude's log
   grows *too rarely* (never, until exit) and defeats it the other way.

### Timing forensics

Real background dispatches were killed at:

| idleMs configured | actual kill time | delta over idleMs |
|---|---|---|
| 180000ms (3 min default) | 185053ms | +5053ms |
| 600000ms (10 min, `HOPPER_IDLE_TIMEOUT_MS` override) | 605213ms | +5213ms |

Both deltas are ≈ one poll tick. The runner's poll cadence is
`pollMs = Math.max(1000, Math.min(idleMs, 5000))` — for both idleMs values above
this clamps to `pollMs = 5000`. A vendor that never grows its log will be killed
on the very next tick after `idleMs` elapses, i.e. at `idleMs + (0..pollMs)`,
matching both observations exactly (Δ≈5s, one poll tick, every single time — not
occasional flakiness, a deterministic unconditional kill).

### Applied mitigation (ceiling-only for buffered-output adapters)

Rather than teach the runner to parse partial/incremental vendor output (grok and
claude are not currently invoked with a streaming output format — see Deferred
below), the fix follows the **existing adapter-declared-hook precedent**: mimo
already declares `idleHeartbeatRe` (`cli/src/vendors/mimo.js:38`) and the runner
already special-cases it (`cli/bin/hopper-runner`, `heartbeatRe` variable). This
fix adds a second, simpler hook:

1. **`cli/src/vendors/grok.js`** (line 53) and **`cli/src/vendors/claude.js`**
   (line 56) each now declare:
   ```js
   bufferedOutput: true,
   ```
   with a comment explaining why (end-buffered `--output-format json`), placed at
   the same top-level position other adapter-declared hooks live (mirrors
   `idleHeartbeatRe`'s placement in mimo.js).
2. **`cli/bin/hopper-runner`** (~:353-355, ~:371) computes
   `bufferedOutput = Boolean(adapter && adapter.bufferedOutput === true)` right
   after the ceiling `killTimer` is armed, and changes the idle-poll arming
   condition from `idleMs > 0` to `idleMs > 0 && !bufferedOutput`. When
   `bufferedOutput` is true, the idle `setInterval` is **never created** — the
   idle mechanism is fully disabled for that dispatch. The **absolute ceiling
   timeout is untouched and stays fully in force** (`killTimer` is set up
   unconditionally, before this check, so a genuinely hung buffered-output vendor
   is still killed — just by the ceiling, not a false-positive idle read).
3. A diagnosability line is emitted unconditionally (not gated behind
   `HOPPER_DEBUG`, since it is a rare, structural fact about the dispatch, not
   per-invocation noise) whenever `bufferedOutput` is true:
   ```
   hopper-runner: idle watchdog disabled (bufferedOutput vendor) — ceiling-only timeout applies (<ceilingMs>ms)
   ```

#### Tests

- `tests/unit/vendors-contract.test.js` — two new tests mirroring the existing
  `idleHeartbeatRe` contract test: grok/claude declare `bufferedOutput: true`; the
  other six adapters do not.
- `tests/integration/runner-single-spawn.test.js` — two new integration tests,
  placed directly beside the file's existing (and only other) timeout test
  (`hopper-runner appends exactly one timeout terminal progress event`), reusing
  its PATH-shim helper pattern:
  - **Test A (repro)**: a PATH-shimmed stub vendor that stays silent, then writes
    one trailing blob and exits 0 (the grok/claude shape), dispatched through the
    `opencode` adapter (no `bufferedOutput`) with `idleMs=500`. Asserts the run is
    killed (`status: failed`, `phase: timeout`, `timed_out: true`) well before its
    scheduled write, and that the raw log is **0 bytes** at completion — the
    decisive proof that the vendor never got a chance to produce output before
    being killed.
  - **Test B (fix)**: the identical stub shape, dispatched through the **real
    grok adapter** (now `bufferedOutput: true`) with the same `idleMs=500`, but a
    silence duration (2500ms) deliberately longer than idleMs — so under the
    pre-fix runner this case would ALSO have been falsely killed. Asserts a
    natural `status: done` / `adapter_status: success`, and that the parsed
    answer text is embedded in `output.md`'s "Vendor output (parsed)" section.
  - Both verified independently: temporarily reverting only the runner's arming
    condition (back to `idleMs > 0`, ignoring `bufferedOutput`) makes Test B fail
    while Test A still passes — confirming Test B actually exercises the fix
    rather than being tautological.
  - Both run in well under 5s (Test A ~2.0-2.1s, Test B ~2.9-3.0s).

### DEFERRED: proper streaming-based fix

Ceiling-only is a **mitigation**, not a resolution: a genuinely hung grok/claude
background dispatch will now run the *full* ceiling (≥30 min floor) before being
reaped, instead of being caught early by idle detection. The proper fix is to
make these adapters stream incrementally so the EXISTING idle-on-log-growth
detector works as designed, with no special-casing needed:

- **grok**: switch the background/headless invocation from `--output-format
  json` to `--output-format streaming-json`, which the adapter's own capability
  note already documents as emitting NDJSON events (`cli/src/vendors/grok.js`,
  `features.streaming.mechanism`). Requires: (a) an incremental NDJSON parser in
  `parseResult`/a new streaming accumulator (today's `extractGrokText` assumes a
  single JSON object or the last JSON line of a *complete* stream, not a live
  growing one), and (b) live verification of the streaming event schema — the
  adapter's own header comment flags the `--output-format json` object field
  names as UNCONFIRMED/undocumented; the streaming event shape is equally
  unconfirmed and was NOT verified as part of this fix.
- **claude**: switch to `--output-format stream-json` with `--include-partial-
  messages` / `--verbose` (per the adapter's `features.streaming.mechanism`
  note), which emits newline-delimited event JSON incrementally. Same caveat:
  requires an incremental parser and live schema verification (the "single
  trailing result object" shape is CONFIRMED via code.claude.com docs; the
  partial-message event shape was not independently verified here).
- Once both are live-verified and incrementally parsed, `bufferedOutput` can be
  removed from both adapters (or kept as a defensive fallback flag) and the idle
  detector will resume working natively for these vendors, restoring early
  detection of genuinely hung runs instead of waiting out the full ceiling.

This was intentionally NOT attempted in this pass: the task scope was the
false-kill mitigation, and streaming-format event schemas need live vendor
verification (not available in this environment) before an incremental parser
can be trusted not to silently mis-parse.

### Two adjacent findings (noted, not fixed — separate from this issue)

**(a) `prd-research` (and other ad-hoc task-types) lack a pinned output path.**
A kimi ad-hoc run (`hopper-dispatch --adhoc --task-type prd-research --brief
"..."`) was observed to write a stray `output.md` at the **host project root**
instead of anywhere under `.hopper/`. Root cause: `cli/src/scaffold.js`
`taskFrame()` — the generic frame template used for ad-hoc dispatches (no
`.hopper/tasks/prd-research.md` file exists in this repo; `prd-research` only has
a one-line purpose string at `cli/src/scaffold.js:278` and falls through to the
generic `taskFrame()` body) — has an `## Output shape (output.md)` section
(`cli/src/scaffold.js:301-311`) that names the deliverable "output.md" and
describes its expected CONTENT, but never states that hopper itself
automatically persists the parsed answer to `.hopper/handoffs/<task-id>-output.md`
(via the runner, for background dispatches), nor instructs the vendor not to
create its own file. An agentic vendor with file-write tools (kimi) can read this
literally and write a real file literally named `output.md` via its own tools,
landing at its cwd — the host project root by default (`opts.cwd`, per the
grok/claude adapters' own comments on `HOPPER_VENDOR_CWD` defaulting to the repo
root). Suggested fix direction: either have the generic frame explicitly say
hopper persists the answer automatically and the vendor must NOT write its own
output.md, or give ad-hoc dispatches (and task-types like `prd-research`/
`market-research` in general) an explicit pinned output path reminder in the
composed prompt.

**(b) The dispatch header's `Sandbox:` line overstates enforcement for
native-sandbox vendors.** `cli/bin/hopper-dispatch:952` prints
`` console.log(`Sandbox:     ${effectiveOpts.sandbox}`) `` — the REQUESTED
sandbox mode, verbatim, regardless of whether the resolved vendor can actually
enforce it. hopper already has the classification needed to know better:
`cli/src/setup.js:31-43` (`sandboxControl(adapter)`) diffs the adapter's argv for
`danger-full-access` vs `read-only` and returns `'argv'` (downgradable),
`'full'` (always full-access, e.g. codex — not downgradable), or `'native'`
(no sandbox flag at all — the vendor honors only its own policy, e.g. kimi; also
not downgradable; confirmed via `hopper-dispatch --setup`'s own vendor table,
which correctly shows kimi as `Sandbox: native`). That classification is only
surfaced in `--setup`/`--doctor`, not consulted at the per-dispatch header print
site. So `hopper-dispatch <task> --sandbox read-only --vendor kimi` prints
`Sandbox:     read-only` even though kimi's `-p` mode has no argv-level
permission mode at all (confirmed by `tests/unit/vendors-contract.test.js`'s own
kimi test: *"sandbox opts are not argv-enforceable for kimi -p"*) — a read-only
intent that is silently not enforced, with a header that reads as if it were.
Suggested fix: at the line-952 print site, call `sandboxControl(resolvedAdapter)`
and when it returns `'native'`, print something like
`` Sandbox:     read-only (requested; vendor-native policy applies) `` instead of
the bare value.

### Files changed (this fix)

- `cli/src/vendors/grok.js` — `bufferedOutput: true` capability flag + comment
- `cli/src/vendors/claude.js` — `bufferedOutput: true` capability flag + comment
- `cli/bin/hopper-runner` — skip arming the idle poll when
  `adapter.bufferedOutput === true`; emit a diagnosable status line
- `plugins/hopper/cli/...` (vendored copy) — synced via
  `node scripts/sync-vendored-plugin.mjs` (codex-marketplace plugin packaging
  requires a subset copy under `plugins/hopper/`; drift is guarded by
  `tests/unit/vendored-plugin-sync.test.js`)
- `tests/unit/vendors-contract.test.js` — 2 new contract tests
- `tests/integration/runner-single-spawn.test.js` — 2 new tests (Test A repro,
  Test B fix) + shared helper, placed beside the file's existing timeout test
- This file

### Verification

- Baseline (before this fix, on this machine): `npm test` → 804/804 unit tests
  passing; `node --test tests/integration/*.test.js` → 31/31 passing.
- After this fix: `npm test` → 806/806 unit tests passing (2 new contract
  tests); `node --test tests/integration/*.test.js` → 33/33 passing (2 new
  Test A/B); both new integration tests also verified in isolation via
  `--test-name-pattern`.
- `node cli/bin/hopper-dispatch --setup` — exit 0, full 8-vendor table printed
  with no errors (the adapter field addition does not break discovery/setup).
- Note: on this (busy, shared, 10-core dev) machine, running the full
  `tests/integration/*.test.js` glob concurrently occasionally (~1 in 7 runs
  observed) trips a **pre-existing, unrelated** test's hardcoded 500ms
  full-subprocess-spawn budget (`runner-single-spawn.test.js`, "appends exactly
  one timeout terminal progress event", `HOPPER_TEST_ONLY_TIMEOUT_MS=500`) under
  ambient system load — confirmed via ~13 repeated pure-baseline runs (0
  failures) vs repeated after-fix runs, and confirmed the two new Test A/B never
  fail themselves. This is pre-existing fragility in a hardcoded test timeout,
  not a logic regression (the `opencode`-adapter idle-poll code path executed by
  that test is byte-for-byte unchanged by this fix); left as-is (out of scope
  for this fix) but noted here for the owner.

Status: **FIXED** (mitigation). Streaming-based proper fix tracked as DEFERRED
above.

---


<a id="grok-model-line-rotation-stale-knownGood"></a>

## grok-model-line-rotation-stale-knownGood

> Archived from `ISSUE-grok-model-line-rotation-stale-knownGood.md`. Body verbatim.

## ISSUE: grok 模型线换代 — knownGood 过期 + probe 不自愈，`verified-latest` 派发全失败

> 报告方: 真实研究派发（dispatch 到 grok 时触发）
> 日期: 2026-07-16 发现，2026-07-18 修复
> 严重度: 高（`Model rule: verified-latest` 是 grok 派发的默认约定，过期即整条路径全失败，且无自愈手段）
> 状态: 已修复（本 issue 记录根因 + 修复 + 一个更深的待办）
> 关联: `cli/src/vendors/grok.js`, `cli/src/vendor-probe/grok.js`, `cli/src/policy.js`, `cli/src/model-check.js`, `cli/src/dispatch.js`, `cli/src/setup.js`

### 现象

grok 的模型线整体换代：`grok models` 现在只列 `grok-4.5`（CLI 自己的 default），而 hopper 的 grok adapter 一直硬编码的 `grok-build` / `grok-composer-2.5-fast` 已双双变成 `unknown model id`：

```
$ grok -p "..." -m grok-build --output-format json --no-auto-update
{"type":"error","message":"Couldn't set model 'grok-build': Invalid params: \"unknown model id\". Run 'grok models' to see available models."}
```

因为 `.hopper/AGENTS.md` 里 grok 任务行普遍写的是 `Model rule: verified-latest`（sentinel，解析约定见 `cli/src/policy.js` — 取 adapter `capabilities.modelArg.knownGood[0]`），knownGood 一旦过期，**所有走 verified-latest 的 grok 派发全部失败**，且没有任何机制会自动发现或修复它。

### 根因（两点，缺一不可）

**1. `cli/src/vendors/grok.js` 的 `knownGood` 是手工维护、会过期的静态列表。**
`knownGood: ['grok-build', 'grok-composer-2.5-fast']`（2026-06-02 dogfood 时 live-verified）在 2026-06-02 到 2026-07-16 之间被 xAI 静默下线。`verified-latest` sentinel 解析（`cli/src/dispatch.js::resolveAdapterOptsForTask` + `cli/src/policy.js::resolveVerifiedLatest`）纯读 `knownGood[0]`，从不校验这个名字现在是否还活着——静态列表腐烂，派发跟着腐烂。vendored 副本 `plugins/hopper/cli/src/vendors/grok.js` 是逐字节镜像（`scripts/sync-vendored-plugin.mjs` 保证同步），同样过期。

**2. `cli/src/vendor-probe/grok.js` 的 `--probe grok` 是"假探针"——从不读 `grok models`，只会把同一份硬编码列表原样刷回缓存。**
修复前的 probe 文件自己在注释里承认了这一点：
> "NOTE: `grok models` DOES exist in v0.2.51 — a live-introspection upgrade is a follow-up (V3)."

也就是说，即使运维发现派发失败、跑了 `hopper-dispatch --probe grok` 想"刷新一下"，缓存里写回去的仍然是同一份写死在源码里的 `['grok-build', 'grok-composer-2.5-fast']`——**探针不会让系统自愈，只会让人误以为自己已经修复了**。这是根因 1（静态数据会过期）之上更深一层的根因：**修复静态数据的唯一机制本身也是静态的**。

两点合起来就是审查报告曾经预测的"硬编码模型名单会随 vendor 换代而腐烂（names rot）"——这是该预测第一次在真实生产派发中应验：不是"理论上可能过期"，而是两个月内、无任何 vendor 侧公告的情况下真的过期了，且过期后系统没有任何自我修正路径。

### 修复

**A. `knownGood` 更新为 `['grok-4.5']`**（`cli/src/vendors/grok.js` + 同步 `plugins/hopper/cli/src/vendors/grok.js`）。
`DEFAULT_MODEL` 同步改为 `grok-4.5`。live micro-test（grok CLI v0.2.101, 2026-07-18）：
```
$ grok -p "reply with the single word OK and nothing else" -m grok-4.5 \
    --output-format json --no-auto-update --permission-mode bypassPermissions --always-approve
{"text":"OK","stopReason":"EndTurn", ...}
```
`reasoningArg`（`--effort`/`--reasoning-effort`，`low|medium|high`）重新核对未变，注释补了 2026-07-18 复核日期；grok 仍无 xhigh 上限。

**B（核心修复）. `--probe grok` 改为真正解析 `grok models` 输出**（`cli/src/vendor-probe/grok.js`，新增导出 `parseGrokModelsList`）。
`grok models` 的真实输出（v0.2.101）：
```
You are logged in with grok.com.

Default model: grok-4.5

Available models:
  * grok-4.5 (default)
```
probe 现在 spawn 一次 `grok models`（30s 超时，无重试，模式与 codex/opencode/kimi 的 probe 一致），解析 "Available models:" 下的 `* <id>` / `- <id>` 列表项。成功时返回 `introspection_supported: 'full'`，`models` 是活体列表，`models_source` 标注来自实时命令——这样下次 xAI 再换代模型名，只要跑一次 `--probe grok`，缓存就会自动刷新为正确的新名字，不再需要人工改源码。

解析失败时（spawn 失败 / 超时 / 输出不匹配预期形状）**诚实降级**：不伪造/不留空，退回到 adapter 的静态 `knownGood` 作为兜底，标记 `introspection_supported: 'partial'`（与 `claude.js` 探针"版本活体、模型列表静态"的既有语义一致），并在 `notes` 里明确写清楚降级原因。绑定二进制查找不到时仍是 `introspection_supported: 'none'`（未变）。

`estimateSpawns()`（`cli/bin/hopper-dispatch`）同步更新：grok 从"static = 0"改为"`grok models` = 1"。

**D. 版本 bump**：`0.31.0` → `0.32.0`（判定 minor，非 patch——见下方"版本判定"小节），四同步点（`package.json` / `.claude-plugin/plugin.json` / `.codex-plugin/plugin.json` / `.claude-plugin/marketplace.json` 两处 version 字段）+ `commands/smoke.md` / `commands/vendors.md` 版本号文案同步；CHANGELOG.md 新增条目。

**E. 回归**：`tests/unit/vendor-probe.test.js` 新增 8 条 grok 相关用例（`parseGrokModelsList` 4 条纯函数 fixture + 3 条 fake-binary spawn 集成用例覆盖 full/partial-fallback/none 三态）；修正了 3 处读取真实 grok adapter 状态、断言值仍是 `grok-build` 的既有测试（`tests/unit/dispatch-fallback-chain.test.js`、`tests/unit/vendor-model-auth.test.js`、`tests/unit/vendors-contract.test.js`——这三处如果不改会因为本次修复而变红,是预期内的连带更新，不是新缺陷）；`scripts/sync-vendored-plugin.mjs` 已跑，`plugins/hopper/` 下的 grok 相关文件与主源码一致。

### 版本判定：minor 而非 patch

仓库的历史版本号（`git log --oneline`，0.20.0 → 0.31.0 共 12 次发布）**全部**是 `X.Y.0` 形式——patch 位从未真正被当作"小修"使用（仅早期 0.7.1/0.8.1/0.11.1 三次例外），无论提交信息前缀是 `fix:` 还是 `feat:`，一律递增 minor 位。本次改动的实质不只是"改个默认值"：`--probe grok` 从零 spawn 的静态回退升级为真实 spawn + 解析 + 诚实降级的新行为路径（新增导出函数、新增测试类别、`estimateSpawns` 契约变化），符合项目既有惯例里"minor 位承载所有可观察行为变化"的用法，故判定 `0.32.0`（minor），不引入此前罕见的 patch 位。

### 验证记录（真实环境，非 mock）

- `grok -p ... -m grok-build ...` → `Couldn't set model 'grok-build': Invalid params: "unknown model id"`（修复前后均如此，确认这是 vendor 侧真实下线，不是 hopper 这边的误判）。
- `grok -p ... -m grok-4.5 ...` → `{"text":"OK","stopReason":"EndTurn",...}`（V-verified 2026-07-18）。
- `node cli/bin/hopper-dispatch --check-model grok grok-4.5` → `verdict: verified (exit 0)`。
- `node cli/bin/hopper-dispatch --check-model grok grok-build`：
  - 修复前（缓存里还是旧探针写的静态名单）→ `verdict: catalog-only (exit 2)`。
  - 跑过 `node cli/bin/hopper-dispatch --probe grok` 刷新缓存后 → `verdict: not-found (exit 1)`（catalog 里已经没有 grok-build 了）。
  - 两种结果都符合"不再 verified"的验收标准；catalog-only → not-found 的变化本身就是探针自愈生效的直接证据。
- `node cli/bin/hopper-dispatch --probe grok` → `grok ... full | 1 model(s) | ~1.9s`，真实 spawn 了一次 `grok models` 子进程（此前是 0 次）。
- `node cli/bin/hopper-dispatch --models grok`（探针后）→
  ```
  grok (full, 0m ago)
    - grok-4.5
    reasoning: low | medium | high
  ```

### 更深的待办（本次不做，记录为 follow-up）

**`verified-latest` 哨兵和 `--check-model` 的 "verified" 判定信任的是静态 `knownGood`，从不校验新鲜度——即使 `knownGood` 本身已经过期，只要没人手动发现并改代码，两条路径都会持续、静默地给出"verified"的假阳性。**

具体来说：
- `cli/src/model-check.js::evaluateModelCheck` 的第一步就是 `kg.some((g) => modelKeysMatch(vendor, g, normalized))` → 命中直接判 `verified`，**根本不看 probe 缓存**（`catalog` 只在 knownGood 未命中时才会被查）。
- `cli/src/policy.js::resolveVerifiedLatest` / `cli/src/dispatch.js` 里 `verified-latest` 哨兵同样只读 `knownGood[0]`，同样不查 probe 缓存。
- 也就是说：哪怕这台机器五分钟前刚跑过 `--probe grok`、缓存里明明白白写着 grok-build 已经不在活体 catalog 里了，`--check-model grok grok-build` 依然会因为 knownGood 里（假设还没被人工改掉）残留着 `grok-build` 而判 `verified`——**"verified" 这个词本该代表"我们有把握这个名字现在能用"，但它实际验证的只是"这个名字曾经被人手工确认过"，两者在 knownGood 过期后就分道扬镳了**。这正是本次 issue 复现的确切故障模式，只是这次是从"从未探测过"的角度触发；如果反过来是"探测过但没人去对照"，同样的假阳性会发生在有新鲜缓存的机器上，而且更隐蔽——因为看起来像是"探测过的、应该可信"的状态。

值得注意的是，`cli/src/setup.js::buildVendorReadiness`（`hopper-dispatch --setup --deep` / `--doctor --deep`）**已经有**一套活体 catalog vs 静态 knownGood 的漂移检测机制（`row.modelReconcile` + `cli/src/model-normalize.js::reconcileModels`，本次 B 修复上线后 grok 也会第一次真正吃到这条检测路径，因为它此前要求 `introspection_supported === 'full'` 才会做对照，而 grok 一直是 `'none'`）。但这条检测路径**只在人主动跑 `--setup --deep`/`--doctor --deep` 时触发**，`--check-model` 和 `verified-latest` 哨兵解析完全不复用它，二者是两条互不相通的代码路径。

**建议的加固方向（follow-up，非本次范围）**：当某个 vendor 存在新鲜（未过 `staleAfter`）且 `introspection_supported === 'full'` 的 probe 缓存时，`--check-model` 的 `verified` 判定与 `verified-latest` 哨兵解析都应该顺手交叉核对一下 `knownGood`（至少是 `knownGood[0]`）是否仍出现在这份新鲜 catalog 里；不在的话，不应该静默地继续判 `verified`/继续把它当 `verified-latest` 的解析结果转发出去，而应该at least 在 hint / policyNotices 里发出一个"knownGood 与新鲜 catalog 不一致"的强警告（是否要新增一个 `verified-stale` verdict、还是复用现有的 `catalog-only` 语义、还是仅追加一条 notice，留给实现时判断）。这样即使未来又有别的 vendor（不只是 grok）经历同样的模型线换代，只要机器上有新鲜探针缓存，故障能在派发前就被拦下来，而不必等到真实 dispatch 400 才发现。

---


<a id="lockfile-missing-platform-rollup-variants"></a>

## lockfile-missing-platform-rollup-variants

> Archived from `ISSUE-lockfile-missing-platform-rollup-variants.md`. Body verbatim.

## ISSUE: `npm ci` is broken on every non-Windows machine (lockfile carries only win32 rollup binaries)

- **Status**: RESOLVED 2026-08-03 — lockfile regenerated, `npm ci` restored in CI
- **Found**: 2026-08-03, by the first CI run this repo has ever had (v0.43.0)
- **Severity**: anyone cloning this repo and running `npm ci` on linux or macOS
  gets a broken install. Not CI-specific.

### Symptom

```
Error: Cannot find module @rollup/rollup-linux-x64-gnu. npm has a bug related to
optional dependencies (https://github.com/npm/cli/issues/4828).
  [cause]: Error: Cannot find module '@rollup/rollup-linux-x64-gnu'
```

Observed on `ubuntu-latest` (`rollup-linux-x64-gnu`) and `macos-latest`
(`rollup-darwin-arm64`) — 2 failing unit test files on each
(`tests/unit/dashboard-queue.test.js`, `tests/unit/dashboard-task.test.js`,
both of which load vite → rollup).

### Root cause

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

### Why it was invisible until now

The repo had **no CI**. Every "tests pass" was a local run on a machine whose
`node_modules` had been populated by `npm install` (which *does* re-resolve
optional deps per platform), never by `npm ci`. The lockfile's incompleteness
therefore never mattered to anyone actually running the suite.

### Reproduction

```bash
mkdir /tmp/ncitest && cp package.json package-lock.json /tmp/ncitest/
cd /tmp/ncitest && npm ci
ls node_modules/@rollup/          # empty on macOS/linux
```

Confirmed on macOS with npm 10.9.8 / node 22.22.3.

### What was tried and did not work

`npm install --package-lock-only` (npm 10.9.8, macOS) — regenerated lockfile
still records only the same two win32 entries; it does not add the host
platform's variant, let alone all 26.

### Workaround that did NOT work

Switching CI to `npm install` was tried first and **failed**: ubuntu (both Node
versions) and macOS/Node 22 still died with the same missing-module error. Only
macOS/Node 24 passed, presumably because of the newer bundled npm. Recorded here
because "npm install instead of npm ci" is the answer most search results give
for npm/cli#4828, and for this repo it was not sufficient.

### Resolution

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

### Fix directions considered (for the record)

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

### Not claimed

Verification was on macOS only at the time of writing; that `npm ci` now works on
linux and windows follows from the lockfile carrying their variants, but the
proof is the CI run, not this file. If a future lockfile regeneration is done
with `node_modules` present, this defect returns silently — nothing guards it.

---


<a id="mimo-codeimpl-timeout"></a>

## mimo-codeimpl-timeout

> Archived from `ISSUE-mimo-codeimpl-timeout.md`. Body verbatim.

## ISSUE: mimo (mimocode) adapter — `code-impl` 多文件机械编辑任务撞 180s 硬超时

> 报告方: x-agents CEO 编排(S1-AST-01 Contacts 断言改写任务)
> 日期: 2026-06-16
> 严重度: 中(有 workaround=改派其它 vendor,但暴露 adapter 真实限制)
> 状态: 待 hopper 自查

### 现象

任务 `S1-AST-01-P5`(code-impl):对 2 个 TS 测试文件做 **41 处机械替换**(`aiQuery(\`boolean, X\`)` → `aiBoolean(\`X\`)`)。

两次 background 派发**都超时,且未落任何编辑**:

| 次 | 通道 | 时长 | 结果 |
|---|---|---|---|
| 1 | opencode 调 mimo(`opencode run --model xiaomi-token-plan-cn/mimo-v2.5-pro`) | **181406ms** | `adapter_status: timeout` / exit 1 / `opencode run timed out after 181406ms` |
| 2 | mimo 原生(`mimo run --model xiaomi/mimo-v2.5-pro --dangerously-skip-permissions`) | **181029ms** | `adapter_status: timeout` / exit 1 / `mimo run timed out after 181029ms` |

两次时长几乎相同(~181s),指向**固定 180s 超时**而非 vendor 通道差异。

### 定位(代码级)

`cli/src/vendors/mimo.js:81-83`:
```js
timeoutMs(opts) {
  return applyTaskTypeFloor(180_000, opts);
}
```
- 基线 **180_000ms 硬编码**;`code-impl` 任务类型**不享受加长 floor**(review 类才有);**无 env/flag 可调**(`--help` 无 `--timeout`,源码无 `process.env.*TIMEOUT` 覆盖 mimo 基线)。
- mimo 是 agentic coding tool,**逐处 read→reason→edit→write** ~40 次,加启动开销,超 180s。

### 疑似加重因素:启动期 skill 重名刷屏

两次 output 里各有 **17 条** `WARN message="duplicate skill name"`(`~/.claude/skills/<name>` 与 `~/.claude/skills/gstack/<name>` 双注册,如 ship/review/retro/scrape/qa/learn/guard/…)。mimo 启动加载这批 gstack skill,吃掉首段时间预算才开始任务。

证据文件:
- `<x-agents>/.hopper/handoffs/S1-AST-01-P5-output.md`(status 块 + WARN 刷屏)
- `<x-agents>/.hopper/handoffs/S1-AST-01-P5-output.log`(raw,~300KB)

### 建议 hopper 自查方向

1. **code-impl 超时 floor 可配/加长**:机械批量编辑(几十处)正当地会超 180s;给 code-impl 一个更高 floor 或 `--timeout <ms>` 派发覆盖。
2. **env 覆盖**:`HOPPER_MIMO_TIMEOUT_MS` / 通用 `HOPPER_DISPATCH_TIMEOUT_MS`,便于慢机/大任务放宽。
3. **duplicate skill name 双注册**:`gstack/<name>` 与裸 `<name>` 同名重复加载是否应去重/抑制,减少 mimo/opencode 启动浪费。
4. **机械任务路径**:agentic vendor 对"可 sed 化"的纯机械批量替换是否应提示/支持 bulk 编辑(单次 sed),而非逐处 LLM round-trip——同一任务交 grok/deepseek 即在超时内完成,差异主要在 mimo 的逐处编辑节奏。

### 备注

本任务已 workaround:P5 的两文件改派 grok(P2)/ deepseek(P3)执行,不阻塞 S1-AST-01。此 issue 仅为 mimo adapter 的真实限制留档供 hopper 修复。

---


<a id="monitor-cross-session-crosstalk"></a>

## monitor-cross-session-crosstalk

> Archived from `ISSUE-monitor-cross-session-crosstalk.md`. Body verbatim.

## ISSUE: hopper monitor crosses sessions — a new Claude session in a hopper project immediately receives ANOTHER session's terminal/monitor events

> Reporter: user (observed live) + governance-fusion session (corroborated in code)
> Date: 2026-06-17
> Severity: medium-high (UX correctness: a session is woken/notified by work it did not start; confusing and potentially actionable on the wrong task)
> Status: open
> Env: Claude Code with the hopper plugin installed; multiple sessions in the same project dir.

### Symptom (observed)

Starting a *second* Claude Code session in the same project directory that contains `.hopper/` causes the new session to **immediately** receive events belonging to a different session that is using hopper — e.g.:

```
● Agent "Re-investigate stop-500 in deployed fd5b739" completed · 10m 4s
● Monitor event: "Forward hopper terminal task events from .hopper/handoffs to Claude Code notifications"
```

The new session never dispatched that work, yet it is notified about it on startup ("串台" / crosstalk).

### Root cause (confirmed in code)

Three reinforcing factors:

1. **Project-wide monitor registration.** `monitors/monitors.json` registers:
   ```json
   { "name": "hopper-watch-events",
     "command": "node \"${CLAUDE_PLUGIN_ROOT}/cli/bin/hopper-dispatch\" --watch-events",
     "description": "Forward hopper terminal task events from .hopper/handoffs to Claude Code notifications" }
   ```
   Because this ships with the plugin, **every** Claude session opened in the project auto-starts the monitor against the **same** `.hopper/handoffs/`.

2. **No session scoping.** `runWatchEvents` (`cli/bin/hopper-dispatch`) watches the shared handoff dir and `listOutputMarkdownFiles()` returns **all** `*-output.md`; it emits a terminal event for every one of them. There is no filter by which session dispatched the task. Task `output.md` frontmatter even carries `session_id: null` — tasks are not tagged with the dispatching session, so no filtering is possible today.

3. **Startup replay of historical terminal events.** On launch, `runWatchEvents` calls `scanOutputs()` → `watchOutput()` → `maybeEmit()` for each existing file. `maybeEmit` emits whenever `isTerminalFrontmatter(fm)` is true and the seq hasn't been seen by *this* monitor instance (`lastSeenSeq` starts empty). So a freshly started monitor **immediately re-emits terminal events for tasks that were already done before it started** — including tasks from other sessions. This is the "immediately on startup" part of the symptom.

(The `Agent "...stop-500..." completed` line is an adjacent symptom that may be Claude-Code-side agent/notification routing rather than hopper directly; the **monitor event** and the immediate replay are squarely hopper. Both should be considered together since they co-occur in the same project.)

### Impact

- A new session is woken/notified by another session's (or historical) hopper task completions — noisy and misleading.
- A session cannot tell which of its own dispatches a completion belongs to vs. another session's.
- With several sessions in one repo (a normal multi-agent / dogfooding setup), terminal notifications fan out to all of them.

### Reproduction

1. In a project with the hopper plugin + a `.hopper/` that has at least one completed `*-output.md`, open Claude session A and dispatch a background task.
2. Open Claude session B in the **same** directory.
3. Session B immediately surfaces the `hopper-watch-events` monitor event and terminal events for tasks it never dispatched (including the already-completed ones).

### Suggested fix direction

1. **Tag tasks with the dispatching session.** Populate the existing `session_id` frontmatter field at dispatch time (from a `HOPPER_SESSION_ID` / Claude session id), and have `--watch-events` accept a target session (`--session <id>` or `HOPPER_SESSION_ID`) and emit only events for tasks matching it. Default the monitor command to the current session.
2. **Do not replay history on startup.** Seed `lastSeenSeq` from the current terminal state of each existing `*-output.md` on the first scan so the monitor only emits events for transitions that happen **after** it starts — never for tasks already terminal at startup.
3. Optionally make the project-wide monitor opt-in, or namespace its delivery per session, so two concurrent sessions don't both consume the same shared terminal events.

---


<a id="opencode-ansi-log-output-not-parsed"></a>

## opencode-ansi-log-output-not-parsed

> Archived from `ISSUE-opencode-ansi-log-output-not-parsed.md`. Body verbatim.

## ISSUE: opencode exit-0 success misclassified as adapter-protocol-invalid — this opencode build emits ANSI-colored log lines on stdout instead of the `--format json` NDJSON event stream, and parseOpencodeAnswerEvents parses nothing

> Reporter: Kimi Work orchestration session (hawk-clawhive project)
> Date: 2026-07-24
> Severity: medium-high — the vendor COMPLETES the task correctly (full answer on stdout), but hopper records `failed` / `adapter-protocol-invalid`; orchestration that gates on task status cannot chain on opencode results
> Env: Windows; opencode via cmd.exe shim `C:\nvm4w\nodejs\opencode.cmd`; model `tokenbox/deepseek-v4-pro`; hopper-dispatch `0.35.1+6aa10d3`; CLI = `<hopper>/cli/bin/hopper-dispatch` (loads `cli/src/vendors/opencode.js`)
> Status: **CLOSED** — fixed in the audit-close commit (candidates 1+2 implemented; see Resolution)

### Context

Found while validating the fix for
ISSUE-opencode-windows-multiline-prompt-truncation (commit 6aa10d3). That fix
works: the multi-line composed brief now reaches opencode intact via the
pointer-file channel, and opencode completes the task. What remains broken is
the **classification** of the run.

### Evidence (task `adhoc-code-review-adversarial-mryr4dsd`, hawk-clawhive `.hopper/handoffs/`)

Dispatched 2026-07-24 with
`hopper-dispatch --adhoc --task-type code-review-adversarial --vendor opencode --model tokenbox/deepseek-v4-pro --background --brief "READ-ONLY micro task: read the file .hopper/handoffs/REV-GRK-001-output.md and reply with exactly one sentence summarizing it. Do not modify anything."`

- `adhoc-code-review-adversarial-mryr4dsd-output.md` frontmatter:
  `exit_code: 0`, `duration_ms: 69659`, yet `status: failed`,
  `phase: failed`, `--result` reports
  `Adapter diagnostic: adapter-protocol-invalid`, `Recovered output: none`.
- `adhoc-code-review-adversarial-mryr4dsd-output.log` — the run clearly
  **succeeded**: it shows the vendor reading the pointer prompt file
  (`Read .hopper/handoffs/adhoc-code-review-adversarial-mryr4dsd-prompt.md`),
  then reading `REV-GRK-001-output.md`, then emitting the requested
  one-sentence summary as the final answer. But every log line is an
  **ANSI-colored human log line**, not JSON. Readable transcription of the
  actual bytes (ESC = `\x1b`, CR = `\r`):

  ```
  ESC[0m CR
  > build · deepseek-v4-pro CR
  ESC[0m CR
  ESC[0m → ESC[0mRead . CR
  ESC[0m → ESC[0mRead .hopper/handoffs/adhoc-…-prompt.md CR
  <thinking>…</thinking>
  An adversarial code review of the ClawHive Electron app's startup IPC and
  coordinator identifies four real defects—including a high-severity OAuth
  race condition … —with a REWORK verdict …
  ```

  i.e. stdout looks like `opencode run --print-logs` console output (color
  resets, `→ Read <path>` tool traces, `<thinking>` blocks, plain-text final
  answer). **No NDJSON event lines appear anywhere in the captured stdout**,
  even though the adapter argv includes `--format json --print-logs --pure`
  (`cli/src/vendors/opencode.js` args()).

### Root cause analysis

`cli/src/vendors/opencode.js` `parseOpencodeAnswerEvents()` splits stdout into
lines and `JSON.parse`s each line, collecting text only from recognized event
shapes (`{type:"text", part:{text}}`, message/assistant/result envelopes,
terminal markers like `step_finish` / `message.completed` / successful
`result`). On this opencode build:

1. every stdout line is ANSI-decorated human log output → per-line
   `JSON.parse` throws for ALL lines → `chunks` empty, `terminalMarker: 'none'`;
2. `parseResult` then has `exitCode === 0` but no text and no terminal marker
   → falls through to `adapterFailure('unknown-fail', 'adapter-protocol-invalid')`.

So the parser contract ("stdout is a JSON event stream") does not match this
build's actual stdout ("human log stream"). Two open questions for the dev
team:

- **Why does `--format json --print-logs --pure` still yield ANSI log lines?**
  Hypotheses: (a) this opencode build (or the `tokenbox/*` provider path)
  routes `--print-logs` output to **stdout** interleaved with — or instead of —
  the JSON event stream; (b) under the Windows **cmd-shim** spawn the child's
  TTY/color detection differs from a direct console run, so opencode keeps
  colorized console formatting even in `--format json` mode; (c) `--pure`
  semantics changed in this version. Needs a direct repro:
  `opencode run "<prompt>" --model tokenbox/deepseek-v4-pro --print-logs --format json --pure`
  captured to a file on this host, with and without `--print-logs`, and via
  `cmd.exe /c opencode.cmd` vs direct invocation.
- **Is the final plain-text answer line distinguishable?** In the captured
  log the final answer is a plain (non-`→`-prefixed, non-`<thinking>`) text
  block after the tool traces — recoverable with heuristics, but fragile.

### Fix candidates (for the dev team — deliberately NOT fixed in 6aa10d3)

1. **Strip ANSI escape sequences before parsing** (minimal, safe): remove
   `ESC[…m` / CR control bytes in `parseOpencodeAnswerEvents` line
   preprocessing. Necessary but NOT sufficient for this build — the stripped
   lines are still not JSON events.
2. **Force logs off stdout**: drop `--print-logs` (or redirect it) for
   background dispatches so stdout carries only the `--format json` event
   stream; verify whether this build then emits NDJSON at all. If the build
   simply ignores `--format json`, escalate upstream / pin a known-good
   opencode version.
3. **Tolerant non-JSON fallback extraction** (last resort): when zero JSON
   events parse but exit code is 0, extract the trailing plain-text answer
   block (excluding `→` tool-trace lines and `<thinking>` blocks) with
   `completeness: 'unknown-completeness'` evidence, so a genuinely successful
   run is not false-failed. Must stay conservative to keep the
   protocol-invalid guard meaningful for real protocol breaks.

Candidate 1+2 is the preferred path (restores the real event-stream
contract); candidate 3 is the resilience net if the build truly cannot emit
NDJSON in this environment.

### Impact / workaround

Every opencode dispatch on this host is recorded `failed` even when the
vendor did the work (same false-fail class as the fixed
ISSUE-grok-adapter-protocol-invalid-false-fail, different mechanism).
Workaround: read the deliverable / final answer from
`.hopper/handoffs/<taskId>-output.log` manually; do not gate downstream
orchestration on opencode task status until this is fixed.

### Repro

```
## Windows, from a repo with .hopper/
hopper-dispatch --adhoc --task-type code-review-adversarial --vendor opencode \
  --model tokenbox/deepseek-v4-pro --background --brief "<any small read-only task>"
hopper-dispatch --result <taskId>   # → exit_code 0, answer in .log, status failed / adapter-protocol-invalid
## inspect the raw log: ANSI-colored "→ Read …" log lines, zero JSON event lines
```

---

### Resolution (2026-07-24 — hopper 0.35.1+)

**FIXED** in `cli/src/vendors/opencode.js` (synced to `plugins/hopper/cli/src/`), implementing candidates 1+2.

#### Controlled experiments (opencode 1.18.4, tokenbox/deepseek-v4-pro, this host — one run each)

| Invocation | stdout | stderr |
|---|---|---|
| `--format json --pure --print-logs` (direct shell, no `--dir`) | clean NDJSON event stream (`step_start` / `text` / `step_finish` lines) | structured `level=INFO` logs |
| `--format json --pure` (no `--print-logs`) | clean NDJSON event stream | empty |
| full hopper argv (`--dir … --print-logs --format json --pure`, direct shell) | clean NDJSON event stream incl. `tool_use` events | structured `level=INFO` logs |

So the CURRENT build honors `--format json` on stdout in every directly
reproducible configuration, and `--print-logs` writes to **stderr**. The
evidence run's all-ANSI/zero-JSON output could not be reproduced (same
opencode 1.18.4 binary, installed 2026-07-22, before the evidence run). Two
aggravating platform facts WERE confirmed: hopper's runner **tees vendor
stdout AND stderr into one log file** and passes that interleaved stream to
`parseResult` as `raw.stdout` — so any stderr log output reaches the parser;
and whatever mode produced the evidence log emitted its pretty stream with
zero NDJSON, leaving nothing parseable.

#### Changes shipped

1. **`args()`: `--print-logs` removed** (candidate 2). Its INFO logs already
   went to stderr, but the tee puts stderr into the parse input and the
   shared evidence log; the NDJSON event stream alone feeds both parsing and
   log-growth liveness. `--format json --pure` retained.
2. **Parser strips ANSI escapes + CR before per-line `JSON.parse`** (candidate
   1) in both `parseOpencodeAnswerEvents` and
   `extractOpencodeModelAttestation` — ANSI-wrapped NDJSON now parses.
3. **Conservative plain-text recovery**: when ZERO JSON events parse AND the
   input looks like an opencode log (ANSI escapes / `> build` banner / `→`
   tool traces / `<thinking>` blocks), the readable residue (final answer
   lines minus noise) is attached to the FAILURE result as `text` with
   `outputEvidence { completeness: 'unknown-completeness', source:
   'ansi-stripped-plain-text', terminalMarker: 'none' }`. It NEVER flips the
   classification to success, and arbitrary raw stdout stays fail-closed (the
   vendors-contract privacy test: unstructured raw/private text must not
   become parser evidence — gated by the log-shape check).

Verified against the REAL `adhoc-code-review-adversarial-mryr4dsd-output.log`:
still (correctly) `unknown-fail / adapter-protocol-invalid` for that
unverifiable run, but the final answer sentence is now recovered into the run
record instead of `recovered_output_state: no-text`.

#### Tests

New `tests/unit/opencode-adapter.test.js` (8 cases): `--print-logs` absent
from argv; clean NDJSON → success; ANSI-wrapped NDJSON → success; ANSI
pretty log with no JSON → still `adapter-protocol-invalid` but final answer
recovered (noise/banner/tool-trace/thinking excluded); noise-only stdout →
no recovered text; non-zero exit; timeout; empty stdout.
`tests/unit/vendors-contract.test.js` opencode argv case updated for the
`--print-logs` removal. Full unit suite: no regressions vs the unmodified
baseline (the 7 dashboard-* env suites + 1 flaky lifecycle test fail
identically before and after).

#### Live verification (one dispatch, 2026-07-24)

`hopper-dispatch --adhoc --task-type code-review-adversarial --vendor opencode --model tokenbox/deepseek-v4-pro --background --brief "<tiny read-only task>"`
→ task `adhoc-code-review-adversarial-mryswwzj`: **status done, adapter
diagnostic none** — the false `adapter-protocol-invalid` on a successful
opencode run is gone.

---


<a id="opencode-windows-multiline-prompt-truncation"></a>

## opencode-windows-multiline-prompt-truncation

> Archived from `ISSUE-opencode-windows-multiline-prompt-truncation.md`. Body verbatim.

## ISSUE: opencode on Windows receives only the first line of the task brief — cmd-shim truncates multi-line argv at the first newline, opencode has no stdin channel

> Reporter: Kimi Work orchestration session (hawk-clawhive project), dispatching adversarial review tasks to opencode/grok
> Date: 2026-07-24
> Severity: high on Windows — every opencode dispatch with a multi-line brief is a silent no-op; the vendor answers "your message seems to be cut off" and hopper records `adapter-protocol-invalid`
> Env: Windows; opencode reached via cmd.exe shim `C:\nvm4w\nodejs\opencode.cmd`; hopper-dispatch `0.35.1`; CLI = `<hopper>/cli/bin/hopper-dispatch` (loads `cli/src/prompt-delivery.js` + `cli/src/vendors/opencode.js`)
> Status: **CLOSED** — fixed in 6aa10d3; pointer-instruction hardening added in the audit-follow-up commit (see Resolution)

### Evidence

Any background dispatch to the opencode vendor with a composed (multi-line)
brief returns an answer whose entire content is a truncation complaint:

> "Your message seems to be cut off. I see you've sent a header/preamble …"

`parseResult` then classifies the run `unknown-fail` /
`adapter-protocol-invalid` (exit 0 but no usable terminal result), so the
queue row shows `failed` even though opencode ran fine — it simply never
received the task.

Repro:

```
## Windows, from a repo with .hopper/
hopper-dispatch --adhoc --task-type code-review-adversarial --vendor opencode --background
hopper-dispatch --result <taskId>   # → opencode: "message cut off …", status failed
```

### Root cause (symptom proven; precise mechanism partially characterized)

**What is empirically proven:** on this Windows host, a multi-line composed
brief delivered as an argv positional to opencode (a cmd.exe `.cmd` shim at
`C:\nvm4w\nodejs\opencode.cmd`) arrives **cut to its first segment** — the
vendor consistently receives only the header/preamble and asks for the rest.
The failure is 100% reproducible for multi-line briefs and absent for
single-line ones.

**What is NOT precisely established** (wording corrected after independent
audit): the exact cutting mechanism. An earlier version of this ISSUE stated
flatly that "cmd.exe truncates a multi-line argv positional at the first
newline at any size." That is too strong: the pointer instruction shipped in
the original fix was itself multi-line and DID reach the vendor intact
(opencode read the prompt file and completed the task), so "cmd.exe
truncates any multi-line argv at the first newline" cannot be the whole
story. The precise mechanism — cmd.exe line-length/quoting interaction,
Node's win32 argv escaping through a `.cmd` shim, or opencode's own argv
parsing of embedded newlines — is left to a follow-up repro experiment
(`cmd.exe /c opencode.cmd run "<controlled multi-line string>"` with varying
lengths/quoting). What matters operationally is unchanged: **argv-inline
delivery of multi-line briefs to cmd-shim vendors is unreliable**, so the
pointer-file channel is the correct fix regardless of which exact layer cuts
the text.

Confirmed contributing facts:

1. On Windows, `opencode` resolves to a **cmd.exe `.cmd` shim**, so
   `commandLineRegime()` puts the spawn in the `cmd-shim` regime
   (`cli/src/prompt-delivery.js`).
2. The size-gated pointer mechanism did NOT catch the truncation: the
   truncation victim is usually a SMALL prompt far under the 4000-byte inline
   budget, so it stayed on `argv-inline`.
3. Vendors that declared `promptStdin: 'supported'` (codex/claude/mimo,
   opt-in copilot) were already routed to stdin delivery and unaffected.
   **`cli/src/vendors/opencode.js` has no `promptStdin` declaration** (only
   `stdinMode: 'none'`), so opencode stayed on argv-inline.
4. opencode CLI genuinely **cannot read the message from stdin** (verified
   `opencode run --help`: the message is an argv positional array only), so
   routing it to stdin was never an option.

### Resolution (2026-07-24 — hopper 0.35.1+)

**FIXED** in `cli/src/prompt-delivery.js` (synced to `plugins/hopper/cli/src/`):

A newline-gated companion rule to the existing size gate: on the `cmd-shim`
regime, when the adapter does NOT declare `promptStdin: 'supported'` and the
composed prompt contains a newline, delivery now takes the **pointer-file**
channel (`handoffs/<taskId>-prompt.md` + a small single-paragraph "read this
file" pointer instruction) regardless of size. opencode — like every hopper
vendor — is an agentic coding CLI that can read a file in its workspace, so
the pointer is fully compatible.

Behavior preserved:
- stdin-capable vendors (codex/claude/mimo, opt-in copilot) still use the
  stdin channel on cmd-shim (checked before the new gate).
- Single-line prompts within budget still inline (deterministic path).
- native-exe and POSIX regimes are untouched (their argv is multi-line-safe).
- The cwd-scope guard and write-failure fallback (fall back to inline with
  `fallbackReason`, never break dispatch) apply to the forced pointer exactly
  as to the size-gated one.

Tests added in `tests/unit/prompt-delivery.test.js`:
- small multi-line prompt on cmd-shim + non-stdin adapter → pointer file;
- single-line prompt on cmd-shim → still inline (no regression);
- multi-line on native-exe/posix → still inline;
- stdin-capable codex on cmd-shim → still stdin channel (gate ordering);
- REAL opencode adapter + cmd-shim + multi-line → pointer file, prompt off
  argv, `run …` argv shape preserved.

All 33 prompt-delivery tests pass; the full unit suite shows no new failures
(the 7 dashboard-* suites + 1 flaky lifecycle test that fail also fail on the
unmodified baseline).

#### Audit follow-up (2026-07-24, pointer hardening)

An independent audit (approve-with-comments) noted that the ORIGINAL
`buildPointerInstruction` itself produced a 4-line pointer — inconsistent with
this ISSUE's own "multi-line argv is at risk" theory (and, per the corrected
root-cause wording above, evidence that the precise cutting mechanism is not
fully characterized). Hardening shipped in the follow-up commit:

- `buildPointerInstruction` now emits a **single line** with the prompt-file
  absolute path **front-loaded**: even if some layer ever cuts an argv
  positional mid-string, the file path survives as early as possible.
- Pointer delivery results now carry `channel: 'argv-pointer'` (inline
  fallbacks carry `channel: 'argv-inline'`), consistent with the `'stdin'`
  channel label.
- New regression tests: the pointer instruction contains no newline, the path
  sits in the first half of the line, and a cmd-shim pointer delivery has NO
  newline in ANY argv element.

---


<a id="progress-watch-hang"></a>

## progress-watch-hang

> Archived from `ISSUE-progress-watch-hang.md`. Body verbatim.

## ISSUE: `tests/unit/progress-watch.test.js` hangs the test process (and `--watch-events --once` can hang forever)

> Reporter: governance-fusion migration (Claude Code session, dogfooding hopper-dispatch)
> Date: 2026-06-17
> Severity: medium (blocks the full-suite `npm test` gate; has a workaround = exclude this one file)
> Status: open — pre-existing, NOT introduced by the governance-fusion change (which never touched the `--watch-events` path)

### Symptoms (confirmed)

- `node --test tests/unit/*.test.js` does not terminate. Observed hangs of 120s and ~904s before external cancellation.
- Isolated to one file: `node --test tests/unit/progress-watch.test.js` alone hangs. `node --test --test-timeout=15000 tests/unit/progress-watch.test.js` reports the file-level test as `cancelled` ("test timed out after 15000ms") with no subtest output surfaced.
- The rest of the suite is healthy: `node --test $(ls tests/unit/*.test.js | grep -v progress-watch)` → **616 tests, 590 pass, 0 fail, 26 skipped**. So `progress-watch.test.js` is the sole hanger.

### Reproduction

```bash
## hangs (cancelled by node's own per-test timeout)
node --test --test-timeout=15000 tests/unit/progress-watch.test.js

## the full-suite gate inherits the hang
node --test tests/unit/*.test.js
```

### Analysis (partial — root cause NOT fully confirmed)

Each individual test in the file is internally bounded: `waitFor`/`waitForExit` throw after 6000ms. So no single subtest should exceed ~6s, yet the file process runs >120s. That points to a **leaked handle keeping the test-file process alive after the tests themselves finish**, rather than a slow test. Strong suspects, not yet pinned to one:

- `runWatchEvents` (in `cli/bin/hopper-dispatch`) sets up `setInterval(scanOutputs, 500)` + one `fs.watchFile()` StatWatcher per output file. Its `cleanup()` clears the interval and `unwatchFile()`s — but if any path through the in-process tests (`'terminal event triggers one OS notify attempt'`, `'notify failure does not block stdout JSONL output'`) leaves a StatWatcher reffed, or a spawned `--watch-events` child (the non-`--once` `'single subscriber'` test) is not fully terminated/released on this platform's polling filesystem, the parent/file process never drains its event loop and node:test never exits.

There is also a **distinct product-level hazard** in the same code: `hopper-dispatch --watch-events --once` has **no bounded exit** — it only calls `cleanup(0)` after observing a terminal event. In a workspace where no task ever reaches a terminal state, the command runs forever (no idle/max-wait cap). The quiet no-op path (`!hopperDir && !HOPPER_DIR → return`) only covers the no-workspace case; a real workspace with no terminating task hangs.

### Impact

- `npm test` (the full-suite gate) cannot complete; contributors must exclude `progress-watch.test.js` to get a green run.
- `--watch-events --once` can hang a session indefinitely if no terminal event arrives.

### Suggested fix direction (for the implementer to confirm via systematic debugging)

1. Reproduce and identify the exact leaked handle (e.g. run the file under a handle dump: `process.getActiveResourcesInfo()` / `process._getActiveHandles()` after `node:test` completes).
2. Ensure `runWatchEvents` releases everything on cleanup: `unref()` the `setInterval` and the `watchFile` StatWatchers so they never keep the loop alive on their own, and confirm spawned children in the tests are killed AND their stdio pipes closed/awaited.
3. Give `--watch-events --once` a bounded/idle exit (or make the tests deterministic so the file always drains), so neither the test nor the CLI can hang indefinitely.
4. Re-verify: `node --test tests/unit/progress-watch.test.js` exits on its own, and `node --test tests/unit/*.test.js` (no exclusion) completes green.

---


<a id="prompt-artifact-lifecycle-and-windows-permissions"></a>

## prompt-artifact-lifecycle-and-windows-permissions

> Archived from `ISSUE-prompt-artifact-lifecycle-and-windows-permissions.md`. Body verbatim.

## ISSUE: `-prompt.md` artifacts hold the full task brief, accumulate forever, and are unprotected on Windows

- **Status**: open — recorded, not fixed
- **Found**: 2026-08-03, while fixing a Windows CI failure that was itself unrelated
- **Severity**: not a credential leak (this repo's brief discipline forbids real
  credentials in briefs), but a file containing the complete composed prompt sits
  on disk indefinitely, with permissions that are unverified on Windows.

### What the file is

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

### Two problems

#### 1. It fires far more often on Windows than the size gate suggests

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

#### 2. Nothing ever deletes them

`archive.js`'s own header states archival is "EXPLICIT — hopper has no reaction
core, so nothing auto-archives," and `--archive` only **moves** files into
`.hopper/archive/<date>/`. There is no retention window, no purge, no delete path
anywhere for any of the five artifact types. A `-prompt.md` persists until a
human removes it out of band. Combined with (1), Windows accumulates them fastest.

#### 3. The `0600` is best-effort, and on Windows we now know it does not hold

The code comments the `chmodSync` as best-effort because NTFS ACLs do not map to
POSIX mode bits. Independently confirmed the same day (see
`CHANGELOG.md` 0.45.0 and the `windows-latest` diagnostic): hopper's own
owner-only hardening does not actually take effect on Windows —
`icacls /inheritance:r /grant:r` leaves explicit `NT AUTHORITY\SYSTEM` and
`BUILTIN\Administrators` full-control ACEs in place. There is no reason to expect
`chmodSync` to do better. So on Windows these files are, in practice, readable by
every administrator on the machine — which for a single-user dev box is close to
"no protection at all."

### Why it was invisible

The same reason as everything else surfaced in this batch: **nothing executed
it.** The repo had no CI, so the Windows delivery path had never run in a test
environment, and no test asserts anything about artifact retention on any
platform.

### Not claimed

- No evidence any real credential has ever been written to one of these files;
  this repo's `.hopper/AGENTS.md` discipline is that briefs carry parameter names,
  never values. The concern is task context and governance text, not secrets.
- No fix direction is endorsed here. Eager deletion is **wrong** (the background
  runner reads the file after the dispatcher exits). A retention window, an
  explicit purge command, or moving delivery to a mode-enforced temp location are
  all plausible; none has been evaluated.

---


<a id="resolve-ignores-vendor-override"></a>

## resolve-ignores-vendor-override

> Archived from `ISSUE-resolve-ignores-vendor-override.md`. Body verbatim.

## ISSUE: `--resolve <task-id> --vendor <v>` silently ignores `--vendor` — shows AGENTS.md/queue.md routing, not the override

- 发现于: 2026-08-03（安装/升级引导 batch 审查时，主会话实测复现）
- 状态: **已修复（2026-08-03，同日）**——见文末「修复记录」。选的是「实际 vs 预期」两个方向里的方向 1：
  `--resolve` 应用 `--vendor` 覆盖，并如实反映真实 dispatch 会不会拒绝。
- 严重性: 中——不是安全问题，是「所见非所得」：`--resolve` 打印的 Vendor 与真实 dispatch 会用的 Vendor 可能不一致，误导预检
- Env: hopper-plugin 0.41.1（本 batch 提交前，缺陷仍在）；修复代码位于本次改动，随下一次版本 bump 一并发布；CLI = `cli/bin/hopper-dispatch`

### 事实（实测，两种参数位置都试过）

```
$ node cli/bin/hopper-dispatch --resolve T-AUDIT-PH6B-codex --vendor opencode
hopper-dispatch v0.41.1 — resolved dispatch for T-AUDIT-PH6B-codex
  Task-type: ...
  Vendor:    codex          ← --vendor opencode 没有生效，仍是 AGENTS.md/queue.md 路由结果

$ node cli/bin/hopper-dispatch --vendor opencode --resolve T-AUDIT-PH6B-codex
  Vendor:    codex          ← 同上，参数顺序不影响结果
```

而 `--help` 对 `--vendor` 的说明（改之前）是无条件的：

> `--vendor <name>   Override the routed vendor (must be a registered adapter; host != vendor still enforced)`

没有任何一处说明这条覆盖对 `--resolve` 不生效。

### 根因（已读代码确认，不是猜测）

`cli/bin/hopper-dispatch` 的 `--resolve` 分支（约 572-579 行）：

```js
const resolveIdx = args.indexOf('--resolve');
if (resolveIdx !== -1) {
  const taskId = args[resolveIdx + 1];
  ...
  await runResolve(hopperDir, taskId);
  return;
}
```

`runResolve(hopperDir, taskId)` 只有两个参数——**这个分支从未读取 `--vendor`**，也没有把它传给
`runResolve` 或再传给 `resolveDispatch`。对照同一文件里 `--adhoc` 分支（约 365-370 行）：

```js
const vendor = valueAfter('--vendor');
...
resolved = await resolveDispatch({ hopperDir, taskId, vendorOverride });
```

`--adhoc`、同步 dispatch（`parseDispatchArgs` 走到底部的 `valueFlags.vendor`）、`--background`
三条路径都正确地把 `--vendor` 转成 `vendorOverride` 传给 `resolveDispatch`/`resolveAdhocDispatch`。
只有 `--resolve` 这一条路径漏了——形状是「代码遗漏」，不是「`--resolve` 只展示路由结果」的有意设计
（如果是有意设计，`--adhoc` 的等价预检路径不会反过来支持覆盖）。

### 实际 vs 预期

- 实际：`--resolve <id> --vendor <v>` 打印的 `Vendor:` 行 = AGENTS.md/queue.md 静态路由结果，`--vendor`
  的值被完全丢弃，且没有任何警告/notice 提示这条参数被忽略了。
- 预期（二选一，需要在修复时决定）：
  1. `--resolve` 也应用 `--vendor` 覆盖，打印「若真实 dispatch 会用这个 vendor」——与 `--adhoc`/
     同步 dispatch 行为一致；或
  2. `--resolve` 有意只展示未覆盖的静态路由结果，但必须显式拒绝或警告一个被忽略的 `--vendor`
     （而不是静默吞掉），并在 `--help`/两处 SKILL.md 里写清楚这个例外。

### 为什么本次不修

本 batch（v0.42.0）已经在改脚手架产物（`Active Agent Instances` 表）和 skill 指令
（first-run/升级路径），属于行为变化批次；验收面已经不小。这个 `--resolve` 缺陷是独立缺陷，
和本 batch 的「安装/升级引导」主题只是文档层面相邻（都在 `--help`/SKILL.md 附近），修代码会把
本轮的验收范围再扩一圈。按主会话裁决：**本轮只如实标注当前行为，不改代码**。

本轮已同步做的事（如实标注，不是修复）：
- `cli/bin/hopper-dispatch` 的 `--help`：`--vendor` 说明补充「适用于真实 dispatch；
  `--resolve` 展示的是路由结果，不套用覆盖（见本 issue）」。
- `skills/hopper-dispatch/SKILL.md`：`--check <task-id>` 的错误说法一并修正（见下）,
  `--vendor`/`--resolve` 的关系目前 SKILL.md 未展开，留给 issue 修复时一并处理。

### 修的时候要一起决定的事（已完成，见下）

- 选上面「实际 vs 预期」的哪个方向（大概率是方向 1：预检应该反映真实 dispatch 行为，否则
  `--resolve` 作为「dry run」的价值打折）。✅ 选了方向 1。
- 无论哪个方向，都要补一条测试：`--resolve <id> --vendor <v>` 的行为被断言锁定，防止再次静默漂移。
  ✅ `tests/unit/resolve-vendor-override.test.js`。
- 修完后回填本 issue 的「状态」为 closed，并把 `--help`/两处 SKILL.md 的措辞同步更新为修复后的真实行为。
  ✅ 见下方「修复记录」。

### 修复记录（2026-08-03）

**修复位置**：`cli/bin/hopper-dispatch`
- `main()` 的 `--resolve` 分支：新增对 `--vendor` 的扫描（`args.indexOf('--vendor')`，与位置无关，
  两种参数顺序都生效），先做格式校验（`validateVendor`）+ 已注册 adapter 校验
  （`listAdapters().includes(...)`），未通过则 exit(2)（与真实 dispatch 路径在
  `resolveDispatch`/`assertVendorApproved` 之前做的检查顺序一致）。
- `runResolve(hopperDir, taskId, vendorOverride)`：新增第三个参数，直接透传给
  `resolveDispatch({ hopperDir, taskId, vendorOverride })`——**不是另发明一套解析逻辑**，用的就是
  `cli/src/dispatch.js:72` 的 `vendorOverride || resolveVendor(...)` 那条真实路径，因此
  `assertVendorApproved`（`dispatch.js:77`）在覆盖场景下自动生效，不需要在 `--resolve` 里单独复刻。
  又新增了 `validateHostVendorSeparation`（host!=vendor 族隔离）调用，位置对齐
  `runDispatch`/`runBackgroundDispatch` 里紧跟在 `resolveDispatch` 之后的调用点——这是纯函数
  （env 读取 + 静态族表比对，不涉及子进程），dry run 完全有能力也应该施加它。

**真实 dispatch 的校验清单（核实结果）与用户给的清单的差异**：
用户给的清单（assertVendorApproved / 族隔离 / 已注册 adapter）基本准确，核实后发现两点需要补充说明：
1. 已注册 adapter 检查在真实路径里其实分两处、顺序不同：CLI 入口先做一次「`--vendor` 值必须是
   registered adapter」（`unknown vendor '<x>'`，exit 2，在 `resolveDispatch` 调用之前），
   `--resolve` 原有的 HOPPER-1 诊断则是在 `resolveDispatch` 返回之后对 `result.vendor` 再查一次
   （给出「像模型名」还是「像 typo」的更友好提示）。两处都保留了，各自对应真实路径里的位置。
2. 真实 dispatch 在 `executeWithAdapter()` 里还有 `assertVendorDispatchable`（adapter 的
   `dispatchDisabled` 能力门，目前只有 agy 用）——**这条故意没有在 `--resolve` 里施加**，
   不是漏了：`dispatch.js` 里 `assertVendorDispatchable` 自己的文档注释明确写着
   "Non-dispatch surfaces (doctor / --vendors / --resolve) do NOT call this, so a disabled
   vendor is still listed + introspectable"——即 `--resolve` 就应该能预览一个被禁用的 vendor，
   施加这条门反而违背 dry-run 预览的本意。

**判断不该在 dry-run 施加的一条**：`assertAdapterSandboxEnforceable`（kimi 只读沙箱不可强制的门）
与更广义的 sandbox/model/reasoning 解析链（`resolveAdapterOptsForTask`）——这条需要
`adapterOpts.sandbox` 等输入，而 `--resolve` 的 CLI 表面本来就从未解析 `--sandbox`/`--model`/
`--reasoning` 等 flag（只有 `--vendor`，现在是唯二两个）。这是本次 vendor-override 修复范围之外
的既有缺口，不是本次改动引入或掩盖的——已在代码注释里写明，不是沉默丢弃。

**破坏性反证**：把 `resolveDispatch({ hopperDir, taskId, vendorOverride })` 临时改回
`resolveDispatch({ hopperDir, taskId })`（丢弃 vendorOverride），`tests/unit/resolve-vendor-override.test.js`
6 个用例里精确地 4 个转红（覆盖生效的两个位置用例 + 未批准覆盖被拒的两个位置用例），另外
2 个（未注册 adapter 校验、无覆盖回归）保持绿——因为那两条校验点根本不经过被回退的那一行。
还原后全部转绿。细节见本次改动的验收报告。

**测试**：`tests/unit/resolve-vendor-override.test.js`（6 用例，覆盖：覆盖生效 × 两种参数顺序、
覆盖被拒 × 两种参数顺序、未注册 adapter 覆盖被拒、无覆盖回归）。

**文档同步**：`cli/bin/hopper-dispatch --help` 的 `--resolve`/`--vendor` 两行、
`skills/hopper-dispatch/SKILL.md` 第 8 条，均已更新为修复后的真实行为；`plugins/hopper/` 已用
`npm run sync:plugin` 同步。

---


<a id="setup-sandbox-column-dead-code"></a>

## setup-sandbox-column-dead-code

> Archived from `ISSUE-setup-sandbox-column-dead-code.md`. Body verbatim.

## ISSUE: `--setup` 的 Sandbox 列是 dead code，而文档让用户去看它

- 发现于: 2026-07-29（v0.38.0 修 sandboxControl 误分类时顺带发现）
- 状态: **CLOSED**（2026-08-05 修复；影响面比原记录大得多，见下方「影响面更正」）
- 严重性: 中——不是安全问题，是「建议不可执行」

### 事实

`cli/bin/hopper-dispatch` 的 `runSetup()` 里有一个**无条件 `return;`**（约 195 行，
由更早的提交 `03330ea "feat: render model inventory safely"` 引入）挡在 pipe-table + legend
代码之前。该整块——**包括 Sandbox=argv/full/native 这一列**——今天是 dead code。

实测 `node cli/bin/hopper-dispatch --setup` 的真实输出只有简化行：

```
codex: status=READY auth=verified binaryAvailability=unknown ...
```

**没有 Sandbox 列。**

### 为什么它现在要紧

v0.38.0 修好了 `sandboxControl()` 的误分类（grok 曾被判 `argv`，实际恒
`--permission-mode bypassPermissions`），并**保留**了 `commands/setup.md:39` /
`skills/hopper-setup/SKILL.md:20` 那句建议：

> prefer a vendor whose **Sandbox=argv** so read-only is actually enforced

修完之后这句话**语义上是真的**（opencode/copilot/claude 确实是真 `argv`，
codex/grok 是 `full`）。**但用户没有任何办法看到这个值**——它不在 `--setup` 输出里。

**即：一句正确但不可执行的建议。** 这与 v0.38.0 修掉的那批「假安全声明」不同族
（那批是说了假话），本条是**说了真话但指向一个不存在的界面**。

### 为什么当时不修（2026-07-29 的判断，已过期）

1. 该表格路径**零测试覆盖**——正因如此这个 `return;` 才能存活至今没被发现。
   修它需要先补测试，属于新工作不是收尾。
2. 主会话当前的产品判断是：**在「20 次 `/hopper:review` 实测」跑完之前不写新机制**
   （见 test-harnessloop 的产品化方案）。改渲染器属于新机制。

---

### 影响面更正（2026-08-05）

**本 issue 原先低估了范围。** 那个 `return;` 挡住的不只是 Sandbox 列，而是
`runSetup()` 的**整份报告**：

| 被挡住的 | 后果 |
|---|---|
| Runtime / Workspace 块 | 看不到 Node 版本、平台、是否在 workspace 内 |
| verdict 行 | 看不到「几个 vendor 可用」 |
| Vendors pipe 表（含 Sandbox 列） | 本 issue 原本记录的那一条 |
| Auth notes | 看不到 keychain/session 类软告警的原文 |
| `--deep` 的 flag drift / model catalog drift | `--deep` 花了 spawn 却不显示结果 |
| **Task-type policy lint** | **见下** |
| Next steps | 看不到任何可执行建议 |

其中 **Task-type policy lint 的丢失是最贵的**：那是**唯一**会报告
`.hopper/AGENTS.md` 有没有 batch-2 机器解析列（`Effort policy` / `Model rule`）的界面。
它死掉之后，batch 2 之前 scaffold 的项目**没有任何信号**说自己需要迁移——
2026-08-05 发现一个真实项目仍停在 **v0.28.0** 的 scaffold 上，落后 18 个版本，
其 `--model` fallback 链第二级整条失效（`effective_selector: null`），
而这在故障现场被误判成「swarm 不传 model」。

### Resolution（2026-08-05）

**CLOSED — 已修。**

- 删除 `cli/bin/hopper-dispatch` `runSetup()` 里的无条件 `return;`，整份报告恢复。
- `03330ea` 合法引入的两样东西**保留并折进完整报告**，不是被替换掉：
  - 闭合 inventory 投影（`renderSafeInventory`）→ 新的 `Vendor provenance` 段
  - grok auth-context 边界声明 → 放在 Auth notes 之后
  - 每 vendor 的 `status=… auth=… auth_context=…` 行原样保留
    （`tests/unit/setup.test.js` 断言其形状——它保证本地凭证物件不会被呈现为
    远端认证证明，而表格里的 `warn` 单元格并不表达这个意思）
- **补上了本 issue 自己要求的测试**：`tests/unit/vendor-binaries.test.js` 里
  `--setup renders every section (guards the unconditional \`return;\` regression)`
  逐段断言（含 `Sandbox`），任何位置的下一个提前 return 都会在这里挂掉，
  而不是又静默发布一个月。

同批一起做的（同一次事故暴露的相邻缺口）：
`binary_availability` / `binary_basename` 此前在 `cli/src/setup.js` 里被**硬编码**成
`unknown` / `null`，现改为真实观测；新增 `--binaries` 本地诊断命令，
列出一个 vendor 名在 PATH 上解析到的**每一个**文件、dispatch 实际 spawn 的是哪个、
以及（`--deep`）各自版本。绝对路径只出现在 `--binaries`——
`--setup` / `--check` / `--models` / `--capabilities` 是 public discovery 面，
按 `tests/unit/model-attestation-contract.test.js` 的契约不得输出本地路径。

---


<a id="verifypidimage-linux-node24-comm-mismatch"></a>

## verifypidimage-linux-node24-comm-mismatch

> Archived from `ISSUE-verifypidimage-linux-node24-comm-mismatch.md`. Body verbatim.

## ISSUE (HOPPER-6b): `verifyPidImage` false-`mismatch`es on Linux under Node 24

- **Status**: FIXED in `cli/src/subprocess.js` (pending real-CI confirmation — see "Not verified" below)
- **Found**: 2026-08-03, `test (ubuntu-latest, 24)` red on `stop-job.test.js`;
  `test (ubuntu-latest, 22)` and both macOS legs green (run 30782809366)
- **Severity**: does not risk killing an unrelated process (the caller,
  `background.js:stopBackgroundJob`, treats `'mismatch'` as "never kill" — the
  safe direction). It does silently break `--stop`'s ability to actually stop
  a job it legitimately owns, on Linux, under Node 24.

### Symptom (real CI logs, not simulated)

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

### Root cause

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

### Fix

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

### Verified locally (macOS, both Node 22.22.3 and Node 24.14.1 via nvm)

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

### Not verified (honest gap)

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

---

<a id="queue-brief-dropped-without-leader-tasklist"></a>

## queue-brief-dropped-without-leader-tasklist

---

## ISSUE：queue.md 的 brief 在任务无 leader-tasklist 条目时被静默丢弃

- **发现**：2026-08-11，test-harnessloop 项目 rounds/0013 派 ★审查闸时
- **版本**：hopper 0.53.0（安装缓存 == submodule 工作区，已用 `plugin-status.sh` 确认）
- **严重度**：**高** —— 被派发的 vendor 收到一个**没有任务内容**的框架，却仍返回
  `exit 0` / `status: done` / `Task completed successfully.`
- **状态**：**CLOSED — fixed in 0.55.0**（2026-08-12，见文末「Resolution」）

### 症状

`hopper-dispatch T-090 --background`（vendor=codex）44 秒后报 `done`、`exit_code: 0`。
但 vendor 的实际输出是：

```
## Open questions
- What is the T-090 queue brief?
- Which commit or working-tree diff should be reviewed?

## Verdict
FAIL
```

### 根因

vendor 实际收到的 prompt 里，`## Task spec` 段**只有一行占位符**：

```
## Task spec

(no detailed spec found for T-090 in leader-tasklist.md; using queue.md brief only)
```

**「using queue.md brief only」这句话与实际行为不符 —— brief 并没有被拼进 prompt。**

### 机械证据（不是靠读那一行字下的结论）

| 量 | 值 |
|---|---|
| `queue.md` 里 T-090 的 brief 长度 | **959 chars** |
| vendor 实际收到的 prompt 段长度 | **2874 chars** |
| `--resolve T-090` 自报的 composed prompt length | **2868 chars** |
| 若 brief 被包含，应约为 | **3833 chars** |
| `'RAE-0001' in prompt`（brief 特征串） | **False** |
| `'no detailed spec found' in prompt` | **True** |

`--resolve` 自报的 composed 长度就等于「不含 brief」的长度 —— 说明**合成阶段就丢了 brief**，
不是传输截断。而 `--resolve` 的显示界面又**照常回显完整 Brief**，造成「看起来一切正常」的假象。

### 触发条件（对照组坐实）

| 任务 | `.hopper/handoffs/leader-tasklist.md` 中的条目数 | brief 是否到达 vendor |
|---|---|---|
| T-088 | 2 | ✅ 到达（prompt 中特征词命中 26 次） |
| T-089 | 2 | ✅ 到达 |
| **T-090** | **0** | ❌ **丢失** |

→ **仅当任务在 `leader-tasklist.md` 中没有详细 spec 时触发。**
有 spec 的路径正常，所以此前 89 个任务都没暴露它。

### 反证（确认不是环境问题）

同一 brief 改用 `--adhoc --brief "<text>"` 重派：
`Prompt: inline argv` 从 **3193B → 4753B**，brief 确实进入 prompt。
**同一 vendor、同一模型、同一 sandbox，唯一变量是走 queue 行还是走 adhoc。**

### 建议修法（两条，第二条即使不修第一条也应做）

1. **真的把 queue brief 拼进 composed prompt**（当任务没有 leader-tasklist 条目时）。
2. **若确实无法拼入，占位符文案必须诚实**——说「brief 未包含」，而不是
   「using queue.md brief only」。**静默的假陈述比缺失本身更危险**：
   `exit 0` + `status: done` + `Task completed successfully.` 三个信号全绿，
   而任务内容根本没送到。下游若不做独立核对，会拿着一份「已评审通过」的假记录收盘。

### workaround

用 `--adhoc --task-type <t> --brief "<text>"`（brief 即 spec），或先在
`leader-tasklist.md` 里为该任务补一条详细 spec。

### 相关

- 完整取证：test-harnessloop 仓
  `.harnessloop/goals/20260718-002-agent-app/rounds/0013/evidence/hopper-defect-queue-brief-dropped.md`
- 同期另记一条环境侧问题：`~/.local/bin/hopper-dispatch` 的 shim 指向已不存在的旧安装路径
  （`marketplaces/agent-hopper/...`）；现行布局下 marketplace 已是 directory source、
  缓存在 `~/.claude/plugins/cache/agent-hopper/hopper/<version>`。**shim 不在任何重指流程的覆盖范围内。**

### Resolution（2026-08-12，0.55.0）

两条「建议修法」都做了，且第 2 条不是「把文案改诚实」而是**把这段文案整个从 vendor prompt 里
拿掉**——诚实版的占位符仍然是「拿一句诊断当任务书」，只是不再撒谎。

- `loadTaskSpec()`（`cli/src/dispatch.js`）改为返回 `string | null` 并 **export**：两条未命中
  分支返回 `null`，不再返回描述自己失败的字符串；非 ENOENT 的 IO 错误仍然 throw。
- 合成在调用点做：详细 spec 在前，queue brief 跟在 `### Queue brief` 标题下并注明来源，**明写
  冲突时详细 spec 优先**。选合并而非二选一的依据是 `cli/src/tasks.js:154-155` 的执行模式守则
  第 4 条原文——「The brief and Task spec below are the complete, closed loop.」：prompt 自己
  已经承诺了两样都在。
- 诊断降级为 **operator notice**（stderr / `--resolve` 的 `  notice:` 行），不进 vendor prompt。
- **spec 与 brief 皆空 → 抛错（fail-closed）**，与 adhoc / swarm 对空 brief 的既有拒绝对齐。
  这是新增的拒绝，不放宽任何权限边界。
- 回归测试 `tests/unit/dispatch-task-content.test.js`（12 条）覆盖四种 fixture：有条目 / 文件在
  但无条目 / 文件不存在 / brief 空且无 spec；并反向断言占位符句子永不出现在 composedPrompt 中。
  `composePrompt` 的拼装形状未改动（`tests/unit/tasks.test.js` 的四条逐字节断言原样绿）。

---

<a id="stale-status-on-runner-death"></a>

## stale-status-on-runner-death

---

## Issue: runner 异常终止后，任务状态文件停在陈旧值（工作实际已完成）

**发现**：test-harnessloop，2026-08-10，任务 T-088（codex，`code-review-adversarial`）
**严重度**：中——不丢数据，但会让调用方**误判任务未完成**，进而重复派发、浪费 vendor 调用

### 现象

`--progress` 与 `T-088-output.md` 报告：

```
status: in-progress
phase:  starting
pid:    71484
```

而实际情况：

- `ps -p 71484` **无输出**——runner 进程早已不存在
- `T-088-output.log` 最后修改 **01:29:11**，查看时为 **10:32**，静止 9 小时
- **该 log 里有完整产出**：四问裁决、`## Verdict`、`## Next recommendation` 一应俱全

即：**vendor 侧工作已完成、产出已落盘，但状态文件从未被更新到终态**，`phase` 甚至停在最初的 `starting`。

### 影响

1. 调用方按状态字段判断会得出「仍在跑」，从而**无限等待**或**重复派发**（本次即差点重派第三次，每次都是真实 vendor 花费）。
2. `--watch` / `--progress` 这类基于状态文件的接口在此场景下**给出错误答案**。
3. 与本项目既有纪律「不得仅凭 exit 0 / vendor 自述 success 采信」形成对称问题：**同样不能仅凭状态字段判定任务未完成**。本次是靠人工去读 raw log 才发现的。

### 复现线索（未逐条验证，供排查方向）

同一任务先前有一次 `adapter-timeout` 失败（`duration_ms: 495138`，基线上限 300s），随后以 `--timeout 1500000` 重派。**怀疑与「重派同一 task-id 时状态文件的接管/覆盖」或「runner 被信号终止时缺少 finalize」有关**——两者都会导致终态写入被跳过。

### 建议方向（不预设实现）

- runner 退出路径（含被信号杀死）加 finalize，至少把 `status` 落成 `failed`/`unknown`，而不是留在 `in-progress`
- `--progress` / `--watch` 在读到 `status: in-progress` 时，**交叉核对 `pid` 是否存活**；进程不存在则报「状态陈旧」而非「仍在运行」
- 若 raw log 已含终态标记（如 `## Verdict`），可据此提示「产出可能已完整，请核对 raw log」

### 与既有 issue 的区别（已核对，非重复）

`ISSUE-progress-watch-hang.md`（2026-06-17）讲的是**测试文件本身挂起**——`tests/unit/progress-watch.test.js` 让 `npm test` 不终止。
本 issue 讲的是**运行时状态文件在 runner 死后不落终态**，两者根因与影响面不同，仅同属 progress/watch 面。

### 归档说明

本文件按 hopper 仓既有惯例（`ISSUE-*.md`）落在仓库根，与 `ISSUE-codex-review-hijack.md`、`ISSUE-resolve-ignores-vendor-override.md` 等并列。**未修**，仅登记。

---

<a id="queue-brief-truncated-by-unescaped-pipe"></a>

## queue-brief-truncated-by-unescaped-pipe

---

## ISSUE：queue.md 的 brief 含未转义竖线时被静默截断，且可静默派给"看起来正确"的 vendor

- **版本**：hopper 0.55.0（发现于 brief-drop 修复轮的复审派发过程中）
- **严重度**：中高——**vendor 收到一份被截断的任务书，无任何报错**。与 `queue-brief-dropped-without-leader-tasklist`（已修）是**同一个失败形状**：看起来有任务，实际不是完整的那份
- **状态**：**Open — 未修，仅登记**

### 现象

`cli/src/queue.js` 的列解析按**下标**取值（`cells[map.briefIdx]`、`cells[map.vendorIdx]`），
表头 7 列，行若因 brief 内含字面量 `|` 而切出 8 个及以上 cell 时，**多出来的部分被直接丢弃**，
不做任何列数校验。

### 实测（三个对照，2026-08-12）

表头固定为 `| ID | Task-type | Status | Depends | Priority | Brief | Vendor |`：

| 行内容（Brief 段） | 解析出的 brief | 解析出的 vendor | 是否报错 |
|---|---|---|---|
| `请审查 foo 的 bar 行为`（无竖线，对照） | `"请审查 foo 的 bar 行为"` | `"codex"` | 否 ✅ |
| `形态举例 \| T-1 \| 表格行` | `"形态举例"` | `"T-1"` | **是**——`E_VENDOR_NOT_APPROVED` |
| `前半段任务 \| codex \| 后半段被吃掉的关键要求` | `"前半段任务"` | `"codex"` | **否** ❌ |

**第三行是静默失败**：brief 只剩前半段、后半段的关键要求被吃掉，vendor 解析成 `codex`
（已批准），于是**照常派发**。

### 为什么第二行响了而第三行没响

拦下第二行的是 `.hopper/AGENTS.md` 的 Approved Vendors 守卫（`agents.js:351`
`assertVendorApproved`）——它拦的是"vendor 名不认识"，**不是"brief 被截断"**。
所以这层保护是**碰巧生效**，不是针对本问题的防御：只要竖线之后恰好是一个已批准的
vendor 名，就完全静默。

### 建议的修法

**列数校验，fail-closed**：行的 cell 数与表头列数不等时拒绝该行并报明确错误
（"row has N cells, header declares M — brief 里的 `|` 需转义为 `\|`"），
而不是按下标静默取值。

对照本项目已反复确认的原则：**清单会过时，发现式守卫不会**——按下标取值属于"假定输入合规"，
列数校验属于发现式守卫。

### 发现经过

主会话给 T-102 复审写 brief 时，为举例三种 marker 形态而在 brief 里写了字面量
`| T-1 | … |`，派发直接失败。追查后才发现失败是碰巧的。
**这条本身就是 T-102 的 Q3「同一形状还有没有第三处」的答案——只不过它不在 `dispatch.js`，在 `queue.js`。**

---

<a id="task-spec-structural-only-body-accepted"></a>

## task-spec-structural-only-body-accepted

---

## ISSUE：leader-tasklist 小节的"正文"只有结构性标记时仍被当作有效 spec

- **版本**：hopper 0.55.0（由 T-102 复审的 grok 一路实跑发现；登记前已用真实 `loadTaskSpec` 复核，见下）
- **严重度**：低——需要人写出这种 leader-tasklist 才会触发，但**失败形状与已修的两处完全相同**
- **状态**：**Open — 未修，仅登记**

### 现象

`loadTaskSpec()` 的 fail-closed 判据是「匹配 marker 之后有无非空白正文」
（`cli/src/dispatch.js:380-381`：`afterMarker.trim().length > 0 ? section : null`）。
一个正文只有结构性标记（如 `---` 分隔线、空表格骨架 `|---|---|`、单个 `>` 引用符）的小节，
**非空白，因此被判为有效 spec 并派发**——vendor 拿到一份没有任务内容的任务书。

### 实测复核（2026-08-12，登记前用真实代码验证，非转述）

直接调用 `loadTaskSpec` 对四个 fixture 小节验证（`otherTaskIds` 传全部四个 id 以确保边界正确）：

| 小节正文 | `loadTaskSpec` 返回值 |
|---|---|
| `---` | 非 null —— `"## T-1\n\n---"` |
| `\|---\|---\|` | 非 null —— `"## T-2\n\n\|---\|---\|"` |
| `>` | 非 null —— `"## T-3\n\n>"` |
| `Real content line.`（对照） | 非 null —— `"## T-4\n\nReal content line."` |

三个「仅结构性标记」的正文全部被接受为有效 spec，返回值形状与「真有内容」的对照组完全一致——
证实了本条问题的判断，不是猜测。

### 与已修两处的关系

这是**同一族的第三个实例**：

| # | 实例 | 状态 |
|---|---|---|
| 1 | 无 leader-tasklist 条目时返回自述文案冒充 spec | 已修 0.55.0 |
| 2 | 裸 marker（`## T-1` 光标题没正文）非空 → 冒充 spec | 已修 0.55.0 |
| 3 | 正文只有结构性标记 → 冒充 spec | **本条，未修** |

共同形状：**「看起来有内容」与「真的承载了任务」被当成了同一件事。**

### 建议的修法

判据从「有非空白字符」收紧为「去掉纯结构性标记后仍有实质内容」。
需要注意不要过度收紧——正文里合法包含表格或分隔线的 spec 必须仍被接受，
判据应是「**除了**结构性标记之外还有别的」，不是「不含结构性标记」。

---

<a id="composeprompt-no-fail-closed-on-empty-spec"></a>

## composeprompt-no-fail-closed-on-empty-spec

---

## ISSUE：`composePrompt` 对空/纯空白 taskSpec 没有 fail-closed，只靠上游拦截

- **版本**：hopper 0.55.0（T-102 复审的 grok 提出，`cli/src/tasks.js:169`；登记前已核对行号与实测输出，见下）
- **严重度**：低——当前 `dispatch.js` 已在上游拦住，属纵深防御缺失而非活跃缺陷
- **状态**：**Open — 未修，仅登记**

### 现象

`composePrompt(frameContent, taskSpec, …)` 不校验 `taskSpec` 是否为空或纯空白，
直接拼进「## Task spec」一节（`cli/src/tasks.js:169`：
`` parts.push(`## Task spec\n\n${taskSpec.trim()}`); ``）。**当前唯一的防线在 `dispatch.js` 的
`composeTaskContent()`**，即任何绕过该函数直接调用 `composePrompt` 的新调用点，都会重新打开
0.55.0 刚堵上的洞。

### 实测复核（2026-08-12，登记前用真实代码验证，非转述）

直接调用 `composePrompt('# Frame', '')` 与 `composePrompt('# Frame', '   \n  ')`：两次调用都
**未抛错**，都正常返回一份完整 prompt，其中「## Task spec」小节之后没有任何内容
（`...## Task spec\n\n\n`）。确认没有任何 empty/whitespace 守卫。

### 为什么本轮没修

`cli/src/tasks.js` 被 `tests/unit/tasks.test.js` 的 **4 条逐字节 `assert.equal`**
（`:130`/`:138`/`:150`/`:155`）锁死拼装形状，本轮修复的既定约束是**一字不改该文件**。

注：在函数入口加 fail-closed 抛错**不会**改变合法输入的拼装结果，
因此理论上与那 4 条断言不冲突——是本轮的 scope 约束，不是技术阻碍。留待独立一轮评估。

---
