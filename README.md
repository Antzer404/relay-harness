# Relay ｜ 接力

桌面 Agent Harness —— 以 Claude Agent SDK 为运行时、接入 DeepSeek，带双轨记忆与跨会话交接。

> 状态：**M2 已完成，Project 模式（多智能体）MVP 已接入**。Electron + Agent SDK + DeepSeek 端点 + thinking 流 + 工具权限闭环已跑通；界面为现代毛玻璃布局，含配置分级、会话持久化、时间线虚拟滚动、跨会话交接、双轨长期记忆与 Project 团队窗口。详见 [M0 验证报告](docs/m0-verification.md)。

## 快速开始

要求：Node.js ≥ 22.12，Windows 10/11 或 macOS。

中国网络环境下建议先切镜像（Electron 本体在安装时下载，镜像须在 `npm ci` 之前设置）：

```bash
npm config set registry https://registry.npmmirror.com
# Windows PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

```bash
npm ci        # postinstall 会自动下载 Electron 本体（约 200 MB）
npm run dev
```

Electron 44 起核心包不再带 postinstall，二进制改为首次加载时懒下载；electron-vite 6 不会触发懒下载，因此项目根目录用 `postinstall: install-electron` 显式补齐。若下载中断，重跑 `npm run postinstall` 即可，不需要重新 `npm ci`。

`git push`、`npm ci` 或 Electron 下载缓慢通常是命令行没有走代理（Windows 系统代理不作用于 CLI）。按 [命令行代理配置](docs/proxy-setup.md) 设置一次即可。

若 Windows 上 Chromium GPU 进程无法启动（虚拟机、远程桌面或受限显卡驱动），设置环境变量 `RELAY_DISABLE_GPU=1` 后启动，会关闭硬件加速。启动日志会打印 `[relay] gpu compositing=...`；当合成器不是 `enabled` 时界面自动进入低特效模式（去掉大面积毛玻璃与背景模糊、对话框直接显示），优先保证滚动和动画流畅。开发模式按 F12 可打开 DevTools。

首次启动点击右上角齿轮打开设置，在 **API Key** 页填入 DeepSeek 密钥（`sk-...`），然后在左侧点「新会话」。模型与思考强度在设置里调整；权限模式可直接用输入框左下的胶囊按钮即时切换（仅作用于当前会话），也可以在每个工作目录放一份 `.relay/settings.json` 覆盖应用默认值。

需要团队协作时，点顶栏的「Project」并选择工作文件夹：Relay 会为新目录打开一个独立窗口，以 Project 模式运行（Leader + 架构 / 后端 / 前端 / 测试四个 worker）。在 `.relay/agents.json` 中可替换阵容（id、名称、描述、系统提示、可选工具集）。主窗口与 Project 窗口的会话互相隔离，记忆与交接记录按目录共享。

## 当前能力（M0）

- electron-vite 单包分层：`src/main`、`src/preload`、`src/renderer`、`src/shared`。
- `@anthropic-ai/claude-agent-sdk@0.3.303` 精确锁定；SDK 平台包自带 CLI，无需用户安装。
- DeepSeek Anthropic 兼容端点：`ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`，鉴权走 `ANTHROPIC_AUTH_TOKEN`。
- 密钥由主进程 `safeStorage` 加密保存；系统安全存储不可用时只保存在内存，不落明文。
- 极简控制台：顶栏 + 会话栏 + 时间线，无右侧检查器；流式文本、思维链折叠（显示思考耗时）、紧凑工具卡、时间线内联权限卡；浅色 / 深色 / 跟随系统；不在主界面展示 token 与成本。
- 时间线虚拟滚动：只挂载可视窗口内的条目（约 20 个 DOM 行，与会话长度无关）；行高由 ResizeObserver 实测并缓存，滚动时以首行锚定避免跳动；贴底跟随流式输出，离开底部时出现「回到最新」。
- 文件改动卡：Edit / MultiEdit / Write 成功后显示行级 diff（行号、上下文、+N/−M），diff 随事件落盘，历史会话同样可见；红绿只用于 diff 内容。
- 配置分级：应用默认保存在 userData；`<工作区>/.relay/settings.json` 可覆盖模型、思考强度、权限模式与追加系统提示；`.relay/settings.local.json` 保存「始终允许」的工具授权（按工具整体生效，例如 `WebFetch` 覆盖所有网站，可在设置的工作区页移除）。
- 会话持久化：持久事件按轮写入 userData/sessions，重启后可浏览、重命名、删除，并通过 CLI transcript 恢复上下文。
- 权限默认 `default`；`canUseTool` 三态（拒绝 / 本次允许 / 总是允许），内联卡片不阻塞界面；「总是允许」按工具整体授权（WebFetch 覆盖所有网站、Write 覆盖所有文件），写入工作区配置后新会话直接生效，也可在设置的已允许工具中移除；窗口关闭时自动拒绝挂起请求。
- 权限模式即时切换：输入框左下的胶囊按钮在 `每次询问 / 仅规划 / 自动接受编辑` 之间切换，运行中的会话通过 SDK `setPermissionMode` 立刻生效并留下时间线记录；没有运行中会话时则保存为应用默认。plan 模式批准时（ExitPlanMode）按建议提供「自动接受编辑 / 逐次确认」两个选项。
- 上下文填充率：开发者模式的事件轨迹抽屉顶部显示最近一轮的 context 占用（tokens、窗口、百分比、输入输出、缓存读写与估算成本）。
- 跨会话交接：填充率达到阈值（默认 70%，低于 CLI 自动压缩的 75%）时输入框上方出现提示；点「交接」后用当前会话的持久事件生成结构化交接文档（目标 / 已完成 / 关键决策 / 涉及文件 / 待办 / 未解决），可编辑、重生成，确认后新建会话并把文档注入其系统提示；会话列表用「接力」标记来源，交接链可连续延长。生成走独立的模型调用，不占用当前会话上下文。
- 双轨长期记忆：每个回合结束后 2 分钟去抖，用当前会话模型把增量对话整理成「项目记忆 + 用户画像」，以 `add / update / delete` 增量写入 `userData/memory`（JSON，按会话游标只处理未整理的事件）；工作区同时生成只读镜像 `.relay/memory.md`。新会话启动时按约 2000 tokens 预算注入系统提示，整理结果在时间线留一条通知。设置 → 通用可查看记忆目录与条数；直接编辑 JSON 即可修改，`enabled: false` 可停用。
- Project 模式（多智能体）：主窗口顶栏点「Project」选择工作文件夹，会打开一个独立窗口并绑定该目录。Leader 仍是主会话，通过 SDK 原生子代理派发任务（默认阵容：架构 / 后端 / 前端 / 测试，可用 `.relay/agents.json` 覆盖）；侧栏底部「团队」区可切换成员与频道，查看任务单、进度摘要、逐成员 token 与完整过程；worker 的思维链与工具调用不会混入主时间线，权限审批卡会标注请求来自哪个 agent。worker 继承会话权限模式。
- 运行中可继续输入排队；Esc 中断；失败回合支持一键重试；开发者模式提供事件轨迹抽屉。
- 运行时与 UI 解耦：SDK 消息先归一化为自有 `HarnessEvent`，后续替换运行时不动界面。
- 打包：Windows NSIS/portable、macOS dmg；SDK 原生二进制通过 `asarUnpack` 解包并显式传入 `pathToClaudeCodeExecutable`。

尚未实现（M3）：安装包签名公证与 Defender 误报处理、E2E 冒烟、Cowork、自动更新。

## 目录

```text
src/
  shared/        # 事件、IPC、设置类型与 zod schema（无 Electron/Node 依赖）
  main/
    runtime/     # RuntimeAdapter、ClaudeAgentRuntime、事件归一化、原生 CLI 路径
    services/    # 配置/密钥（safeStorage）、会话生命周期、交接文档、双轨记忆、项目阵容
    hosts.ts     # 主窗口 / Project 窗口的会话宿主与共享存储
    ipc.ts       # 类型化 IPC 与入参校验（按窗口路由）
    window.ts
    index.ts
  preload/       # contextBridge 暴露最小 window.relay
  renderer/      # React 19 + Zustand + 毛玻璃 CSS（时间线 / 设置 / 事件抽屉）
tests/           # 归一化单测、路径单测、SDK + mock 端点闭环
scripts/         # 打包产物校验
docs/            # v1 方案、M0 验证报告、截图
```

## 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | electron-vite 开发模式 |
| `npm run typecheck` | 主进程 + 渲染层两套 TS 检查 |
| `npm test` | Vitest：归一化、路径、SDK mock 闭环 |
| `npm run smoke` | 只跑 SDK 闭环（本地 mock，不需要真实 key） |
| `npm run build:app` | 构建 main / preload / renderer |
| `npm run dist:win` | Windows NSIS + portable |
| `npm run dist:mac` | 当前架构 dmg |
| `npm run dist:dir` | 当前平台未打包目录 |
| `npm run verify:package` | 检查 `app.asar.unpacked` 中的 SDK CLI |

## 架构要点

- **不重建历史**：会话恢复只走 SDK `resume` / CLI transcript，Relay 自己的事件库不参与向模型回传消息，从根上规避 DeepSeek thinking 回传 400。
- **运行时适配层**：`RuntimeAdapter` + `EventNormalizer` 隔离 SDK 0.x 的破坏性变更；升级 SDK = 产品发版，需跑权限、thinking、resume、usage 回归。
- **环境合并**：SDK `options.env` 是替换语义，必须合并 `process.env`；同时清除宿主上可能存在的其他 Anthropic 凭证，避免抢走用户 key。
- **原生二进制**：打包后 CLI 位于 `app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/`，主进程显式解析并传入 SDK。

## 安全约定

- 仓库不包含任何 API Key 或凭据。密钥只存在于 `safeStorage` 加密文件或当前进程内存。
- `contextIsolation: true`、`nodeIntegration: false`，渲染层不接触 Node；preload 只暴露白名单方法。
- IPC 入参使用 zod 校验；生产构建注入 CSP；外部链接交给系统浏览器。
- 默认权限模式 `default`，不提供“默认全放行”开关。

## 文档

- [v1 技术方案](docs/v1-tech-proposal.md)
- [M0 技术验证报告](docs/m0-verification.md)
- [命令行代理配置](docs/proxy-setup.md)

## 打包

在目标系统上构建，npm 会自动安装对应平台的 SDK 原生包：

```bash
npm ci
npm run dist:win    # Windows
npm run dist:mac    # macOS
npm run verify:package
```

CI 矩阵见 [.github/workflows/build.yml](.github/workflows/build.yml)（Windows x64、macOS arm64/x64）。

## 许可

TBD。
