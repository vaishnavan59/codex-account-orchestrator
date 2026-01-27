# codex-account-orchestrator (CAO)

[![CI](https://github.com/DAWNCR0W/codex-account-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DAWNCR0W/codex-account-orchestrator/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codex-account-orchestrator.svg)](https://www.npmjs.com/package/codex-account-orchestrator)
[![npm downloads](https://img.shields.io/npm/dm/codex-account-orchestrator.svg)](https://www.npmjs.com/package/codex-account-orchestrator)
[![license](https://img.shields.io/npm/l/codex-account-orchestrator.svg)](LICENSE)
[![node](https://img.shields.io/node/v/codex-account-orchestrator.svg)](https://nodejs.org/)
[![typescript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Codex OAuth 계정 오케스트레이터. CAO는 계정마다 별도의 `CODEX_HOME`을 만들고, 쿼터가 소진되면 자동으로 다음 계정으로 전환합니다.

Language: [English](README.md) | 한국어 | [日本語](README.ja.md) | [中文](README.zh.md) | [Español](README.es.md)

## CAO의 강점

- 쿼터 소진 시 자동 폴백
- 세션이 끊기지 않는 게이트웨이 모드
- 상태 요약과 헬스체크
- 공유 가능한 보고서 출력
- 계정별 완전 격리

## 요구 사항

- Node.js 18+
- Codex CLI 설치 및 PATH 등록

## 설치

```bash
npm install -g codex-account-orchestrator
```

CLI는 `cao` 또는 `codex-account-orchestrator`로 실행합니다.

## 빠른 시작

1. 계정 추가

```bash
cao add accountA
cao add accountB
```

2. 기본 계정 선택

```bash
cao switch
```

3. 폴백 실행

```bash
cao run
```

Codex 인자를 넘길 때는 `--` 뒤에 넣습니다:

```bash
cao run -- exec "summarize README"
```

## 주요 명령어

| 명령어 | 설명 |
| --- | --- |
| `cao add <name>` | 계정 추가 및 로그인 |
| `cao switch` | 대화형 계정 전환 |
| `cao current` | 현재 기본 계정 표시 |
| `cao list` | 계정 목록 (간단) |
| `cao list --details` | 상세 상태 출력 |
| `cao status` | 전체 상태 출력 |
| `cao status --compact` | 한 줄 요약 |
| `cao doctor` | 헬스체크 및 종료 코드 |
| `cao report` | 보고서 생성 |
| `cao run` | 폴백 실행 |
| `cao run --gateway` | 게이트웨이 경유 |

## 관측성

상세 상태:

```bash
cao status
```

한 줄 요약:

```bash
cao status --compact
```

대시보드 보기:

```bash
cao status --pretty
```

헬스체크 (0=ok, 1=warn, 2=error):

```bash
cao doctor
cao doctor --json
```

보고서:

```bash
cao report
cao report --format json
```

## 게이트웨이 모드

게이트웨이는 세션을 유지한 채 계정을 전환합니다.

```bash
cao gateway start
cao run --gateway
```

## 동작 방식

계정별 디렉터리 구조:

```text
~/.codex-account-orchestrator/<account>/
```

`config.toml`은 계정마다 생성됩니다:

```toml
cli_auth_credentials_store = "file"
forced_login_method = "chatgpt"
```

## 데이터 레이아웃

```text
~/.codex-account-orchestrator/
  registry.json
  account_status.json
  <account>/auth.json
  <account>/config.toml
```

## 스냅샷 가져오기 (선택)

```bash
cao import codex-auth
cao import codex-auth --source ~/.codex/accounts
cao import codex-auth --overwrite
```

## 개발

```bash
npm install
npm run test
```

## 참고

- 폴백 모드는 출력 캡처로 인해 TTY가 아닌 것처럼 보일 수 있습니다. 순수 TTY가 필요하면 `--no-fallback`을 사용하세요.
- 쿼터 감지는 키워드 기반이며 `src/constants.ts`에서 확장할 수 있습니다.

## 변경 이력

`CHANGELOG.md`를 참고하세요.
