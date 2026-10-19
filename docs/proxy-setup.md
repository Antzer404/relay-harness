# 命令行代理配置

Windows 的“系统代理”只对 WinINet 应用（浏览器、部分 GUI）生效，`git`、`npm`、Electron 下载器等命令行工具不会自动继承它。本项目的常见慢速场景——`git push`、`npm ci`、Electron 二进制下载——都需要单独配置。

以下示例假设代理客户端监听 `127.0.0.1:7890`（Clash / Mihomo 的 mixed 端口，同时接受 HTTP 与 SOCKS5）。如果你的客户端只开了纯 SOCKS 端口，请先在客户端里启用 mixed 端口，或把下面的 `http://` 改为对应端口。

## 1. 全局环境变量（一次设置，永久生效）

在 PowerShell 中执行：

```powershell
setx HTTP_PROXY  "http://127.0.0.1:7890"
setx HTTPS_PROXY "http://127.0.0.1:7890"
setx ALL_PROXY   "socks5://127.0.0.1:7890"
setx NO_PROXY    "localhost,127.0.0.1,::1"
```

`setx` 写入用户环境变量，只对**之后新开的终端**生效；当前窗口可用 `$env:HTTP_PROXY="http://127.0.0.1:7890"` 临时设置。

使用 `http://` 而不是 `socks5://` 作为 `HTTP(S)_PROXY`，是因为不少工具（npm、pip、各种 Node 库）只支持 HTTP 代理；mixed 端口两种协议都接受，这样覆盖率最高。`NO_PROXY` 必须包含 localhost，否则本地 mock 服务也会被绕进代理。

## 2. Git

Git 有自己的代理配置，显式设置最可靠。只对 GitHub 生效：

```powershell
git config --global http.https://github.com.proxy socks5h://127.0.0.1:7890
```

用 `socks5h://` 而不是 `socks5://`：前者让 DNS 也在代理侧解析，避免 DNS 污染导致“配了代理仍然连不上”。

如果之前配过全局代理需要清理：

```powershell
git config --global --unset http.proxy
git config --global --unset https.proxy
```

## 3. npm

npm 只支持 HTTP(S) 代理，不认 SOCKS：

```powershell
npm config set proxy http://127.0.0.1:7890
npm config set https-proxy http://127.0.0.1:7890
```

国内网络也可以不挂代理，直接切镜像源（与代理二选一即可）：

```powershell
npm config set registry https://registry.npmmirror.com
```

恢复默认：

```powershell
npm config delete proxy
npm config delete https-proxy
```

## 4. Electron / electron-builder 下载

`@electron/get` 不读系统代理，但支持显式开启：

```powershell
setx ELECTRON_GET_USE_PROXY "true"
setx GLOBAL_AGENT_HTTPS_PROXY "http://127.0.0.1:7890"
```

更稳妥的是使用镜像（README 快速开始已列出），镜像与代理二选一：

```powershell
setx ELECTRON_MIRROR "https://npmmirror.com/mirrors/electron/"
setx ELECTRON_BUILDER_BINARIES_MIRROR "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

Electron 44 起二进制改为首次加载时懒下载，由项目的 `postinstall` 触发；下载中断后重跑 `npm run postinstall` 即可，不必重新 `npm ci`。

## 5. 验证

```powershell
curl.exe -I https://github.com          # 返回 3xx/200 即通
git ls-remote https://github.com/Antzer404/relay-harness.git   # 能看到 refs
npm ping                                 # 返回 PONG
```

`git push` 的认证弹窗由 Git Credential Manager 处理，走系统浏览器登录，不受上述命令行代理影响；命令本身的传输走 `git config` 里的代理。

## 6. 常见问题

**配了环境变量但没效果**：`setx` 只对新终端生效，重开窗口再试；可用 `echo $env:HTTPS_PROXY` 确认当前窗口是否读到。

**git 仍超时**：检查是否被仓库级配置覆盖（`git config --show-origin --get-all http.proxy`），并确认用的是 `socks5h`。

**Node 的 `fetch` 不走代理**：Node 24 默认不读 `HTTP(S)_PROXY`，需要加 `NODE_USE_ENV_PROXY=1` 启动，或使用 `undici` 的 ProxyAgent。npm 不受影响，它按自身 config 走。

**不想全局挂代理**：把第 1 步改成只在具体终端会话里设置 `$env:` 变量，或在 `git` 配置里按域名限定（如第 2 步）。项目仓库中不要提交任何指向本机代理的配置。
