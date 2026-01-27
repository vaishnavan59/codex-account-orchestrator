# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Upstream retry/backoff options for gateway requests

### Changed

- Gateway now retries transient 5xx/network errors with exponential backoff

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
