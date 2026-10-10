/*
  sigbot-core.js — Signals 탭 진입 신호 자동매매 규칙 (모의투자 test·jina 계정) — 롱 + 숏
  ---------------------------------------------------------------
  Signals 탭 기본 설정과 같은 계산: 바이낸스 선물 · 1시간봉 · 캔들 2000개 · 스윙 민감도 5 · 관찰 봉 20 · 깊이 C(-1)
                                   · 시총 150위 안에서 거래량 상위 100개 · 진입가는 1시간봉 마감 때 다시 계산
  규칙 (숏은 롱을 위아래로 뒤집은 것 — 아래 설명은 롱 기준, 숏은 [ ] 안)
  - 상태가 "진입 구간"(진입가에 닿았고 아직 이탈 전)이 되면 진입 시작
      롱 = 스윙 아래쪽 -1 확장 레벨에서 매수 [숏 = 스윙 위쪽 -1 확장 레벨에서 매도]
  - 코인 하나 = (계좌 자산 × 레버리지 10배)의 5%, 3번에 나눠 진입 — 비중 1:2:3 (불리한 쪽으로 갈수록 크게) (교차 10배)
      손절폭 d = 평균 반등 × 1.5  (예: 평균 반등 2% → 손절 -3%)
      1차 = 진입가, 2차 = 진입가 -d/3 [+d/3], 3차 = 진입가 -2d/3 [+2d/3], 손절 = 진입가 -d [+d]
      1차 익절 = 진입가 + [-] 평균 반등 × 50% 에서 포지션 50% 익절 (부분 TP)
        → 체결되면 남은 분할 지정가 주문 취소 + 남은 물량 손절을 본전(평단 +0.1% [-0.1%])으로 (5분 안에)
      최종 익절 = 예상 반등가 (진입가 ± 평균 반등) 에서 남은 물량 전부
      → 손절·익절은 첫 진입가 기준으로 고정 (추가 진입해도 안 바뀜)
  - 봇이 볼 때 이미 지나간 분할 가격은 시장가로 한꺼번에, 아직 안 온 분할은 지정가 주문으로 걸어 둠
  - 익절·손절은 모의투자 TP/SL 로 걸어 두어서 1분봉 기준으로 닿는 순간 처리됨
  - 포지션이 끝나면 남은 분할 지정가 주문은 취소. 같은 방향·같은 진입가로는 다시 들어가지 않음
  - 동시에 최대 10개 (롱·숏 합쳐서). 자리가 모자라면 기대값 높은 것부터
  - 같은 코인에 롱·숏을 동시에 잡지 않음 (먼저 잡힌 쪽이 끝날 때까지 반대쪽은 건너뜀)
  - Signals 목록에서 빠져도(거래량 순위 변동 등) 이미 잡은 포지션은 끝까지 관리
  - 목표 익절 (복리, 시간 상관없음): 기준 자산 대비
      자산(잔고 + 증거금 + 미실현 손익)이 +3.2% 이상이면 → 모든 포지션 시장가 정리 + 대기 주문 취소
      → 정리 후 자산을 새 기준으로 잡고 바로 다시 신호대로 진입 (쉬지 않음, 5분마다 확인)
      손절(손실)로 끝난 코인은 그 손실만큼 기준도 같이 내림 → 손실을 메울 필요 없이 다음 목표는 줄어든 자산 기준 +3.2%

  봇 기록(user.sbot.act / done) 키: 롱 = "BTCUSDT" (예전과 같음), 숏 = "BTCUSDT:S"
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./fib-core.js"));
  else root.SigBotCore = factory(root.FibCore);
})(typeof self !== "undefined" ? self : this, function (FibCore) {
  "use strict";
  const P = {
    // 신호 계산 (Signals 탭 기본값)
    interval: "1h", count: 2000, n: 5, k: 20, ratio: 1, top: 100, mcap: 150,   // 거래량 상위 100개 (Signals 탭 기본 50개보다 넓게)
    sides: ["long", "short"],   // 매매할 방향
    // 매매
    lev: 10, mode: "cross", maxCoins: 10, pct: 5, splits: 3, w: [1, 2, 3], slFrac: 1.5,
    half: 0.5, halfQty: 0.5,    // 분할 익절: 반등치의 50% 지점에서 50% 익절 → 남은 물량 손절은 본전(수수료 포함)으로
    beBuf: 0.1,                 // 본전 손절 = 평단 +0.1% (숏은 -0.1%) (왕복 수수료)   // w = 분할 비중 (불리한 쪽으로 갈수록 크게 1:2:3)
    minTouches: 3,              // 과거 터치가 너무 적은 코인은 통계가 의미 없어서 제외
    dayTarget: 3.2,             // 목표 (%): 계좌 자산(미실현 포함)이 기준 자산 대비 +3.2% 되면 전부 정리 → 지금 자산을 새 기준으로 바로 다시 시작
  };
  const LOG_MAX = 150;
  const keyOf = level => Number(level).toPrecision(8);
  const actKey = (m, side) => side === "short" ? m + ":S" : m;          // 봇 기록 키 (롱은 예전 그대로)
  const symOf = k => k.replace(/:S$/, "");
  const sideOf = k => /:S$/.test(k) ? "short" : "long";

  // 진입가와 평균 반등(%)으로 분할 가격·손절·익절 (숏은 위아래 반대)
  function plan(level, rebound, side = "long") {
    const g = side === "short" ? -1 : 1;                           // 롱 +1, 숏 -1 (유리한 쪽 부호)
    const d = rebound * P.slFrac;                                  // 손절폭 (%)
    const lv = [];
    for (let i = 0; i < P.splits; i++) lv.push(level * (1 - g * d * i / P.splits / 100));
    return { lv, sl: level * (1 - g * d / 100), tp: level * (1 + g * rebound / 100), tp1: level * (1 + g * rebound * P.half / 100), d };
  }

  /*
    step(user, scan, prices, now, E)
      user  : 모의투자 계정 { st, sbot }
      scan  : { coins: [{ sym, stats, current, short: { stats, current } }] }
              (1시간봉 마감 때 계산해 둔 Signals 결과 — 롱은 stats/current, 숏은 short 안에. 실시간 가격으로 갱신됨)
      prices: { "UNIUSDT": 8.2, ... } 지금 가격
      E     : paper-engine
    반환 { dirty, log }
  */
  function step(user, scan, prices, now, E) {
    const st = user.st;
    const b = user.sbot || (user.sbot = { act: {}, done: {}, log: [] });
    b.act = b.act || {}; b.done = b.done || {}; b.log = b.log || [];
    const log = [];
    let dirty = false;
    const say = msg => { log.push(msg); b.log.unshift({ t: now, msg }); if (b.log.length > LOG_MAX) b.log.length = LOG_MAX; dirty = true; };
    const fx = v => (v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toPrecision(4));
    const posOf = (m, side) => st.pos.find(p => p.sym === m && p.side === side && E.modeOf(p) === P.mode);
    const tag = side => side === "short" ? "숏 " : "";             // 기록에 숏만 표시 (롱은 예전처럼)

    // 1) 봇이 잡은 포지션 정리: TP/SL 로 끝났으면 남은 분할 주문 취소
    for (const k of Object.keys(b.act)) {
      const a = b.act[k], m = symOf(k), side = sideOf(k), p = posOf(m, side);
      if (p) continue;
      const mine = st.ord.filter(o => !o.ro && o.sym === m && a.oids.includes(o.id));
      for (const o of mine) { try { E.cancelOrder(st, o.id, now); } catch (e) {} }
      const tr = st.th.find(x => x.sym === m && x.side === side && x.t >= a.t);
      say(`${m.replace(/USDT$/, "")} ${tag(side)}종료 · ${tr ? `${tr.reason} @ ${fx(tr.exit)} · 손익 ${tr.pnl.toFixed(2)} USDT` : "포지션 없음"}` +
          (mine.length ? ` · 남은 분할 주문 ${mine.length}개 취소` : ""));
      b.done[k] = { key: a.key, t: now };
      delete b.act[k];
      if (tr && tr.pnl < 0 && b.base > 0) {                         // 손실로 끝난 건 기준 자산에서 빼서 그냥 두고 넘어감 (손실을 메울 필요 없이 다음 목표는 지금 자산 기준 +3.2%)
        b.base += tr.pnl;
        say(`손실 반영 → 새 기준 ${b.base.toFixed(2)}, 목표 ${(b.base * (1 + P.dayTarget / 100)).toFixed(2)}`);
      }
    }

    // 1-2) 목표 (+3.2%) 확인: 넘었으면 전부 정리하고 지금 자산을 새 기준으로 바로 다시 시작
    const pxOf = m => prices[m];
    const equity = () => st.bal + st.pos.reduce((s, p) => s + p.margin + E.pnlOf(p.side, p.entry, pxOf(p.sym) || p.entry, p.qty), 0);
    if (!(b.base > 0)) {
      b.base = equity(); b.dep0 = st.dep;
      say(`목표 기준 설정 · 기준 자산 ${b.base.toFixed(2)} USDT · 목표 ${(b.base * (1 + P.dayTarget / 100)).toFixed(2)} (+${P.dayTarget}%)`);
    }
    // 관리자 입금(원금 증가)은 수익이 아니니까 기준 자산에도 같이 더함. 원금이 줄었으면(초기화) 지금 자산으로 다시 시작
    if (b.dep0 == null) b.dep0 = st.dep;
    if (st.dep !== b.dep0) {
      if (st.dep > b.dep0) b.base += st.dep - b.dep0; else b.base = equity();
      b.dep0 = st.dep;
      say(`원금 변경(입금/초기화) 반영 → 기준 ${b.base.toFixed(2)}, 목표 ${(b.base * (1 + P.dayTarget / 100)).toFixed(2)}`);
    }
    if (st.pos.length) {
      const eq = equity(), goal = b.base * (1 + P.dayTarget / 100);
      if (eq >= goal) {
        for (const o of st.ord.slice()) { try { E.cancelOrder(st, o.id, now); } catch (e) {} }
        let sum = 0;
        for (const p of st.pos.slice()) {
          const tr = E.closePosition(st, p, pxOf(p.sym) || p.entry, "Target", now);
          sum += tr.pnl;
          const k = actKey(p.sym, p.side);
          if (b.act[k]) { b.done[k] = { key: b.act[k].key, t: now }; delete b.act[k]; }
        }
        const after = st.bal;
        say(`🎯 목표 달성 → 전량 정리 · 정리 손익 ${sum.toFixed(2)} USDT · 자산 ${after.toFixed(2)} (기준 대비 +${((after / b.base - 1) * 100).toFixed(2)}%) · 새 기준 ${after.toFixed(2)}, 목표 ${(after * (1 + P.dayTarget / 100)).toFixed(2)}`);
        b.base = after; b.wins = (b.wins || 0) + 1;
        return { dirty, log };                                        // 이번 차례는 정리만, 다음 5분부터 다시 진입
      }
    }

    // 2) 새 진입 후보: 지금 "진입 구간"인 코인 (롱·숏 각각)
    const cands = [];
    for (const c of (scan && scan.coins) || []) {
      const m = c.sym + "USDT", px = prices[m];
      if (!(px > 0)) continue;
      for (const side of P.sides) {
        const sig = side === "short" ? c.short : c;                 // 숏 계산이 없는 예전 스캔이면 숏은 건너뜀
        if (!sig || !sig.current || !sig.current.level) continue;
        const res = { direction: side, price: px, stats: sig.stats, current: sig.current };
        FibCore.applyPrice(res, px, side);
        sig.current = res.current;                                  // 도달 여부·극값은 다음 번에도 이어서 씀
        if (FibCore.label(res.current) !== "진입 구간") continue;
        const s = sig.stats, lvl = res.current.level, key = keyOf(lvl), k = actKey(m, side);
        if (b.act[k] || (b.done[k] && b.done[k].key === key)) continue;
        if (!(s && s.count >= P.minTouches && s.reboundAvg > 0)) continue;
        const pl = plan(lvl, s.reboundAvg, side);
        if (side === "short" ? !(px < pl.sl) : !(px > pl.sl)) continue;   // 이미 손절가 너머면 건너뜀
        cands.push({ m, k, side, c, px, key, lvl, pl, ev: FibCore.expectancy(s) ?? -Infinity });
      }
    }
    cands.sort((x, y) => y.ev - x.ev);

    for (const x of cands) {
      if (Object.keys(b.act).length >= P.maxCoins) break;
      const { m, k, side, px, pl } = x, name = x.c.sym, other = side === "short" ? "long" : "short";
      if (b.act[actKey(m, other)]) continue;                        // 봇이 이미 반대 방향으로 잡고 있으면 끝날 때까지 건너뜀
      if (st.pos.some(p => p.sym === m) || st.ord.some(o => o.sym === m)) {   // 수동으로 잡은 같은 코인이 있으면 섞이지 않게 건너뜀
        if (!(b.done[k] && b.done[k].key === x.key)) { say(`${name} ${tag(side)}진입 구간이지만 이미 직접 잡은 포지션/주문이 있어서 건너뜀`); b.done[k] = { key: x.key, t: now }; }
        continue;
      }
      const eq = E.summary(st).equity;
      const tot = eq * P.lev * P.pct / 100, wsum = P.w.reduce((s, v) => s + v, 0);
      const per = P.w.map(v => tot * v / wsum);                     // 분할별 금액 (USDT, 포지션 크기) 1:2:3
      const a = { side, key: x.key, level: x.lvl, tp: pl.tp, tp1: pl.tp1, sl: pl.sl, lv: pl.lv, per, t: now, oids: [] };
      // 이미 지나간 분할(롱: 가격 ≥ 현재가, 숏: 가격 ≤ 현재가)은 시장가로 한꺼번에
      const now1 = pl.lv.filter(v => side === "short" ? v <= px : v >= px).length || 1;
      try {
        const r = E.placeOrder(st, { sym: m, side, lev: P.lev, mode: P.mode, qty: per.slice(0, now1).reduce((s, v) => s + v, 0) / px, type: "market", tp: pl.tp, sl: pl.sl }, px, now);
        a.pid = r.pos.id;
      } catch (e) { say(`${name} ${tag(side)}진입 실패: ${e.message}`); b.done[k] = { key: x.key, t: now }; continue; }
      const waits = [];
      for (let i = now1; i < pl.lv.length; i++) {
        try {
          const r = E.placeOrder(st, { sym: m, side, lev: P.lev, mode: P.mode, qty: per[i] / pl.lv[i], type: "limit", price: pl.lv[i], tp: pl.tp, sl: pl.sl }, px, now);
          if (r.ord) a.oids.push(r.ord.id);
          waits.push(fx(pl.lv[i]));
        } catch (e) { say(`${name} ${tag(side)}${i + 1}차 지정가 실패: ${e.message}`); }
      }
      b.act[k] = a;
      say(`${name} ${tag(side)}진입 ${now1}/${P.splits}차 시장가 @ ${fx(px)} (진입가 ${fx(x.lvl)})` +
          (waits.length ? ` · 대기 ${waits.join(", ")}` : "") + ` · 1차 익절 ${fx(pl.tp1)}(50%) · 최종 익절 ${fx(pl.tp)} · 손절 ${fx(pl.sl)} (${side === "short" ? "+" : "-"}${pl.d.toFixed(2)}%)`);
    }

    // 3) 분할 익절 관리: 1차 익절(부분 TP) 주문을 지금 물량의 50%로 맞춰 두고, 체결됐으면 본전 손절로
    for (const k of Object.keys(b.act)) {
      const a = b.act[k], m = symOf(k), side = sideOf(k), p = posOf(m, side), name = m.replace(/USDT$/, "") + (side === "short" ? " 숏" : "");
      if (!p) continue;
      if (a.half) continue;
      const short = side === "short";
      const tp1 = a.tp1 || a.level * (1 + (a.tp / a.level - 1) * P.half);
      const be = p.entry * (1 + (short ? -1 : 1) * P.beBuf / 100);    // 본전 (수수료 포함)
      const toBE = () => { p.sl = short ? Math.min(p.sl || Infinity, be) : Math.max(p.sl || 0, be); };
      const mine = (p.pt || []).find(o => o.id === a.ptId);
      if (a.ptId && !mine) {                                        // 1차 익절 체결됨
        a.half = true;
        for (const o of st.ord.filter(o => !o.ro && o.sym === m && a.oids.includes(o.id))) { try { E.cancelOrder(st, o.id, now); } catch (e) {} }
        const px = prices[m] || p.entry;
        if (short ? px >= be : px <= be) { const tr = E.closePosition(st, p, px, "Breakeven", now); say(`${name} 1차 익절 후 이미 본전 너머 → 남은 물량 정리 · 손익 ${tr.pnl.toFixed(2)} USDT`); }
        else { toBE(); say(`${name} 1차 익절(50%) 체결 → 남은 분할 주문 취소 · 손절을 본전 ${fx(p.sl)}으로`); }
        dirty = true;
        continue;
      }
      const want = Math.floor(p.qty * P.halfQty * 1e8) / 1e8, px = prices[m] || p.entry;
      if (mine) { if (mine.frac !== P.halfQty || Math.abs(mine.qty - want) > want * 1e-6) { mine.qty = want; mine.frac = P.halfQty; dirty = true; } continue; }   // 체결 순간 물량의 50% (분할 진입으로 늘어나도)
      if (short ? px <= tp1 : px >= tp1) {                          // 이미 1차 익절가 너머면 바로 50% 정리
        const tr = E.closePosition(st, p, px, "TP", now, want);
        a.ptId = -1; a.half = true;
        for (const o of st.ord.filter(o => !o.ro && o.sym === m && a.oids.includes(o.id))) { try { E.cancelOrder(st, o.id, now); } catch (e) {} }
        toBE();
        say(`${name} 이미 1차 익절가 너머 → 50% 정리 (${tr.pnl.toFixed(2)} USDT) · 손절을 본전 ${fx(p.sl)}으로`);
        continue;
      }
      try { const o = E.addPartial(st, p, { qty: want, tp: tp1 }, px); o.frac = P.halfQty; a.ptId = o.id; dirty = true; }
      catch (e) { say(`${name} 1차 익절 주문 실패: ${e.message}`); a.half = true; }
    }

    // 끝난 기록은 7일 지나면 지움 (너무 커지지 않게)
    for (const k of Object.keys(b.done)) if (!b.done[k] || now - b.done[k].t > 7 * 86400e3) delete b.done[k];
    return { dirty, log };
  }

  return { P, plan, step, keyOf, actKey };
});
