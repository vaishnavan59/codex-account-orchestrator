# codex-account-orchestrator (CAO)

[![CI](https://github.com/DAWNCR0W/codex-account-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DAWNCR0W/codex-account-orchestrator/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codex-account-orchestrator.svg)](https://www.npmjs.com/package/codex-account-orchestrator)
[![npm downloads](https://img.shields.io/npm/dm/codex-account-orchestrator.svg)](https://www.npmjs.com/package/codex-account-orchestrator)
[![license](https://img.shields.io/npm/l/codex-account-orchestrator.svg)](LICENSE)
[![node](https://img.shields.io/node/v/codex-account-orchestrator.svg)](https://nodejs.org/)
[![typescript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Codex OAuth アカウントのオーケストレーター。CAO はアカウントごとに `CODEX_HOME` を分離し、クォータ消費時に自動で次のアカウントへ切り替えます。

Language: [English](README.md) | [한국어](README.ko.md) | 日本語 | [中文](README.zh.md) | [Español](README.es.md)

## CAO の特徴

- クォータ枯渇時の自動フォールバック
- セッションを切らさないゲートウェイモード
- 状態サマリーとヘルスチェック
- 共有可能なレポート出力
- アカウントごとの完全分離

## 必要条件

- Node.js 18+
- Codex CLI が PATH にあること

## インストール

```bash
npm install -g codex-account-orchestrator
```

CLI は `cao` または `codex-account-orchestrator` で実行できます。

## クイックスタート

1. アカウント追加

```bash
cao add accountA
cao add accountB
```

2. デフォルト切り替え

```bash
cao switch
```

3. フォールバック実行

```bash
cao run
```

Codex 引数は `--` の後に渡します:

```bash
cao run -- exec "summarize README"
```

## 主要コマンド

| コマンド | 説明 |
| --- | --- |
| `cao add <name>` | アカウント追加とログイン |
| `cao switch` | 対話式で切り替え |
| `cao current` | 現在のデフォルトを表示 |
| `cao list` | アカウント一覧 (簡易) |
| `cao list --details` | 詳細ステータス |
| `cao status` | フルステータス |
| `cao status --compact` | 1 行サマリー |
| `cao doctor` | ヘルスチェック |
| `cao report` | レポート出力 |
| `cao run` | フォールバック実行 |
| `cao run --gateway` | ゲートウェイ経由 |

## 可視化

詳細ステータス:

```bash
cao status
```

1 行サマリー:

```bash
cao status --compact
```

ダッシュボード表示:

```bash
cao status --pretty
```

ヘルスチェック (0=ok, 1=warn, 2=error):

```bash
cao doctor
cao doctor --json
```

レポート:

```bash
cao report
cao report --format json
```

## ゲートウェイモード

ゲートウェイはセッションを維持したまま切り替えます。

```bash
cao gateway start
cao run --gateway
```

## 仕組み

アカウントごとのディレクトリ:

```text
~/.codex-account-orchestrator/<account>/
```

`config.toml` は各アカウントごとに作成されます:

```toml
cli_auth_credentials_store = "file"
forced_login_method = "chatgpt"
```

## データ配置

```text
~/.codex-account-orchestrator/
  registry.json
  account_status.json
  <account>/auth.json
  <account>/config.toml
```

## スナップショット取り込み (任意)

```bash
cao import codex-auth
cao import codex-auth --source ~/.codex/accounts
cao import codex-auth --overwrite
```

## 開発

```bash
npm install
npm run test
```

## ノート

- フォールバックは出力をキャプチャするため、TTY ではないと見なされる場合があります。必要なら `--no-fallback` を使ってください。
- クォータ検出はキーワードベースで、`src/constants.ts` で拡張できます。

## 変更履歴

`CHANGELOG.md` を参照してください。
