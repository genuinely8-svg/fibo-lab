/*
  lowsig-core.js — Low Signals 계산 엔진 (양방향 추세추종 v4, 12시간봉 기준)
  ---------------------------------------------------------------
  규칙은 자동매매 봇(bot-core.js)과 같아요.
  - 롱: 12시간봉 종가 > 400개 이평 + 직전 40개 최고가 돌파 → 진입1 (봉 마감 때 확정)
  - 숏: 12시간봉 종가 < 400개 이평 + 직전 40개 최저가 이탈 → 진입1
  - 진입1 가격에서 ATR(28) 1·2배 유리하게 가면 진입2·진입3 (불타기)
  - 손절: 계좌 2%를 잃는 가격(평단이 유리해지면 따라옴) + 추적 손절(최고/최저가 ∓ ATR x 3)
  - 12시간봉 종가가 400개 이평 반대편이면 청산
  진입2·진입3·손절은 12시간봉 "안에서" 가격이 닿는 순간 일어나요.
  → fine(bar) 로 더 짧은 봉(1분·3분…)을 받아 순서대로 훑어서 정확한 시각·가격을 찾아요.
     fine 이 없거나 null 을 주면 12시간봉 하나로 판단 (손절을 먼저 본다고 보수적으로 가정, 시각은 모름)
*/
(function (root) {
  "use strict";
  const P = {
    tf: 12 * 3600e3, trendLen: 400, boLen: 40, atrLen: 28,
    levL: 4, levS: 2, add1: 1, add2: 2, lossPct: 2, trail: 3,
    capital: 50000, fee: 0.0005,
  };

  // 트레이딩뷰 ta.sma / ta.atr(RMA) / ta.highest[1] 과 같은 계산 (bot-core.js 와 같음)
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

  /*
    B: 닫힌 12시간봉 [{t,o,h,l,c}] (오래된 것부터, t = 봉 시작 ms)
    opts: { dir: "both"|"long"|"short", startT: 이 시각 이후 신호만, fine: async (bar) => 짧은 봉 배열 또는 null,
            tight: true 면 진입2·3이 체결되는 순간 손절선을 바로 다시 계산 (전체 손실 계좌 2% 이내로) }
    반환 { events, trades, open, stats, touchBars }
  */
  async function run(B, opts = {}) {
    const dir = opts.dir || "both", startT = opts.startT || 0, fine = opts.fine || null, tight = !!opts.tight;
    const I = calc(B);
    const events = [], trades = [], touchBars = [];
    let eq = P.capital, peak = eq, mdd = 0;
    let pos = null;                       // { s, e1, a0, base, unit, lossCap, fills:[{px,t,n}], stop, ext, t0 }
    const name = s => (s === 1 ? "롱" : "숏");

    function addFill(px, t, exact, same) {
      const n = pos.fills.length + 1;
      pos.fills.push({ px, t, n });
      events.push({ t, px, kind: "entry", s: pos.s, n, label: "진입" + n, exact, same: !!same, trade: trades.length });
      // 체결 즉시 손절선 올리기: 지금까지 산 물량 전체가 손절돼도 계좌 2%(lossCap)만 잃는 가격으로 (유리한 쪽으로만)
      if (tight && n > 1) {
        const avg = pos.fills.reduce((a, f) => a + f.px, 0) / n, dist = pos.lossCap / (pos.unit * n);
        pos.stop = pos.s === 1 ? Math.max(pos.stop, avg - dist) : Math.min(pos.stop, avg + dist);
      }
    }
    function close(px, t, why, exact, same) {
      const s = pos.s, parts = [];
      let pnl = 0, anyLoss = false;
      const fills = pos.fills.map(f => {
        const g = s * (px - f.px) * pos.unit - (f.px + px) * pos.unit * P.fee;     // 수수료 진입·청산 둘 다
        pnl += g;
        const win = s * (px - f.px) > 0;
        if (win) parts.push(`${name(s)} 익절${f.n}`); else anyLoss = true;
        return { ...f, win, pnl: g };
      });
      if (anyLoss) parts.push(`${name(s)} SL`);
      eq += pnl; peak = Math.max(peak, eq); mdd = Math.max(mdd, (peak - eq) / peak);
      const tr = { s, t0: pos.fills[0].t, t1: t, e1: pos.e1, exit: px, why, fills, pnl, ret: pnl / pos.base, eqAfter: eq };
      events.push({ t, px, kind: "exit", s, label: parts.join(" · "), why, exact, same: !!same, win: pnl > 0, pnl, trade: trades.length });
      trades.push(tr);
      pos = null;
    }

    for (let i = Math.max(P.trendLen, P.boLen, P.atrLen); i < B.length; i++) {
      const k = B[i], ct = k.t + P.tf;           // ct = 봉 마감 시각
      let exited = false;

      if (pos) {
        const s = pos.s;
        const nextLvl = () => pos.e1 + s * pos.a0 * (pos.fills.length === 1 ? P.add1 : P.add2);
        const hitStop = c => (s === 1 ? c.l <= pos.stop : c.h >= pos.stop);
        const hitAdd = c => pos.fills.length < 3 && (s === 1 ? c.h >= nextLvl() : c.l <= nextLvl());
        // 이번 12시간봉 안에서 손절선이나 불타기 가격을 건드렸나?
        if (hitStop(k) || hitAdd(k)) {
          touchBars.push(k.t);
          let sub = fine ? await fine(k) : null;
          const exact = !!(sub && sub.length);
          if (!exact) sub = [k];
          for (const c of sub) {
            const t = exact ? c.t : k.t;
            if (hitStop(c)) {
              // 같은 짧은 봉 안에서 불타기 가격도 닿았으면 순서를 알 수 없어 손절을 먼저로 봄 (보수적)
              close(s === 1 ? Math.min(c.o, pos.stop) : Math.max(c.o, pos.stop), t, "stop", exact, hitAdd(c));
              exited = true;
              break;
            }
            let added = false;
            while (hitAdd(c)) {
              const lvl = nextLvl();
              addFill(s === 1 ? Math.max(c.o, lvl) : Math.min(c.o, lvl), t, exact);
              added = true;
            }
            // 손절선을 바로 올린 경우, 같은 봉 안에서 새 손절선에도 닿았으면 순서를 모르니 손절로 봄 (보수적)
            if (added && tight && hitStop(c)) {
              close(pos.stop, t, "stop", exact, true);
              exited = true;
              break;
            }
          }
        }
        if (pos) {
          if (s === 1 ? k.c < I.ma[i] : k.c > I.ma[i]) { close(k.c, ct, "trend", true); exited = true; }
          else {
            const n = pos.fills.length, avg = pos.fills.reduce((a, f) => a + f.px, 0) / n;
            const dist = pos.lossCap / (pos.unit * n);
            if (s === 1) { pos.ext = Math.max(pos.ext, k.h); pos.stop = Math.max(pos.stop, avg - dist, pos.ext - I.atr[i] * P.trail); }
            else { pos.ext = Math.min(pos.ext, k.l); pos.stop = Math.min(pos.stop, avg + dist, pos.ext + I.atr[i] * P.trail); }
            // 새 손절선을 종가가 이미 넘었으면 마감 때 바로 청산 (봇과 같음)
            if (s === 1 ? k.c <= pos.stop : k.c >= pos.stop) { close(k.c, ct, "stop-close", true); exited = true; }
          }
        }
      }

      if (!pos && !exited && k.t >= startT && isFinite(I.ma[i])) {
        const L = dir !== "short" && k.c > I.ma[i] && k.c > I.hh[i];
        const S = dir !== "long" && k.c < I.ma[i] && k.c < I.ll[i];
        if (L || S) {
          const s = L ? 1 : -1, lev = L ? P.levL : P.levS;
          const base = eq, unit = base * lev / 3 / k.c, lossCap = base * P.lossPct / 100;
          pos = { s, e1: k.c, a0: I.atr[i], base, unit, lossCap, fills: [], stop: k.c - s * lossCap / unit, ext: L ? k.h : k.l };
          addFill(k.c, ct, true);
        }
      }
    }

    // 지금 열려 있는 포지션
    let open = null;
    const last = B[B.length - 1], li = B.length - 1;
    if (pos && last) {
      const n = pos.fills.length, avg = pos.fills.reduce((a, f) => a + f.px, 0) / n;
      open = {
        s: pos.s, n, fills: pos.fills, avg, stop: pos.stop, e1: pos.e1, a0: pos.a0,
        next: n < 3 ? pos.e1 + pos.s * pos.a0 * (n === 1 ? P.add1 : P.add2) : null,
        upnl: pos.s * (last.c - avg) * pos.unit * n, base: pos.base,
      };
    }
    // 다음 12시간봉 마감 때 진입1 이 나오려면 종가가 얼마를 넘어야 하나
    let nextHH = -Infinity, nextLL = Infinity;
    for (let j = Math.max(0, li - P.boLen + 1); j <= li; j++) { nextHH = Math.max(nextHH, B[j].h); nextLL = Math.min(nextLL, B[j].l); }
    const wins = trades.filter(t => t.pnl > 0), loss = trades.filter(t => t.pnl <= 0);
    const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = -loss.reduce((a, t) => a + t.pnl, 0);
    const stats = {
      trades: trades.length, wins: wins.length, ret: (eq - P.capital) / P.capital, equity: eq, mdd,
      pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0),
      worst: trades.length ? Math.min(...trades.map(t => t.ret)) : null,
      ma: I.ma[li], atr: I.atr[li], lastClose: last ? last.c : NaN, lastT: last ? last.t : NaN, nextHH, nextLL,
    };
    return { events, trades, open, stats, touchBars };
  }

  const api = { P, calc, run };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LowSig = api;
})(typeof window !== "undefined" ? window : this);
