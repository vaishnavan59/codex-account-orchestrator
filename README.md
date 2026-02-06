# codex-account-orchestrator (CAO)

[![CI](https://github.com/DAWNCR0W/codex-account-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DAWNCR0W/codex-account-orchestrator/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codex-account-orchestrator.svg)](https://www.npmjs.com/package/codex-account-orchestrator)
[![npm downloads](https://img.shields.io/npm/dm/codex-account-orchestrator.svg)](https://www.npmjs.com/package/codex-account-orchestrator)
[![license](https://img.shields.io/npm/l/codex-account-orchestrator.svg)](LICENSE)
[![node](https://img.shields.io/node/v/codex-account-orchestrator.svg)](https://nodejs.org/)
[![typescript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Codex OAuth account fallback orchestrator. CAO keeps separate `CODEX_HOME` directories per account and automatically falls back to the next account when quota is exhausted.

Language: English | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文](README.zh.md) | [Español](README.es.md)

## Why CAO

CAO focuses on long-running Codex sessions, resilience, and visibility.

- Automatic fallback on quota exhaustion
- Gateway mode for seamless account switching without session drops
- Health checks and compact status summaries
- Shareable Markdown or JSON reports
- Per-account isolation with separate `CODEX_HOME` directories

## Requirements

- Node.js 18+
- Codex CLI installed and available on `PATH`

## Install

```bash
npm install -g codex-account-orchestrator
```

The CLI is available as `cao` (alias) or `codex-account-orchestrator`.

## Quick Start

1. Add accounts

```bash
cao add accountA
cao add accountB
```

2. Select the default account

```bash
cao switch
```

3. Run with fallback

```bash
cao run
```

To pass arguments to Codex, put them after `--`:

```bash
cao run -- exec "summarize README"
```

## Core Commands

| Command | Description |
| --- | --- |
| `cao add <name>` | Add an account and log in |
| `cao switch` | Interactive account switch |
| `cao current` | Show current default account |
| `cao list` | List accounts (quick) |
| `cao status` | Status dashboard (TTY) or compact summary |
| `cao status --full` | Full verbose status |
| `cao status --compact` | One-line summaries |
| `cao status --doctor` | Health checks and exit codes |
| `cao status --report [md|json]` | Shareable report (Markdown/JSON) |
| `cao run` | Run with fallback |
| `cao run --gateway` | Route through gateway |

## Observability

```bash
cao status                 # pretty dashboard in TTY, compact otherwise
cao status --full          # verbose multi-line output
cao status --compact       # one-line summaries
cao status --pretty        # force the dashboard view
```

Health checks with exit codes (0=ok, 1=warn, 2=error):

```bash
cao status --doctor
cao status --doctor --json
```

Shareable reports:

```bash
cao status --report        # Markdown report
cao status --report json   # JSON report
```

## Gateway Mode (No Session Drop)

Gateway mode keeps the Codex session open while switching accounts on quota errors.

Start the gateway:

```bash
cao gateway start
```

On macOS, `cao gateway start` also exports `OPENAI_BASE_URL` via `launchctl` (so the Codex desktop app can route through the gateway when launched from Dock/Finder). You can disable this with:

```bash
cao gateway start --no-app-env
```

Run Codex through the gateway (CLI fallback disabled):

```bash
cao run --gateway
```

Enable routing for Codex:

```bash
cao gateway enable
```

Disable routing:

```bash
cao gateway disable
```

## How It Works

Each account lives under its own directory:

```text
~/.codex-account-orchestrator/<account>/
```

`config.toml` is created per account:

```toml
cli_auth_credentials_store = "file"
forced_login_method = "chatgpt"
```

On quota errors, CAO re-runs Codex with the next account and can recheck all accounts for multiple passes.

## Data Layout

```text
~/.codex-account-orchestrator/
  registry.json
  account_status.json
  <account>/auth.json
  <account>/config.toml
```

## Snapshot Import (Optional)

If you have snapshots from other tools, import them:

```bash
cao import codex-auth
cao import codex-auth --source ~/.codex/accounts
cao import codex-auth --overwrite
```

## Development

```bash
npm install
npm run test
```

## Notes

- Fallback captures output and may look like a non-TTY to Codex. Use `--no-fallback` if you want a pure TTY session.
- The quota detector is keyword-based and can be extended in `src/constants.ts`.

## Changelog

See `CHANGELOG.md` for release notes.
