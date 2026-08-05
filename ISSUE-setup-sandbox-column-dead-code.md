# ISSUE: `--setup` 的 Sandbox 列是 dead code，而文档让用户去看它

- 发现于: 2026-07-29（v0.38.0 修 sandboxControl 误分类时顺带发现）
- 状态: **CLOSED**（2026-08-05 修复；影响面比原记录大得多，见下方「影响面更正」）
- 严重性: 中——不是安全问题，是「建议不可执行」

## 事实

`cli/bin/hopper-dispatch` 的 `runSetup()` 里有一个**无条件 `return;`**（约 195 行，
由更早的提交 `03330ea "feat: render model inventory safely"` 引入）挡在 pipe-table + legend
代码之前。该整块——**包括 Sandbox=argv/full/native 这一列**——今天是 dead code。

实测 `node cli/bin/hopper-dispatch --setup` 的真实输出只有简化行：

```
codex: status=READY auth=verified binaryAvailability=unknown ...
```

**没有 Sandbox 列。**

## 为什么它现在要紧

v0.38.0 修好了 `sandboxControl()` 的误分类（grok 曾被判 `argv`，实际恒
`--permission-mode bypassPermissions`），并**保留**了 `commands/setup.md:39` /
`skills/hopper-setup/SKILL.md:20` 那句建议：

> prefer a vendor whose **Sandbox=argv** so read-only is actually enforced

修完之后这句话**语义上是真的**（opencode/copilot/claude 确实是真 `argv`，
codex/grok 是 `full`）。**但用户没有任何办法看到这个值**——它不在 `--setup` 输出里。

**即：一句正确但不可执行的建议。** 这与 v0.38.0 修掉的那批「假安全声明」不同族
（那批是说了假话），本条是**说了真话但指向一个不存在的界面**。

## 为什么当时不修（2026-07-29 的判断，已过期）

1. 该表格路径**零测试覆盖**——正因如此这个 `return;` 才能存活至今没被发现。
   修它需要先补测试，属于新工作不是收尾。
2. 主会话当前的产品判断是：**在「20 次 `/hopper:review` 实测」跑完之前不写新机制**
   （见 test-harnessloop 的产品化方案）。改渲染器属于新机制。

---

## 影响面更正（2026-08-05）

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

## Resolution（2026-08-05）

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
