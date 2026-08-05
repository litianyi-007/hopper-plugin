# ISSUE: 0.50.0 background runner 失败时丢失终局簿记 → in-progress 僵尸 + watch-events 静默

- **版本**: 0.50.0（回归；0.46.0 同一失败路径簿记正常——同日有直接对照）
- **发现**: 2026-08-05/06，E:\project\hawk-clawhive 实战（AUD-MID-GRK 三连派发）
- **严重度**: high（编排层对失败致盲：--watch/monitor/队列状态全部失真）

## 现象

同一任务 AUD-MID-GRK、同一失败根因（grok 二进制不在派发 shell 的 PATH → adapter 295ms spawn 失败），两个版本行为对照：

| | 0.46.0（15:10 attempt#1） | 0.50.0（15:36 attempt#2） |
|---|---|---|
| raw log | `hopper-runner: adapter-unknown-failed` | 同样打出该行 |
| progress.log 终局条目 | ✅ seq2 `phase:failed, kind:terminal, exit_code:-1` | ❌ **无 seq4，停在 seq3 lifecycle(queued)** |
| output.md frontmatter | `status: failed` | ❌ **永久 `status: in-progress / phase: starting`** |
| watch-events (`--watch-events`) | ✅ 转发 `hopper.task.terminal failed` | ❌ **无任何事件** |
| runner 进程 | 退出 | 退出（PID 44384 实测已死） |

即：0.50.0 的 spawn-失败分支在写终局簿记（progress terminal 条目 + frontmatter 翻转 + terminal 事件发射）**之前**就退出了。

## 佐证材料（项目内可查）

- `E:\project\hawk-clawhive\.hopper\handoffs\AUD-MID-GRK-progress.log` — seq1/2 为 0.46.0 完整失败簿记；seq3 为 0.50.0 attempt#2 的 queued，此后无终局
- `AUD-MID-GRK-output.log` — 两段各一行 `adapter-unknown-failed`（第二段后无任何 runner 收尾输出）
- attempt#2 期间 frontmatter 快照：`status: in-progress, phase: starting, terminal_event_emitted: false, last_progress: "Background task queued."`（外部哨兵确认 PID 已死 30+ 分钟后仍如此）

## 连带问题（同次实测）

1. **僵尸未被识别为 orphaned**：attempt#3 重派同 ID 时，dispatcher 对着 `in-progress` frontmatter 直接接受重派，既未拒绝、未要求 --force、也未把僵尸标记为 `orphaned`——orphan 检测（PID 活性）疑似未在派发路径执行。
2. `--result AUD-MID-GRK --full` 在成功的 attempt#3 之后仍报 `Status: partial / Adapter diagnostic: adapter-unknown-failed / Terminal: no / Attestation: conflict`，且 "Recent events" 显示 `running/process_alive status=unknown`——结果视图混叠了 attempt#2 僵尸状态与 attempt#3 实际产出（正文 body 是 attempt#3 的完整 verdict）。同 ID 多 attempt 的状态归并有歧义。

## 复现步骤

1. 使 grok（或任一 vendor）二进制不在派发 shell 的 PATH（`command -v grok` 为空即可）
2. `hopper-dispatch <task> --background`（0.50.0）
3. 观察：raw log 现 `adapter-unknown-failed`，但 progress.log 无 terminal 条目、frontmatter 永 in-progress、watch-events 无事件
4. 同环境换 0.46.0 重跑 → 终局簿记完整（对照）

## 修复建议

1. runner 的终局写入（progress terminal + frontmatter flip + terminal 事件）包进 `try/finally`/等价兜底，任何 spawn/adapter 异常路径都必须落终局
2. 派发路径加 orphan 检测：目标任务 frontmatter=in-progress 时校验 PID 活性，死则先翻 `orphaned`（并发 watch-events orphaned 事件）再受理重派
3. `--result` 对同 ID 多 attempt 明确归并语义（以最后 attempt 为准，或分 attempt 呈现），避免 partial/conflict 混叠
4. 回归测试：spawn-fail（binary 不存在）× {sync, background} × 簿记三件套断言

## 环境

Windows 11 / Claude Code 宿主 / node v22.14 / HOPPER_DIR 显式指定 / 派发 shell 为 Git Bash（最小 PATH——这也是触发 spawn 失败的环境成因，独立成因但可用于复现）
