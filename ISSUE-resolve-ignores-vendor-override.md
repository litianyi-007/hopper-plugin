# ISSUE: `--resolve <task-id> --vendor <v>` silently ignores `--vendor` — shows AGENTS.md/queue.md routing, not the override

- 发现于: 2026-08-03（安装/升级引导 batch 审查时，主会话实测复现）
- 状态: **已修复（2026-08-03，同日）**——见文末「修复记录」。选的是「实际 vs 预期」两个方向里的方向 1：
  `--resolve` 应用 `--vendor` 覆盖，并如实反映真实 dispatch 会不会拒绝。
- 严重性: 中——不是安全问题，是「所见非所得」：`--resolve` 打印的 Vendor 与真实 dispatch 会用的 Vendor 可能不一致，误导预检
- Env: hopper-plugin 0.41.1（本 batch 提交前，缺陷仍在）；修复代码位于本次改动，随下一次版本 bump 一并发布；CLI = `cli/bin/hopper-dispatch`

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

## 修的时候要一起决定的事（已完成，见下）

- 选上面「实际 vs 预期」的哪个方向（大概率是方向 1：预检应该反映真实 dispatch 行为，否则
  `--resolve` 作为「dry run」的价值打折）。✅ 选了方向 1。
- 无论哪个方向，都要补一条测试：`--resolve <id> --vendor <v>` 的行为被断言锁定，防止再次静默漂移。
  ✅ `tests/unit/resolve-vendor-override.test.js`。
- 修完后回填本 issue 的「状态」为 closed，并把 `--help`/两处 SKILL.md 的措辞同步更新为修复后的真实行为。
  ✅ 见下方「修复记录」。

## 修复记录（2026-08-03）

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
