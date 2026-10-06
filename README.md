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
| (코인 상세) | `coin.html` | 바이낸스 + 코인게코 |
| 계산기 | `calc.html` | 수수료·펀딩비(바이낸스 실시간)·물타기/불타기 평단·청산가 계산 |
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
- `bot-core.js` — 양방향 추세추종 v4(12시간봉, 이평 400·돌파 40·ATR 28) 규칙. 롱 4배·숏 2배를 3번에 나눠 진입, 손절은 모의투자 SL 주문
- `api/bot.js` — 관리자(ADMIN_NICKNAME) 계정의 모의투자에만 주문. `Authorization: Bearer <BOT_SECRET>` 필요
- `.github/workflows/bot.yml` — 15분마다 `/api/bot` 호출
- 설정: Vercel 환경변수 `BOT_SECRET` + GitHub 저장소 Secrets `BOT_SECRET` (같은 값). 멈추려면 Vercel 에 `BOT_PAUSED=1`
- 봇이 잡은 BTC 포지션을 수동으로 닫으면 봇은 다음 신호까지 기다려요. 관리자 계정에서 BTC 교차 포지션을 직접 잡지 마세요

