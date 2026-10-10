// 비트·이더·솔라나 교차 물타기 백테스트 (Gwave 진입 신호 사용 — 비공개). 브라우저 콘솔에서: window.__d 에 15분봉 [t,o,h,l,c] 를 넣고 FibCore 를 올린 뒤 __runBT({coins:['BTC','ETH','SOL']})
// 2026-10-10 결과: 3코인 -73.5% (MDD 93.4%), BTC만 -20.5% (MDD 34.2%), 2020-01~
window.__runBT = function (o) {
  const FC = window.FibCore, D = window.__d, M15 = 900e3, H = 3600e3, FEE = 0.0005, T0 = Date.UTC(2020, 0, 1);
  const SEED = o.seed || 56000, BQ = o.bq || [0.1, 0.2, 0.4], coins = o.coins;
  // 1시간봉 (마감된 것만)
  const b15 = D.BTC, h1 = [], h1end = [];
  for (let i = 0; i < b15.length; i++) {
    const [t, op, hi, lo, c] = b15[i], ht = Math.floor(t / H) * H, last = h1[h1.length - 1];
    if (last && last.t === ht) { last.h = Math.max(last.h, hi); last.l = Math.min(last.l, lo); last.c = c; last.n++; }
    else h1.push({ t: ht, o: op, h: hi, l: lo, c, n: 1 });
  }
  const idx = {};
  for (const s of ["ETH", "SOL"]) { idx[s] = new Map(); for (const r of D[s] || []) idx[s].set(r[0], r); }
  const px = (s, t, btcPx, bar) => {               // 같은 15분봉 안에서 BTC와 같은 비율로 움직였다고 가정 (봉 고가·저가 안으로)
    if (s === "BTC") return btcPx;
    const r = idx[s].get(t); if (!r) return null;
    return Math.min(r[2], Math.max(r[3], r[1] * btcPx / bar[1]));
  };
  let cash = SEED, peak = SEED, mdd = 0, minMr = Infinity, pending = null, cyc = null, hi = 0;
  const used = new Set(), cycles = [], yearly = {};
  const pos = {};                                      // s -> {q, cost}
  const fill = (s, q, p) => { const P = pos[s] || (pos[s] = { q: 0, cost: 0 }); P.q += q; P.cost += q * p; cash -= q * p * FEE; cyc.fee += q * p * FEE; };
  const sell = (s, frac, p) => { const P = pos[s]; if (!P || !P.q) return; const q = P.q * frac, avg = P.cost / P.q, pnl = q * (p - avg) - q * p * FEE;
    cash += pnl; cyc.pnl[s] = (cyc.pnl[s] || 0) + pnl; cyc.fee += q * p * FEE; P.q -= q; P.cost -= q * avg; if (P.q < 1e-12) delete pos[s]; };
  const upnl = (t, bar) => { let u = 0; for (const s in pos) { const p = s === "BTC" ? bar[4] : (idx[s].get(t) || [0, 0, 0, 0, null])[4]; if (p) u += pos[s].q * (p - pos[s].cost / pos[s].q); } return u; };
  const notional = (t, bar) => { let n = 0; for (const s in pos) { const p = s === "BTC" ? bar[4] : (idx[s].get(t) || [0, 0, 0, 0, null])[4]; if (p) n += pos[s].q * p; } return n; };
  function tranche(k, t, p, bar) {                     // BTC k번째 매수 + 같이 사는 알트
    const usd0 = BQ[0] * p;                            // 코인마다 1:2:4 → 1차 = 0.1 BTC 어치
    fill("BTC", BQ[k], p); cyc.n = k + 1;
    if (coins.includes("ETH")) { const e = px("ETH", t, p, bar); if (e) fill("ETH", usd0 * (BQ[k] / BQ[0]) / e, e); }
    if (coins.includes("SOL") && k >= 1) { const sp = px("SOL", t, p, bar); if (sp) fill("SOL", usd0 * (BQ[k - 1] / BQ[0]) / sp, sp); }
  }
  function closeAll(frac, t, p, bar) { for (const s of Object.keys(pos)) { const q = px(s, t, p, bar); if (q) sell(s, frac, q); } }
  for (let j = 0; j < b15.length; j++) {
    const bar = b15[j], t = bar[0];
    if (t >= T0) {
      if (!cyc && pending && bar[3] <= pending.L) {     // 진입
        const L = pending.L, d = pending.reb * 1.5;
        cyc = { t, L, lv: [L, L * (1 - d / 300), L * (1 - 2 * d / 300)], tp: L * (1 + pending.reb / 100), cut: [0.97, 0.96, 0.95].map(x => L * x), all: L * 0.94,
                k: 0, c: 0, pnl: {}, fee: 0, n: 0 };
        used.add(L.toPrecision(8)); pending = null;
      }
      if (cyc) {
        // 불리한 쪽 먼저: 시가 → 저가 사이 가격들을 높은 순서로
        const ev = [];
        for (let k = cyc.k; k < 3; k++) ev.push([cyc.lv[k], "add", k]);
        for (let c = cyc.c; c < 3; c++) ev.push([cyc.cut[c], "cut", c]);
        ev.push([cyc.all, "all"]);
        ev.sort((a, b) => b[0] - a[0]);
        for (const [p0, ty, k] of ev) {
          if (!cyc || bar[3] > p0) continue;
          const p = Math.min(p0, bar[1]);
          if (ty === "add" && k === cyc.k) { tranche(k, t, p, bar); cyc.k++; }
          else if (ty === "cut" && k === cyc.c && cyc.k > 0) { closeAll(0.1, t, p, bar); cyc.c++; }
          else if (ty === "all" && cyc.k > 0) { closeAll(1, t, p, bar); cyc.out = "손절"; }
          if (cyc.out) break;
        }
        if (!cyc.out && bar[2] >= cyc.tp) { closeAll(1, t, Math.max(cyc.tp, bar[1]), bar); cyc.out = cyc.c ? "분할손절 후 익절" : "익절"; }
        if (cyc.out) {
          const tot = Object.values(cyc.pnl).reduce((a, b) => a + b, 0);
          cycles.push({ t: cyc.t, end: t, n: cyc.n, out: cyc.out, pnl: tot, by: cyc.pnl });
          const y = new Date(cyc.t).getUTCFullYear(); yearly[y] = (yearly[y] || 0) + tot;
          cyc = null; for (const s in pos) delete pos[s];
        }
      }
      const eq = cash + upnl(t, bar), nt = notional(t, bar);
      if (eq > peak) peak = eq; mdd = Math.max(mdd, (peak - eq) / peak);
      if (nt > 0) minMr = Math.min(minMr, eq / nt);
    }
    // 1시간봉이 막 끝났으면 (그리고 쉬고 있으면) 다음 진입가 계산 — 사이트와 같은 설정
    if ((t + M15) % H === 0) {
      while (hi < h1.length && h1[hi].t + H <= t + M15) hi++;
      if (!cyc && hi >= 300 && t + M15 >= T0) {
        const r = FC.analyze(h1.slice(Math.max(0, hi - 2000), hi), { n: 5, k: 20, ratio: 1, direction: "long" });
        const c = r.current;
        pending = c && c.level && !c.touched && r.stats.count >= 3 && r.stats.reboundAvg > 0 && !used.has(c.level.toPrecision(8))
          ? { L: c.level, reb: r.stats.reboundAvg } : null;
      }
    }
  }
  const w = cycles.filter(c => c.pnl > 0), l = cycles.filter(c => c.pnl <= 0);
  const sum = a => a.reduce((s, c) => s + c.pnl, 0), by = {};
  for (const c of cycles) for (const s in c.by) by[s] = Math.round((by[s] || 0) + c.by[s]);
  const outs = {}; for (const c of cycles) outs[c.out] = (outs[c.out] || 0) + 1;
  const depth = [0, 0, 0]; for (const c of cycles) depth[c.n - 1]++;
  const worst = cycles.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 3).map(c => [new Date(c.t).toISOString().slice(0, 10), Math.round(c.pnl), c.n + "차"]);
  return { coins: coins.join("+"), end: Math.round(cash), ret: ((cash / SEED - 1) * 100).toFixed(1) + "%", mdd: (mdd * 100).toFixed(1) + "%", cycles: cycles.length,
    winRate: (w.length / cycles.length * 100).toFixed(0) + "%", avgWin: Math.round(sum(w) / (w.length || 1)), avgLoss: Math.round(sum(l) / (l.length || 1)),
    outs, depth, byCoin: by, yearly: Object.fromEntries(Object.entries(yearly).map(([y, v]) => [y, Math.round(v)])), worst,
    minEqOverNotional: minMr === Infinity ? null : minMr.toFixed(2), open: !!cyc };
};
"ok"
