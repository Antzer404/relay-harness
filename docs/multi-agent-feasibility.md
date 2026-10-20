# 多智能体（Project 模式）可行性评估

> 2026-10-20 · 基于 `@anthropic-ai/claude-agent-sdk@0.3.303` 的类型定义与 Relay 现状
> 状态：**MVP 已实现（2026-10-20）**，实现取舍见文末「实施修订」

## 1. 结论

**可行。** SDK 原生支持"主线程 + 子代理"模型，且提供了做团队视图所需的全部信号：

- 自定义代理阵容（`options.agents`，`AgentDefinition`）；
- 子代理完整对话转发（`forwardSubagentText: true`），消息带 `parent_tool_use_id`、`agent_id`、`subagent_type`、`task_description`；
- 任务生命周期事件（`task_started` / `task_progress` / `task_notification`），含 `task_id`、`spawn_depth`、`parent_task_id`、实时进度摘要、逐任务 token 与耗时；
- 子代理 transcript 落盘（`listSubagentIds` / `getSubagentMessages`），可用于回放；
- 权限回调能拿到 `agentID`，可把审批归属到具体代理；
- 可选的 AI 进度摘要（`agentProgressSummaries`，约 30s 一次，复用子代理 prompt cache，成本低）。

不建议自建多进程编排器；建议 v1 用原生子代理，leader 通过 Agent/Task 工具派活，Relay 只负责展示与治理。

## 2. 需求与 SDK 的映射

| 需求 | SDK 能力 | 结论 |
| --- | --- | --- |
| Project 模式开启后启用团队 | `query({ agents, ... })` 按会话下发 | 直接可行 |
| 用户只与 leader 对话 | leader = 主线程，现有 Composer 不变 | 无需改动 |
| leader 制定计划并分发 | 主线程调用 Agent/Task 工具，可并行多个；`agents` 定义可派发的成员 | 直接可行 |
| 左侧展示智能体之间的交流 | 转发消息里 leader→agent 的任务文本 + agent 的回复 + 进度摘要，可按 `agent_id` 归组 | 可行，需要新的视图模型 |
| agent 状态 | `task_started/progress/notification` | 直接可行 |
| 点开看某个 agent 的完整过程 | `forwardSubagentText` 的嵌套消息，或读 transcript | 可行 |
| 权限弹窗区分是谁要执行 | `canUseTool` 的 `options.agentID` | 可行，需扩展事件 |
| 回放 | Relay 自己的事件存储 + 可选的 transcript API | 可行，需新增耐久事件 |

注意：原生"agents 之间直接对话"（peer-to-peer）在 SDK 里属于 teammate/跨会话通道，依赖 tmux/iterm2 或进程间 socket，为终端场景设计。**v1 的团队交流一律走 leader 中转**：leader→agent 是任务单，agent→leader 是报告，这在产品上就是"leader 分发、汇总"，足够表达需求。

## 3. 架构选项

### A. 原生子代理 + leader 中转（推荐）

- leader 是主会话；`options.agents` 注册固定阵容（如 架构 / 前端 / 后端 / 测试）。
- leader 通过 Agent 工具派发任务；并行任务就是同一轮里多次工具调用。
- `forwardSubagentText: true` 打开完整转发；`agentProgressSummaries: true` 打开进度摘要。
- 每个子代理有独立上下文窗口，leader 只收到最终报告 —— 这正好是团队协作想要的上下文隔离，也顺带降低 leader 的上下文压力。
- 实现面：normalizer 拆分主线程/子代理事件、团队视图、事件持久化、权限归属。

### B. 自建编排器（in-process MCP `relay_delegate` + 多个 `query()` 会话）

- 完全掌控每个 agent 的会话、模型、权限、日志，能做到真正的双向多轮。
- 代价：每个 agent 一个 CLI 进程；权限、取消、usage、resume 都要自己接一遍；故障面翻倍；且仍然没有天然的 agent↔agent 对话。
- 适合确实需要"长期驻留 agent"或独立会话历史的场景，v1 不需要。

### C. 原生 teammates（SendMessage / 跨会话）

- SDK 里有 `teammateMode: auto | tmux | iterm2 | in-process` 与 SendMessage 通道。
- 终端导向，Windows 无 tmux；跨会话消息还涉及信任与投递策略。
- 不作为 v1 方案，留作后续"agent 之间直接对话"的参考。

**选择 A。** B 只在 A 碰到"单任务一问一答不够用"的真实需求时再考虑。

## 4. Project 模式的最小形态（建议）

1. **开关位置**：工作区级设置（`<cwd>/.relay/settings.json` 的 `projectMode: true`）+ 会话级开关（Composer 权限胶囊旁），默认关。开启后新会话按团队模式启动。
2. **阵容**：v1 用模板阵容（Leader + 3~4 个角色），角色定义（名称、描述、系统提示、工具集、模型、权限）写在 `.relay/agents.json`，可手改；UI 编辑放 v2。
3. **Leader 提示**：注入一段团队纪律——先给计划（分步 + 负责人 + 验收标准），再派发；能并行就并行；每个任务单必须自包含（目标、约束、涉及文件、验收）。
4. **权限**：worker 默认继承会话权限模式；审批卡显示「架构 agent 请求运行 Bash」。可给 worker 单独设 `permissionMode`/`acceptEdits`，但危险命令仍走全局审批。
5. **并发**：v1 只支持前台子代理；同工作区并行时由 leader 负责文件不重叠（提示词约束），不做 worktree 隔离。

## 5. 需要动的模块

- **`normalizer.ts`**：按 `parent_tool_use_id` / `agent_id` 分流；新增事件：`agent_started`、`agent_progress`、`agent_finished`、`agent_message`（leader↔worker 的任务与报告）。**现状问题：默认情况下子代理的 tool_use/tool_result 会以"主线程工具"身份混入时间线**，做本功能前必须先按归属分流（否则现有时间线也会误导）。
- **`runtime/claude-agent-runtime.ts`**：传 `agents`、`forwardSubagentText`、`agentProgressSummaries`；权限回调带 `agentID`；按 `task_id` 支持单任务停止（`query.stopTask`，可选）。
- **事件与存储**：新事件类型进 `HarnessEvent`/`SessionStore`；子代理事件只持久化摘要与消息（限长），保证回放能重建团队面板；transcript 文件作为兜底。
- **UI**：
  - 侧栏在 Project 模式下加「团队」区：成员卡（名称、状态、当前任务摘要、token），下方频道流（`Leader → 后端：任务单`、`后端 → Leader：报告`、进度摘要）。
  - 点成员打开抽屉看该 agent 的完整消息流（转发的 text/thinking/tool）。
  - 时间线主视图仍只显示 leader 的产出，避免噪音。
- **权限**：`permission_request` 增加 `agentId/agentName`，审批卡与「始终允许」的粒度按 agent 与工具。
- **成本**：`task_notification.usage` 汇总到 usage 面板，按成员展示。

## 6. 主要风险

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| DeepSeek 编排质量 | flash 可能不会稳定地用 Agent 工具、任务单写不完整 | leader 默认 v4-pro、worker 用 flash；真实 key 压测"计划→并行派发→汇总" |
| thinking 回传 | 子代理转发开启后 thinking block 混入主线程事件 | normalizer 按 agent 归属分流，绝不并入 leader |
| 权限风暴 | 多个 worker 同时要审批 | 聚合审批（按 agent 分组）+ worker 可预设 acceptEdits |
| 成本与上下文翻倍 | 并行 agent 各自计费 | 团队面板显示逐 agent token/成本；成员数上限（如 4） |
| 文件冲突 | 并行写同一文件 | v1 提示词约束 + 文件归属清单；worktree 隔离留 v2 |
| 恢复 | 重启后前台子代理不会续跑 | 事件标记中断 + 提示重新派发；transcript 可回看 |
| Windows | 原生 teammates 依赖 tmux | 只走 in-process 子代理，无此问题 |

## 7. 待定的产品问题

1. Project 模式是工作区开关、会话开关，还是两者都有？（建议两者：工作区默认 + 会话可覆盖）
2. 阵容固定模板还是用户可编辑？成员上限？
3. 左侧是"会话 + 团队"上下分区，还是独立「团队」标签页？
4. 是否强制 leader 先出计划、用户确认后再派发？（类似 plan 模式，质量更稳但多一步）
5. worker 是否允许自动接受文件编辑、危险命令仍需确认？
6. 团队面板要不要展示 worker 的思维链？（建议默认折叠，只在成员详情里看）

## 8. 工作量估算

| 部分 | 估时 |
| --- | --- |
| normalizer 分流 + 新事件 + 持久化 | 3–4 天 |
| 运行时配置（阵容/转发/进度/权限归属/停止） | 2–3 天 |
| 团队面板 + 成员详情 + 审批归属 | 4–5 天 |
| Project 模式开关 + 阵容文件 + leader 提示 | 2–3 天 |
| 真实 key 压测与调优（DeepSeek 编排、并发、成本） | 3–4 天 |

**MVP（固定阵容 + 前台子代理 + 团队面板）约 1.5–2 周；完整 v1 约 3 周。**

## 9. 开始前必须先做的一件事

给现有 normalizer 加归属分流（子代理事件不再冒充主线程工具）。这是独立的小修复，4–6 小时，也是多智能体的地基。

## 10. 实施修订（2026-10-20，MVP 落地）

- **开关形态**：用户选择「额外加一个按钮 → 新建窗口 → 定位工作文件夹」。主窗口顶栏新增「Project」按钮，弹出原生目录选择；选定后由 `HostRegistry` 打开独立的 `BrowserWindow` 并绑定该目录，同目录再次打开会聚焦已有窗口。主窗口与 Project 窗口各自持有一个 `SessionManager`，共享 `SessionStore` / `HandoffStore` / `MemoryStore`；IPC 按 `webContents.id` 路由，事件只发往所属窗口。
- **会话隔离**：`SessionRecord` 增加 `projectMode`。主窗口只列普通会话，Project 窗口只列 `projectMode=true` 且 `cwd` 等于其绑定目录的会话；跨窗口的 load/rename/delete/handoff 一律拒绝。Project 窗口的 cwd 固定为打开时选择的目录（`workspaceOverride`）。
- **阵容**：默认「架构 / 后端 / 前端 / 测试」四名 worker；`.relay/agents.json`（zod 校验，1–6 名）可整体替换阵容，字段为 id / label / description / prompt / tools / model。worker 未指定模型时走 `CLAUDE_CODE_SUBAGENT_MODEL=deepseek-flash`，leader 使用会话模型。
- **Leader 纪律**：`projectLeaderPrompt` 拼进 `systemPromptAppend`（顺序：长期记忆 → 交接文档 → 团队纪律 → 工作区追加）。要求先给计划（分步、负责人、验收）再直接派发，不阻塞等待用户确认。
- **权限**：worker 继承会话权限模式；`permission_request` 增加 `agentId` / `agentName`（normalizer 由 `task_started` 与子代理帧维护 task_id → subagent_type 映射），审批卡显示「后端 agent」等归属。危险命令仍按全局策略审批。
- **事件**：新增耐久事件 `agent_started` / `agent_progress` / `agent_finished` / `agent_message`。`task_started` / `task_progress` / `task_notification` 映射为生命周期事件；子代理的完整 assistant/user 帧只提炼 text / tool / result（丢弃 thinking 与 stream 增量，文本 4k、工具 300、结果 800 字符上限），不再进入 leader 时间线。事件落 JSONL，回放由纯函数 `reduceTeam` 重建团队状态。
- **UI**：侧栏底部「团队」区（成员 / 频道两个页签），成员卡显示状态、当前摘要与 token；点击成员打开右侧抽屉查看任务单与完整过程。主时间线仍只显示 leader 产出；顶栏显示 `Project` 徽标与绑定目录；设置页显示该目录且不允许改选。
- **未纳入 MVP**：worktree 隔离、单任务停止、worker 独立模型/权限档、后台代理常驻、agent 间直接对话、真实 key 下的编排质量与并发成本压测（需在 Windows 用 DeepSeek 实测）。
