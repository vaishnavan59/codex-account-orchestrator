# codex-account-orchestrator

Codex OAuth account fallback orchestrator. It keeps **separate `CODEX_HOME` directories per account** and automatically falls back to the next account when quota is exhausted.

## Install (local dev)

```bash
npm install
npm run build
```

## Usage

### Add accounts

```bash
cao add accountA
cao add accountB
```

`cao add` starts OAuth login by default. Use `--no-login` to skip:

```bash
cao add accountA --no-login
```

If you prefer device auth:

```bash
cao add accountA --device-auth
```

### Set default account

```bash
cao use accountA
```

### Run with fallback

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

### Run a specific account (no fallback)

```bash
cao run --no-fallback --account accountB -- codex
```

### Custom data directory

```bash
cao --data-dir /path/to/data run -- codex
```

## How it works

- Each account is stored in its own `CODEX_HOME` directory under:
  - `~/.codex-account-orchestrator/<account>/`
- A `config.toml` is created with:
  - `cli_auth_credentials_store = "file"`
  - `preferred_auth_method = "chatgpt"`
- On quota errors (detected via output keywords), the CLI re-runs Codex with the next account and can recheck all accounts for a configurable number of passes.

## Notes

- Fallback requires capturing output; this may make Codex detect a non-TTY stdout. If you want a pure TTY session, use `--no-fallback`.
- The quota detector is keyword-based and can be extended in `src/constants.ts`.
