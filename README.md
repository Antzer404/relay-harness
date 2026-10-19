# Relay ｜ 接力

桌面 Agent Harness —— 以 Claude Agent SDK 为运行时、接入 DeepSeek，带双轨记忆与跨会话交接。

> 状态：**M0 技术验证完成**。Electron + Agent SDK + DeepSeek 端点 + thinking 流 + 工具权限 + usage 仪表均已跑通；真实 DeepSeek key 的长会话回归待补测。详见 [M0 验证报告](docs/m0-verification.md)。

## 快速开始

要求：Node.js ≥ 22.12，Windows 10/11 或 macOS。

```bash
npm ci
npm run dev
```

首次启动在右侧 `SETUP` 面板填入 DeepSeek API Key（`sk-...`），保存后点左侧「新建会话」。

中国网络环境下可先切换镜像：

```bash
npm config set registry https://registry.npmmirror.com
# Windows PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

## 当前能力（M0）

- electron-vite 单包分层：`src/main`、`src/preload`、`src/renderer`、`src/shared`。
- `@anthropic-ai/claude-agent-sdk@0.3.303` 精确锁定；SDK 平台包自带 CLI，无需用户安装。
- DeepSeek Anthropic 兼容端点：`ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`，鉴权走 `ANTHROPIC_AUTH_TOKEN`。
- 密钥由主进程 `safeStorage` 加密保存；系统安全存储不可用时只保存在内存，不落明文。
- 最小控制台：流式文本、thinking 折叠块、工具调用卡、权限三态弹窗、上下文/成本仪表、事件轨迹、浅色/深色主题。
- 权限默认 `default`；`canUseTool` 三态（拒绝 / 本次允许 / 总是允许）；窗口关闭时自动拒绝挂起请求。
- 运行时与 UI 解耦：SDK 消息先归一化为自有 `HarnessEvent`，后续替换运行时不动界面。
- 打包：Windows NSIS/portable、macOS dmg；SDK 原生二进制通过 `asarUnpack` 解包并显式传入 `pathToClaudeCodeExecutable`。

尚未实现（M1/M2）：会话持久化与恢复、diff 卡、双轨记忆、交接、Cowork。

## 目录

```text
src/
  shared/        # 事件、IPC、设置类型与 zod schema（无 Electron/Node 依赖）
  main/
    runtime/     # RuntimeAdapter、ClaudeAgentRuntime、事件归一化、原生 CLI 路径
    services/    # 配置/密钥（safeStorage）、会话生命周期
    ipc.ts       # 类型化 IPC 与入参校验
    window.ts
    index.ts
  preload/       # contextBridge 暴露最小 window.relay
  renderer/      # React 19 + Zustand + endfield 风格 CSS
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
