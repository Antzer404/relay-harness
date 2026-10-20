# 开发与构建

面向需要从源码运行、调试、测试或发版的维护者。普通用户请直接从 [Releases](https://github.com/Antzer404/relay-harness/releases/latest) 下载安装包，不需要本文档。

## 环境要求

- Node.js ≥ 22.12
- npm
- Windows 10 / 11 或 macOS 13 Ventura 及以上

## 首次安装

中国网络环境下建议先切镜像。Electron 本体在安装依赖时下载，镜像必须在 `npm ci` 之前设置好：

```bash
npm config set registry https://registry.npmmirror.com
```

Windows PowerShell：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

macOS / Linux shell：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

然后安装依赖并启动：

```bash
npm ci        # postinstall 会自动下载 Electron 本体（约 200 MB）
npm run dev
```

Electron 44 起核心包不再自带 postinstall，二进制改为首次加载时懒下载；electron-vite 6 不会触发懒下载，因此项目根目录用 `postinstall: install-electron` 显式补齐。下载中断时重跑 `npm run postinstall` 即可，不需要重新 `npm ci`。

`git push`、`npm ci` 或 Electron 下载缓慢，通常是命令行没有走代理（Windows 系统代理不作用于 CLI）。按 [命令行代理配置](proxy-setup.md) 设置一次即可。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | electron-vite 开发模式，F12 打开 DevTools |
| `npm run typecheck` | 主进程与渲染层两套 TypeScript 检查 |
| `npm test` | Vitest 全量测试，含 SDK + 本地 mock 端点的闭环测试 |
| `npm run smoke` | 只跑 SDK 闭环，不需要真实 key |
| `npm run build:app` | 构建 main / preload / renderer 到 `out/` |
| `npm run preview` | 预览构建产物 |
| `npm run dist:win` | Windows x64 NSIS 安装包 |
| `npm run dist:mac` | 当前架构 dmg |
| `npm run dist:mac:arm64` | Apple Silicon dmg（发布用） |
| `npm run dist:mac:x64` | Intel Mac dmg |
| `npm run dist:dir` | 当前平台未打包目录 |
| `npm run verify:package` | 检查 `app.asar.unpacked` 中的 SDK CLI 是否存在 |

## 目录结构

```text
src/
  shared/        # 事件、IPC、设置类型与 zod schema（不依赖 Electron/Node）
  main/
    runtime/     # RuntimeAdapter、ClaudeAgentRuntime、事件归一化、diff 与 CLI 路径
    services/    # 配置与密钥、会话生命周期、交接、双轨记忆、技能、Project 阵容
    hosts.ts     # 主窗口 / Project 窗口的会话宿主与共享存储
    ipc.ts       # 类型化 IPC 与入参校验（按窗口路由）
    window.ts    # 窗口创建与窗口状态
    perf.ts      # GPU 合成能力检测与低特效判定
    index.ts     # 应用入口
  preload/       # contextBridge 暴露最小 window.relay
  renderer/      # React 19 + Zustand + 毛玻璃 CSS
tests/           # 归一化、diff、记忆、技能、Project 与 SDK 闭环测试
scripts/         # 打包产物校验、Windows 诊断脚本
resources/       # 随应用分发的内置技能（builtin-skills/<name>/SKILL.md）
docs/            # 方案、验证报告、发布说明与截图
build/           # 图标、macOS entitlements 等打包资源
```

## 运行环境调试

开发模式按 F12 打开 DevTools。

若 Windows 上 Chromium GPU 进程无法启动（虚拟机、远程桌面或受限显卡驱动），应用会继续以软件合成运行：主进程默认给 Chromium 传 `disable-gpu-process-crash-limit`，避免它在多次 GPU 启动失败后直接退出。启动日志会打印 `[relay] gpu compositing=...`；当合成器不是 `enabled` 时，界面自动进入低特效模式（去掉大面积毛玻璃与背景模糊、对话框直接显示），优先保证滚动和动画流畅。

仍可强制关闭硬件加速。Windows PowerShell：

```powershell
$env:RELAY_DISABLE_GPU="1"; npm run dev
```

macOS / Linux shell：

```bash
RELAY_DISABLE_GPU=1 npm run dev
```

该开关会追加 `disable-gpu`、`disable-gpu-compositing`、`disable-gpu-sandbox` 与 `in-process-gpu`，并打印 `[relay] hardware acceleration disabled` 确认生效。另有 `RELAY_NO_SANDBOX=1` 可在外部沙箱或策略阻止 Chromium 子进程启动时临时排查，仅用于开发。

## 测试

```bash
npm run typecheck
npm test
```

SDK 冒烟测试使用本地 mock 的 Anthropic 端点，验证流式事件、thinking 回传、工具权限、工具结果与多轮对话，不需要真实 API Key。测试的临时目录固定在仓库内 `.smoke-tmp/`，可用 `RELAY_SMOKE_BASE` 覆盖，不依赖系统 `TEMP`。

Windows 上如果 `%TEMP%` 目录存在权限或安全软件限制，可能导致 SDK 的原子写工具失败；优先使用仓库内临时目录，必要时：

```powershell
$env:RELAY_SMOKE_BASE="D:\RelayTestTmp"
npm test
```

## 打包

在目标系统上构建，npm 会安装对应平台的 SDK 原生包：

```bash
npm ci
npm run dist:win          # Windows x64（NSIS 安装包）
npm run dist:mac:arm64    # macOS Apple Silicon dmg
npm run verify:package    # 检查 app.asar.unpacked 中的 SDK CLI
```

产物输出到 `release/`。

`electron-builder.yml` 中的关键约定：

- `asarUnpack` 只解包 `@anthropic-ai/claude-agent-sdk-<platform>-<arch>` 原生包，SDK 的 JS 仍在 asar 内。
- `extraResources` 把 `resources/builtin-skills` 复制到安装包资源根，首次启动时安装到 `CLAUDE_CONFIG_DIR/skills`。
- macOS 目前使用 ad-hoc 签名（`mac.identity: '-'`）：Apple Silicon 要求至少临时签名才能启动，首次打开需右键 → 打开，或执行 `xattr -cr /Applications/Relay.app`。拿到 Developer ID 证书后，把 `identity` 换成证书名并打开公证。
- Windows 安装包未签名，首次运行会有 SmartScreen 提示。

## 发布流程

Release 由 [.github/workflows/build.yml](../.github/workflows/build.yml) 驱动：

1. 修改 `package.json` 版本号与 `docs/release-notes.md`，提交并推送 `main`。
2. 打 tag 并推送：

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. CI 并行执行两个平台任务：`macos-14` 构建 arm64 dmg，`windows-latest` 构建 x64 NSIS 安装包。两边都会先跑 typecheck、单测与 SDK 冒烟测试，并校验 SDK 原生二进制已解包出 asar。
4. 构建通过后自动创建**草稿 Release**，附 dmg、exe 与 `SHA256SUMS.txt`；在真机安装验收后，到 GitHub Releases 页面手动发布。

手动触发（`workflow_dispatch`）只构建并保留产物，不创建 Release。扩展平台时在 workflow 矩阵中添加对应行，并同步 `release` 步骤的文件匹配。

## 配置与数据位置

应用级数据位于 Electron 的 `userData` 目录：

- `settings.json`：应用默认设置、API Key 密文、窗口状态、内置技能清单版本等。
- `sessions/index.json` 与 `<session-id>.jsonl`：会话索引与持久事件流。
- `handoffs.json`：交接文档。
- `memory/user.json` 与 `memory/projects/<hash>.json`：双轨长期记忆。
- `claude-config/skills`：全局技能目录，也是内置技能的安装位置。

工作区级数据位于项目目录：

- `.relay/settings.json`：覆盖模型、思考强度、权限模式与追加系统提示。
- `.relay/settings.local.json`：按工具记录的授权。
- `.relay/memory.md`：记忆的只读镜像。
- `.relay/agents.json`：Project 可复用专员定义（可选）。
- `.claude/skills`：工作区技能。

## 常见问题

**`Error: Electron uninstall`**

Electron 44 的二进制没有随 `npm ci` 下载完整时会出现。重跑：

```bash
npm run postinstall
```

**`GPU process isn't usable. Goodbye.`**

用 `RELAY_DISABLE_GPU=1` 启动，或确认主进程已带 `disable-gpu-process-crash-limit`。界面会自动切到低特效模式。

**构建时报 `EPERM` 或无法清空 `out/`**

electron-vite 构建会先清空 `out/`。关闭正在运行的开发实例或预览窗口后重试；若文件被安全软件锁定，重启终端或放宽该目录的实时扫描。

**macOS 提示应用已损坏**

这是 ad-hoc 签名被 Gatekeeper 拦截，不是文件损坏：

```bash
xattr -cr /Applications/Relay.app
```

## 相关文档

- [当前版本发布说明](release-notes.md)
- [v1 技术方案](v1-tech-proposal.md)
- [M0 技术验证报告](m0-verification.md)
- [多智能体可行性与实施修订](multi-agent-feasibility.md)
- [命令行代理配置](proxy-setup.md)
