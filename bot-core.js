/*
  bot-core.js — 양방향 추세추종 v4 (12시간봉 신호, 일봉 환산 기간) 자동매매 규칙
  ---------------------------------------------------------------
  트레이딩뷰 지표 "양방향 추세추종 v4 (12시간 신호)"와 같은 규칙을 모의투자 계정에 그대로 적용해요.
  대상: 비트코인(BTCUSDT) + 이더리움(ETHUSDT) — 코인마다 따로 같은 규칙으로 (상태도 따로: BTC = user.bot, ETH = user.bots.ETHUSDT)
  - 롱: 12시간봉 종가 > 400개 이평 + 직전 40개 최고가 돌파 → 진입1, ATR(28) 1·2배 더 오르면 진입2·진입3
  - 숏: 12시간봉 종가 < 400개 이평 + 직전 40개 최저가 이탈 → 진입1, ATR 1·2배 더 내리면 진입2·진입3
  - 한 번 진입 = 계좌의 (롱 4배 / 숏 2배) ÷ 3  (진입1 때의 자산 기준)
  - 손절: 계좌의 2%를 잃는 가격, 평단이 유리해지면 따라옴 + 추적 손절(최고/최저가 ∓ ATR x 3)
    진입2·3이 체결되는 순간 손절선을 바로 다시 계산 (체결 즉시 손절선 올리기)
    → 모의투자의 SL 주문으로 걸어 두어서 가격이 닿는 순간 청산돼요
  - 청산: 12시간봉 종가가 400개 이평 반대편이면 시장가로 청산
  step() 은 15분마다 불려요. 불타기는 매번 현재가로 확인하고, 나머지는 12시간봉이 새로 마감됐을 때만 처리해요.
*/
"use strict";
const P = {
  sym: "BTCUSDT", syms: ["BTCUSDT", "ETHUSDT"], tf: 12 * 3600e3, trendLen: 400, boLen: 40, atrLen: 28,
  levL: 4, levS: 2, add1: 1, add2: 2, lossPct: 2, trail: 3,
  lev: 10, mode: "cross",          // 모의투자 주문 설정 (교차 10배: 증거금만 정하는 값, 실제 노출은 위 levL/levS 로 정해짐)
};
const LOG_MAX = 100;

// 닫힌 봉 배열 → 각 봉의 이평·ATR·직전 N개 최고/최저 (트레이딩뷰 ta.sma / ta.atr(RMA) / ta.highest[1] 과 같은 계산)
function calc(B) {
  const N = B.length, ma = Array(N).fill(NaN), atr = Array(N).fill(NaN), hh = Array(N).fill(NaN), ll = Array(N).fill(NaN);
  let s = 0;
  for (let i = 0; i < N; i++) { s += B[i].c; if (i >= P.trendLen) s -= B[i - P.trendLen].c; if (i >= P.trendLen - 1) ma[i] = s / P.trendLen; }
  let trSum = 0;
  for (let i = 0; i < N; i++) {
    const tr = i ? Math.max(B[i].h - B[i].l, Math.abs(B[i].h - B[i - 1].c), Math.abs(B[i].l - B[i - 1].c)) : B[i].h - B[i].l;
    if (i < P.atrLen) { trSum += tr; if (i === P.atrLen - 1) atr[i] = trSum / P.atrLen; }
    else atr[i] = (atr[i - 1] * (P.atrLen - 1) + tr) / P.atrLen;
  }
  for (let i = P.boLen; i < N; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = i - P.boLen; j < i; j++) { if (B[j].h > h) h = B[j].h; if (B[j].l < l) l = B[j].l; }
    hh[i] = h; ll[i] = l;
  }
  return { ma, atr, hh, ll };
}

const fresh = () => ({ side: 0, lastT: null, log: [] });
function flat(b) { b.side = 0; b.n = 0; b.pid = null; b.e1 = b.a0 = b.stop = b.ext = b.base = null; b.fills = []; }

/*
  user: 관리자 계정 ({st, bot, bots}), bars: 12시간봉 [{t,o,h,l,c,ct}] (오래된 것부터), cur: 현재가, now: 지금(ms), E: paper-engine
  sym: "BTCUSDT"(기본) | "ETHUSDT"
  반환 { dirty, log: [이번에 한 일] }
*/
function stateOf(user, sym) {
  if (sym === "BTCUSDT") return user.bot || (user.bot = fresh());           // 예전부터 쓰던 자리 그대로
  user.bots = user.bots || {};
  return user.bots[sym] || (user.bots[sym] = fresh());
}
function step(user, bars, cur, now, E, sym = "BTCUSDT") {
  const st = user.st;
  const b = stateOf(user, sym);
  if (!b.log) b.log = [];
  const log = [];
  let dirty = false;
  const coin = sym.replace(/USDT$/, "");
  const say0 = msg => { log.push(msg); b.log.unshift({ t: now, msg }); if (b.log.length > LOG_MAX) b.log.length = LOG_MAX; dirty = true; };
  const say = msg => say0(`[${coin}] ${msg}`);
  const sideName = s => (s === 1 ? "long" : "short");
  const lbl = s => (s === 1 ? "롱" : "숏");
  const fx = v => Math.round(v * 100) / 100;
  const pos = () => (b.pid != null ? st.pos.find(x => x.id === b.pid && x.side === sideName(b.side)) : null);

  const closed = bars.filter(k => k.ct < now);
  if (closed.length < P.trendLen + 2) { say("12시간봉 데이터가 부족해서 이번엔 건너뜀"); return { dirty, log }; }
  const I = calc(closed), i = closed.length - 1, k = closed[i];

  // 1) 봇 포지션이 SL·청산·수동 청산으로 이미 닫혔는지 확인
  if (b.side && !pos()) {
    const tr = st.th.find(x => x.id === b.pid);
    say(`${lbl(b.side)} 포지션 종료 확인 (${tr ? tr.reason : "포지션 없음"}${tr ? `, ${fx(tr.exit)}` : ""})`);
    b.blockT = Math.floor(((tr ? tr.t : now) - 1) / P.tf) * P.tf;   // 지표처럼, 청산이 일어난 12시간봉의 마감 때는 새로 진입하지 않음
    flat(b);
  }

  // 처음 켰을 때: 지금 봉까지는 넘기고 다음 12시간봉 마감부터 신호 확인
  if (b.lastT == null) {
    b.lastT = k.t; flat(b);
    say("자동매매 시작 — 다음 12시간봉 마감(오전·오후 9시)부터 신호 확인");
    return { dirty, log };
  }

  // 한 번 진입분 주문 (시장가, 교차 10배, SL 같이)
  // ref = 지표 기준 가격(진입1은 12시간봉 종가, 불타기는 진입2·3 가격). 손절선 계산은 이 값으로 해서 차트의 손절선과 똑같이 맞춰요
  function buy(s, why, ref) {
    const lev = s === 1 ? P.levL : P.levS;
    const qty = Math.floor(b.base * lev / 3 / cur * 1e5) / 1e5;
    const r = E.placeOrder(st, { sym, side: sideName(s), lev: P.lev, mode: P.mode, qty, type: "market", sl: b.stop }, cur, now);
    b.pid = r.pos.id; b.fills.push(ref); b.n = b.fills.length;
    say(`${lbl(s)} ${why} ${qty} ${coin} @ ${fx(cur)} · 손절 ${fx(b.stop)}`);
  }
  // 불타기: ext(유리한 쪽 극값)가 진입2·3 가격에 닿았으면 현재가로 추가
  // 체결 즉시 손절선 올리기: 추가하는 순간 "지금까지 산 물량 전체가 손절돼도 계좌 2%만 잃는 가격"으로 손절선을 다시 계산해서
  // 같은 주문의 SL 로 같이 걸어요 (12시간봉 마감까지 기다리지 않음 → 불타기 직후 급반전에도 한 번 손실이 2% 근처로 묶임)
  function pyramid(ext) {
    const s = b.side;
    while (b.side && b.n < 3) {
      const lvl = b.e1 + s * b.a0 * (b.n === 1 ? P.add1 : P.add2);
      if (!(s === 1 ? ext >= lvl : ext <= lvl)) break;
      const n2 = b.n + 1, avg2 = (b.fills.reduce((a, x) => a + x, 0) + lvl) / n2;
      const dist2 = b.e1 * 3 * P.lossPct / (100 * (s === 1 ? P.levL : P.levS) * n2);
      const ns = s === 1 ? Math.max(b.stop, avg2 - dist2) : Math.min(b.stop, avg2 + dist2);
      if (s === 1 ? ns >= cur : ns <= cur) break;                   // 새 손절선을 이미 넘은 가격이면 추가하지 않음
      const prev = b.stop;
      b.stop = ns;
      try { buy(s, `진입${n2} (불타기)`, lvl); } catch (e) { b.stop = prev; say(`진입${n2} 실패: ${e.message}`); break; }
    }
  }
  function exit(reason) {
    const p = pos();
    if (p) { const tr = E.closePosition(st, p, cur, reason, now); say(`${lbl(b.side)} 청산 (${reason}) @ ${fx(cur)} · 손익 ${fx(tr.pnl)} USDT`); }
    flat(b);
  }

  // 2) 15분마다: 현재가로 불타기 확인
  if (b.side) pyramid(cur);

  // 3) 12시간봉이 새로 마감됐을 때만
  if (k.t > b.lastT) {
    const ma = I.ma[i], atr = I.atr[i];
    let exited = b.blockT === k.t;
    if (b.side) {
      pyramid(b.side === 1 ? k.h : k.l);                                 // 이번 봉 고가/저가로 다시 확인 (15분 사이에 스쳤을 때)
      if (b.side === 1 ? k.c < ma : k.c > ma) { exit("Bot trend exit"); exited = true; }
      else {
        const avg = b.fills.reduce((a, x) => a + x, 0) / b.n;
        const dist = b.e1 * 3 * P.lossPct / (100 * (b.side === 1 ? P.levL : P.levS) * b.n);
        if (b.side === 1) { b.ext = Math.max(b.ext, k.h); b.stop = Math.max(b.stop, avg - dist, b.ext - atr * P.trail); }
        else { b.ext = Math.min(b.ext, k.l); b.stop = Math.min(b.stop, avg + dist, b.ext + atr * P.trail); }
        const p = pos();
        if (b.side === 1 ? b.stop >= cur : b.stop <= cur) exit("Bot SL");    // 새 손절선을 이미 넘었으면 바로 청산
        else if (p) {
          if (p.sl !== b.stop) { p.sl = b.stop; say(`${lbl(b.side)} 손절선 → ${fx(b.stop)}`); }
          else dirty = true;
        }
      }
    }
    if (!b.side && !exited) {
      const L = k.c > ma && k.c > I.hh[i], S = k.c < ma && k.c < I.ll[i];
      if (L || S) {
        const s = L ? 1 : -1, lev = L ? P.levL : P.levS;
        const mine = st.pos.find(x => x.sym === sym && x.side === sideName(s) && E.modeOf(x) === P.mode);
        if (mine) say(`${lbl(s)} 신호가 났지만 이미 수동으로 잡은 ${coin} 교차 ${lbl(s)} 포지션이 있어서 건너뜀`);
        else {
          b.side = s; b.e1 = k.c; b.a0 = atr; b.fills = []; b.n = 0;
          b.base = E.summary(st).equity;
          b.stop = k.c - s * k.c * 3 * P.lossPct / (100 * lev);
          b.ext = L ? k.h : k.l;
          if (s === 1 ? b.stop >= cur : b.stop <= cur) { say(`${lbl(s)} 신호가 났지만 현재가가 이미 손절선 밖이라 건너뜀`); flat(b); }
          else { try { buy(s, "진입1", k.c); } catch (e) { say(`진입1 실패: ${e.message}`); flat(b); } }
        }
      }
    }
    b.lastT = k.t; dirty = true;
  }
  return { dirty, log };
}

module.exports = { P, calc, step, fresh, stateOf };
