# hopper-plugin Agent Instances (v2.0 schema — task-based binding)

Generated: 2026-05-20T00:00:00+08:00
Schema: llm-hopper v0.3 + task-based amendment (v2.0 spec, 2026-05-20)
Direction: dev (TypeScript/Node CLI + Claude Code plugin + 5 vendor adapters)

---

## Approved Vendors

<!-- 本项目允许派发的 vendor。未列或 Approved=no 的一律拒绝，--vendor 覆盖也不例外。 -->

<!-- `Default model`（可选）：本项目里「未指定模型的派发」该用哪个模型。留空或 `-` = 用 hopper
     出厂的该 vendor 偏好（`hopper-dispatch --capabilities <vendor>` 会打印当前生效值及来源）。
     填上它用于：(a) 表达项目偏好；(b) vendor 已发新模型但 hopper 预设还没跟上时，不必等 hopper
     发版。优先级：`--model <id>` > `HOPPER_<VENDOR>_MODEL` > 本列 > 适配器预设。 -->

| Vendor | Approved | Approved by | Date | Default model | Scope / Notes |
|---|---|---|---|---|---|
| `codex` | yes | user | 2026-08-03 | - | 对抗/验收评审。与 test-harnessloop 的 vendor 角色一致。 |
| `grok` | yes | user | 2026-08-03 | - | 对抗/验收评审 + 研究。同上。 |
| `pi` | yes | user | 2026-08-10 | - | 本次新增的 vendor（`cli/src/vendors/pi.js`）。多 provider 路由，本机登录的是 `openai-codex`；hopper **不预设模型**（平台型 router），未钉时警告并列出 provider id；`--thinking xhigh`（pi 的 thinking 枚举是 hopper 五档的超集，**不需要 clamp**）。read-only 走 pi 的工具白名单 `--tools read,grep,find,ls`——真能拿掉 bash/edit/write，但**不是 OS 沙箱**（pi 自带沙箱为无），macOS 上需要内核级只读时请叠加 `--subject-root`。`workspace-write` 会被**拒绝**（`E_PI_WORKSPACE_WRITE_UNENFORCEABLE`）：pi 没有按路径的权限模型，认下来就等于静默给了完全主机访问。宿主隔离**两半都要**：`--no-*` flags 之外还必须换掉 `PI_CODING_AGENT_DIR`——pi 会把配置目录里的 `SYSTEM.md` / `APPEND_SYSTEM.md` 折进 system prompt，没有任何 flag 能关（2026-08-10 实测复现并已修）。 |

**为什么这一节在 2026-08-03 才补上。** v0.40.0（2026-07-31）把 `.hopper/AGENTS.md`
从路由表升级为 **fail-closed 白名单**：缺这一节 ⇒ 拒绝一切 dispatch，`--vendor` 覆盖也拒。
本文件生成于 2026-05-20，**早于该变更**，于是 hopper 自己的 dogfood 项目从 v0.40.0 起
一直派不出任何任务（`E_APPROVED_VENDORS_SECTION_MISSING`），直到本次审计实跑才发现。
这正是 `MIGRATION.md` 要覆盖的场景——**每一个 v0.40.0 之前建的项目都有同样的问题**。

下面 `## Active Agent Instances` 里仍登记着 `kimi` / `opencode` / `copilot` / `agy`，
是历史记录，**不代表批准**——本表才是执行点，那几家现在会被拒。

---

## Schema change (v2.0, 2026-05-20)

Previous schema bound `nickname → role → model`. v2.0 binds **`nickname → vendor` + optional `task-vendor-preference`**. The role layer is removed because v2.0 spec §3 #5 makes dispatch task-type-driven instead of role-driven. See `llm-hopper/.hopper/USAGE-GUIDE.md` §3.4 for the principle.

---

## Active Agent Instances

| Nickname | UUID | Vendor | Default invocation | Notes |
|----------|------|--------|-------------------|-------|
| `strategy-primary` | `825ab5bf-84c6-484b-b144-3e5e37595054` | claude-code-tui (Claude Opus 4.7) | (interactive only) | Observer/supervisor; not dispatched by plugin |
| `codex-builder` | `2620cc7a-25e6-4059-999e-17af54bdcaf4` | codex-cli (gpt-5.5-xhigh) | `codex exec -s read-only -c 'model_reasoning_effort="xhigh"'` (resolved by T-PLUGIN-00) | Sticky Leader-equivalent from myWriteAssistant |
| `kimi-builder` | `6c5ac7fa-7a5e-40b4-920a-b4fe1d562876` | kimi-cli (Kimi Code 0.x) | `kimi -p "<input>" [-m <alias>] [--session <id>]` | Kimi Code 0.x removed `--print` / `--afk` / `--final-message-only`; `-m` now takes a config alias key, not an upstream model ID. |
| `opencode-builder` | `6db17b47-ba7f-4a16-8890-832ce18c43cb` | opencode (pin 0.14.7) | `opencode run --model <provider/model> "<input>"` | New; pin version per known regression #3213 |
| `copilot-builder` | `7a1c4d50-3b8e-4f2a-9c11-d4e3f8a9b234` | copilot-cli (Sonnet 4.5 default) | `copilot -p "<input>" --headless` (with `GH_TOKEN` env) | Premium quota meters per call — use sparingly |
| `agy-builder` | `9e2f1a3d-7b4c-4d8e-a1f6-c3b2d9e4f567` | agy-cli (Antigravity; Google's 2026-06-18 Gemini successor) | `agy -p "<input>" --dangerously-skip-permissions` + `--log-file <path>` | ⚠️ **DISABLED by default (2026-06-26)** — agy 1.0.12 `--print` renders the answer only in its interactive TUI; under a non-TTY stdout (every dispatch) it emits nothing capturable, so hopper REFUSES to dispatch to agy. Override at your own risk with `HOPPER_ENABLE_AGY=1`. A PTY fix is excluded (agy hangs on an open stdin pipe). OAuth-only; run `agy` interactively once to auth. |
| `grok-builder` | `-` | grok-cli | `grok -p "<input>"` | 2026-08-05 补登记。grok 自 2026-08-03 起在 `## Approved Vendors` 里是 `yes`，却从未有实例行——于是任何指向它的 task-type 都解析不到 vendor。read-only 非 argv 强制（恒 `--permission-mode bypassPermissions`），只读任务事后须 `git status` 核对。 |
| `pi-builder` | `-` | pi | `pi -p --mode json --model <provider>/<model> --thinking xhigh` | 2026-08-10 随适配器一起登记——**先登记再批准**，避免重演第 45 行 grok 那次「Approved=yes 但无实例行 ⇒ 指向它的 task-type 解析不到 vendor」。上面 `## Approved Vendors` 才是执行点。 |
| `critic-claude-opus` | `b3d5e7f9-1a2c-4e8a-b9c1-d4e6f8a9c123` | claude-opus-xhigh (fresh subagent) | (Strategy invokes /codex separately, OOB; not a queue role) | Adversarial review |

---

## Task-type → vendor default preference

<!-- hopper-scaffold-version: 0.50.0 -->
<!-- 本文件生成于 2026-05-20，已两次落后于插件自身 schema（v0.40.0 的 Approved Vendors、
     batch 2 的 Effort policy / Model rule）。上面这行水印用于让 `--setup` 能比对。
     升级插件后跑 `hopper-dispatch --setup` 看 "Task-type policy" 段。 -->

Plugin routes by Task-type + this table. queue.md row may override via optional `Vendor` column (not used in initial queue).

> **2026-08-05 审计更正（dogfood 自查）。** 这张表有两类问题，都是「本插件自己的
> workspace 落后于本插件自己的 schema」——和 2026-08-03 补 `## Approved Vendors`
> 是同一类事故的第二次发作：
>
> 1. **缺 `Effort policy` / `Model rule` 两列**（hopper batch 2，2026-07 引入）。
>    `cli/src/agents.js` 把这两列做成可选、缺失即静默跳过，所以 `--reasoning` /
>    `--model` 的 fallback 链第二级一直是死的。之所以一个月没人发现，是因为唯一会
>    报告它的界面——`--setup` 的 Task-type policy lint——本身也是 dead code
>    （见 [`setup-sandbox-column-dead-code`](../docs/archive/ISSUES.md#setup-sandbox-column-dead-code)）。**两个缺陷互相遮蔽。**
> 2. **`code-impl` / `sidecar-polish` 路由到 `kimi-builder`，而 kimi 在
>    `## Approved Vendors` 里是 `no`** ⇒ 自 v0.40.0 fail-closed 以来这两条必然被拒；
>    `code-review-adversarial` 的 `(Strategy OOB /codex)` 是括号开头，按 OOB 约定
>    解析为 **unbound**，派发会直接报错。现改为只指向已批准的 codex / grok。

| Task-type | Default vendor | Effort policy | Model rule | Why |
|---|---|---|---|---|
| `spec-write` | codex-builder | codex:xhigh, grok:high | verified-latest | High reasoning; sticky from spec-writing experience in myWriteAssistant |
| `code-impl` | codex-builder | codex:xhigh, grok:high | verified-latest | 静态默认，无 round-robin / 有状态轮换（codex F1）。原为 kimi-builder，但 kimi 未获批准 ⇒ 必被拒；按行覆盖仍可用 queue.md 的 `Vendor` 列 |
| `code-review-adversarial` | grok-builder | codex:xhigh, grok:high | verified-latest | 已批准的对抗评审 vendor；原 `(Strategy OOB /codex)` 解析为 unbound |
| `code-review-acceptance` | codex-builder | codex:xhigh, grok:high | verified-latest | Continuity with sticky Leader pattern |
| `sidecar-polish` | codex-builder | codex:medium, grok:medium | verified-latest | 卫生检查用低成本档；原 kimi-builder 未获批准 |
| `spec-blindspot-hunt` | grok-builder | codex:xhigh, grok:high | verified-latest | 未知的未知需要高推理，且应与撰写者异构（host = Claude Code） |

**关于 `Model rule: verified-latest`。** 它解析为该 vendor 适配器**显式声明**的
`hopperDefault`（v0.54.0 起；此前是从 `knownGood[0]` 推断，那个推断会把 claude 静默钉成
`sonnet`——它的 knownGood 是无序 alias 集合——从而降级 opus 账号）。codex 声明的是
`gpt-5.6-sol`，**要求 codex CLI ≥ 0.144**；**pi 声明 `null`**（它是平台型 router，用户可能
跑 gpt / claude / kimi / qwen，hopper 不替你猜——未钉时会警告并给出 provider id 清单）；
claude 是 `opus`（刻意钉顶档：经 hopper 派发的是评审/裁决，值这个成本；⚠ 若账号没有 opus
权限会直接失败，用下面的 `Default model` 列或 `HOPPER_CLAUDE_MODEL` 覆盖）。当前生效值用
`hopper-dispatch --capabilities <vendor>` 查，要覆盖就填上面 `## Approved Vendors` 的
`Default model` 列。

> 2026-08-05：本开发机一度有两份 codex，`codex` 在 PATH 上首先解析到 **0.131.0**
> （`~/bin/codex*` 手写 shim 指向旧的独立 node 安装），而 nvm4w 的 0.146.0 排在后面
> ——于是 codex 派发对该模型报 400，症状看着像账号或能力问题。**已修**：删除那两个
> shim，并把旧 npm-global 的 `@openai/codex` 对齐到 0.146.0。现在 hopper 与交互式
> shell 都是 0.146.0。
>
> 这类问题用 `hopper-dispatch --binaries --deep` 一眼可见（v0.47.0 新增）；
> `--setup` 的 Vendor binaries 段也会给出无路径摘要。

---

## Role Permissions Summary (legacy, retained for backwards-compat reference)

v2.0 dropped role binding but the conceptual permissions still describe "what behaviors are acceptable in each task-type":

- **Strategy task** (long-horizon decisions): no queue push, no code edits, file-protocol only — handled by user-via-Claude-Code-interactive
- **Builder task** (code-impl / spec-write): full design + execution from spec
- **Critic task** (code-review-adversarial / code-review-acceptance): review-only, no code edits

---

## Cross-audit binding (per goal directive 2026-05-20)

Two triggers auto-invoke `/codex` GPT-5.5 xhigh as adversarial second opinion:
1. **New proposals**: any new dispatch handoff, spec revision, architectural decision
2. **Phase completion**: any T-PLUGIN-XX task done

Strategy invokes codex via `codex exec` with `model_reasoning_effort="xhigh"`. Codex is NOT in queue.md as a task; it is an out-of-band audit layer.

---

## Reassignment

Edit this file + update `.hopper/MANIFEST.md` together. UUIDs persist across model swaps; vendor binding may change per phase if a vendor proves unsuitable.

If a vendor adapter (T-PLUGIN-05x) fails its spike or implementation, mark the corresponding builder as `vendor: deferred-until-post-essay` and remove from task-vendor-preference table.
