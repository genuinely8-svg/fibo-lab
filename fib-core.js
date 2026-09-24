/*
  fib-core.js — 피보나치 -1 계산 엔진
  ---------------------------------------------------------------
  캔들 배열(오래된 것 → 최신 순)을 받아서
    1) 스윙 고점(H) / 스윙 저점(L)을 찾고
    2) 하락 스윙마다 -1 레벨 = L - (H - L) × 비율 을 계산하고
    3) 과거에 가격이 -1에 닿았을 때, 그 뒤 K개 봉 동안
       최대 몇 % 반등했는지 / 최대 몇 % 더 빠졌는지 통계를 냅니다.
  캔들 형식: { t: 시각(ms), o, h, l, c }
*/
(function (root) {
  "use strict";

  // ── 1. 스윙(피벗) 찾기 ────────────────────────────────────────
  // i번째 봉의 고가가 좌우 n개 봉보다 모두 높거나 같으면 "스윙 고점"
  function findPivots(candles, n) {
    const pivots = [];
    for (let i = n; i < candles.length - n; i++) {
      let isHigh = true, isLow = true;
      for (let j = i - n; j <= i + n; j++) {
        if (j === i) continue;
        // 왼쪽은 "같아도 탈락", 오른쪽은 "더 커야 탈락" → 횡보 구간에서 피벗이 줄줄이 생기는 것 방지
        if (j < i ? candles[j].h >= candles[i].h : candles[j].h > candles[i].h) isHigh = false;
        if (j < i ? candles[j].l <= candles[i].l : candles[j].l < candles[i].l) isLow = false;
      }
      if (isHigh) pivots.push({ type: "H", i, price: candles[i].h });
      if (isLow) pivots.push({ type: "L", i, price: candles[i].l });
    }
    // 같은 종류가 연달아 나오면 더 극단적인 것 하나만 남김 (H-L-H-L 번갈아 나오게)
    const out = [];
    for (const p of pivots) {
      const last = out[out.length - 1];
      if (last && last.type === p.type) {
        const better = p.type === "H" ? p.price > last.price : p.price < last.price;
        if (better) out[out.length - 1] = p;
      } else {
        out.push(p);
      }
    }
    return out;
  }

  // ── 2. 하락 스윙(H → L) 목록 만들기 ────────────────────────────
  function downSwings(pivots) {
    const swings = [];
    for (let k = 0; k < pivots.length - 1; k++) {
      if (pivots[k].type === "H" && pivots[k + 1].type === "L") {
        swings.push({ high: pivots[k], low: pivots[k + 1] });
      }
    }
    return swings;
  }

  // ── 3. 통계 계산 ──────────────────────────────────────────────
  function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
  // 표준오차 = 표준편차 / √표본수  → "이 평균이 얼마나 흔들릴 수 있나"
  function stdErr(a) {
    if (a.length < 2) return null;
    const m = mean(a);
    const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
    return Math.sqrt(v) / Math.sqrt(a.length);
  }

  /*
    analyze(candles, opts)
      opts.n      : 스윙 민감도 (좌우 몇 개 봉과 비교할지). 기본 5
      opts.k      : 터치 후 몇 개 봉 동안 지켜볼지. 기본 20
      opts.ratio  : 확장 비율. 1이면 -1 레벨. 기본 1
  */
  function analyze(candles, opts = {}) {
    const n = opts.n ?? 5, K = opts.k ?? 20, ratio = opts.ratio ?? 1;
    const swings = downSwings(findPivots(candles, n));
    const touches = [];   // 과거에 -1을 찍은 사건들
    let current = null;   // 지금 진행 중인 스윙

    for (const s of swings) {
      const H = s.high.price, L = s.low.price;
      const level = L - (H - L) * ratio;
      if (level <= 0) continue;
      const start = s.low.i + 1;
      let touchIdx = -1, broken = false;

      for (let x = start; x < candles.length; x++) {
        if (candles[x].h > H) { broken = true; break; }      // 고점 돌파 → 스윙 무효
        if (candles[x].l <= level) { touchIdx = x; break; }   // -1 터치!
      }

      const info = { highIdx: s.high.i, lowIdx: s.low.i, H, L, level };

      if (touchIdx >= 0 && touchIdx + K < candles.length) {
        // 터치 이후 K개 봉(터치한 봉 포함) 동안의 최고가 / 최저가
        let maxH = -Infinity, minL = Infinity;
        for (let x = touchIdx; x <= touchIdx + K; x++) {
          if (x > touchIdx) maxH = Math.max(maxH, candles[x].h); // 반등은 다음 봉부터
          minL = Math.min(minL, candles[x].l);
        }
        const rebound = (maxH - level) / level * 100;  // -1에서 최대 몇 % 올랐나
        const fall = (level - minL) / level * 100;      // -1 아래로 최대 몇 % 더 빠졌나
        touches.push({ ...info, touchIdx, t: candles[touchIdx].t, rebound, fall, win: rebound > fall });
      }
    }

    // ── 지금 진행 중인 스윙 ──
    // 마지막 스윙 고점 이후 가장 높은 봉을 H로, 그 뒤 가장 낮은 봉을 L로 잡음 (L은 아직 확정 전일 수 있음)
    const pivots = findPivots(candles, n).filter(p => p.type === "H");
    if (pivots.length) {
      let hIdx = pivots[pivots.length - 1].i;
      for (let x = hIdx; x < candles.length; x++) if (candles[x].h > candles[hIdx].h) hIdx = x;
      let lIdx = -1;
      for (let x = hIdx + 1; x < candles.length; x++) if (lIdx < 0 || candles[x].l < candles[lIdx].l) lIdx = x;
      if (lIdx < 0) {
        current = { state: "신고점", highIdx: hIdx, H: candles[hIdx].h };
      } else {
        const H = candles[hIdx].h, L = candles[lIdx].l;
        current = { state: "대기", highIdx: hIdx, lowIdx: lIdx, H, L, level: L - (H - L) * ratio };
      }
    }

    const reb = touches.map(x => x.rebound), fal = touches.map(x => x.fall);
    const stats = {
      count: touches.length,
      reboundAvg: mean(reb), reboundErr: stdErr(reb),
      fallAvg: mean(fal), fallErr: stdErr(fal),
      winRate: touches.length ? touches.filter(x => x.win).length / touches.length * 100 : null,
    };

    const price = candles.length ? candles[candles.length - 1].c : null;
    if (current && !(current.level > 0)) { current.level = null; }   // 신고점이거나 -1이 0 이하
    if (current && current.level) {
      current.distance = (price - current.level) / current.level * 100;
      current.expected = stats.reboundAvg != null ? current.level * (1 + stats.reboundAvg / 100) : null;
    }
    return { price, stats, current, touches };
  }

  const api = { findPivots, downSwings, analyze, mean, stdErr };
  if (typeof module !== "undefined" && module.exports) module.exports = api; // node 테스트용
  else root.FibCore = api;                                                  // 브라우저용
})(this);
