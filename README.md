# Relay ｜ 接力

桌面 Agent Harness —— 以 Claude Code 为运行时、接入 DeepSeek，带双轨记忆与跨会话交接。

> 状态：v1 技术方案已确定，M0 技术验证准备中。

## 文档

- [v1 技术方案（草案）](docs/v1-tech-proposal.md)

## 技术栈

Electron（≥40）· React 19 · TypeScript · electron-vite · Claude Agent SDK · better-sqlite3 · endfield-ui CSS kit · electron-builder

## 里程碑

- **M0 技术验证**：Electron + Agent SDK + DeepSeek 最小闭环、thinking 流、权限弹窗、双平台打包
- **M1 核心闭环**：会话管理、事件时间线、权限三态、上下文仪表
- **M2 记忆与交接**：双轨记忆、记忆面板、交接文档与接力链
- **M3 打包打磨**：安装包、签名公证、性能与 E2E

## 安全约定

- 仓库不包含任何 API Key 或凭据；密钥由应用通过系统安全存储（Electron safeStorage）保存。
- 提交前确认 `.env`、`*.local` 已被忽略。

## 许可

TBD
