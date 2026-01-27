# codex-account-orchestrator (CAO)

[![CI](https://github.com/DAWNCR0W/codex-account-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DAWNCR0W/codex-account-orchestrator/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codex-account-orchestrator.svg)](https://www.npmjs.com/package/codex-account-orchestrator)
[![npm downloads](https://img.shields.io/npm/dm/codex-account-orchestrator.svg)](https://www.npmjs.com/package/codex-account-orchestrator)
[![license](https://img.shields.io/npm/l/codex-account-orchestrator.svg)](LICENSE)
[![node](https://img.shields.io/node/v/codex-account-orchestrator.svg)](https://nodejs.org/)
[![typescript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Orquestador de cuentas OAuth de Codex. CAO mantiene un `CODEX_HOME` separado por cuenta y cambia automáticamente a la siguiente cuenta cuando se agota la cuota.

Language: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文](README.zh.md) | Español

## Por qué CAO

- Fallback automático cuando se agota la cuota
- Modo gateway sin cortar la sesión
- Resúmenes de estado y health checks
- Reportes en Markdown o JSON
- Aislamiento por cuenta

## Requisitos

- Node.js 18+
- Codex CLI instalado y disponible en `PATH`

## Instalación

```bash
npm install -g codex-account-orchestrator
```

El CLI está disponible como `cao` o `codex-account-orchestrator`.

## Inicio rápido

1. Agregar cuentas

```bash
cao add accountA
cao add accountB
```

2. Seleccionar cuenta por defecto

```bash
cao switch
```

3. Ejecutar con fallback

```bash
cao run
```

Para pasar argumentos a Codex, colócalos después de `--`:

```bash
cao run -- exec "summarize README"
```

## Comandos principales

| Comando | Descripción |
| --- | --- |
| `cao add <name>` | Agregar cuenta e iniciar sesión |
| `cao switch` | Cambio interactivo |
| `cao current` | Cuenta por defecto actual |
| `cao list` | Lista rápida de cuentas |
| `cao status` | Dashboard en TTY o resumen compacto |
| `cao status --full` | Estado completo (verbose) |
| `cao status --compact` | Resumen en una línea |
| `cao status --doctor` | Health checks |
| `cao status --report [md|json]` | Reporte en Markdown/JSON |
| `cao run` | Ejecutar con fallback |
| `cao run --gateway` | Ejecutar vía gateway |

## Observabilidad

```bash
cao status                 # Dashboard en TTY, resumen si no
cao status --full          # Salida completa (verbose)
cao status --compact       # Resumen en una línea
cao status --pretty        # Forzar dashboard
```

Health checks (0=ok, 1=warn, 2=error):

```bash
cao status --doctor
cao status --doctor --json
```

Reportes:

```bash
cao status --report        # Reporte Markdown
cao status --report json   # Reporte JSON
```

## Modo Gateway (sin cortar sesión)

Iniciar gateway:

```bash
cao gateway start
```

Ejecutar vía gateway (fallback del CLI desactivado):

```bash
cao run --gateway
```

## Cómo funciona

Cada cuenta vive en su propio directorio:

```text
~/.codex-account-orchestrator/<account>/
```

Se crea un `config.toml` por cuenta:

```toml
cli_auth_credentials_store = "file"
forced_login_method = "chatgpt"
```

## Estructura de datos

```text
~/.codex-account-orchestrator/
  registry.json
  account_status.json
  <account>/auth.json
  <account>/config.toml
```

## Importar snapshots (opcional)

```bash
cao import codex-auth
cao import codex-auth --source ~/.codex/accounts
cao import codex-auth --overwrite
```

## Desarrollo

```bash
npm install
npm run test
```

## Notas

- El fallback captura salida y puede hacer que Codex detecte un stdout no TTY. Usa `--no-fallback` si necesitas TTY puro.
- El detector de cuota es por palabras clave y se puede ampliar en `src/constants.ts`.

## Changelog

Consulta `CHANGELOG.md`.
