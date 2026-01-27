# codex-account-orchestrator

Codex OAuth account fallback orchestrator. It keeps **separate `CODEX_HOME` directories per account** and automatically falls back to the next account when quota is exhausted.

## Install (local dev)

```bash
npm install
npm run build
npm link  # Makes 'cao' command available globally
```

## Usage

### Add accounts

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

### Set default account

```bash
cao use accountA
```

### List accounts

```bash
cao list
```

### Remove an account

```bash
cao remove accountB
```

To keep files on disk:

```bash
cao remove accountB --keep-files
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
  - `forced_login_method = "chatgpt"`
- On quota errors (detected via output keywords), the CLI re-runs Codex with the next account and can recheck all accounts for a configurable number of passes.

## Gateway mode (no session drop)

Gateway mode keeps the Codex session open while switching accounts on quota errors. It requires routing Codex traffic through the local gateway.

### Start the gateway

```bash
cao gateway start
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

### Debug logging

Set `CAO_DEBUG_HEADERS=1` to log sanitized request/response headers in the gateway process. To capture the last request body for inspection, also set `CAO_CAPTURE_BODY=1` (saved to `/tmp/cao-last-body.json` by default).

## Notes

- Fallback requires capturing output; this may make Codex detect a non-TTY stdout. If you want a pure TTY session, use `--no-fallback`.
- The quota detector is keyword-based and can be extended in `src/constants.ts`.
