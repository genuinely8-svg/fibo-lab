/*
  sig-live.js — 서버가 준 신호 결과에 실시간 가격을 반영하고, 화면에 보일 상태 글자를 정해요.
  진입가·예상가·통계는 서버(api/fib)가 계산해서 주고, 여기서는 가격 비교만 해요.
*/
(function (root) {
  "use strict";
  const isShort = d => d === "short";
  const distance = (price, level, d) => isShort(d) ? (level - price) / price * 100 : (price - level) / level * 100;

  // 진입가 도달 뒤 지금 상황 (목표 도달 / 이탈 / 반등 중 / 진입 구간)
  function touchPhase(cur, stats, price, d) {
    const S = isShort(d), lv = cur.level;
    const limit = stats && stats.fallAvg != null ? stats.fallAvg + (stats.fallErr || 0) : null;
    cur.outLimit = limit;
    cur.lowPct = cur.minSince != null ? (cur.minSince - lv) / lv * 100 : null;
    cur.highPct = cur.maxSince != null ? (cur.maxSince - lv) / lv * 100 : null;
    const gain = S ? lv - price : price - lv;
    const room = S ? lv - cur.expected : cur.expected - lv;
    cur.progress = cur.expected && room > 0 ? gain / room * 100 : null;
    const goal = S ? cur.minSince : cur.maxSince;
    const reached = goal != null && cur.expected != null && (S ? goal <= cur.expected : goal >= cur.expected);
    if (reached) cur.phase = "목표 도달";
    else if (limit != null && (S ? price - lv : lv - price) / lv * 100 > limit) cur.phase = "이탈";
    else if (S ? price < lv : price > lv) cur.phase = "반등 중";
    else cur.phase = "진입 구간";
    cur.state = cur.phase;
    return cur;
  }

  // 실시간 가격 한 틱 반영 (진입가는 고정). 신호가 끝나는 가격(brk)을 넘으면 다음 계산 때 새 신호를 기다림
  function applyPrice(res, px) {
    const d = res.direction;
    res.price = px;
    const c = res.current;
    if (!c || !c.level) return;
    if (c.brk != null && (isShort(d) ? px < c.brk : px > c.brk)) {
      res.current = { state: isShort(d) ? "고점 형성 중" : "저점 형성 중", level: null };
      return;
    }
    if (!c.touched && (isShort(d) ? px >= c.level : px <= c.level)) {
      c.touched = true; c.touchT = null;
      c.minSince = isShort(d) ? null : px; c.maxSince = isShort(d) ? px : null;
    } else if (c.touched) {
      c.minSince = Math.min(c.minSince ?? px, px);
      c.maxSince = Math.max(c.maxSince ?? px, px);
    }
    c.distance = distance(px, c.level, d);
    if (c.touched) touchPhase(c, res.stats, px, d);
  }

  // 화면 상태 4가지: 진입 구간 / 진입 근접(5% 이내) / 이탈 / 대기
  function label(cur, near = 5) {
    if (!cur || !cur.level) return "대기";
    if (cur.touched) {
      if (cur.phase === "진입 구간") return "진입 구간";
      if (cur.phase === "이탈") return "이탈";
      if (cur.phase === "목표 도달") return "대기";
    }
    return cur.distance <= near ? "진입 근접" : "대기";
  }

  // 기대값(참고) % = 승률 × 평균 반등 − (1 − 승률) × 평균 추가 이동 − 왕복 수수료
  function expectancy(stats, fee = 0.1) {
    if (!stats || !stats.count || stats.winRate == null || stats.reboundAvg == null || stats.fallAvg == null) return null;
    const w = stats.winRate / 100;
    return w * stats.reboundAvg - (1 - w) * stats.fallAvg - fee;
  }

  root.SigLive = { applyPrice, touchPhase, label, expectancy };
})(window);
