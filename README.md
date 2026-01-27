# codex-account-orchestrator (CAO)

[![CI](https://github.com/DAWNCR0W/codex-account-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DAWNCR0W/codex-account-orchestrator/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codex-account-orchestrator.svg)](https://www.npmjs.com/package/codex-account-orchestrator)
[![npm downloads](https://img.shields.io/npm/dm/codex-account-orchestrator.svg)](https://www.npmjs.com/package/codex-account-orchestrator)
[![license](https://img.shields.io/npm/l/codex-account-orchestrator.svg)](LICENSE)
[![node](https://img.shields.io/node/v/codex-account-orchestrator.svg)](https://nodejs.org/)
[![typescript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Codex OAuth account fallback orchestrator. CAO keeps **separate `CODEX_HOME` directories per account** and automatically falls back to the next account when quota is exhausted.

> If you juggle multiple Codex accounts, CAO removes the friction and keeps you moving.

## Highlights

- Per-account isolation via separate `CODEX_HOME` directories
- Automatic fallback on quota exhaustion (keyword-based detector)
- Gateway mode for seamless account switching without session drops
- Lightweight observability via `cao status` and `cao list --details`
- Interactive switching and codex-auth snapshot import
- Strict TypeScript build with a small, dependency-light CLI

## Requirements

- Node.js 18+
- Codex CLI installed and available on `PATH`

## Install (npm)

```bash
npm install -g codex-account-orchestrator
```

The CLI is available as `cao` (alias) or `codex-account-orchestrator`.

## Install (local dev)

```bash
npm install
npm run build
npm link  # Makes 'cao' command available globally
```

## Quick Start

### 1. Add accounts

```bash
cao add accountA
cao add accountB
```

`cao add` starts OAuth login by default and should open a browser window. Use `--no-login` to skip:

```bash
cao add accountA --no-login
```

If you prefer device auth:

```bash
cao add accountA --device-auth
```

### 2. Set the default account

```bash
cao use accountA
```

Or pick interactively:

```bash
cao switch
```

Check the current default account:

```bash
cao current
```

### 3. Run with fallback

```bash
cao run
```

To pass arguments to Codex, put them after `--`:

```bash
cao run -- exec "summarize README"
```

To recheck all accounts when everyone is quota-limited, use multiple passes:

```bash
cao run --max-passes 2 --retry-delay 5
```

## Account Status & Observability

### List accounts (quick)

```bash
cao list
```

### Detailed status (recommended)

```bash
cao status
```

### Compact summary

```bash
cao status --compact
```

You can also use:

```bash
cao list --details
```

### JSON output for scripting

```bash
cao status --json
```

This includes useful signals such as:

- Token expiry time
- Last refresh time
- Last attempt / success / quota-hit timestamps
- Cooldown window and consecutive failures

## Gateway Mode (No Session Drop)

Gateway mode keeps the Codex session open while switching accounts on quota errors. It requires routing Codex traffic through the local gateway.

### Start the gateway

```bash
cao gateway start
```

Run Codex through the gateway (no CLI fallback, gateway handles switching):

```bash
cao run --gateway
```

Tune upstream retry/backoff (for transient 5xx/network errors):

```bash
cao gateway start \
  --upstream-retries 2 \
  --upstream-retry-base-ms 200 \
  --upstream-retry-max-ms 2000 \
  --upstream-retry-jitter-ms 120
```

For troubleshooting, you can pass through the current Codex auth without overriding it:

```bash
cao gateway start --passthrough-auth
```

### Enable routing for Codex

```bash
cao gateway enable
```

This installs a small `codex` shim (in `~/.local/bin`) that sets `OPENAI_BASE_URL` to the gateway. You can revert with:

```bash
cao gateway disable
```

If `~/.local/bin` is not in your PATH, add it so the shim is used.

### Check gateway status

```bash
cao gateway status
```

## How It Works

- Each account is stored in its own `CODEX_HOME` directory: `~/.codex-account-orchestrator/<account>/`
- A `config.toml` is created with the following values:

```toml
cli_auth_credentials_store = "file"
forced_login_method = "chatgpt"
```

- On quota errors (detected via output keywords), the CLI re-runs Codex with the next account and can recheck all accounts for a configurable number of passes.
- CAO now persists lightweight status signals to `account_status.json` for visibility.

## Data Layout

Default base directory:

```text
~/.codex-account-orchestrator/
```

Key files:

- `registry.json`: registered accounts and default account
- `account_status.json`: persisted last-attempt/success/quota/cooldown signals
- `<account>/auth.json`: account-scoped tokens managed by Codex
- `<account>/config.toml`: account-scoped Codex configuration

## Migration from codex-auth

Import snapshots created by `codex-auth`:

```bash
cao import codex-auth
```

Custom source directory:

```bash
cao import codex-auth --source ~/.codex/accounts
```

Overwrite existing auth files if needed:

```bash
cao import codex-auth --overwrite
```

## Development

Build:

```bash
npm run build
```

Test (build + Node test runner):

```bash
npm run test
```

Run locally after build:

```bash
node dist/cli_main.js --help
```

## Notes

- Fallback requires capturing output; this may make Codex detect a non-TTY stdout. If you want a pure TTY session, use `--no-fallback`.
- The quota detector is keyword-based and can be extended in `src/constants.ts`.

## Changelog

See `CHANGELOG.md` for release notes and version history.
