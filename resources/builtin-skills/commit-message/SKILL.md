---
name: commit-message
description: 根据工作区变更生成 Conventional Commits 提交信息，必要时拆分提交并给出待执行的 git 命令。
---

# 提交信息

## 1. 看变更

- `git status` 确认改动范围；`git diff` 与 `git diff --cached` 看具体内容。
- `git log --oneline -10` 了解仓库的提交风格（中文/英文、scope 习惯）。
- 不把无关改动混进同一个提交；发现多件事时建议拆分。

## 2. 写信息

格式：`type(scope): summary`

- type：feat / fix / refactor / perf / test / docs / chore / build / ci。
- summary：祈使句、不超过 72 字符，说明「做了什么」而不是「改了哪些文件」。
- 正文（可选）：为什么改、行为影响、迁移注意；每行不超过 72 字符。
- 破坏性变更：单独一段 `BREAKING CHANGE:`。
- 语言跟随仓库既有风格；没有先例时用英文标题，正文可用中文。

## 3. 输出

有多件事时，为每个提交给出：

1. 建议 `git add` 的路径列表。
2. 完整提交信息（可直接复制）。
3. 对应的 `git commit -m ...` 命令。

## 约束

- 默认只生成信息与命令，**不要自行执行 git commit**；用户明确要求「帮我提交」时才执行。
- 不提交密钥、构建产物或临时文件；发现这类文件先提醒用户检查 .gitignore。
