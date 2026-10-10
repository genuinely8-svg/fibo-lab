/* bt-examples.js — 백테스트 탭 예시 스크립트 + AI 에게 줄 작성 규칙 */
window.BT_SPEC = `Gwave 백테스트 스크립트 작성 규칙 (자바스크립트, 브라우저에서 실행)

쓸 수 있는 것 (await 사용 가능):
- await candles(sym, interval, from, opts)
    → [{t, o, h, l, c, v}] 오래된 것부터, 마감된 봉만. t 는 ms 시각(UTC)
    sym: "BTC", "ETH" 처럼 USDT 를 뺀 기호 / interval: "1m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w"
    from: "2020-01-01" 또는 ms / opts.market: "futures"(바이낸스 선물, 기본) 또는 "spot"
- ta.sma(arr, n), ta.ema(arr, n), ta.rsi(arr, n), ta.atr(candles, n), ta.highest(arr, n), ta.lowest(arr, n)
    → 입력과 같은 길이의 배열 (앞부분은 NaN)
- stats(equity, seed) → { 시작, 최종, 수익률, 최대 낙폭 }
- log(...) 진행 상황 글자, progress(0~1) 진행 막대

마지막에 결과를 return 하세요:
return {
  summary: { "수익률": "12.3%", ... },     // 위쪽 숫자 카드 (키: 이름, 값: 글자나 숫자)
  equity: [[t, 자산], ...],                 // 자산 곡선 (선 그래프, 연도별 손익은 자동 계산)
  trades: [{ 시각: t, 구분: "매수", 가격: 123, ... }, ...]   // 매매 기록 표 (최대 1000줄 표시)
};

규칙:
- 맨 위에 SEED, 수수료, 비중, 손절 % 같은 설정 숫자를 const 로 모아 둘 것 (사용자가 숫자만 바꿔 다시 돌림)
- 수수료는 체결 금액의 0.05% 로 계산, 같은 봉 안에서 손절·익절이 둘 다 가능하면 손절이 먼저라고 가정
- 화면 접근(document, window, localStorage)은 안 됨. 외부 라이브러리 없이 순수 자바스크립트로`;

window.BT_EXAMPLES = [
{ name: "예시 1 · 비트코인 이평선 교차 (4시간봉)", code: `// 비트코인 4시간봉: 빠른 이평이 느린 이평을 위로 뚫으면 매수, 아래로 뚫으면 매도 (현물처럼 레버리지 없음)
const SEED = 10000;      // 시작 금액 (USDT)
const FEE = 0.0005;      // 수수료 0.05%
const FAST = 50, SLOW = 200;
const START = "2020-01-01";

const cs = await candles("BTC", "4h", START);
const c = cs.map(x => x.c), f = ta.ema(c, FAST), s = ta.ema(c, SLOW);
let cash = SEED, qty = 0, entry = 0;
const trades = [], equity = [];
for (let i = 1; i < cs.length; i++) {
  const p = c[i];
  if (!qty && f[i - 1] <= s[i - 1] && f[i] > s[i]) {
    qty = cash * (1 - FEE) / p; entry = p; cash = 0;
    trades.push({ 시각: cs[i].t, 구분: "매수", 가격: p });
  } else if (qty && f[i - 1] >= s[i - 1] && f[i] < s[i]) {
    cash = qty * p * (1 - FEE);
    trades.push({ 시각: cs[i].t, 구분: "매도", 가격: p, 수익률: ((p / entry - 1) * 100).toFixed(2) + "%" });
    qty = 0;
  }
  if (i % 6 === 0 || i === cs.length - 1) equity.push([cs[i].t, cash + qty * p]);
}
const sells = trades.filter(t => t.구분 === "매도");
return {
  summary: { ...stats(equity, SEED), "매매 수": sells.length, "승률": (sells.filter(t => parseFloat(t.수익률) > 0).length / (sells.length || 1) * 100).toFixed(0) + "%" },
  equity, trades,
};` },
{ name: "예시 2 · 비트·이더·솔라나 교차 물타기 (RSI 진입)", code: `// 비트코인 1시간봉 RSI 가 기준 아래로 내려가면 시작 → 비트코인을 3번 나눠 물타기,
// 비트코인 1차 때 이더 1차 / 2차 때 이더 2차 + 솔라나 1차 / 3차 때 이더 3차 + 솔라나 2차.
// 익절은 비트코인 기준으로 셋 다 같이, 손절은 비트코인 첫 진입가 기준으로 셋 다 분할.
const SEED = 56000;
const FEE = 0.0005;
const BTC_QTY = [0.1, 0.2, 0.4];      // 비트코인 1·2·3차 수량 (이더·솔라나도 같은 금액 비율 1:2:4)
const ADD_AT = [0, 1.5, 3];           // 1·2·3차 가격: 첫 진입가에서 몇 % 아래 (0 = 바로)
const TP = 2;                         // 익절: 첫 진입가 +2% 에 셋 다 정리
const CUTS = [3, 4, 5];               // 첫 진입가 -3%·-4%·-5% 에서 각각 10% 씩 정리
const CUT_FRAC = 0.1;
const ALL_OUT = 6;                    // -6% 에서 전부 손절
const RSI_N = 14, RSI_IN = 25;        // 진입 조건: RSI(14) 25 아래
const START = "2020-01-01";

log("가격 데이터 받는 중…");
const btc = await candles("BTC", "1h", START), eth = await candles("ETH", "1h", START), sol = await candles("SOL", "1h", START);
const E = new Map(eth.map(x => [x.t, x.c])), S = new Map(sol.map(x => [x.t, x.c]));
const rsi = ta.rsi(btc.map(x => x.c), RSI_N);

let cash = SEED, pos = {}, cyc = null;
const trades = [], equity = [];
const buy = (s, q, p) => { const P = pos[s] || (pos[s] = { q: 0, cost: 0 }); P.q += q; P.cost += q * p; cash -= q * p * FEE; };
const sellFrac = (s, frac, p) => { const P = pos[s]; if (!P) return 0; const q = P.q * frac, avg = P.cost / P.q, pnl = q * (p - avg) - q * p * FEE;
  cash += pnl; P.q -= q; P.cost -= q * avg; if (P.q < 1e-12) delete pos[s]; return pnl; };
const priceOf = (s, t, btcPx) => s === "BTC" ? btcPx : (s === "ETH" ? E : S).get(t);
const closeAll = (frac, t, btcPx) => { let sum = 0; for (const s of Object.keys(pos)) { const p = priceOf(s, t, btcPx); if (p) sum += sellFrac(s, frac, p); } return sum; };

for (let i = 1; i < btc.length; i++) {
  const b = btc[i], t = b.t;
  if (!cyc && rsi[i - 1] < RSI_IN) cyc = { t, L: b.o, k: 0, c: 0, pnl: 0 };
  if (cyc) {
    // 불리한 가격부터 차례대로 (물타기·분할손절·전량손절)
    const ev = [];
    for (let k = cyc.k; k < 3; k++) ev.push([cyc.L * (1 - ADD_AT[k] / 100), "add", k]);
    for (let c = cyc.c; c < CUTS.length; c++) ev.push([cyc.L * (1 - CUTS[c] / 100), "cut", c]);
    ev.push([cyc.L * (1 - ALL_OUT / 100), "all"]);
    ev.sort((a, z) => z[0] - a[0]);
    for (const [p0, ty, k] of ev) {
      if (b.l > p0) continue;
      const p = Math.min(p0, b.o);
      if (ty === "add" && k === cyc.k) {
        const usd = BTC_QTY[0] * p * (BTC_QTY[k] / BTC_QTY[0]);
        buy("BTC", BTC_QTY[k], p);
        if (E.get(t)) buy("ETH", usd / E.get(t), E.get(t));
        if (k >= 1 && S.get(t)) buy("SOL", BTC_QTY[0] * p * (BTC_QTY[k - 1] / BTC_QTY[0]) / S.get(t), S.get(t));
        cyc.k++;
      } else if (ty === "cut" && k === cyc.c && cyc.k) { cyc.pnl += closeAll(CUT_FRAC, t, p); cyc.c++; }
      else if (ty === "all" && cyc.k) { cyc.pnl += closeAll(1, t, p); cyc.out = "손절"; break; }
    }
    if (!cyc.out && b.h >= cyc.L * (1 + TP / 100)) { cyc.pnl += closeAll(1, t, cyc.L * (1 + TP / 100)); cyc.out = cyc.c ? "분할손절 후 익절" : "익절"; }
    if (cyc.out) { trades.push({ 시작: cyc.t, 끝: t, 물타기: cyc.k + "차", 결과: cyc.out, 손익: Math.round(cyc.pnl) }); cyc = null; pos = {}; }
  }
  if (i % 24 === 0) { let u = 0; for (const s in pos) { const p = priceOf(s, t, b.c); if (p) u += pos[s].q * (p - pos[s].cost / pos[s].q); } equity.push([t, cash + u]); }
  if (i % 5000 === 0) progress(i / btc.length);
}
const win = trades.filter(x => x.손익 > 0), lose = trades.filter(x => x.손익 <= 0);
const avg = a => Math.round(a.reduce((s, x) => s + x.손익, 0) / (a.length || 1));
return {
  summary: { ...stats(equity, SEED), "매매 수": trades.length, "승률": (win.length / (trades.length || 1) * 100).toFixed(0) + "%", "평균 수익": avg(win), "평균 손실": avg(lose) },
  equity, trades,
};` },
];
