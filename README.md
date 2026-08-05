![hopper-plugin banner](docs/assets/banner.png)

# hopper-plugin

> Vendor-neutral background dispatch for AI agents

![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-0.49.1-3DDC97)
![Tests](https://img.shields.io/badge/tests-passing-3DDC97)
![Hosts](https://img.shields.io/badge/hosts-7-111827)

> 🇬🇧 [English](README.en.md) ・ 🇯🇵 [日本語](README.ja.md)

## 它是什么

多个 vendor CLI 各有自己的账号、鉴权方式、沙箱行为和输出格式——直接手拼命令行,每跑一次
后台任务就要自己维护"它跑完了没""输出在哪""失败了要不要人工看"这几件事,而且**跨宿主不通用**。

hopper-plugin 是 llm-hopper 文件协议之上的一层瘦插件。它让 Claude Code、Codex CLI、
OpenCode、Copilot CLI、Grok Build、Cursor CLI,或者一个 standalone shell(共 7 类宿主),
把任务类型化的工作派发给 codex、kimi、opencode、copilot、agy、grok、mimo、claude 这些
vendor CLI。状态全部落在 `.hopper/` 下的 markdown 与 JSONL 文件里——**没有隐藏数据库,
没有 harness 反应核心,也没有自动 vendor 重试或 fallback**。

**产品实际支持的 vendor 只有四家:`codex` / `grok` / `claude` / `kimi`**(2026-07-31 产品
决策)。其余四个 adapter(`agy` / `copilot` / `mimo` / `opencode`)仍注册在代码里、
`--vendors` 仍会把全部 8 家列出来,但它们不在当前建议的使用范围内——具体分层与执行点见
下面「两层 vendor 控制」与「主机与 vendor 支持矩阵」。

![hopper-plugin architecture](docs/assets/architecture.svg)

7 类宿主的调用都收敛到 `hopper-dispatch`。分发器读 `.hopper/queue.md` 与
`.hopper/AGENTS.md`,解析出 vendor,并强制一条**同族隔离**——判据是
`VENDOR_FAMILY`"族"比较(`cli/src/validation.js`):`claude` / `claude-code` → anthropic、
`codex` → openai、`grok` → xai、`kimi` → moonshot;`copilot` / `opencode` / `mimo` / `agy`
是多后端路由器,刻意不归族。族相同就拒绝派发,防止一个宿主把任务转派回自己同一账号体系。
后台任务由 `hopper-runner` 拉起,dashboard 是同一份 `.hopper/` 状态的只读消费者。

## 什么时候用它 / 什么时候别用

**Hopper 对结果负责，不对过程负责。** 它是单次 spawn、无重试、无 fallback；vendor 在
独立进程里跑，不共享你的上下文，中途无法转向——追问就是一次新的派发。

派发前问两个问题，任一不过就自己做：

1. **这个答案你自己能算出来吗？** 能——自己做。源码摘要、提交记录、文件检索、版本号
   都是确定性查询，走一次派发要花几分钟和几美元，换回来一个**更不可靠**的答案。
   （实测：一次评审派发 5m16s / 153 万 token / $0.74；被它对比的那条 `git log` 是 40ms。）
2. **现在能不能把整个问题说完？** 不能——那是探索性工作，而探索需要的引导正是
   单次派发给不了的。

两问都过，再看**独立性是不是价值来源**：你要的是一个不共享你的上下文、先验和错误的答案吗？

判据是**交付物**，不是主题。代码评审**必须**读源码——那是手段，交付物是判断，该派发；
「这个模块干了什么」也读源码，但交付物是你自己就能产出的数据，不该派发。

**「不该派发」的那些场景没有对应的 task-type，这就是执行面**——不需要任何东西去猜你
brief 的意图。完整论述见 [`docs/WHEN-TO-USE.md`](docs/WHEN-TO-USE.md)，
`hopper-dispatch --task-types` 会按类型打印同样的「用于/不用于」。

## 两层 vendor 控制

一次 dispatch 能不能发出去,要过两层独立的关卡——两层都过才算数:

**底层:这台机器上装了什么、认证了没有。** `hopper-dispatch --setup`(doctor)扫描本机
已安装、已认证的 vendor CLI,报告 Installed / Auth / Sandbox / WebSrch / Models 等
(`/hopper:setup`)。这是能力层——回答"这台机器上这个 vendor 能不能用"。

**上层:这个项目批准把任务派给谁。** `.hopper/AGENTS.md` 的 `## Approved Vendors` 表决定
**这个项目**允许 dispatch 给哪些 vendor。**fail-closed**:这一节缺失,或者某个 vendor
不在表里 / 状态不是 `yes`,一律拒绝派发——**包括显式的 `--vendor` 覆盖**,错误码分别是
`E_APPROVED_VENDORS_SECTION_MISSING`(整节缺失)与 `E_VENDOR_NOT_APPROVED`(有节但没批这家)。

这是 v0.40.0 新加的项目级白名单。在这之前,`Notes` 列里的"入选/未入选"标注只是文字说明,
代码从不读它——`--vendor` 传一个已注册的 vendor 就能派,跟项目实际批没批准无关。

两层目前**互不引用**:`hopper-dispatch --setup` 的报告里看不到 Approved Vendors 的状态,
`commands/setup.md` 与 `skills/hopper-setup/SKILL.md` 两份文档里连"Approved"这个词都没
出现过;Approved Vendors 表里也看不到本机装了什么。底层回答"能不能",上层回答"许不许",
读的是两份不同的文件。

## 它做不到什么 / 安全边界的真实情况

这一节不是免责声明。以下每一条都是为了不让这份 README 的可信度建立在吹嘘上。

- `read-only` 是任务类型携带的**请求**,不是保证——它由 executor prompt frame 传达,
  是否变成真正的操作系统边界,**取决于 vendor 与平台**。
- **grok 恒为 `bypassPermissions`**,与平台无关(`cli/src/vendors/grok.js`,全文件没有
  任何平台分支)。
- **codex 按平台分叉**:macOS / Linux 上,codex 自己的 `-s <mode>` 沙箱是真的——一次写
  操作会真实失败,返回 `operation not permitted`。**Windows 上 codex 的 `-s` 沙箱根本
  起不了子进程**,所以那里总是走 `--dangerously-bypass-approvals-and-sandbox` 全放开,
  不管请求的是什么模式。`HOPPER_CODEX_SANDBOX_BYPASS` **按平台反极性**:Windows 上
  `=0` 关闭 bypass,macOS / Linux 上 `=1` 开启 bypass——两个平台上默认值本来就相反,这
  个变量只是分别给了一个开关。
- 上面「两层 vendor 控制」之外,还有一条独立的**同族隔离**守卫(旧文档与 `--help` 里
  把它写作 `host != vendor`,**那个写法本身有误导性**:按字面读 `'claude-code'` 与
  `'claude'` 永不相等,会得出"这守卫恒成立、等于没有"的反结论,而这恰恰是它要拦的那一对)。它在
  Claude Code 下**曾经空转过约两个月**(2026-06-03 引入声称 ~ 2026-07-31 修复,见
  v0.39.0):`HOPPER_HOST_VENDOR` 这个环境变量从来只由 5 个 Tier-C bash 宿主 wrapper 设置,
  Claude Code 会话里从未被设置过,守卫自己"没有 hostVendor 就跳过"的分支悄悄吞掉了检查;
  就算补上这个值,当时的判据还是裸字符串相等,`'claude-code' === 'claude'` 永远是
  false,追不上它本该拦的那一种情况。v0.39.0 起改成按 `VENDOR_FAMILY` 族比较,**现在才
  真的成立**——不要把它读成"这条守卫一直有效"。
- 不自动重试、不自动切 vendor、不做 fallback——一次 spawn 就是一次 spawn。
- **Windows 上 vendor 探测缓存不可用。** 该缓存含探测诊断信息,写入前必须先把目录
  和文件加固成 owner-only。POSIX 上这是 `0700`/`0600`,能真正做到;Windows 上做不到——
  实测(2026-08-03,GitHub Actions `windows-latest`)加固后 `NT AUTHORITY\SYSTEM` 与
  `BUILTIN\Administrators` 仍持有完全控制,而 Administrators 无论如何都能夺取所有权。
  **hopper 选择 fail-closed:做不到 owner-only 就拒绝写缓存**,而不是把断言放松到
  「这几个主体不算数」。代价是 Windows 上每次都要重新探测 vendor 能力,不能复用缓存。
  这条限制此前一直存在且**从未生效过**(加固实际没起作用、断言也从没被执行过),
  是本仓第一次接上 CI 才发现的。
- 权威来源是 `hopper-dispatch --rules`(会写进 `.hopper/DISPATCH.md`)。**本 README 里
  的表和描述都是快照,会漂**——真正要做判断前,以 `--rules` 现场跑出来的为准。

## 快速开始

新项目 / 新 agent 第一次接入,完整链路是这样,中间任何一步跳过都会在下一步撞墙:

```bash
# 0. 装好插件后,先看这台机器上有什么 vendor CLI、装没装、认证了没有(doctor)
hopper-dispatch --setup

# 1. 在项目里建 .hopper/ 工作区——queue.md / AGENTS.md / COST-LOG.md / DISPATCH.md /
#    handoffs/leader-tasklist.md,加上 8 个 tasks/*.md 任务类型模板,共 13 个文件
hopper-dispatch --init-tasks

# 2. 打开 .hopper/AGENTS.md,把要用的 vendor 填进 `## Approved Vendors` 表、标 yes
#    —— 不填这一步,后面所有 dispatch 都会被 fail-closed 拒绝,见上面「两层 vendor 控制」

# 3. 在 .hopper/queue.md 里写一行任务,然后派发
hopper-dispatch T-PROG-AUDIT --background

# 查看进度 / 取结果
hopper-dispatch --progress T-PROG-AUDIT
hopper-dispatch --result   T-PROG-AUDIT
```

Claude Code 里用等价的 slash command:

```text
/hopper:dispatch T-PROG-AUDIT --background
```

## 选模型与推理档位

`--model` 和 `--reasoning` 是**两个独立的旋钮**——不要把它们拼进同一个字符串。
`gpt-5.5-xhigh` 是错的:那是把一个模型名(`gpt-5.5`)和一个推理档位(`xhigh`)粘在一起,
vendor 会把它当成未知模型拒绝。应该分开设置:

不确定一个模型名是不是真的存在、又不想为此白花一次 dispatch?`--check-model` 是零 spawn
的断言:`hopper-dispatch --check-model codex gpt-5.5-xhigh` 能按名字识别出上面那种拼接
错误(专门的 `effort-spliced` 判定,exit 1),不用等它当成一个 400 打到 vendor 那边才发现。

```bash
# 只设置 reasoning——model 用账号默认值
hopper-dispatch T-PROG-AUDIT --background --reasoning xhigh

# model 和 reasoning 都设置,两者独立
hopper-dispatch T-PROG-AUDIT --background --model gpt-5.4-mini --reasoning high

hopper-dispatch --progress T-PROG-AUDIT
hopper-dispatch --result   T-PROG-AUDIT

# Claude Code 里等价的 flag:
# /hopper:dispatch T-PROG-AUDIT --model gpt-5.4-mini --reasoning high
```

- `--model <name>` —— vendor 自己的 model id。**省略则用账号默认值。**
- `--reasoning <minimal|low|medium|high|xhigh>` —— 推理强度。**默认 `xhigh`**;
  全局默认值可以用 `HOPPER_DEFAULT_REASONING` 改。

不是每个 CLI 都同时暴露这两个旋钮。各家 vendor 实际支持的情况:

| vendor | `--model` | 推理档位(`--reasoning`) | 说明 |
|---|---|---|---|
| codex | `-m` | ✓ | **只认裸名字**:`gpt-5.5`、`gpt-5.4-mini`、`gpt-5.3-codex-spark`。带 provider 前缀的 id(`openai-codex/…`)在 ChatGPT 账号下会被拒绝。 |
| grok | `-m` | ✓ | 枚举 low/med/high;`xhigh` 会被 clamp 到 `high`。 |
| mimo | `--model` | ✓ | `xhigh` → `--variant max`。**不在产品支持范围**(2026-07-31 决策)——见下文。 |
| copilot | `--model` | ✓ | 枚举 low/med/high;`xhigh` 会被 clamp 到 `high`。原始覆盖值:`HOPPER_COPILOT_EFFORT`。**不在产品支持范围**(2026-07-31 决策)——见下文。 |
| opencode | `--model <provider/model>` | 仅显式传入才生效 | 调用方传的 `--reasoning high` 会变成 `--variant high`;Hopper 故意不给 OpenCode 发默认的 `xhigh`,以保持 provider 兼容。`HOPPER_OPENCODE_VARIANT=<v>` 可以原样覆盖它。**不在产品支持范围**(2026-07-31 决策)——见下文。 |
| kimi | `-m` | — | `kimi -p` 没有逐次调用的 effort flag。 |
| claude | `--model` | — | `claude -p` 没有 effort flag。 |
| agy | — | — | ⚠️ **默认技术禁用** 且 **不在产品支持范围**(2026-07-31 决策)——见下文。 |

上面这张表是一份快照。**权威、不会漂**的版本是直接从 adapter 现场生成的——用它们查你这台
机器 / 这个账号的实时真相:

```bash
hopper-dispatch --rules                 # 完整矩阵(同时写进 .hopper/DISPATCH.md)
hopper-dispatch --capabilities codex    # 单个 vendor 的 model/effort/perms 契约
hopper-dispatch --probe codex           # 你这个账号的实时 model 目录
hopper-dispatch --check-model codex gpt-5.5   # 派发前断言一个模型:verified(0) | catalog-only(2) | not-found(1)
```

用环境变量调优:

| 变量 | 效果 |
|---|---|
| `HOPPER_DEFAULT_REASONING` | 全局 effort 默认值(否则是 `xhigh`)。 |
| `HOPPER_COPILOT_EFFORT` | 原始 copilot `--effort` 值(比如 `max`);`""` 表示不传这个 flag。 |
| `HOPPER_OPENCODE_VARIANT` | 优先级最高的原始 OpenCode `--variant` 覆盖值;由 provider/model 校验合法性。 |
| `HOPPER_GROK_EFFORT` | 原始 grok `--effort` 值;`""` 表示不传这个 flag。 |

对 OpenCode,只有在所选 provider/model 文档明确支持某个 variant 时才应该指定:

```bash
# OpenCode 实际收到: opencode run ... --variant high
hopper-dispatch T-PROG-AUDIT --background --vendor opencode --reasoning high
```

`--reasoning` 省略时,Hopper 对其他 adapter 保留通用的有效默认值,但对 OpenCode 故意**不**
发送任何 `--variant`;tokenbox / DeepSeek 这类自定义 provider,没有 Hopper 验证过的
variant 契约。

派发权限默认是 `danger-full-access`,好让实现类任务能改文件。如果任务 brief / spec 里写了
`read-only` / `只读`,hopper 会自动把 vendor 沙箱降级到 `read-only`;可以用
`--sandbox <read-only|workspace-write|danger-full-access>` 覆盖。这个降级只是一个**请求**,
是否变成真正的操作系统边界取决于 vendor 与平台——完整的诚实版本见上面「它做不到什么 /
安全边界的真实情况」一节。

## 后台派发与观察

```bash
hopper-dispatch T-PROG-REVIEW --background
npm run dashboard:build
npm run dashboard:start
# 打开 http://127.0.0.1:7777,选中该任务的 Progress 标签
```

![hopper-plugin background dispatch data flow](docs/assets/data-flow.svg)

一次后台 dispatch 会写 `output.md`、`output.log`、`progress.log`。runner 在执行过程中
持续追加 progress JSONL 事件,vendor 退出时追加**恰好一条**终态事件。`--progress`、
`--watch-events`、Claude 的 monitor、系统 toast,以及 dashboard 的 SSE,读的都是这同一份
文件状态。

Claude Code 用户还能通过插件 monitor 拿到终端事件。Standalone 和 Codex CLI 用户可以保持
一个 watcher 常驻:

```bash
hopper-dispatch --watch-events
```

**跨宿主等价性**:同一个任务 ID,不管从哪个宿主发起,解析走的都是同一套 `.hopper/` 路由表:

```bash
hopper-dispatch --resolve T-PROG-REVIEW
# Claude Code: /hopper:dispatch T-PROG-REVIEW --background
hopper-codex T-PROG-REVIEW --background
hopper-opencode T-PROG-REVIEW --background
```

## 命令与 skills

| 命令 | 作用 |
|---|---|
| `/hopper:dispatch` | 把任务派发给它的首选 vendor(`--vendor` 覆盖路由;`--result <id> --full` 看完整长输出)。 |
| `/hopper:review` | 一次性的只读\* 代码评审,针对 diff/path/PR(临时任务,不进 queue.md)。 |
| `/hopper:research` | 一次性的、带联网搜索的产品/功能研究(临时任务,只读\*)。 |
| `/hopper:market` | 一次性的、带联网搜索的市场/竞品研究(临时任务,只读\*)。 |
| `/hopper:swarm` | 把一个定性任务分发给 N 个 vendor 组成的评审小组(确认 → 并行 → 综合)。 |
| `/hopper:setup` | vendor 就绪度:装没装、认没认证、模型、沙箱、联网能力。 |
| `/hopper:status` | 显示队列汇总。 |
| `/hopper:result` | 取一个已完成任务的结论与日志尾部(`--full` 看完整文本)。 |
| `/hopper:models` | 列出已缓存的 vendor 模型。 |
| `/hopper:probe` | 刷新 vendor 能力缓存。 |
| `/hopper:vendors` | 列出已注册的 vendor adapter。 |
| `/hopper:smoke` | 跑安装自检。 |
| `hopper-watch-events` | 投递终端事件的 Claude monitor。 |

\* "只读"是任务类型**请求**的沙箱——由 executor prompt frame 携带的一条指令,是否真的被
强制执行取决于 vendor,以及(对 codex 而言)平台。**grok** 不管请求什么都跑全放开;
**codex** 在 Windows 上也是,但在 macOS/Linux 上会真正执行只读沙箱(完整版本见上面「它做
不到什么」一节)。具体到你这台机器,看 `/hopper:review` 和 `hopper-dispatch --rules`。

## 主机与 vendor 支持矩阵

**7 类宿主**都能发起 dispatch:Claude Code、Codex CLI、OpenCode、Copilot CLI、Grok Build、
Cursor CLI,以及一个 standalone shell。

**8 个 vendor adapter** 已注册,但产品实际建议使用的只有其中 4 个:

> **产品支持的 vendor 集合(2026-07-31 决策):`codex` / `grok` / `claude` / `kimi`。**
> `agy` / `copilot` / `mimo` / `opencode` **不在支持范围内**——这是一次产品决策,收窄
> 主动维护的使用范围,不是代码层面的限制。它们的 adapter 文件**没有被删除**(删掉会破坏
> 现有测试与历史记录);它们仍然注册着,`--vendors` 仍会列出全部 8 家,代码里也没有任何地方
> 硬编码"只认这 4 家"(那样会和真正的执行点重复,甚至可能打架)。对某个**具体项目**能派发给
> 谁的执行点,是那个项目 `.hopper/AGENTS.md` 里的 **`Approved Vendors`** 表——fail-closed:
> 这一节缺失,或者某个 vendor 不在表里 / 不是 `yes`,一律拒绝派发,**包括显式的 `--vendor`
> 覆盖**。
>
> **agy 还有一层单独的、纯技术性的禁用(2026-06-26)。** agy 1.0.12 的 `--print` 只把模型
> 回答渲染在交互式 TUI 里;在非 TTY 的 stdout 下(每一次 hopper dispatch 都是),它什么也
> 不输出,dispatch 永远拿不到答案。因此 hopper **拒绝派发给 agy**,并给出明确错误,不管某个
> 项目的 Approved Vendors 表里怎么写。真正的修复需要一个 PTY,而 agy 被排除在 PTY 方案之外
> (它会在打开的 stdin 管道上挂起)。如果你理解这个限制、仍然想试,设
> `HOPPER_ENABLE_AGY=1`。这条提示会在上游修复或者有了受支持的捕获路径之后移除——见
> `docs/specs/vendor-io-protocol-current-vs-target.md`。

## 治理层(可选)

默认情况下,hopper 派发一个任务类型 frame + spec,并把 vendor 与宿主配置隔离开。如果你还
想让每个被派发的 vendor 都遵循一份共享的行为准则(比如 fable 的 portable core),可以选择
性开启:

```bash
hopper-dispatch --init-governance --from /path/to/fable/prompts/portable-agent-core.md
```

这会写出 `.hopper/GOVERNANCE.md`(一个准则指针 + 一张按 vendor 分的 overlay 表),并在
`.hopper/governance/` 下 vendor 一份带戳的准则副本。从那之后,`hopper-dispatch` 会把
`准则 + 对应 vendor 的 overlay` 前置进拼好的 prompt——用的还是路由器本来就解析出的那个
vendor。

- 全局关闭:删掉 `.hopper/GOVERNANCE.md`。
- 单个任务关闭:在 `queue.md` 里加一列 `Govern`,设成 `off`。
- 准则本身归上游(fable)所有;hopper 只带一份带戳的副本。

这是一份 prompt 层面的行为约定;它不改变沙箱、超时、路由,也不改变"一次 spawn、不重试"的
承诺。

## 安装

详细的分宿主安装步骤见 [docs/release/INSTALL-MATRIX.md](docs/release/INSTALL-MATRIX.md)。

Claude Code 用户:

```bash
mkdir -p ~/.claude/plugins
ln -s "$(pwd)" ~/.claude/plugins/hopper
```

Windows PowerShell:

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$HOME\.claude\plugins\hopper" `
  -Target "F:\absolute\path\to\hopper-plugin"
```

Codex CLI 用户:

```bash
chmod +x /absolute/path/to/hopper-plugin/hosts/codex-cli/bin/hopper-codex
ln -s /absolute/path/to/hopper-plugin/hosts/codex-cli/bin/hopper-codex ~/.local/bin/hopper-codex
```

Standalone:

```bash
npm link
hopper-dispatch --smoke
hopper-dispatch --vendors
```

Kimi Work 用户:把 `plugins/hopper/` 当作托管插件安装。这个目录带着 `kimi.plugin.json`
(Kimi 插件 manifest),以及 `plugins/hopper/skills/` 下的 skills 和 `plugins/hopper/cli/`
下的 CLI——把 Kimi Work 的插件管理指向这个目录(或它的副本),它会从 `kimi.plugin.json`
里读出 hopper 的 skills 与接口元数据并注册。

## 升级

从旧版本升级、尤其是跨 v0.40.0 这条线,见 [MIGRATION.md](MIGRATION.md)。

**v0.40.0 对已有项目是一次 breaking change**:它给 `.hopper/AGENTS.md` 新加了一节
`## Approved Vendors`,并且这一节是 fail-closed 的——一个在 v0.40.0 之前建好的项目,如果
`.hopper/AGENTS.md` 里还没有这一节,升级之后**所有 vendor 的 dispatch 都会被拒绝**,直到
手动补上这张表并把要用的 vendor 标 `yes`。这不是一个渐进式的提示,是硬拒绝——升级前请先看
MIGRATION.md 里的补表步骤。

## 文档 / 状态 / 许可

从 [docs/cookbook.md](docs/cookbook.md) 开始看 dispatch、progress、通知、dashboard、
probe、清理陈旧任务,以及多 vendor 评审这些场景的完整用法。

- PRD:[docs/specs/background-progress-notification-prd-trd.md](docs/specs/background-progress-notification-prd-trd.md)
- 安装矩阵:[docs/release/INSTALL-MATRIX.md](docs/release/INSTALL-MATRIX.md)
- Dashboard:[dashboard/README.md](dashboard/README.md)
- Telemetry 手册:[docs/specs/background-progress-notification-dogfood-telemetry-MANUAL.md](docs/specs/background-progress-notification-dogfood-telemetry-MANUAL.md)

状态:

- v1.0(progress + 终端通知):GA
- v1.1(dashboard 集成 + 系统 toast + 文档):GA
- v1.2(pipe+tee + stream-parser + 更多 provider):规划中

许可:MIT。见 [LICENSE](LICENSE)。
