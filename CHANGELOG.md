# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.2] - 2026-02-06

### Fixed

- `cao gateway start` now exports `OPENAI_BASE_URL` via `launchctl` on macOS so Codex Desktop launched from Dock/Finder routes through the gateway (`--no-app-env` disables this).

## [1.4.1] - 2026-02-06

### Fixed

- `cao gateway enable` now updates `~/.codex/config.toml` to route Codex via the configured gateway URL
- Gateway config update now ensures `~/.codex/` exists before writing `config.toml`

## [1.4.0] - 2026-01-27

### Added

- `cao status --pretty` dashboard view (TTY default)
- `cao status --doctor` and `cao status --report` consolidated flags

### Changed

- `cao status` now defaults to a dashboard in TTY and compact output otherwise
- `cao doctor` and `cao report` are deprecated (status flags preferred)
- `cao list --details` removed in favor of `cao status`
- Added Chinese and Spanish README translations

## [1.3.0] - 2026-01-27

### Added

- `cao doctor` health checks with JSON output and exit codes
- `cao report` for Markdown/JSON shareable account summaries
- Interactive account switching (`cao switch`) and `cao current` convenience command
- Optional `cao run --gateway` to route traffic through the gateway without CLI fallback
- `cao status --pretty` for a framed dashboard view

### Changed

- README emphasizes CAO’s unique observability and reporting features
- Added Korean and Japanese README translations
- Added Chinese and Spanish README translations

## [1.2.0] - 2026-01-27

### Added

- `cao switch` interactive account picker and `cao current` convenience command
- `cao status --compact` for one-line per-account summaries
- `cao import codex-auth` to migrate snapshots from codex-auth
- `cao run --gateway` for running through the local gateway without CLI fallback

### Changed

- Gateway status now includes token expiry and last refresh hints
- README expanded with migration, switching, and gateway run guidance

## [1.1.1] - 2026-01-27

### Fixed

- Made `npm run test` bash-compatible by using `node --test test/*.test.js`
- Restored CI stability across the GitHub Actions Node.js matrix

## [1.1.0] - 2026-01-27

### Added

- `cao status` command for detailed per-account inspection
- `cao list --details` for quick detailed status views
- Persisted account signals in `account_status.json` (attempt/success/quota/cooldown)
- Node.js test suite for the account status store

### Changed

- Gateway and fallback flows now update persisted account status signals
- CI now runs tests (build + Node test runner)
- README refreshed with badges, observability guidance, and clearer quick-start flows

### Fixed

- Eliminated shared empty-registry state in account status loading

## [1.0.2] - 2026-01-27

### Added

- Upstream retry/backoff options for gateway requests

### Changed

- Gateway now retries transient 5xx/network errors with exponential backoff
- Gateway ignores aborted client requests and guards stream writes
- Gateway config values are sanitized to avoid invalid overrides

## [1.0.1] - 2026-01-27

### Added

- Global npm install instructions and expanded debug options in README

### Changed

- Hardened registry and gateway config loading with automatic corruption backups
- Improved gateway config path resolution via `os.homedir()`
- Made codex shim resolution more robust when `codex` is missing from PATH

## [1.0.0] - 2025-01-27

### Added

- Account management with separate CODEX_HOME directories per account
- OAuth login support with browser and device auth flows
- Automatic fallback to next account on quota exhaustion
- Gateway mode for seamless account switching without session drops
- Codex shim installation for transparent traffic routing
- Token refresh and session management
- Configurable cooldown and retry settings
- Debug logging with header sanitization

### Commands

- `cao add <name>` - Register a new account
- `cao list` - List registered accounts
- `cao use <name>` - Set default account
- `cao remove <name>` - Remove an account
- `cao run` - Run codex with automatic fallback
- `cao gateway start` - Start local gateway server
- `cao gateway enable` - Install codex routing shim
- `cao gateway disable` - Remove shim and restore config
- `cao gateway status` - Show gateway and account status
