/*
  sigbot-core.js — Signals 탭(LONG) 진입 신호 자동매매 규칙 (모의투자 test 계정)
  ---------------------------------------------------------------
  Signals 탭 기본 설정과 같은 계산: 바이낸스 선물 · 1시간봉 · 캔들 2000개 · 스윙 민감도 5 · 관찰 봉 20 · 깊이 C(-1)
                                   · 시총 150위 안에서 거래량 상위 50개 · 진입가는 1시간봉 마감 때 다시 계산
  규칙
  - 상태가 "진입 구간"(진입가에 닿았고 아직 이탈 전)이 되면 진입 시작 (롱만)
  - 코인 하나 = (계좌 자산 × 레버리지 10배)의 5%, 3번에 나눠 매수 — 비중 1:2:3 (아래로 갈수록 크게) (교차 10배 — 남은 잔고 전체가 증거금으로 같이 버팀)
      손절폭 d = 평균 반등 × 1.5  (예: 평균 반등 2% → 손절 -3%)
      1차 = 진입가, 2차 = 진입가 -d/3, 3차 = 진입가 -2d/3, 손절 = 진입가 -d
      익절 = 예상 반등가 (진입가 + 평균 반등)
      → 손절·익절은 첫 진입가 기준으로 고정 (추가 매수해도 안 바뀜)
  - 봇이 볼 때 이미 지나간 분할 가격은 시장가로 한꺼번에, 아직 안 온 분할은 지정가 주문으로 걸어 둠
  - 익절·손절은 모의투자 TP/SL 로 걸어 두어서 1분봉 기준으로 닿는 순간 처리됨
  - 포지션이 끝나면 남은 분할 지정가 주문은 취소. 같은 진입가로는 다시 들어가지 않음
  - 동시에 최대 10개 코인. 자리가 모자라면 기대값 높은 코인부터
  - Signals 목록에서 빠져도(거래량 순위 변동 등) 이미 잡은 포지션은 끝까지 관리
  - 목표 익절 (복리, 시간 상관없음): 기준 자산 대비
      자산(잔고 + 증거금 + 미실현 손익)이 +3.2% 이상이면 → 모든 포지션 시장가 정리 + 대기 주문 취소
      → 정리 후 자산을 새 기준으로 잡고 바로 다시 신호대로 진입 (쉬지 않음, 5분마다 확인)
      손절(손실)로 끝난 코인은 그 손실만큼 기준도 같이 내림 → 손실을 메울 필요 없이 다음 목표는 줄어든 자산 기준 +3.2%
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./fib-core.js"));
  else root.SigBotCore = factory(root.FibCore);
})(typeof self !== "undefined" ? self : this, function (FibCore) {
  "use strict";
  const P = {
    // 신호 계산 (Signals 탭 기본값)
    interval: "1h", count: 2000, n: 5, k: 20, ratio: 1, top: 50, mcap: 150,
    // 매매
    lev: 10, mode: "cross", maxCoins: 10, pct: 5, splits: 3, w: [1, 2, 3], slFrac: 1.5,   // w = 분할 비중 (아래로 갈수록 크게 1:2:3)
    minTouches: 3,              // 과거 터치가 너무 적은 코인은 통계가 의미 없어서 제외
    dayTarget: 3.2,             // 목표 (%): 계좌 자산(미실현 포함)이 기준 자산 대비 +3.2% 되면 전부 정리 → 지금 자산을 새 기준으로 바로 다시 시작
  };
  const LOG_MAX = 150;
  const keyOf = level => Number(level).toPrecision(8);

  // 진입가와 평균 반등(%)으로 분할 가격·손절·익절
  function plan(level, rebound) {
    const d = rebound * P.slFrac;                                  // 손절폭 (%)
    const lv = [];
    for (let i = 0; i < P.splits; i++) lv.push(level * (1 - d * i / P.splits / 100));
    return { lv, sl: level * (1 - d / 100), tp: level * (1 + rebound / 100), d };
  }

  /*
    step(user, scan, prices, now, E)
      user  : 모의투자 계정 { st, sbot }
      scan  : { coins: [{ sym, stats, current }] }  (1시간봉 마감 때 계산해 둔 Signals 결과, 실시간 가격으로 갱신됨)
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
    const posOf = m => st.pos.find(p => p.sym === m && p.side === "long" && E.modeOf(p) === P.mode);

    // 1) 봇이 잡은 코인 정리: 포지션이 TP/SL 로 끝났으면 남은 분할 주문 취소
    for (const m of Object.keys(b.act)) {
      const a = b.act[m], p = posOf(m);
      const mine = st.ord.filter(o => !o.ro && o.sym === m && a.oids.includes(o.id));
      if (p) continue;
      for (const o of mine) { try { E.cancelOrder(st, o.id, now); } catch (e) {} }
      const tr = st.th.find(x => x.sym === m && x.side === "long" && x.t >= a.t);
      say(`${m.replace(/USDT$/, "")} 종료 · ${tr ? `${tr.reason} @ ${fx(tr.exit)} · 손익 ${tr.pnl.toFixed(2)} USDT` : "포지션 없음"}` +
          (mine.length ? ` · 남은 분할 주문 ${mine.length}개 취소` : ""));
      b.done[m] = { key: a.key, t: now };
      delete b.act[m];
      if (tr && tr.pnl < 0 && b.base > 0) {                         // 손실로 끝난 건 기준 자산에서 빼서 그냥 두고 넘어감 (손실을 메울 필요 없이 다음 목표는 지금 자산 기준 +3.2%)
        b.base += tr.pnl;
        say(`손실 반영 → 새 기준 ${b.base.toFixed(2)}, 목표 ${(b.base * (1 + P.dayTarget / 100)).toFixed(2)}`);
      }
    }

    // 1-2) 목표 (+3.2%) 확인: 넘었으면 전부 정리하고 지금 자산을 새 기준으로 바로 다시 시작
    const pxOf = m => prices[m];
    const equity = () => st.bal + st.pos.reduce((s, p) => s + p.margin + E.pnlOf(p.side, p.entry, pxOf(p.sym) || p.entry, p.qty), 0);
    if (!(b.base > 0)) {
      b.base = equity();
      say(`목표 기준 설정 · 기준 자산 ${b.base.toFixed(2)} USDT · 목표 ${(b.base * (1 + P.dayTarget / 100)).toFixed(2)} (+${P.dayTarget}%)`);
    }
    if (st.pos.length) {
      const eq = equity(), goal = b.base * (1 + P.dayTarget / 100);
      if (eq >= goal) {
        for (const o of st.ord.slice()) { try { E.cancelOrder(st, o.id, now); } catch (e) {} }
        let sum = 0;
        for (const p of st.pos.slice()) {
          const tr = E.closePosition(st, p, pxOf(p.sym) || p.entry, "Target", now);
          sum += tr.pnl;
          if (b.act[p.sym]) { b.done[p.sym] = { key: b.act[p.sym].key, t: now }; delete b.act[p.sym]; }
        }
        const after = st.bal;
        say(`🎯 목표 달성 → 전량 정리 · 정리 손익 ${sum.toFixed(2)} USDT · 자산 ${after.toFixed(2)} (기준 대비 +${((after / b.base - 1) * 100).toFixed(2)}%) · 새 기준 ${after.toFixed(2)}, 목표 ${(after * (1 + P.dayTarget / 100)).toFixed(2)}`);
        b.base = after; b.wins = (b.wins || 0) + 1;
        return { dirty, log };                                        // 이번 차례는 정리만, 다음 5분부터 다시 진입
      }
    }

    // 2) 새 진입 후보: 지금 "진입 구간"인 코인
    const cands = [];
    for (const c of (scan && scan.coins) || []) {
      const m = c.sym + "USDT", px = prices[m];
      if (!(px > 0) || !c.current || !c.current.level) continue;
      const res = { direction: "long", price: px, stats: c.stats, current: c.current };
      FibCore.applyPrice(res, px, "long");
      c.current = res.current;                                      // 도달 여부·최저가는 다음 번에도 이어서 씀
      if (FibCore.label(res.current) !== "진입 구간") continue;
      const s = c.stats, lvl = res.current.level, key = keyOf(lvl);
      if (b.act[m] || (b.done[m] && b.done[m].key === key)) continue;
      if (!(s && s.count >= P.minTouches && s.reboundAvg > 0)) continue;
      const pl = plan(lvl, s.reboundAvg);
      if (!(px > pl.sl)) continue;                                  // 이미 손절가 아래면 건너뜀
      cands.push({ m, c, px, key, lvl, pl, ev: FibCore.expectancy(s) ?? -Infinity });
    }
    cands.sort((x, y) => y.ev - x.ev);

    for (const x of cands) {
      if (Object.keys(b.act).length >= P.maxCoins) break;
      const { m, px, pl } = x, name = x.c.sym;
      if (posOf(m) || st.ord.some(o => o.sym === m && o.side === "long")) {   // 수동으로 잡은 같은 코인이 있으면 섞이지 않게 건너뜀
        if (!(b.done[m] && b.done[m].key === x.key)) { say(`${name} 진입 구간이지만 이미 직접 잡은 포지션/주문이 있어서 건너뜀`); b.done[m] = { key: x.key, t: now }; }
        continue;
      }
      const eq = E.summary(st).equity;
      const tot = eq * P.lev * P.pct / 100, wsum = P.w.reduce((s, v) => s + v, 0);
      const per = P.w.map(v => tot * v / wsum);                     // 분할별 금액 (USDT, 포지션 크기) 1:2:3
      const a = { key: x.key, level: x.lvl, tp: pl.tp, sl: pl.sl, lv: pl.lv, per, t: now, oids: [] };
      // 이미 지나간 분할(가격 ≥ 현재가)은 시장가로 한꺼번에
      const now1 = pl.lv.filter(v => v >= px).length || 1;
      try {
        const r = E.placeOrder(st, { sym: m, side: "long", lev: P.lev, mode: P.mode, qty: per.slice(0, now1).reduce((s, v) => s + v, 0) / px, type: "market", tp: pl.tp, sl: pl.sl }, px, now);
        a.pid = r.pos.id;
      } catch (e) { say(`${name} 진입 실패: ${e.message}`); b.done[m] = { key: x.key, t: now }; continue; }
      const waits = [];
      for (let i = now1; i < pl.lv.length; i++) {
        try {
          const r = E.placeOrder(st, { sym: m, side: "long", lev: P.lev, mode: P.mode, qty: per[i] / pl.lv[i], type: "limit", price: pl.lv[i], tp: pl.tp, sl: pl.sl }, px, now);
          if (r.ord) a.oids.push(r.ord.id);
          waits.push(fx(pl.lv[i]));
        } catch (e) { say(`${name} ${i + 1}차 지정가 실패: ${e.message}`); }
      }
      b.act[m] = a;
      say(`${name} 진입 ${now1}/${P.splits}차 시장가 @ ${fx(px)} (진입가 ${fx(x.lvl)})` +
          (waits.length ? ` · 대기 ${waits.join(", ")}` : "") + ` · 익절 ${fx(pl.tp)} · 손절 ${fx(pl.sl)} (-${pl.d.toFixed(2)}%)`);
    }

    // 끝난 기록은 7일 지나면 지움 (너무 커지지 않게)
    for (const m of Object.keys(b.done)) if (!b.done[m] || now - b.done[m].t > 7 * 86400e3) delete b.done[m];
    return { dirty, log };
  }

  return { P, plan, step, keyOf };
});
