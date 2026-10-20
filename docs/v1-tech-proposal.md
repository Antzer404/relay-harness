# Relay ｜ 接力 — v1 技术方案（草案）

日期：2026-10-19 ｜ 状态：已确认（2026-10-19），M0 技术验证完成 ｜ 范围：单会话 + 双轨记忆 + 交接（Cowork 后置）

---

## 0. 结论速览

| 决策项 | 结论 |
| --- | --- |
| 运行时基座 | **Claude Agent SDK（TypeScript，`@anthropic-ai/claude-agent-sdk`）**，锁定精确版本；裸 CLI 仅作逃生/诊断通道 |
| 桌面框架 | **Electron**（主进程持有运行时，渲染进程无 Node） |
| 前端 | **React 19 + TypeScript + electron-vite**；样式直接用 endfield-ui 的 `assets/endfield.css`，不引 Tailwind |
| 数据 | **SQLite（better-sqlite3）**：会话元数据、归一化事件、记忆、交接记录；CLI 自身 transcript 是会话恢复的唯一真源 |
| 模型接入 | DeepSeek Anthropic 兼容端点，BYO API Key，`safeStorage` 加密存储 |
| 分发 | electron-builder：Windows NSIS/portable + macOS dmg；**无自动更新**；SDK 平台二进制需 asarUnpack + 签名 |
| 暂缓 | Cowork、多 provider、自研 agent loop、git worktree 隔离 |

---

## 1. 开源调研结论

调研快照 2026-10-19，覆盖 opcode（原 Claudia）、Crystal、Vibe Kanban、Claude Code UI、Happy Coder、Nimbalyst、CodePilot、ccgui（desktop-cc-gui）、DeepSeek Harness（DSH）。

**结论一：Agent SDK 是 v1 最合理的运行时基座。**
SDK 官方定位就是"把 Claude Code agent 嵌进你自己的应用"：`canUseTool` 权限回调、编程式 hooks（含 TS 独有的 `SessionStart`/`SessionEnd`）、类型化消息流、`resume`/`forkSession`/`sessionStore` 会话管理全部内置。且 2026 年的 0.3.x 版本通过平台 optional dependency **自带 Claude Code 原生二进制**，用户无需单独安装 CLI——"给个 key 就能用"由此成立。裸 CLI 的双工控制协议（Vibe Kanban/ccgui 路线）虽然控制力最强，但 `control_request` 通道没有完整公开文档，自研等于给自己造维护负担。

**结论二：Claude Code 的 transcript 是唯一事实源，不要自己重建消息历史。**
DeepSeek 思考模式有一条硬规则：带 tools 时历史 `reasoning_content`/thinking 块必须完整回传，否则 400。所有出问题的社区案例，根源都是"GUI 自己存消息、自己重建请求"。只要始终坚持 `--resume` / SDK session 恢复、由 CLI 管理 transcript，这一整类 bug 就不会出现。我们自己的事件库只用于 UI 重建、轨迹、记忆和交接，**不参与向模型回传历史**。

**结论三：不要抄的设计。**
opcode 的单全局子进程（开新会话杀旧进程）、`--dangerously-skip-permissions`、环境变量白名单（会把 `ANTHROPIC_BASE_URL` 过滤掉）都是反例。反面教材之外，Vibe Kanban 的"每会话独立进程 + 逐工具审批"、Crystal 的 worktree 生命周期、DSH 的"append-only 事件日志 + 投影"值得吸收。

**结论四：DSH 高价值但暂不采用。**
DeepSeek Harness 是很好的参考实现（事件溯源、turn/step 两级边界、surface 投影、fork 边界、单写者日志），但仍是 pre-1.0，发布全是 alpha/rc、无兼容承诺，且插件在进程内拥有完整 Node 权限。后期若要替换运行时，它的 ACP sidecar 是干净切入点；现在只借设计，不押运行时。

**结论五：UI 的竞争点不是聊天框。**
所有成熟项目都围绕四件事做体验：权限审批卡、工具调用卡（参数/结果/耗时）、thinking 折叠与降级、上下文占用仪表。我们的时间线设计应当把这四件作为一等公民。

---

## 2. 整体架构

```
┌──────────────────────────────────────────────┐
│ Renderer (React 19, 无 Node 权限)             │
│  · 会话时间线  · 权限弹窗  · 记忆/交接面板     │
└──────────────┬───────────────────────────────┘
               │ 类型化 IPC（contextBridge + zod 校验）
┌──────────────┴───────────────────────────────┐
│ Electron Main（ESM）                          │
│  ├─ SessionManager      会话生命周期/元数据    │
│  ├─ ClaudeAgentRuntime  RuntimeAdapter 实现    │
│  │    └─ Agent SDK query()（streaming input）  │
│  │         └─ 内置 native CLI 子进程           │
│  │              └─ https://api.deepseek.com/anthropic
│  ├─ MemoryService       双轨记忆 + 蒸馏        │
│  ├─ HandoffService      交接文档生成/注入       │
│  └─ ConfigService       API Key（safeStorage）  │
└──────────────────────────────────────────────┘
```

要点：

- 每个会话一个长期存活的 SDK `query()`（AsyncIterable prompt），不是每轮起进程；可中断、可切换权限模式、可并发多会话。
- 主进程负责 spawn 与协议；渲染进程只消费归一化事件，永不接触 Node/child_process。
- 后续重写运行时 = 新增一个 `RuntimeAdapter` 实现，UI 零改动。

---

## 3. 技术栈明细

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面壳 | Electron（当前稳定版，≥40） | 主进程 ESM（SDK 是 ESM-only） |
| 构建 | electron-vite + electron-builder | 开发热更新；打包 asarUnpack SDK 平台二进制 |
| 语言 | TypeScript 5.x | 主/渲染/共享类型同一套 |
| 前端框架 | React 19 | 函数组件 + hooks |
| 状态 | Zustand | 会话流状态、UI 偏好；不引 Redux |
| Markdown | react-markdown + remark-gfm | 成果渲染，代码块交给 Shiki |
| 高亮 | Shiki | 与终末地"代码只用等宽"的规则一致 |
| Diff | jsdiff + 自绘 hunk 组件 | v1 从 Edit/Write 的 tool input 生成 diff 卡片，不依赖 git |
| 数据库 | better-sqlite3 | 主进程同步访问；electron-builder 自动 rebuild |
| 校验 | zod | IPC 契约与事件 schema |
| 测试 | Vitest（单测）+ Playwright（E2E 冒烟） | 事件归一化、记忆蒸馏、交接注入必测 |
| 打包 | electron-builder | Win NSIS/portable、macOS dmg；mac 需公证 |
| 包管理 | pnpm | 锁文件入库，依赖精确版本 |

UI 套件：endfield-ui 的 `assets/endfield.css`（`ef-` 类名、纯 CSS、无框架依赖）+ Saira 可变字体 + 思源黑体（Noto Sans SC）。模板与组件写法读该 skill 的 `references/components.md`、`patterns.md`。

---

## 4. RuntimeAdapter 与事件模型

### 4.1 接口

```ts
interface RuntimeAdapter {
  startSession(opts: StartOptions): Promise<SessionHandle>; // cwd、model、effort、permissionMode
  send(sessionId: string, input: UserInput): void;          // 用户消息
  interrupt(sessionId: string): Promise<void>;              // 停止当前轮
  respondPermission(requestId: string, decision: PermissionDecision): void;
  resume(sessionId: string): Promise<SessionHandle>;        // SDK resume
  getUsage(sessionId: string): UsageSnapshot;
  dispose(sessionId: string): Promise<void>;
}
```

### 4.2 归一化事件（自有 schema，与 SDK 解耦）

```ts
type HarnessEvent =
  | { type: 'session_started'; sessionId; model; cwd; cliVersion }
  | { type: 'text_delta'; text }
  | { type: 'text_done'; text }
  | { type: 'thinking_delta'; text }
  | { type: 'thinking_done'; text }              // 空文本时 UI 显示"该模型未返回思维链"
  | { type: 'tool_call'; toolUseId; name; input }
  | { type: 'tool_result'; toolUseId; output; isError; durationMs }
  | { type: 'permission_request'; requestId; toolName; input; suggestions; agentId? }
  | { type: 'usage'; inputTokens; outputTokens; cacheRead; cacheWrite; contextWindow; percent }
  | { type: 'compact_boundary' }
  | { type: 'turn_end'; reason }
  | { type: 'error'; code; message; retryable }
```

原则：SDK 的消息先经 `normalize.ts` 转成以上事件，**渲染层只认识 HarnessEvent**。SDK 升级时改动收拢在 normalizer 与 adapter。

### 4.3 权限流

`permissionMode` 显式设为 `default`；`canUseTool` 回调 → IPC `permission_request` → 渲染层三态卡（本次允许 / 总是允许 / 拒绝，支持"拒绝并说明原因"）。"总是允许"通过 `updatedPermissions` 落成作用域规则（如 `Bash(npm test *)`），不用裸工具名预授权。窗口关闭/渲染崩溃时主进程主动 deny，防止工具调用永久挂起。高风险操作加 `PreToolUse` hook + deny 规则双保险（SDK issue #493 的 Write/Edit 绕过问题需在锁定版本上回归验证）。

### 4.4 thinking 与回传策略

- 展示：`includePartialMessages: true`，消费 `thinking_delta`；Settle 后折叠。
- 回传：**永远不自己拼历史**。恢复一律走 SDK `resume`，历史 thinking 由 CLI transcript 原样带出。若实测遇到 DeepSeek 400（`thinking must be passed back`），再加可选的本地代理兜底（缓存/回注 thinking blocks），默认关闭，作为最后手段。
- DeepSeek 端点兼容开关按需启用：`CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`、`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`、`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`。

### 4.5 DeepSeek 子进程环境

```text
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_AUTH_TOKEN=<用户 API Key>        # 注意不是 ANTHROPIC_API_KEY
ANTHROPIC_MODEL=deepseek-v4-pro[1m]        # 或 deepseek-flash[1m]
ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro[1m]
ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-flash[1m]
ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-flash
CLAUDE_CODE_SUBAGENT_MODEL=deepseek-flash
CLAUDE_CODE_EFFORT_LEVEL=max               # UI 可切换 high / max
CLAUDE_CODE_AUTO_COMPACT_WINDOW=786432     # 与 1M 窗口配合；我们的交接阈值低于它
```

注意：SDK `options.env` 是**替换**语义，必须 `{ ...process.env, ... }` 合并；Windows 上尤其不能丢 `PATH`。

---

## 5. 会话、记忆与交接

### 5.1 会话存储

- `sessions` 表：id、标题、cwd、model、effort、permissionMode、created_at、last_active、context_percent、handoff_from。
- `session_events` 表：append-only 存 HarnessEvent（UI 重建、轨迹、记忆蒸馏的来源）。
- 恢复：SDK `resume`（会话文件在 `~/.claude/projects/...`，可用 `CLAUDE_CONFIG_DIR` 收进应用私有目录）。**不解析 JSONL 内部格式**，回读走 SDK 的 `listSessions`/`getSessionMessages`。

### 5.2 双轨记忆 v1

| 轨道 | 内容 | 写入 | 读取 |
| --- | --- | --- | --- |
| 项目记忆 | 架构决策、约定、坑、文件地图 | Stop hook 异步蒸馏（便宜模型一次调用），追加到 SQLite `project_memory`；同时维护一份工作区内可读 Markdown | SessionStart hook 注入 `additionalContext` |
| 用户能力画像 | 技术栈偏好、沟通习惯、被纠正的点、常犯错误 | 同上，按用户全局（跨工作区）存 | SessionStart 注入（限 token 预算） |

纪律：每条记忆带 `source_session`、时间戳、置信度；面板支持查看/编辑/删除/停用；总注入量设 token 上限（如 2000 tokens），超出按相关性截断。错误记忆比没有记忆更糟——v1 就做记忆管理面板，不做"自动全量注入"。

### 5.3 交接

- 触发：上下文仪表 ≥ 75%，或用户手动点"交接"。
- 生成：向当前会话追加一条系统指令，产出结构化交接文档（目标、已完成、关键决策、涉及文件、待办、未解问题），存 `handoffs` 表并展示预览（可编辑后再确认）。
- 新会话：`sessionId` 新建，SessionStart hook 注入交接文档全文；记录 `handoff_from` 形成接力链。
- 可选：`resume + compact` 作为次要路径（保留在设置里），不作为默认。

**实现修订（2026-10-20，M2 交接链）**：生成改为一次独立的摘要调用——读取该会话已落盘的耐久事件、压缩成带预算的对话记录，直连 DeepSeek 端点生成文档，不向当前会话追加系统指令。理由：交接恰好在上下文接近上限时发生，不应再占用会话上下文，也避免把交接指令留在时间线里；且会话停止后仍可生成。阈值默认 70%（低于 auto-compact 的 75%），达到时只做提示，由用户手动发起；文档可编辑、可重新生成，确认后新建会话并记录 `handoffFrom`，注入走 `systemPromptAppend` 而非 hook。

### 5.4 上下文仪表

取 `result.modelUsage` 的 `contextWindow` 与 `usage`（含缓存读写）计算填充率；DeepSeek `[1m]` 档按 1M 配置，cache hit/miss 映射为近似值并标注"估算"。设置里可关闭 CLI auto-compact，把压缩权交给我们的交接逻辑（策略：auto-compact 保留、交接阈值设在其下方，避免打架）。

---

## 6. UI 骨架（endfield-ui）

**变体卡**：`standard` ｜ 强调色 `#FFFA00` ｜ 纸色 `#F4F4F2` ｜ 切角 small ｜ 底纹 contours ｜ 密度 standard ｜ 动效 mech。
页面类型：会话主界面 = **控制台**；设置/记忆 = **阅读**。深色主题做完整一套，跟随系统。

布局：

- 顶部**深色命令栏**：产品字标、当前工作区、模型档位（v4-pro / flash）、effort（high / max）、权限模式（default / plan / acceptEdits）。
- 左侧**会话列表**：编号记录行（`No.024 ｜ 2026.10.19 ｜ 标题 ｜ 上下文 62%`），当前项黄块 + 细线；底部"新建会话"切角按钮。
- 中间**事件时间线**：thinking 折叠块（等宽、浅灰斜线纹头）→ 工具调用卡（工具名、参数摘要、结果、耗时）→ diff 卡（红绿仅用于 diff 内容，不用红绿做状态）→ 成果 Markdown 渲染。turn/step 分组，虚拟滚动。
- 输入区上方**上下文仪表**：填充率条、本轮 token、估算成本、"交接"按钮（切角，黄底）。
- 右侧**可折叠面板**：上下文详情 / 记忆 / 交接链三 tab。
- 权限请求：模态卡（切角块），默认焦点在"拒绝"；显示工具名、参数、作用域与"总是允许"范围。
- 空状态、错误提示按 skill 规则：白底细框 + 黄旗，不用红色；红色只给删除。

字体：Saira（界面/数字，字段 112% 宽度，标签 125%）+ Noto Sans SC（正文），自托管并附 OFL 许可证。

---

## 7. 打包、分发与安全

- **SDK 原生二进制**：`asarUnpack: ["node_modules/@anthropic-ai/claude-agent-sdk*/**"]`；打包后用 `app.isPackaged` 判断并显式传 `pathToClaudeCodeExecutable`；macOS 对解包二进制单独签名/公证；Windows 需实测 Defender 误报。
- **ESM**：主进程用 ESM（electron-vite 支持）；SDK 与 `/core` 入口不要混用。
- **密钥**：`safeStorage` 加密落盘；渲染层永不接触明文 key；子进程 env 仅注入当前会话所需凭证。
- **进程安全**：`contextIsolation: true`、`nodeIntegration: false`；IPC 入参 zod 校验；默认 `permissionMode: default`，不提供"默认全放行"开关（可提供 plan 模式）。
- **版本策略**：SDK 精确锁定（如 `0.3.303`）；启动时校验内置 CLI 版本；升级 = 产品发版，需跑回归清单（权限流、thinking、resume、usage）。
- **无自动更新**：安装包手动分发；应用内做版本展示与兼容性提示。

---

## 8. 里程碑（单人全职估算）

| 阶段 | 内容 | 工期 | 退出标准 |
| --- | --- | --- | --- |
| M0 技术验证 | Electron+SDK+DeepSeek 最小闭环；thinking 流；权限弹窗；usage；Win/mac 打包冒烟 | 1–2 周 | 双平台能跑通一次带工具调用的真实任务；thinking 可见且长会话不 400 |
| M1 核心闭环 | 会话管理、时间线 UI（thinking/工具/diff/成果）、权限三态、模型与 effort 设置、密钥存储、上下文仪表、中断/恢复 | 3–4 周 | 日常编码任务可完全在 app 内完成 |
| M2 记忆与交接 | 双轨记忆 + 记忆面板、交接文档生成/预览/注入、交接链 | 2–3 周 | 连续三次交接后上下文无关键信息丢失 |
| M3 打包打磨 | 安装包、签名公证、错误态、性能（长会话虚拟化）、E2E 冒烟 | 2–3 周 | 双平台安装包可分发；崩溃/断连可恢复 |

合计约 8–12 周。Cowork、多 provider、worktree 隔离均为 v2。

---

## 9. 主要风险与对策

| 风险 | 等级 | 对策 |
| --- | --- | --- |
| SDK 0.x 版本频繁破坏 | 高 | 锁精确版本；adapter+normalizer 隔离；升级跑回归清单；保留裸 CLI 逃生口 |
| DeepSeek thinking 回传 400 | 中高 | 不自建历史、只走 resume；必要时启用代理兜底；M0 专项压测 |
| SDK issue #493 权限绕过（Write/Edit） | 中 | 锁版本回归验证；PreToolUse + deny 双保险 |
| Electron + 原生二进制打包/签名 | 中 | M0 就做双平台打包；mac 公证提前跑 |
| Windows shell 依赖 Git for Windows | 中 | 启动检测并引导；文档说明 |
| 长会话渲染性能 | 低中 | 事件虚拟滚动（借鉴 DSH 的尾部加载 + 分页） |
| 记忆质量（噪音/污染） | 中 | 记忆面板 + token 预算 + 置信度 + 可回滚 |

---

## 10. 已确认（2026-10-19）

1. 运行时基座按 **Agent SDK** 推进，裸 CLI 仅作逃生/诊断通道。
2. 仓库结构采用**单包分层**（`src/main`、`src/preload`、`src/renderer`、`src/shared`）。
3. 已进入 M0 技术验证，结果见 [M0 验证报告](m0-verification.md)。

---

## 参考

- Agent SDK：https://code.claude.com/docs/en/agent-sdk/typescript ｜ https://code.claude.com/docs/en/agent-sdk/permissions ｜ https://code.claude.com/docs/en/agent-sdk/hooks ｜ https://code.claude.com/docs/en/agent-sdk/sessions
- DeepSeek Anthropic API：https://api-docs.deepseek.com/guides/anthropic_api ｜ Thinking Mode：https://api-docs.deepseek.com/guides/thinking_mode
- Vibe Kanban：https://github.com/BloopAI/vibe-kanban ｜ Claude Code UI：https://github.com/siteboon/claudecodeui ｜ ccgui：https://github.com/zhukunpenglinyutong/desktop-cc-gui ｜ CodePilot：https://github.com/op7418/CodePilot ｜ Crystal：https://github.com/stravu/crystal ｜ opcode：https://github.com/winfunc/opcode ｜ Happy：https://github.com/slopus/happy ｜ Nimbalyst：https://github.com/Nimbalyst/nimbalyst
- DeepSeek Harness：https://github.com/deepseek-ai/deepseek-harness ｜ 架构文档：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.zh.md ｜ 会话模型：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.zh.md
- endfield-ui skill：CSS kit `assets/endfield.css`，字体与组件指南见 skill 目录。
