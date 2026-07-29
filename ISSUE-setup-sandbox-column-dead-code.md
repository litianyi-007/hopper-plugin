# ISSUE: `--setup` 的 Sandbox 列是 dead code，而文档让用户去看它

- 发现于: 2026-07-29（v0.38.0 修 sandboxControl 误分类时顺带发现）
- 状态: open（**本次刻意不修**）
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

## 为什么本次不修

1. 该表格路径**零测试覆盖**——正因如此这个 `return;` 才能存活至今没被发现。
   修它需要先补测试，属于新工作不是收尾。
2. 主会话当前的产品判断是：**在「20 次 `/hopper:review` 实测」跑完之前不写新机制**
   （见 test-harnessloop 的产品化方案）。改渲染器属于新机制。

## 修的时候要一起决定的事

- 是恢复表格，还是把 Sandbox 值并进现有的简化行（后者改动更小）？
- 无论哪种，**必须同时加一条测试断言 Sandbox 列真的出现在 `--setup` 输出里**——
  否则下一个 `return;` 会重演同一件事。
- 若决定不恢复，则 `commands/setup.md:39` 与 `SKILL.md:20` 必须改写：
  不能让用户去查一个查不到的值。
