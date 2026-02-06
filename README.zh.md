# codex-account-orchestrator (CAO)

[![CI](https://github.com/DAWNCR0W/codex-account-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DAWNCR0W/codex-account-orchestrator/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codex-account-orchestrator.svg)](https://www.npmjs.com/package/codex-account-orchestrator)
[![npm downloads](https://img.shields.io/npm/dm/codex-account-orchestrator.svg)](https://www.npmjs.com/package/codex-account-orchestrator)
[![license](https://img.shields.io/npm/l/codex-account-orchestrator.svg)](LICENSE)
[![node](https://img.shields.io/node/v/codex-account-orchestrator.svg)](https://nodejs.org/)
[![typescript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Codex OAuth 账号编排工具。CAO 为每个账号创建独立的 `CODEX_HOME`，当额度用尽时自动切换到下一个账号。

Language: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | 中文 | [Español](README.es.md)

## CAO 的优势

- 额度耗尽时自动切换
- 网关模式，长会话不中断
- 状态摘要与健康检查
- 可分享的 Markdown/JSON 报告
- 账号级隔离，互不影响

## 环境要求

- Node.js 18+
- 已安装 Codex CLI，并在 PATH 中可用

## 安装

```bash
npm install -g codex-account-orchestrator
```

CLI 可用 `cao` 或 `codex-account-orchestrator` 运行。

## 快速开始

1. 添加账号

```bash
cao add accountA
cao add accountB
```

2. 选择默认账号

```bash
cao switch
```

3. 启动自动切换

```bash
cao run
```

要传递参数给 Codex，请放在 `--` 后面：

```bash
cao run -- exec "summarize README"
```

## 主要命令

| 命令 | 说明 |
| --- | --- |
| `cao add <name>` | 添加账号并登录 |
| `cao switch` | 交互式切换账号 |
| `cao current` | 显示当前默认账号 |
| `cao list` | 账号列表（简版） |
| `cao status` | 状态仪表盘（TTY）或简洁摘要 |
| `cao status --full` | 详细完整输出 |
| `cao status --compact` | 一行摘要 |
| `cao status --doctor` | 健康检查 |
| `cao status --report [md|json]` | 生成报告 |
| `cao run` | 自动切换运行 |
| `cao run --gateway` | 通过网关运行 |

## 可观测性

```bash
cao status                 # TTY 显示仪表盘，非 TTY 输出摘要
cao status --full          # 详细完整输出
cao status --compact       # 一行摘要
cao status --pretty        # 强制仪表盘输出
```

健康检查（0=ok, 1=warn, 2=error）：

```bash
cao status --doctor
cao status --doctor --json
```

报告：

```bash
cao status --report        # Markdown 报告
cao status --report json   # JSON 报告
```

## 网关模式（不中断会话）

启动网关：

```bash
cao gateway start
```

在 macOS 上，`cao gateway start` 也会通过 `launchctl` 导出 `OPENAI_BASE_URL`（这样从 Dock/Finder 启动的 Codex 桌面版也会走网关）。如需关闭：

```bash
cao gateway start --no-app-env
```

通过网关运行（CLI 自动切换关闭）：

```bash
cao run --gateway
```

## 工作原理

每个账号有独立目录：

```text
~/.codex-account-orchestrator/<account>/
```

每个账号都会生成 `config.toml`：

```toml
cli_auth_credentials_store = "file"
forced_login_method = "chatgpt"
```

## 数据布局

```text
~/.codex-account-orchestrator/
  registry.json
  account_status.json
  <account>/auth.json
  <account>/config.toml
```

## 快照导入（可选）

```bash
cao import codex-auth
cao import codex-auth --source ~/.codex/accounts
cao import codex-auth --overwrite
```

## 开发

```bash
npm install
npm run test
```

## 备注

- 自动切换会捕获输出，可能让 Codex 认为非 TTY。需要纯 TTY 时使用 `--no-fallback`。
- 额度检测基于关键字，可在 `src/constants.ts` 扩展。

## 更新记录

详见 `CHANGELOG.md`。
