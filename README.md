<p align="center">
  <img src="assets/logo.png" width="96" alt="Relay logo" />
</p>

<h1 align="center">Relay ｜ 接力</h1>

<p align="center">把 DeepSeek 装进一张真正能干活的工作台。</p>

<p align="center">
  <a href="https://github.com/Antzer404/relay-harness/releases/latest"><img src="https://img.shields.io/github/v/release/Antzer404/relay-harness?label=release" alt="Release" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/runtime-DeepSeek-4B6BFB" alt="DeepSeek" />
</p>

Relay 是一个本地运行的桌面 Agent 工作台。它用 Claude Agent SDK 驱动工具调用，接入 DeepSeek 的 Anthropic 兼容端点，把思考过程、文件改动、命令执行和权限决定摊开在一条时间线上。长时间的活不会因为上下文耗尽而断掉：你可以把工作交接给下一个会话，Relay 也会在后台把项目知识和你的习惯沉淀成长期记忆。

[下载最新版](https://github.com/Antzer404/relay-harness/releases/latest) · [发布说明](docs/release-notes.md) · [问题反馈](https://github.com/Antzer404/relay-harness/issues)

---

## 看得见的推理与行动

- **思维链实时可见**。模型边想边显示，完成后折叠并标注思考耗时，随时可以展开回看。
- **工具调用逐条成卡**。参数、结果、耗时与错误都在卡里；Edit / MultiEdit / Write 成功后直接给出带行号的 diff 和 `+N / −M`，历史会话里也一样能看。
- **过程自动收束**。连续的思考与工具调用合并成一条「过程」行，运行中展开、完成后收起。再长的会话，每条用户指令仍然一眼可找。
- **权限不打断阅读**。审批以时间线内联卡片出现：拒绝、本次允许、总是允许。「总是允许」按工具整体生效，之后可在设置里逐项移除。
- **运行中也能说话**。Enter 把消息插入当前回合，正在跑的工具结束后模型就能读到；Ctrl+Enter 立即打断并回答；Esc 停止。失败回合可以一键重试。
- 浅色 / 深色 / 跟随系统，克制的毛玻璃与短促动效；显卡不可用时自动降级为低特效模式，优先保证滚动流畅。

## 长任务不断线

- **交接链**。上下文填充率达到阈值时，输入框上方会出现提示。一键把当前会话压缩成结构化交接文档——目标、已完成、关键决策、涉及文件、待办、未解决——可以编辑、重新生成，确认后作为新会话的起点。会话列表会标记「接力」来源，交接可以一段接一段延长。
- **双轨长期记忆**。每个回合结束后，Relay 在后台把增量对话蒸馏成「项目记忆 + 用户画像」，新会话启动时按约 2000 tokens 的预算注入。工作区里同时生成 `.relay/memory.md` 只读镜像，记忆也可以直接改 JSON。
- **透明恢复**。会话与事件本地持久化，重启后接着聊；运行时崩溃、网络中断或更换 API Key 后，下一条消息会自动重建并恢复上下文。
- **长会话不卡**。时间线虚拟滚动，只渲染可视区域的条目，滚回历史时展开状态也不会丢。

## 工作目录就是工作区

- 每个会话绑定一个工作目录。`<目录>/.relay/settings.json` 可以覆盖模型、思考强度、权限模式和追加系统提示；`.relay/settings.local.json` 保存工具授权。
- 应用默认、工作区覆盖、会话内即时切换三级配置，设置页会标明当前生效来源。
- 输入框左下的权限胶囊可在「每次询问 / 仅规划 / 自动接受编辑」之间切换，运行中立即生效，并在时间线留下记录。

## Project：Leader 带队的多智能体工作区

- 顶栏 **Project** 为一个目录打开独立窗口。打开过一次后，按钮会直接回到上次的目录，旁边的箭头可以另选文件夹；不同目录的 Project 窗口可以同时存在。
- Leader 先给出分步计划——步骤、负责人、验收标准——再按任务通过原生子代理自行组建团队，不预设固定阵容。需要可复用专员时，可在 `.relay/agents.json` 中声明。
- 侧栏团队面板显示实际成员、状态、任务摘要与逐成员 token；频道记录协作消息，成员抽屉保留完整过程。
- Worker 的思考与工具调用不会混入主时间线；权限审批会标明来自哪个 agent，worker 继承当前会话的权限模式。
- 主窗口与 Project 窗口的会话互相隔离，记忆与交接记录按目录共享。

## 技能：把重复工作变成一次点击

- 设置 → 技能会扫描全局与工作区两个目录，列出名称、描述与来源，逐项启停，下次启动会话时生效。
- 内置 5 个常用技能：`code-review`、`test-writer`、`explain-code`、`commit-message`、`repo-tour`。首次启动自动安装；未修改过的内置技能随版本升级，自己改过或同名的自建技能不会被覆盖。
- 采用标准的 `SKILL.md` 目录结构，可以直接使用 Claude Code 生态里的技能。

## 本地优先

- 自带 DeepSeek API Key 即可使用。密钥通过系统安全存储加密保存；系统安全存储不可用时只留在内存，不落明文。
- 没有账号、没有云端同步、没有使用数据上报。应用只访问你配置的 DeepSeek 端点。
- 会话、交接文档、记忆与设置全部保存在本机应用数据目录，工作区配置随项目走。

## 快速上手

Relay 只通过 GitHub Releases 分发安装包，不需要安装 Node.js 或任何开发环境。

到 [Releases](https://github.com/Antzer404/relay-harness/releases/latest) 下载对应版本：

| 平台 | 文件 | 要求 |
| --- | --- | --- |
| Windows | `Relay-1.0.0-win-x64.exe` | Windows 10 / 11，x64 |
| macOS | `Relay-1.0.0-mac-arm64.dmg` | macOS 13 Ventura 及以上，Apple Silicon（M 系列） |

**Windows**

1. 双击安装包。安装包尚未签名，出现 SmartScreen 时点「更多信息」→「仍要运行」。
2. 选择安装目录（默认当前用户目录，无需管理员权限），完成后从桌面或开始菜单启动。
3. 点右上角齿轮 → **API Key**，粘贴 DeepSeek 密钥（`sk-...`）并保存。
4. 左侧点「新会话」，选择工作目录，开始对话。

**macOS**

1. 打开 dmg，把 **Relay** 拖进「应用程序」。
2. 当前版本使用 ad-hoc 签名、尚未公证，首次启动请对 Relay **右键 → 打开**。若提示「已损坏」，在终端执行一次 `xattr -cr /Applications/Relay.app` 后重新打开。
3. 在设置 → **API Key** 填入 DeepSeek 密钥，然后新建会话。

首次启动会自动安装 5 个内置技能。模型、思考强度、权限模式都可以在设置里调整；需要团队协作时点顶栏的 **Project**。

## 系统要求

- Windows 10 / 11 x64，或 macOS 13 Ventura 及以上（Apple Silicon）。暂不提供 Intel Mac、Windows arm64 与 32 位 Windows。
- 自备 DeepSeek API Key，首次对话需要能访问 `api.deepseek.com`。

## 已知限制

- 两个平台的安装包都未签名、未公证：Windows 首次运行有 SmartScreen 提示，macOS 首次打开需要按上面的步骤放行。
- 没有自动更新，新版本需要下载安装包覆盖安装。
- 仅接入 DeepSeek；暂无账号体系与云端同步。
- Windows 版本尚未经过大规模真机兼容性测试，遇到安装或启动问题请附上系统版本与应用日志。

## 技术底座

Electron 44 + React 19 + TypeScript，状态管理使用 Zustand，界面为自行维护的毛玻璃样式。运行时锁定 `@anthropic-ai/claude-agent-sdk@0.3.303`，SDK 自带原生 CLI，用户无需另装 Claude Code；模型通过 DeepSeek 的 Anthropic 兼容端点接入。主进程、预加载与渲染层严格隔离，IPC 入参使用 zod 校验，渲染层不接触 Node。安装包由 electron-builder 产出：Windows NSIS 与 macOS dmg，SDK 原生二进制从 asar 中解包并按路径显式加载。

## 文档

- [当前版本发布说明](docs/release-notes.md)
- [开发与构建](docs/development.md)
- [命令行代理配置](docs/proxy-setup.md)
- [v1 技术方案](docs/v1-tech-proposal.md)

## 许可

TBD。
