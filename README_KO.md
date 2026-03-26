# dev-proxy

[![CI](https://github.com/reopt-ai/dev-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/reopt-ai/dev-proxy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.11-brightgreen.svg)](https://nodejs.org)

**서브도메인 기반 리버스 프록시 + 실시간 HTTP/WS 트래픽 인스펙터 TUI.**

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
- `.worktrees.json` 기반 Git worktree 동적 라우팅
- [mkcert](https://github.com/FiloSottile/mkcert)를 이용한 TLS 인증서 자동 생성
- 3단계 설정: 기본값 → 전역 → 프로젝트별

## 요구 사항

- **Node.js** >= 20.11
- **mkcert** _(선택, HTTPS용)_ — `brew install mkcert && mkcert -install`

## 빠른 시작

```bash
# 1. 설치
npm install -g dev-proxy

# 2. 설정 생성 (선택 — 없으면 localhost 기본값 사용)
mkdir -p ~/.dev-proxy
cat > ~/.dev-proxy/config.json << 'EOF'
{
  "domain": "example.dev",
  "routes": {
    "www": "http://localhost:3001",
    "api": "http://localhost:4000"
  }
}
EOF

# 3. 실행
dev-proxy
```

**Enter**를 눌러 인스펙터를 활성화한 뒤, 브라우저에서 `http://www.example.dev:3000`을 열어보세요.

## 설치

```bash
# npx (설치 없이)
npx dev-proxy

# 전역 설치
npm install -g dev-proxy

# 소스에서 실행
git clone https://github.com/reopt-ai/dev-proxy.git
cd dev-proxy && pnpm install && pnpm proxy
```

## 설정

설정은 세 단계로 로드되며, 나중 단계가 이전 값을 덮어씁니다:

1. **기본값** — `domain: "localhost"`, `port: 3000`, `httpsPort: 3443`
2. **`~/.dev-proxy/config.json`** — 전역 사용자 설정
3. **`.proxy.json`** — 프로젝트별 오버라이드 (cwd에서 상위 디렉토리로 탐색)

### 전역 설정 (`~/.dev-proxy/config.json`)

```json
{
  "domain": "example.dev",
  "port": 3000,
  "httpsPort": 3443,
  "defaultTarget": "http://localhost:3001",
  "routes": {
    "www": "http://localhost:3001",
    "studio": "http://localhost:3001",
    "api": "http://localhost:4000",
    "docs": "http://localhost:3003",
    "admin": "http://localhost:3002"
  }
}
```

### 프로젝트 오버라이드 (`.proxy.json`)

프로젝트 루트에 `.proxy.json`을 두면 전역 설정을 오버라이드할 수 있습니다. JSON 파싱 오류, 잘못된 포트, 지원하지 않는 URL 프로토콜은 시작 시 경고로 출력되고 해당 항목은 무시됩니다.

```json
{
  "routes": {
    "api": "http://localhost:4000",
    "oauth": "https://localhost:9443"
  },
  "certPath": "certs/dev+1.pem",
  "keyPath": "certs/dev+1-key.pem"
}
```

> `certPath`/`keyPath`는 `.proxy.json` 파일 위치 기준 상대 경로로 해석됩니다.

### HTTPS

인증서는 `~/.dev-proxy/certs/`에 저장됩니다. 인증서가 없으면 [mkcert](https://github.com/FiloSottile/mkcert)를 사용해 자동 생성합니다.

```bash
brew install mkcert
mkcert -install
```

mkcert가 설치되어 있으면 첫 실행 시 와일드카드 인증서를 자동 생성합니다. 수동 작업 불필요.

### Worktree 라우팅

dev-proxy는 Git worktree 기반 동적 라우팅을 지원합니다. 호스트명에 `branch--app.domain` 형태를 사용하면 워크트리별 포트로 라우팅됩니다.

**동작 방식:**

1. `.worktrees.json` 파일이 브랜치명과 포트를 매핑합니다:

```json
{
  "worktrees": {
    "feature-auth": { "port": 3101 },
    "fix-nav": { "port": 3102 }
  },
  "nextPort": 3103
}
```

2. `feature-auth--www.example.dev:3000`에 접속하면 `localhost:3101`로 라우팅
3. 파일을 실시간 감시 — 항목을 추가/제거하면 즉시 라우팅이 업데이트

여러 워크트리 체크아웃을 서로 다른 포트에서 동시에 실행하면서 설정 변경 없이 사용할 수 있습니다.

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
echo '{ "port": 3080 }' > .proxy.json
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

## 구조

```
src/
├── index.tsx              # 엔트리 (Ink render + 프록시 라이프사이클)
├── store.ts               # 외부 스토어 (useSyncExternalStore)
├── proxy/
│   ├── config.ts          # 설정 로더 (~/.dev-proxy + .proxy.json)
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
