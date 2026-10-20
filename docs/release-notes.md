# Relay ｜ 接力 v1.0.0 — 首个正式版

桌面 Agent 工作台：以 Claude Agent SDK 为运行时、接入 DeepSeek，把思考、工具调用、文件改动与权限决定放在一条时间线上，并用交接链与双轨长期记忆支撑长时间任务。

这是 Relay 的第一个正式版本，同时提供 macOS Apple Silicon 与 Windows x64 安装包。

## 下载

| 文件 | 平台 |
| --- | --- |
| `Relay-1.0.0-mac-arm64.dmg` | macOS 13+（Ventura 及以上），Apple Silicon（M1/M2/M3/M4） |
| `Relay-1.0.0-win-x64.exe` | Windows 10 / 11，x64 |
| `SHA256SUMS.txt` | 安装包校验和 |

## 安装（Windows）

Windows 版本尚未使用代码签名证书，首次运行会出现 SmartScreen 提示，这是预期行为。

1. 双击 `Relay-1.0.0-win-x64.exe`。
2. 若出现「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」。
3. 选择安装目录（默认当前用户目录，无需管理员权限），完成安装后从桌面或开始菜单启动 Relay。
4. 点右上角齿轮 → **API Key**，粘贴 DeepSeek 密钥（`sk-...`），保存后关闭设置。
5. 左侧点「新会话」开始使用。模型、思考强度、权限模式都可在设置或输入框左下角调整。

如果企业安全软件或 Defender 拦截了安装包，请核对本页校验和后再决定是否放行；应用本身不联网上报数据，只访问你配置的 DeepSeek 端点。

## 安装（macOS）

本版本使用 ad-hoc 签名，尚未使用 Apple Developer 证书签名与公证，所以 macOS Gatekeeper 会拦截首次启动。这是预期行为，不是文件损坏。

1. 打开 dmg，把 **Relay** 拖进「应用程序」。
2. 首次启动：在「应用程序」里对 Relay **右键 → 打开**，在弹窗中再点「打开」。
   如果提示「Relay 已损坏，无法打开」，在终端执行下面这行命令后重新打开（只需一次）：

   ```bash
   xattr -cr /Applications/Relay.app
   ```

3. 在设置里填入 API Key（右上角齿轮 → **API Key**），然后新建会话。

两个平台首次启动时都会自动把 5 个内置技能安装到应用数据目录，无需手动配置。

## 要求

- macOS 13 Ventura 或更高，Apple Silicon（arm64）；或 Windows 10 / 11 x64。暂不提供 Intel Mac、Windows arm64 与 32 位 Windows。
- 自备 DeepSeek API Key（应用不内置任何凭据，密钥通过系统安全存储加密保存在本机）。
- 首次对话需要联网访问 `api.deepseek.com`。

## 本版本包含

- DeepSeek 接入、流式输出、思维链展示、工具权限卡片与按工具授权。
- 会话持久化与恢复、时间线虚拟滚动、文件 diff 卡、跨会话交接链。
- 双轨长期记忆（项目记忆 + 用户画像）与 5 个内置技能（代码审查 / 测试编写 / 代码讲解 / 提交信息 / 仓库导览）。
- Project 模式：为工作目录打开独立窗口，Leader 按任务自行组建团队并派发子代理，团队面板显示实际成员与频道；打开过一次后，Project 按钮会直接重开上次目录，也可从旁边菜单另选文件夹。
- 输入框支持中途插入：运行中 Enter 把消息并入当前回合（当前工具结束后模型即可读到），Ctrl+Enter 立即打断并回答，Esc 停止。
- 连续的思考与工具调用自动合并为可展开的「过程」行：运行中展开、完成后收起，长会话里每条用户指令都能一眼找到。
- 错误分类与透明恢复、软件渲染低特效回退。

## 从预览版升级

v0.1.x 的会话、设置与记忆保存在应用数据目录中。直接安装 v1.0.0 覆盖即可继续使用；如遇异常，可先备份应用数据目录再升级。

## 已知限制

- 两个平台的安装包都未签名、未公证：Windows 首次运行有 SmartScreen 提示，macOS 首次打开需按上面的步骤放行。
- 没有自动更新，新版本需要重新下载安装包覆盖安装。
- 纯 BYO Key，仅接 DeepSeek；暂无账号体系与云端同步。
- Windows 版本尚未经过大规模真机兼容性测试；如遇安装或启动问题，请附上系统版本与应用日志。

## 校验

macOS：

```bash
shasum -a 256 Relay-1.0.0-mac-arm64.dmg
```

Windows（PowerShell 或 CMD）：

```bat
certutil -hashfile Relay-1.0.0-win-x64.exe SHA256
```

结果应与同页 `SHA256SUMS.txt` 中的值一致。
