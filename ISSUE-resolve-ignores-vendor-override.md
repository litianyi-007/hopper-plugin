# ISSUE: `--resolve <task-id> --vendor <v>` silently ignores `--vendor` — shows AGENTS.md/queue.md routing, not the override

- 发现于: 2026-08-03（安装/升级引导 batch 审查时，主会话实测复现）
- 状态: open（**本次刻意不修**——见下方「为什么本次不修」）
- 严重性: 中——不是安全问题，是「所见非所得」：`--resolve` 打印的 Vendor 与真实 dispatch 会用的 Vendor 可能不一致，误导预检
- Env: hopper-plugin 0.41.1（本 batch 提交前）；CLI = `cli/bin/hopper-dispatch`

## 事实（实测，两种参数位置都试过）

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

## 根因（已读代码确认，不是猜测）

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

## 实际 vs 预期

- 实际：`--resolve <id> --vendor <v>` 打印的 `Vendor:` 行 = AGENTS.md/queue.md 静态路由结果，`--vendor`
  的值被完全丢弃，且没有任何警告/notice 提示这条参数被忽略了。
- 预期（二选一，需要在修复时决定）：
  1. `--resolve` 也应用 `--vendor` 覆盖，打印「若真实 dispatch 会用这个 vendor」——与 `--adhoc`/
     同步 dispatch 行为一致；或
  2. `--resolve` 有意只展示未覆盖的静态路由结果，但必须显式拒绝或警告一个被忽略的 `--vendor`
     （而不是静默吞掉），并在 `--help`/两处 SKILL.md 里写清楚这个例外。

## 为什么本次不修

本 batch（v0.42.0）已经在改脚手架产物（`Active Agent Instances` 表）和 skill 指令
（first-run/升级路径），属于行为变化批次；验收面已经不小。这个 `--resolve` 缺陷是独立缺陷，
和本 batch 的「安装/升级引导」主题只是文档层面相邻（都在 `--help`/SKILL.md 附近），修代码会把
本轮的验收范围再扩一圈。按主会话裁决：**本轮只如实标注当前行为，不改代码**。

本轮已同步做的事（如实标注，不是修复）：
- `cli/bin/hopper-dispatch` 的 `--help`：`--vendor` 说明补充「适用于真实 dispatch；
  `--resolve` 展示的是路由结果，不套用覆盖（见本 issue）」。
- `skills/hopper-dispatch/SKILL.md`：`--check <task-id>` 的错误说法一并修正（见下）,
  `--vendor`/`--resolve` 的关系目前 SKILL.md 未展开，留给 issue 修复时一并处理。

## 修的时候要一起决定的事

- 选上面「实际 vs 预期」的哪个方向（大概率是方向 1：预检应该反映真实 dispatch 行为，否则
  `--resolve` 作为「dry run」的价值打折）。
- 无论哪个方向，都要补一条测试：`--resolve <id> --vendor <v>` 的行为被断言锁定，防止再次静默漂移。
- 修完后回填本 issue 的「状态」为 closed，并把 `--help`/两处 SKILL.md 的措辞同步更新为修复后的真实行为。
