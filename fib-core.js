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

    // ── 지금 진행 중인 스윙 (과거 통계와 똑같은 규칙) ──
    // 저점(L)이 "확정된" 하락 스윙만 씀 → 진입가는 한 번 정해지면 고정 (가격을 따라 내려가지 않음)
    // 최근 스윙부터 거꾸로 보면서, 아직 고점(H)을 뚫리지 않은 스윙을 고름
    //   · 아직 진입가를 안 찍었으면 → "대기" (진입가까지 남은 거리 표시)
    //   · 최근 K개 봉 안에 진입가를 찍었으면 → "도달" (진입 신호)
    //   · 찍은 지 K개 봉이 지났으면 → 끝난 스윙이라 건너뜀
    for (let si = swings.length - 1; si >= 0 && !current; si--) {
      const s = swings[si];
      const H = s.high.price, L = s.low.price;
      const level = L - (H - L) * ratio;
      if (level <= 0) continue;
      let touchIdx = -1, broken = false;
      for (let x = s.low.i + 1; x < candles.length; x++) {
        if (candles[x].h > H) { broken = true; break; }
        if (touchIdx < 0 && candles[x].l <= level) touchIdx = x;
      }
      if (broken) continue;
      const since = touchIdx >= 0 ? candles.length - 1 - touchIdx : null;
      if (touchIdx >= 0 && since > K) continue;
      current = { state: touchIdx >= 0 ? "도달" : "대기", highIdx: s.high.i, lowIdx: s.low.i, H, L, level,
                  touched: touchIdx >= 0, touchIdx: touchIdx >= 0 ? touchIdx : null, barsSinceTouch: since };
      if (touchIdx >= 0) {
        // 도달한 뒤 가장 낮았던 가격 / 가장 높았던 가격 (반등은 다음 봉부터 — 과거 통계와 같은 기준)
        let lo = Infinity, hi = -Infinity;
        for (let x = touchIdx; x < candles.length; x++) {
          lo = Math.min(lo, candles[x].l);
          if (x > touchIdx) hi = Math.max(hi, candles[x].h);
        }
        current.minSince = lo;
        current.maxSince = hi > -Infinity ? hi : null;
      }
    }
    // 살아있는 스윙이 없음 = 새 고점을 만들었거나 아직 저점이 확정 전 → 저점이 확정되길 기다리는 중
    if (!current && candles.length) current = { state: "저점 형성 중", level: null };

    const reb = touches.map(x => x.rebound), fal = touches.map(x => x.fall);
    const stats = {
      count: touches.length,
      reboundAvg: mean(reb), reboundErr: stdErr(reb),
      fallAvg: mean(fal), fallErr: stdErr(fal),
      winRate: touches.length ? touches.filter(x => x.win).length / touches.length * 100 : null,
    };

    const price = candles.length ? candles[candles.length - 1].c : null;
    if (current && current.level) {
      current.distance = (price - current.level) / current.level * 100;
      current.expected = stats.reboundAvg != null ? current.level * (1 + stats.reboundAvg / 100) : null;
      if (current.touched) touchPhase(current, stats, price);
    }
    return { price, stats, current, touches };
  }

  /*
    진입가 도달 후 지금 어떤 상황인지 (과거 통계와 비교)
      목표 도달 : 도달 후 예상 반등가까지 한 번이라도 올라감 → 이번 기회는 지나감
      이탈      : 지금 가격이 진입가 아래로 "평균 추가하락 + 오차"보다 더 빠져 있음 → 평소보다 깊게 빠짐
                  (다시 그 범위 안으로 올라오면 진입 구간으로 돌아옴)
      반등 중   : 지금 진입가 위 (예상 반등까지 몇 % 왔는지 progress)
      진입 구간 : 지금 진입가 아래지만 평소에 더 빠지던 범위 안
    (도달 후 최저·최고 가격 minSince / maxSince 는 실시간 가격으로도 갱신 가능)
  */
  function touchPhase(cur, stats, price) {
    const lv = cur.level;
    const limit = stats.fallAvg != null ? stats.fallAvg + (stats.fallErr || 0) : null;   // 이탈 기준 (%)
    cur.outLimit = limit;
    cur.lowPct = cur.minSince != null ? (cur.minSince - lv) / lv * 100 : null;          // 도달 후 최저 (진입가 대비 %)
    cur.highPct = cur.maxSince != null ? (cur.maxSince - lv) / lv * 100 : null;         // 도달 후 최고
    cur.progress = cur.expected && cur.expected > lv ? (price - lv) / (cur.expected - lv) * 100 : null;
    if (cur.expected != null && cur.maxSince != null && cur.maxSince >= cur.expected) cur.phase = "목표 도달";
    else if (limit != null && (lv - price) / lv * 100 > limit) cur.phase = "이탈";
    else if (price > lv) cur.phase = "반등 중";
    else cur.phase = "진입 구간";
    cur.state = cur.phase;
    return cur;
  }

  /*
    화면에 보여줄 상태 4가지
      진입 구간 : 진입가에 도달했고, 아직 평소 추가하락 범위 안 (진입가 아래)
      진입 근접 : 진입가 위 5% 이내 (도달 후 살짝 반등한 경우 포함)
      이탈      : 진입가 도달 후 평소보다 깊게 빠짐
      대기      : 그 밖 (멀리 있음 · 반등이 끝남 · 저점 형성 중)
  */
  function label(cur, near = 5) {
    if (!cur || !cur.level) return "대기";
    if (cur.touched) {
      if (cur.phase === "진입 구간") return "진입 구간";
      if (cur.phase === "이탈") return "이탈";
      if (cur.phase === "목표 도달") return "대기";
    }
    return cur.distance <= near ? "진입 근접" : "대기";
  }

  const api = { findPivots, downSwings, analyze, touchPhase, label, mean, stdErr };
  if (typeof module !== "undefined" && module.exports) module.exports = api; // node 테스트용
  else root.FibCore = api;                                                  // 브라우저용
})(this);
