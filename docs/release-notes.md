# Relay ｜ 接力 v0.1.0 — macOS Apple Silicon 预览版

桌面 Agent Harness：以 Claude Agent SDK 为运行时、接入 DeepSeek，带双轨长期记忆、跨会话交接与多智能体 Project 模式。本版本是首个面向 Apple Silicon Mac 的分发版本，**免安装开发环境，下载 dmg 即可使用**。

## 下载

| 文件 | 平台 |
| --- | --- |
| `Relay-0.1.0-mac-arm64.dmg` | macOS 13+（Ventura 及以上），Apple Silicon（M1/M2/M3/M4） |
| `SHA256SUMS.txt` | 安装包校验和 |

## 安装（首次打开需要一步放行）

本版本使用 ad-hoc 签名，尚未使用 Apple Developer 证书签名与公证，所以 macOS Gatekeeper 会拦截首次启动。这是预期行为，不是文件损坏。

1. 打开 dmg，把 **Relay** 拖进「应用程序」。
2. 首次启动：在「应用程序」里对 Relay **右键 → 打开**，在弹窗中再点「打开」。
   如果提示「Relay 已损坏，无法打开」，在终端执行下面这行命令后重新打开（只需一次）：

   ```bash
   xattr -cr /Applications/Relay.app
   ```

3. 在设置里填入 API Key：点右上角齿轮 → **API Key**，粘贴 DeepSeek 密钥（`sk-...`），保存后关闭设置。
4. 左侧点「新会话」开始使用。模型、思考强度、权限模式都可在设置或输入框左下角调整。

首次启动时应用会自动把 5 个内置技能安装到应用数据目录，无需手动配置。

## 要求

- Apple Silicon Mac（arm64），macOS 13 Ventura 或更高（Electron 44 的最低要求）。
- 自备 DeepSeek API Key（应用不内置任何凭据，密钥通过系统安全存储加密保存在本机）。
- 首次对话需要联网访问 `api.deepseek.com`。

## 本版本包含

- DeepSeek 接入、流式输出、思维链展示、工具权限卡片与「按工具授权」。
- 会话持久化与恢复、时间线虚拟滚动、文件 diff 卡、跨会话交接链。
- 双轨长期记忆（项目记忆 + 用户画像）与 5 个内置技能（代码审查 / 测试编写 / 代码讲解 / 提交信息 / 仓库导览）。
- Project 模式：为工作目录打开独立窗口，Leader 派发任务给架构 / 后端 / 前端 / 测试 worker。
- 错误分类与透明恢复、运行中排队、Esc 中断、软件渲染低特效回退。

## 已知限制

- 未签名、未公证：首次打开需要按上面的步骤放行；Windows 用户请等待后续版本。
- 没有自动更新，新版本需要重新下载 dmg 覆盖安装。
- 纯 BYO Key，仅接 DeepSeek；暂无账号体系与云端同步。
- 仅发布 arm64（Apple Silicon），Intel Mac 暂不提供。

## 校验

下载后可核对校验和：

```bash
shasum -a 256 Relay-0.1.0-mac-arm64.dmg
```

结果应与同页 `SHA256SUMS.txt` 中的值一致。
