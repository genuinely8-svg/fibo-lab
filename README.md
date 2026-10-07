# ath TEST (참고용)

바이낸스(현물·선물) 캔들로 자체 진입 가격을 계산하고, 과거에 그 가격에 닿은 뒤 얼마나 반등했는지 통계를 내는 페이지입니다.

- 사이트: https://genuinely8-svg.github.io/fibo-lab/
- 설치할 것 없음. 브라우저가 바이낸스 공개 API를 직접 불러서 계산합니다.

## 내 컴퓨터에서 열기
`start.bat` 더블클릭 → http://localhost:3000 이 열립니다. (`index.html`을 더블클릭해도 됩니다)

## 페이지 (위쪽 탭)
| 탭 | 파일 | 데이터 |
|---|---|---|
| Signals | `index.html` | 바이낸스 캔들 → 진입 가격 통계 |
| Trading Engine (Artha Trading Engine) | `lowsig.html`, `lowsig-core.js` | 비트코인 전용 · 바이낸스 12시간봉 추세추종(v4) 신호, 차트 위 1m~12H 버튼으로 진입2·3·익절·SL 시각 확인 |
| (코인 상세) | `coin.html` | 바이낸스 + 코인게코 |
| 계산기 | `calc.html` | 수수료·펀딩비(바이낸스 실시간)·물타기/불타기 평단·청산가·복리 계산 |
| 청산히트맵 | `liquidation.html` | 바이낸스 OI로 추정한 청산 지도 + 실시간 청산 |
| OI | `oi.html` | 바이낸스 선물 OI·펀딩비·롱숏 비율 |
| 코인순위 | `rank.html` | 코인게코 시가총액 순위 |
| 24시간변동률 | `movers.html` | 비트겟 24시간 상승/하락 순위 |
| 주요뉴스 | `news.html` | 블록미디어·토큰포스트·CoinDesk RSS, 비트겟 공지 |

## 공통 파일
- `nav.js` — 위쪽 탭 메뉴 (탭 추가는 이 파일의 TABS 목록에 한 줄)
- `common.css`, `common.js` — 새 페이지들이 같이 쓰는 모양·도구
- `meta.js` — 코인 로고·이름·시가총액 순위, 코인이 아닌 상품(원자재·주식·금 토큰) 걸러내기
- `coinpicker.js` — 코인 검색 칸 (한글·영문·티커 자동완성, OI·청산히트맵 페이지)
- `fib-core.js` — 진입 가격 계산 엔진
- `chart.js` — 진입 차트 + 트레이딩뷰 탭
- `server.js`, `start.bat` — 내 컴퓨터에서 여는 작은 서버 (선택)

## 계산 방법

자체 계산 방식이라 공개하지 않아요.

참고용 도구이며 투자 조언이 아닙니다.

## 자동매매 봇 (관리자 모의투자 계정)
- `bot-core.js` — 양방향 추세추종 v4(12시간봉, 이평 400·돌파 40·ATR 28) 규칙. 롱 4배·숏 2배를 3번에 나눠 진입, 손절은 모의투자 SL 주문 (진입2·3이 체결되는 순간 손절선을 바로 다시 계산해서 한 번 손실을 계좌 2% 근처로 묶음)
- `api/bot.js` — 관리자(ADMIN_NICKNAME) 계정의 모의투자에만 주문. `Authorization: Bearer <BOT_SECRET>` 필요
- `.github/workflows/bot.yml` — 15분마다 `/api/bot` 호출 + `/api/lowsig` 미리 계산
- `api/lowsig.js` — Trading Engine 과거 검증 결과. 12시간봉이 마감되면 한 번만 1분봉으로 정확히 계산해서 DB에 저장, 방문자는 저장된 결과만 받음
- 설정: Vercel 환경변수 `BOT_SECRET` + GitHub 저장소 Secrets `BOT_SECRET` (같은 값). 멈추려면 Vercel 에 `BOT_PAUSED=1`
- 봇이 잡은 BTC 포지션을 수동으로 닫으면 봇은 다음 신호까지 기다려요. 관리자 계정에서 BTC 교차 포지션을 직접 잡지 마세요


## Signals 자동매매 봇 (모의투자 test 계정)
- `sigbot-core.js` — Signals 탭(LONG, 기본 설정) 진입 신호 규칙. 상태가 "진입 구간"이 되면 코인당 (자산×10배)의 1%를 3번에 나눠 매수(교차 10배)
  · 손절폭 = 평균 반등 ÷ 2, 1차 진입가 / 2차 -손절폭⅓ / 3차 -손절폭⅔, 손절 = 진입가 -손절폭, 익절 = 예상 반등가 (첫 진입가 기준 고정)
  · 동시 최대 10개 (기대값 높은 순), 같은 진입가로는 한 번만, 끝나면 남은 분할 주문 취소
- `api/sigbot.js` — 1시간봉이 새로 시작되면 50개 코인 다시 계산(DB `sigbot:scan`), 매번 현재가로 상태 확인 후 주문. 계정은 `SIGBOT_NICKNAME`(기본 test)
- `.github/workflows/sigbot.yml` — 5분마다 `/api/sigbot` 호출 (BOT_SECRET 같이 씀). 멈추려면 Vercel 에 `SIGBOT_PAUSED=1`
- test 계정에서 봇이 잡은 코인과 같은 코인을 직접 롱(교차)으로 잡지 마세요 (포지션이 합쳐짐)
