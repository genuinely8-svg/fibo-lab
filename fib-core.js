/*
  fib-core.js — 피보나치 -1 계산 엔진 (롱 / 숏 공용)
  ---------------------------------------------------------------
  캔들 배열(오래된 것 → 최신 순)을 받아서
    1) 스윙 고점(H) / 스윙 저점(L)을 찾고
    2) 스윙마다 확장 레벨(진입가)을 계산하고
         롱 : 하락 스윙(H→L)의 아래쪽 확장   level = L - (H - L) × 비율
         숏 : 상승 스윙(L→H)의 위쪽 확장     level = H + (H - L) × 비율
    3) 과거에 가격이 레벨에 닿았을 때, 그 뒤 K개 봉 동안
         유리한 쪽으로 최대 몇 % 움직였는지 (롱: 반등 / 숏: 되밀림)
         불리한 쪽으로 최대 몇 % 더 갔는지 (롱: 추가하락 / 숏: 추가상승) 통계를 냅니다.
  direction 은 "long"(기본) | "short". 롱과 숏은 같은 코드를 쓰고 방향만 뒤집어요.
  결과 필드 이름은 롱 기준 그대로(rebound / fall …)이고, 숏에서는 되밀림 / 추가상승 값이 들어가요.
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

  // ── 2. 스윙 목록 만들기 ───────────────────────────────────────
  // 롱: 하락 스윙(H → L) / 숏: 상승 스윙(L → H)
  function swingsOf(pivots, dir) {
    const from = dir === "short" ? "L" : "H", to = dir === "short" ? "H" : "L";
    const swings = [];
    for (let k = 0; k < pivots.length - 1; k++) {
      if (pivots[k].type === from && pivots[k + 1].type === to) {
        swings.push({ high: dir === "short" ? pivots[k + 1] : pivots[k], low: dir === "short" ? pivots[k] : pivots[k + 1], end: pivots[k + 1] });
      }
    }
    return swings;
  }
  const downSwings = pivots => swingsOf(pivots, "long");
  const upSwings = pivots => swingsOf(pivots, "short");

  // ── 방향별 규칙 (롱과 숏이 다른 부분은 전부 여기에만 있음) ──────────
  function rules(dir) {
    if (dir === "short") return {
      short: true,
      level: (H, L, ratio) => H + (H - L) * ratio,     // 위쪽 확장
      broken: (c, H, L) => c.l < L,                    // 스윙 저점을 아래로 깨면 스윙 무효
      hit: (c, level) => c.h >= level,                 // 고가가 레벨에 닿음
      favor: (c) => c.l, better: Math.min,             // 유리한 쪽 극값: 가장 낮은 저가 (되밀림)
      adverse: (c) => c.h, worse: Math.max,            // 불리한 쪽 극값: 가장 높은 고가 (추가상승)
      favorPct: (level, x) => (level - x) / level * 100,
      adversePct: (level, x) => (x - level) / level * 100,
      distance: (price, level) => (level - price) / price * 100,   // 진입까지 거리 = (진입가 − 현재가) / 현재가
      expected: (level, pct) => level * (1 - pct / 100),
      startIdx: (s) => s.high.i + 1,                   // 고점이 확정된 다음 봉부터 지켜봄
    };
    return {
      short: false,
      level: (H, L, ratio) => L - (H - L) * ratio,
      broken: (c, H, L) => c.h > H,
      hit: (c, level) => c.l <= level,
      favor: (c) => c.h, better: Math.max,
      adverse: (c) => c.l, worse: Math.min,
      favorPct: (level, x) => (x - level) / level * 100,
      adversePct: (level, x) => (level - x) / level * 100,
      distance: (price, level) => (price - level) / level * 100,
      expected: (level, pct) => level * (1 + pct / 100),
      startIdx: (s) => s.low.i + 1,
    };
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
      opts.n         : 스윙 민감도 (좌우 몇 개 봉과 비교할지). 기본 5
      opts.k         : 터치 후 몇 개 봉 동안 지켜볼지. 기본 20
      opts.ratio     : 확장 비율. 1이면 -1 레벨. 기본 1
      opts.direction : "long"(기본) | "short"
  */
  function analyze(candles, opts = {}) {
    const n = opts.n ?? 5, K = opts.k ?? 20, ratio = opts.ratio ?? 1;
    const direction = opts.direction === "short" ? "short" : "long";
    const R = rules(direction);
    const swings = swingsOf(findPivots(candles, n), direction);
    const touches = [];   // 과거에 레벨을 찍은 사건들
    let current = null;   // 지금 진행 중인 스윙

    for (const s of swings) {
      const H = s.high.price, L = s.low.price;
      const level = R.level(H, L, ratio);
      if (level <= 0) continue;
      const start = R.startIdx(s);
      let touchIdx = -1, broken = false;

      for (let x = start; x < candles.length; x++) {
        if (R.broken(candles[x], H, L)) { broken = true; break; }   // 반대쪽 끝을 넘음 → 스윙 무효
        if (R.hit(candles[x], level)) { touchIdx = x; break; }       // 레벨 터치!
      }

      const info = { highIdx: s.high.i, lowIdx: s.low.i, H, L, level };

      if (touchIdx >= 0 && touchIdx + K < candles.length) {
        // 터치 이후 K개 봉(터치한 봉 포함) 동안의 유리한 쪽 / 불리한 쪽 극값
        let fav = R.short ? Infinity : -Infinity, adv = R.short ? -Infinity : Infinity;
        for (let x = touchIdx; x <= touchIdx + K; x++) {
          if (x > touchIdx) fav = R.better(fav, R.favor(candles[x])); // 반등(되밀림)은 다음 봉부터
          adv = R.worse(adv, R.adverse(candles[x]));
        }
        const rebound = R.favorPct(level, fav);  // 레벨에서 최대 몇 % 유리하게 움직였나 (롱: 반등 / 숏: 되밀림)
        const fall = R.adversePct(level, adv);   // 레벨을 넘어 최대 몇 % 더 불리했나 (롱: 추가하락 / 숏: 추가상승)
        touches.push({ ...info, touchIdx, t: candles[touchIdx].t, rebound, fall, win: rebound > fall });
      }
    }

    // ── 지금 진행 중인 스윙 (과거 통계와 똑같은 규칙) ──
    // 극값(롱: 저점 / 숏: 고점)이 "확정된" 스윙만 씀 → 진입가는 한 번 정해지면 고정 (가격을 따라 움직이지 않음)
    // 최근 스윙부터 거꾸로 보면서, 아직 반대쪽 끝을 깨지 않은 스윙을 고름
    //   · 아직 진입가를 안 찍었으면 → "대기" (진입가까지 남은 거리 표시)
    //   · 최근 K개 봉 안에 진입가를 찍었으면 → "도달" (진입 신호)
    //   · 찍은 지 K개 봉이 지났으면 → 끝난 스윙이라 건너뜀
    for (let si = swings.length - 1; si >= 0 && !current; si--) {
      const s = swings[si];
      const H = s.high.price, L = s.low.price;
      const level = R.level(H, L, ratio);
      if (level <= 0) continue;
      let touchIdx = -1, broken = false;
      for (let x = R.startIdx(s); x < candles.length; x++) {
        if (R.broken(candles[x], H, L)) { broken = true; break; }
        if (touchIdx < 0 && R.hit(candles[x], level)) touchIdx = x;
      }
      if (broken) continue;
      const since = touchIdx >= 0 ? candles.length - 1 - touchIdx : null;
      if (touchIdx >= 0 && since > K) continue;
      current = { state: touchIdx >= 0 ? "도달" : "대기", highIdx: s.high.i, lowIdx: s.low.i, H, L, level,
                  touched: touchIdx >= 0, touchIdx: touchIdx >= 0 ? touchIdx : null, barsSinceTouch: since };
      if (touchIdx >= 0) {
        // 도달한 뒤 가장 낮았던 가격 / 가장 높았던 가격
        // (유리한 쪽 극값은 다음 봉부터 — 롱은 최고가, 숏은 최저가. 과거 통계와 같은 기준)
        let lo = Infinity, hi = -Infinity;
        for (let x = touchIdx; x < candles.length; x++) {
          if (!R.short || x > touchIdx) lo = Math.min(lo, candles[x].l);
          if (R.short || x > touchIdx) hi = Math.max(hi, candles[x].h);
        }
        current.minSince = lo < Infinity ? lo : null;
        current.maxSince = hi > -Infinity ? hi : null;
      }
    }
    // 살아있는 스윙이 없음 = 반대쪽 끝을 깼거나 아직 극값이 확정 전 → 확정되길 기다리는 중
    if (!current && candles.length) current = { state: R.short ? "고점 형성 중" : "저점 형성 중", level: null };

    const reb = touches.map(x => x.rebound), fal = touches.map(x => x.fall);
    const stats = {
      count: touches.length,
      reboundAvg: mean(reb), reboundErr: stdErr(reb),
      fallAvg: mean(fal), fallErr: stdErr(fal),
      winRate: touches.length ? touches.filter(x => x.win).length / touches.length * 100 : null,
    };

    const price = candles.length ? candles[candles.length - 1].c : null;
    if (current && current.level) {
      current.distance = R.distance(price, current.level);
      current.expected = stats.reboundAvg != null ? R.expected(current.level, stats.reboundAvg) : null;
      if (current.touched) touchPhase(current, stats, price, direction);
    }
    return { direction, price, stats, current, touches };
  }

  /*
    진입가 도달 후 지금 어떤 상황인지 (과거 통계와 비교)  — 롱 기준 설명, 숏은 위아래만 뒤집힘
      목표 도달 : 도달 후 예상 반등(되밀림)가까지 한 번이라도 감 → 이번 기회는 지나감
      이탈      : 지금 가격이 진입가에서 "평균 추가하락(추가상승) + 오차"보다 더 불리한 쪽에 있음
                  (다시 그 범위 안으로 돌아오면 진입 구간으로 돌아옴)
      반등 중   : 지금 진입가보다 유리한 쪽 (예상 반등까지 몇 % 왔는지 progress)
      진입 구간 : 지금 진입가보다 불리한 쪽이지만 평소에 더 가던 범위 안
    (도달 후 최저·최고 가격 minSince / maxSince 는 실시간 가격으로도 갱신 가능)
  */
  function touchPhase(cur, stats, price, direction) {
    const R = rules(direction);
    const lv = cur.level;
    const limit = stats.fallAvg != null ? stats.fallAvg + (stats.fallErr || 0) : null;   // 이탈 기준 (%)
    cur.outLimit = limit;
    cur.lowPct = cur.minSince != null ? (cur.minSince - lv) / lv * 100 : null;          // 도달 후 최저 (진입가 대비 %)
    cur.highPct = cur.maxSince != null ? (cur.maxSince - lv) / lv * 100 : null;         // 도달 후 최고
    const gain = R.short ? lv - price : price - lv;                  // 유리한 쪽으로 얼마나 왔나
    const room = R.short ? lv - cur.expected : cur.expected - lv;    // 목표까지 전체 거리
    cur.progress = cur.expected && room > 0 ? gain / room * 100 : null;
    const goal = R.short ? cur.minSince : cur.maxSince;              // 도달 후 유리한 쪽 극값
    const reached = goal != null && (R.short ? goal <= cur.expected : goal >= cur.expected);
    if (cur.expected != null && reached) cur.phase = "목표 도달";
    else if (limit != null && (R.short ? price - lv : lv - price) / lv * 100 > limit) cur.phase = "이탈";
    else if (R.short ? price < lv : price > lv) cur.phase = "반등 중";
    else cur.phase = "진입 구간";
    cur.state = cur.phase;
    return cur;
  }

  /*
    실시간 가격 한 틱을 지금 스윙(res.current)에 반영. 진입가는 고정 (analyze 와 같은 규칙)
    반대쪽 끝을 깨면 그 스윙은 끝 → 다음 재계산 때 새 스윙을 찾음
  */
  function applyPrice(res, px, direction) {
    const R = rules(direction || res.direction);
    res.price = px;
    const c = res.current;
    if (!c || !c.level) return;
    if (R.short ? px < c.L : px > c.H) {
      res.current = { state: R.short ? "고점 형성 중" : "저점 형성 중", level: null };
      return;
    }
    if (!c.touched && (R.short ? px >= c.level : px <= c.level)) {   // 진입가 도달!
      c.touched = true; c.barsSinceTouch = 0;
      c.minSince = R.short ? null : px; c.maxSince = R.short ? px : null;
    } else if (c.touched) {                                           // 도달 후 최저·최고 갱신
      c.minSince = Math.min(c.minSince ?? px, px);
      c.maxSince = Math.max(c.maxSince ?? px, px);
    }
    c.distance = R.distance(px, c.level);
    if (c.touched) touchPhase(c, res.stats, px, direction || res.direction);
  }

  /*
    화면에 보여줄 상태 4가지
      진입 구간 : 진입가에 도달했고, 아직 평소 추가하락(추가상승) 범위 안
      진입 근접 : 진입가까지 5% 이내 (도달 후 살짝 반등한 경우 포함)
      이탈      : 진입가 도달 후 평소보다 깊게 갔음
      대기      : 그 밖 (멀리 있음 · 반등이 끝남 · 극값 형성 중)
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

  /*
    기대값(참고) % = 승률 × 평균 반등(되밀림) − (1 − 승률) × 평균 추가하락(추가상승) − 왕복 수수료
    stats.winRate 는 0~100 (%), fee 는 % 단위 (0.1 = 0.1%)
  */
  function expectancy(stats, fee = 0.1) {
    if (!stats || !stats.count || stats.winRate == null || stats.reboundAvg == null || stats.fallAvg == null) return null;
    const w = stats.winRate / 100;
    return w * stats.reboundAvg - (1 - w) * stats.fallAvg - fee;
  }

  const api = { findPivots, downSwings, upSwings, swingsOf, analyze, touchPhase, applyPrice, label, expectancy, mean, stdErr };
  if (typeof module !== "undefined" && module.exports) module.exports = api; // node 테스트용
  else root.FibCore = api;                                                  // 브라우저용
})(this);
