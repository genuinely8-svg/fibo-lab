# Gwave (fibo-lab) 작업 규칙

사이트: https://gwave-lab.vercel.app (Vercel 프로젝트 `fibo-lab`, 팀 ath-200-m, main 에 푸시하면 자동 배포)

## 어디서 작업하나 — 집 PC든 밖(폰·클라우드)이든 똑같이
- 사용자는 집 PC(Documents\fibo-lab)와 밖(Claude 앱 → 클라우드 작업 공간)에서 번갈아 작업함. **GitHub 의 main 이 항상 유일한 최신본.**
- 사용자에게 `git pull`·`git push`·"PC 연결" 같은 확인이나 절차를 절대 요구하지 말 것. Claude 가 알아서 맞춤:
  - 작업 시작: 최신 main 받기 (`.claude/settings.json` 의 SessionStart 훅이 자동으로 git pull. 실패하면 로컬 변경을 커밋하고 `git pull --rebase` 로 합친 뒤 진행)
  - 작업 끝: 커밋하고 `git push origin main` 까지 (묻지 말고). 로컬에만 남겨 두지 않기.
  - 푸시가 막히면(다른 쪽이 먼저 올림) `git pull --rebase` 후 다시 푸시.
- 집 PC 연결이 안 돼 있어도 작업을 멈추지 말 것: 클라우드에서는 저장소 `genuinely8-svg/fibo-lab` 를 push 권한으로 붙여(add_repo, access "push") 클론해서 작업.

## 바꾸는 순서
1. 화면이 크게 바뀌는 수정은 새 브랜치에서 → 푸시하면 Vercel 이 테스트 주소(Preview)를 만들어 줌. 화면이 바뀌는 수정은 테스트 주소에서 확인.
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
