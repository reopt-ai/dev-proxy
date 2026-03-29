# dev-proxy

[![npm](https://img.shields.io/npm/v/@reopt-ai/dev-proxy)](https://www.npmjs.com/package/@reopt-ai/dev-proxy)
[![CI](https://github.com/reopt-ai/dev-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/reopt-ai/dev-proxy/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/reopt-ai/dev-proxy/branch/main/graph/badge.svg)](https://codecov.io/gh/reopt-ai/dev-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.11-brightgreen.svg)](https://nodejs.org)
[![npm downloads](https://img.shields.io/npm/dm/@reopt-ai/dev-proxy)](https://www.npmjs.com/package/@reopt-ai/dev-proxy)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/reopt-ai/dev-proxy/badge)](https://scorecard.dev/viewer/?uri=github.com/reopt-ai/dev-proxy)

**서브도메인 기반 리버스 프록시 + 실시간 HTTP/WS 트래픽 인스펙터 TUI.**

수십 개의 서비스, 워크트리, AI 에이전트 코딩 세션이 동시에 돌아가는 에이전틱 개발 환경을 위해 만들었습니다 — 하나의 프록시로 전부 라우팅하고, 하나의 터미널로 전부 봅니다.

`*.{domain}:3000`으로 들어오는 요청을 서브도메인별로 로컬 서비스에 라우팅하고, 모든 트래픽을 터미널 대시보드로 실시간 모니터링합니다. Charles나 Proxyman의 가벼운 터미널 버전이라고 생각하면 됩니다 — 로컬 멀티서비스 개발에 특화되어 있습니다.

[English Documentation](README.md)

![dev-proxy 스크린샷](docs/screenshot.png)

## 왜 dev-proxy인가?

프론트엔드, API, 인증, 문서, 어드민 등 여러 로컬 서비스를 동시에 개발할 때 서브도메인 라우팅과 트래픽 모니터링이 필요합니다. 기존 도구들은 너무 무겁거나(nginx, Caddy) GUI 전용(Charles, Proxyman)입니다.

dev-proxy는:

- **제로 설정 시작** — `localhost` 기본값과 TLS 인증서 자동 생성으로 바로 실행
- **터미널 네이티브** — 브라우저 창 없이 터미널에서 바로 확인
- **Vim 스타일 네비게이션** — `j`/`k`로 탐색, `/`로 검색, `r`로 재전송
- **Worktree 지원** — `branch--app.domain` 형태로 워크트리별 포트 자동 라우팅
- **경량** — 런타임 의존성 2개(`ink` + `react`), ~10fps 스로틀 렌더링

## 주요 기능

- HTTP 요청/응답 실시간 모니터링 (메서드, 상태, 크기, 지연시간)
- WebSocket 연결 추적 (OPEN / CLOSED / ERROR)
- Request/Response 헤더, 쿠키, 쿼리 파라미터 인스펙션
- 노이즈 필터 (`_next/`, `favicon`), 에러 전용 모드, URL/메서드 검색
- 원본 헤더 포함 요청 재전송 및 curl 클립보드 복사
- 업스트림 `http`/`https`, `ws`/`wss` 타깃 지원
- 프로젝트 설정 기반 Git worktree 동적 라우팅
- [mkcert](https://github.com/FiloSottile/mkcert)를 이용한 TLS 인증서 자동 생성
- 프로젝트 기반 설정: 전역 (`~/.dev-proxy/config.json`) + 프로젝트별 (`.dev-proxy.json`)

## 요구 사항

- **Node.js** >= 20.11
- **mkcert** _(선택, HTTPS용)_ — `brew install mkcert && mkcert -install`

## 빠른 시작

### 사람용

```bash
npm install -g @reopt-ai/dev-proxy
dev-proxy init
dev-proxy
```

**Enter**를 눌러 인스펙터를 활성화한 뒤, 브라우저에서 `http://www.example.dev:3000`을 열어보세요.

### LLM 에이전트용

AI 코딩 에이전트(Claude Code, Cursor, Copilot 등)에 이 프롬프트를 붙여넣으세요:

> Install and configure dev-proxy by following the instructions here:
> https://raw.githubusercontent.com/reopt-ai/dev-proxy/main/docs/guide/installation.md

## 설치

```bash
# npx (설치 없이)
npx @reopt-ai/dev-proxy

# 전역 설치
npm install -g @reopt-ai/dev-proxy

# 소스에서 실행
git clone https://github.com/reopt-ai/dev-proxy.git
cd dev-proxy && pnpm install && pnpm proxy
```

## 설정

설정은 두 단계로 구성됩니다:

1. **`~/.dev-proxy/config.json`** — 전역 설정 (도메인, 포트, TLS, 프로젝트 목록)
2. **`.dev-proxy.json`** — 프로젝트별 설정 (라우트, 워크트리)

### 전역 설정 (`~/.dev-proxy/config.json`)

```json
{
  "domain": "example.dev",
  "port": 3000,
  "httpsPort": 3443,
  "projects": ["/path/to/your/project"]
}
```

### 프로젝트 설정 (`.dev-proxy.json`)

`projects`에 등록된 각 프로젝트 루트에 `.dev-proxy.json`을 배치합니다. 라우트와 워크트리를 여기에 정의합니다.

```json
{
  "routes": {
    "www": "http://localhost:3001",
    "studio": "http://localhost:3001",
    "api": "http://localhost:4000",
    "*": "http://localhost:3001"
  },
  "worktrees": {
    "feature-auth": { "port": 4001 }
  }
}
```

- `"*"`는 와일드카드 — 매칭되지 않는 서브도메인이 이 타깃으로 라우팅됩니다
- 여러 프로젝트가 같은 서브도메인을 등록하면 먼저 등록된 것이 우선
- `certPath`/`keyPath`는 전역 설정에서 지정하며, `~/.dev-proxy/` 기준 상대 경로로 해석됩니다

### HTTPS

인증서는 `~/.dev-proxy/certs/`에 저장됩니다. 인증서가 없으면 [mkcert](https://github.com/FiloSottile/mkcert)를 사용해 자동 생성합니다.

```bash
brew install mkcert
mkcert -install
```

mkcert가 설치되어 있으면 첫 실행 시 와일드카드 인증서를 자동 생성합니다. 수동 작업 불필요.

### Worktree 라우팅

dev-proxy는 Git worktree 기반 동적 라우팅을 지원합니다. 호스트명에 `branch--app.domain` 형태를 사용하면 워크트리별 포트로 라우팅됩니다.

**자동 라이프사이클 관리:**

프로젝트의 `.dev-proxy.json`에 `worktreeConfig`를 추가합니다. `services`로 서브도메인별 포트 매핑을 정의하면 dev-proxy가 포트를 자동 할당하고 `.env.local`을 생성하여 dev 서버가 어떤 포트에서 listen할지 알 수 있습니다:

```json
{
  "routes": {
    "www": "http://localhost:3001",
    "data": "http://localhost:4001",
    "*": "http://localhost:3001"
  },
  "worktrees": {
    "main": { "ports": { "www": 3001, "data": 4001 } }
  },
  "worktreeConfig": {
    "portRange": [4101, 5000],
    "directory": "../myproject-{branch}",
    "services": {
      "www": { "env": "PORT" },
      "data": { "env": "DATA_PORT" }
    },
    "envFile": ".env.local",
    "hooks": {
      "post-create": "pnpm install",
      "post-remove": "echo cleanup done"
    }
  }
}
```

한 줄로 워크트리를 생성/제거합니다:

```bash
dev-proxy worktree create feature-auth
# → git worktree add
# → 포트 할당: www=4101, data=4102
# → .env.local 생성: PORT=4101, DATA_PORT=4102
# → post-create 훅 실행 (pnpm install)

dev-proxy worktree destroy feature-auth
# → post-remove 훅 실행, git worktree remove, 포트 해제
```

**라우팅 방식:**

- `feature-auth--www.example.dev:3000` → 포트 4101 (www 서비스)로 라우팅
- `feature-auth--data.example.dev:3000` → 포트 4102 (data 서비스)로 라우팅
- 설정 파일 실시간 감시 — 변경 즉시 라우팅 업데이트
- 미등록 워크트리는 silent fallback 없이 오프라인 에러 페이지 표시

**수동 모드** (`worktreeConfig` 없이):

```bash
dev-proxy worktree add feature-auth 4001    # 단일 포트 등록 (git 조작 없음)
dev-proxy worktree remove feature-auth      # 해제만
```

## 실행

```bash
# 전역 설치 또는 npx로
dev-proxy

# 소스에서
pnpm proxy

# 디버그 모드 (tsx, 빌드 생략)
pnpm proxy:src
```

`pnpm proxy`는 `dist/`를 빌드한 뒤 `NODE_ENV=production`으로 실행합니다. Ink/React dev-mode 메모리 누수를 방지하기 위한 기본 동작입니다.

### UI 상태

TUI는 세 가지 상태를 가집니다:

1. **Splash** — 설정된 라우트와 리스닝 포트 표시. **Enter**를 눌러 활성화.
2. **Inspect** — 실시간 트래픽 대시보드 (목록 + 상세 패널).
3. **Standby** — 60초 미조작 시 자동 슬립하여 메모리 부담 감소. **I** 또는 **Enter**로 복귀.

## 키바인딩

### 네비게이션

| 키        | 동작                           |
| --------- | ------------------------------ |
| `←` / `→` | 리스트 / 상세 패널 포커스 전환 |
| `j` / `↓` | 다음 요청                      |
| `k` / `↑` | 이전 요청                      |
| `g`       | 첫 요청으로 이동               |
| `G`       | 마지막 요청으로 이동           |
| `Enter`   | 상세 패널 열기                 |
| `Esc`     | 리스트로 복귀 / 검색 초기화    |

### 상세 패널

| 키        | 동작             |
| --------- | ---------------- |
| `↑` / `↓` | 상세 내용 스크롤 |

> 상세 패널에 포커스하면 Follow 모드가 자동 해제되어 새 요청이 들어와도 선택이 유지됩니다.

### 필터 & 기능

| 키  | 동작                                      |
| --- | ----------------------------------------- |
| `/` | 검색 모드 (URL, 메서드 필터)              |
| `f` | Follow 모드 토글                          |
| `n` | 노이즈 필터 토글 (`_next`, `favicon` 등)  |
| `e` | 에러만 표시 토글                          |
| `x` | 트래픽 + 필터 전체 초기화                 |
| `r` | 선택된 요청 재전송 (원본 헤더 포함)       |
| `y` | 선택된 요청을 curl로 시스템 클립보드 복사 |

### 마우스

- 리스트 또는 상세 패널에서 **스크롤**
- 행을 **클릭**하여 선택
- 헤더의 필터 뱃지를 **클릭**하여 토글

## 보안

이 도구는 **개발 전용**이며, 로컬 개발 편의를 위해 의도적인 트레이드오프가 있습니다:

- **`rejectUnauthorized: false`** — 업스트림 타깃의 자체 서명 인증서를 허용합니다. mkcert나 자체 서명 인증서를 사용하는 개발 서비스가 추가 설정 없이 동작하기 위한 것입니다. **프로덕션에서 사용하지 마세요.**
- **인증 없음** — 프록시는 기본적으로 localhost에 바인딩되며 인증 레이어가 없습니다.

## 문제 해결

### 포트가 이미 사용 중

```
Error: port 3000 is already in use (another dev-proxy instance may already be running)
```

기존 프로세스를 종료하거나 다른 포트를 사용하세요:

```bash
# 찾아서 종료
lsof -ti :3000 | xargs kill

# 또는 포트 변경
echo '{ "routes": { "*": "http://localhost:3080" } }' > .dev-proxy.json
```

### mkcert를 찾을 수 없음

```
HTTPS disabled — mkcert not found.
```

HTTPS는 선택 사항입니다. TLS 지원이 필요하면 mkcert를 설치하세요:

```bash
brew install mkcert    # macOS
mkcert -install
```

### 빈 화면 / Raw mode 에러

`Raw mode is not supported` 메시지가 보이면 비-TTY 환경(파이프, CI 등)에서 실행 중인 것입니다. dev-proxy는 대화형 터미널이 필요합니다.

### 요청이 예상 타깃으로 라우팅되지 않음

1. 스플래시 화면에서 설정된 라우트 목록을 확인하세요
2. `Host` 헤더가 `subdomain.domain:port` 형식과 일치하는지 확인하세요
3. 타깃 서비스가 설정된 포트에서 실제로 실행 중인지 확인하세요

## CLI 레퍼런스

| 명령어                                 | 설명                                       |
| -------------------------------------- | ------------------------------------------ |
| `dev-proxy`                            | 프록시 시작 + 트래픽 인스펙터              |
| `dev-proxy init`                       | 인터랙티브 설정 위자드                     |
| `dev-proxy status`                     | 현재 설정 및 라우팅 테이블                 |
| `dev-proxy doctor`                     | 환경 진단                                  |
| `dev-proxy config`                     | 글로벌 설정 조회                           |
| `dev-proxy config set <key> <value>`   | 글로벌 설정 수정 (domain, port, httpsPort) |
| `dev-proxy project add [path]`         | 프로젝트 등록 (기본: cwd)                  |
| `dev-proxy project remove <path>`      | 프로젝트 해제                              |
| `dev-proxy project list`               | 등록된 프로젝트 목록                       |
| `dev-proxy worktree create <branch>`   | 워크트리 생성 (자동 포트 + 훅 실행)        |
| `dev-proxy worktree destroy <branch>`  | 워크트리 제거 (훅 실행 + 정리)             |
| `dev-proxy worktree add <name> <port>` | 워크트리 수동 등록 (git 조작 없음)         |
| `dev-proxy worktree remove <name>`     | 워크트리 수동 해제                         |
| `dev-proxy worktree list`              | 워크트리 목록                              |
| `dev-proxy --help`                     | 도움말                                     |
| `dev-proxy --version`                  | 버전                                       |

## 구조

```
src/
├── cli.ts                 # 서브커맨드 라우터
├── index.tsx              # TUI 대시보드 (Ink render + 프록시 라이프사이클)
├── store.ts               # 외부 스토어 (useSyncExternalStore)
├── commands/              # CLI 서브커맨드 (Ink 컴포넌트)
│   ├── init.tsx           # 인터랙티브 설정 위자드
│   ├── status.tsx         # 설정 개요
│   ├── doctor.tsx         # 환경 진단
│   ├── config.tsx         # 설정 조회/수정
│   ├── project.tsx        # 프로젝트 관리
│   ├── worktree.tsx       # 워크트리 관리
│   ├── help.tsx           # 도움말
│   └── version.tsx        # 버전
├── bootstrap.ts           # 시작 부트스트래퍼 (설정 로드, 프록시 초기화)
├── cli/                   # 공용 CLI 컴포넌트
│   ├── config-io.ts       # 설정 I/O 헬퍼 및 포트 할당
│   └── output.tsx         # 출력 컴포넌트 (Header, Section, Check 등)
├── proxy/
│   ├── config.ts          # 설정 로더 (~/.dev-proxy + .dev-proxy.json)
│   ├── server.ts          # HTTP/WS 리버스 프록시
│   ├── routes.ts          # 서브도메인 → 타깃 라우팅
│   ├── certs.ts           # TLS 인증서 해석 (mkcert)
│   ├── worktrees.ts       # 동적 워크트리 포트 레지스트리
│   └── types.ts           # 이벤트 타입
├── components/
│   ├── app.tsx             # 루트 (리사이즈, 키보드, 상태 머신)
│   ├── splash.tsx          # 스플래시 화면
│   ├── status-bar.tsx      # 상단 상태바
│   ├── request-list.tsx    # 요청 목록 (뷰포트 슬라이싱)
│   ├── detail-panel.tsx    # 상세 패널 (스크롤)
│   └── footer-bar.tsx      # 하단 키바인딩 힌트
├── hooks/
│   └── use-mouse.ts        # SGR 마우스 이벤트 파서
└── utils/
    ├── format.ts           # 색상 팔레트, 포매터
    └── list-layout.ts      # 반응형 컬럼 레이아웃
```

## 기여

개발 설정과 가이드라인은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## 라이선스

[MIT](LICENSE)
