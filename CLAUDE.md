# Gwave (fibo-lab) 작업 규칙

사이트: https://gwave-lab.vercel.app (Vercel 프로젝트 `fibo-lab`, 팀 ath-200-m, main 에 푸시하면 자동 배포)

## 어디서 작업하나 — 집 PC 연결 없이도 항상 가능하게
- 사용자는 폰·밖에서 수정 요청을 자주 함. **집 PC(Documents\fibo-lab)와 연결돼 있지 않다고 작업을 멈추지 말 것.**
- 기본 작업 장소는 GitHub 저장소 `genuinely8-svg/fibo-lab` 를 클라우드 작업 공간에 클론한 것.
  저장소 연결은 push 권한으로 붙이고(add_repo, access "push"), 바뀐 내용은 GitHub 에 푸시 → Vercel 이 배포.
- 집 PC 폴더는 사용자가 직접 PC 에서 작업할 때만 씀. PC 에서 시작하기 전에는 항상 `git pull` (start.bat 이 자동으로 함).

## 바꾸는 순서
1. 새 브랜치에서 수정 → 푸시하면 Vercel 이 테스트 주소(Preview)를 만들어 줌. 화면이 바뀌는 수정은 테스트 주소에서 확인.
2. 확인되면 main 에 합쳐서 푸시 (실제 사이트 반영). 아주 작은 수정(문구·정렬 등)은 바로 main 도 괜찮음.
3. 커밋 전에 `node bump.js` (html 안의 js/css 주소에 새 버전 번호 → 브라우저 캐시 문제 방지).

## 꼭 지킬 것
- 지표 계산 엔진은 `api/_lib/` 안에만 둠 (fib-core, lowsig-core, bot-core, sigbot-core). 웹 주소로 열리면 안 됨.
  브라우저로 계산 코드를 내려보내지 말고, 화면은 `api/fib`·`api/market`·`api/lowsig` 결과만 받아서 그림.
- 화면 문구·주석·차트에 계산 원리(피보나치, 깊이 비율 숫자, 기준 고점·저점 선, 이평 길이, ATR 배수 등)를 드러내지 않기. 깊이는 A/B/C 로만.
- 연구용 백테스트 페이지는 `research/` (배포 제외, .vercelignore). 사이트에 새로 올리지 않기.
- 비밀값(텔레그램 토큰·바이낸스 키·BOT_SECRET·TICK_SECRET·DB 토큰)은 저장소에 절대 넣지 않음 — Vercel 환경변수에만.
- 봇 타이머는 Upstash QStash (sigbot 5분, bot 15분)가 `fibo-lab-kappa.vercel.app/api/...` 를 부름.
  옛 주소는 화면만 gwave-lab 으로 이동시키고 /api 는 살려 둔 상태이므로 vercel.json 의 그 redirect 규칙을 지우지 말 것.
- 모든 페이지는 휴대폰에서 가로 스크롤 없이, 로고·메뉴 위치·페이지 폭은 탭을 옮겨도 그대로.
- 답변은 한국어로.
