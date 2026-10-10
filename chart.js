/*
  chart.js — 차트 그리기
  ---------------------------------------------------------------
  1) 분석 차트: 트레이딩뷰가 무료로 공개한 "Lightweight Charts" 라이브러리 사용
     캔들 + 진입가 / 예상가 선 + 과거 진입가 터치 표시(▲)
  2) 트레이딩뷰 탭: 진짜 트레이딩뷰 차트를 통째로 넣음 (보조지표·그리기 도구 사용 가능)
*/
(function () {
  "use strict";
  const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const KST = 9 * 3600;   // 차트 시간을 한국 시간으로 보이게 9시간 더함

  let chart = null, series = null, lines = [], mustShow = [];   // mustShow: 세로 범위에 꼭 넣을 가격들
  let lastEl = null, lastOpts = null, tvArgs = null;   // 모드가 바뀔 때 다시 그리려고 기억해 둠
  const isDark = () => (window.Theme ? Theme.get() : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
  let drawnR = null, drawnKey = null, lastN = 0, lastFirstT = 0;   // 지금 그려진 분석 결과 / 코인+봉 단위 / 캔들 수 / 첫 캔들 시각
  const T = c => Math.floor(c.t / 1000) + KST;

  // 화살표 표시 만들기: 과거 터치 ("터치") + 이번 신호에서 진입가에 닿은 봉 (초록색 "진입", 과거 기록보다 우선)
  function buildMarkers(r) {
    const cur = r.current, short = r.direction === "short";
    const pos = short ? "aboveBar" : "belowBar", shape = short ? "arrowDown" : "arrowUp";
    const TS = t => Math.floor(t / 1000) + KST;
    const past = (r.touchT || []).map(t => ({ time: TS(t), position: pos, color: cssVar("--accent"), shape, text: "터치" }));
    const now = cur && cur.touched && cur.touchT != null
      ? [{ time: TS(cur.touchT), position: pos, color: cssVar("--accent"), shape, text: "진입", size: 2 }] : [];
    const seen = new Set();
    return now.concat(past).filter(m => !seen.has(m.time) && seen.add(m.time)).sort((a, b) => a.time - b.time);
  }

  // 가격 크기에 맞춰 소수점 자릿수 정하기
  function precisionFor(price, krw) {
    if (krw) return price >= 100 ? 0 : price >= 1 ? 2 : 4;
    return price >= 1000 ? 1 : price >= 10 ? 2 : price >= 1 ? 4 : price >= 0.01 ? 5 : 8;
  }

  function draw(el, r, opts) {
    if (!window.LightweightCharts) {
      el.innerHTML = '<p style="color:var(--muted);padding:20px">차트 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인하세요.</p>';
      return;
    }
    // 처음 한 번만 차트 틀을 만듦
    if (!chart) {
      el.innerHTML = "";
      chart = LightweightCharts.createChart(el, {
        autoSize: true,
        layout: { background: { color: cssVar("--card") }, textColor: cssVar("--muted"), fontFamily: "system-ui, 'Malgun Gothic', sans-serif" },
        grid: { vertLines: { color: cssVar("--line") }, horzLines: { color: cssVar("--line") } },
        rightPriceScale: { borderColor: cssVar("--line") },
        timeScale: { borderColor: cssVar("--line"), timeVisible: true, secondsVisible: false },
        crosshair: { mode: 0 },
      });
      series = chart.addCandlestickSeries({
        upColor: cssVar("--up"), downColor: cssVar("--down"),
        wickUpColor: cssVar("--up"), wickDownColor: cssVar("--down"), borderVisible: false,
        // 세로 범위에 진입가·예상가가 항상 들어오게 (캔들 범위 밖이어도 자동 맞춤에 포함)
        autoscaleInfoProvider: original => {
          const res = original();
          if (res && res.priceRange && mustShow.length) {
            res.priceRange.minValue = Math.min(res.priceRange.minValue, ...mustShow);
            res.priceRange.maxValue = Math.max(res.priceRange.maxValue, ...mustShow);
          }
          return res;
        },
      });
    }

    lastEl = el; lastOpts = opts;
    const cs = r.candles, cur = r.current, short = r.direction === "short";
    const key = r.market + "|" + (cs.length > 1 ? cs[1].t - cs[0].t : 0);
    const prev = chart.timeScale().getVisibleLogicalRange(), sameChart = key === drawnKey && prev;
    const p = precisionFor(r.price, opts.krw);
    series.applyOptions({ priceFormat: { type: "price", precision: p, minMove: Math.pow(10, -p) } });
    series.setData(cs.map(c => ({ time: T(c), open: c.o, high: c.h, low: c.l, close: c.c })));

    // 이전 코인의 가로선 지우기
    lines.forEach(l => series.removePriceLine(l));
    lines = [];
    const add = (price, color, title, style, width) => {
      if (price == null || !isFinite(price)) return;
      lines.push(series.createPriceLine({ price, color, title, lineStyle: style, lineWidth: width, axisLabelVisible: true }));
    };
    mustShow = [];
    if (cur && cur.level) {
      add(cur.level, cssVar("--accent"), "진입 " + cur.level.toFixed(p), 0, 2);
      add(cur.expected, cssVar("--accent"), short ? "예상 하락" : "예상 반등", 1, 1);
      mustShow = [cur.level, cur.expected].filter(v => v != null && isFinite(v));
    }

    series.setMarkers(buildMarkers(r));

    // 이전 코인에서 가격 눈금을 손으로 늘리거나 줄였으면 자동 맞춤이 꺼져 있음 → 코인 바뀔 때마다 다시 켜기
    chart.priceScale("right").applyOptions({ autoScale: true });

    const n = cs.length;
    if (sameChart) {
      // 같은 코인을 다시 그릴 때는 보던 위치를 유지: 오른쪽 끝을 보고 있었으면 끝에서의 거리를, 과거를 보고 있었으면 같은 봉들을 그대로
      const step = cs.length > 1 ? cs[1].t - cs[0].t : 1, dropped = Math.round((cs[0].t - lastFirstT) / step);
      const atEnd = prev.to >= lastN - 1;
      const shift = atEnd ? n - lastN : -dropped;
      chart.timeScale().setVisibleLogicalRange({ from: prev.from + shift, to: prev.to + shift });
    } else {
      // 최근 300개 봉이 보이게 (마우스 휠·드래그로 과거도 볼 수 있음)
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 300), to: n + 5 });
    }
    drawnR = r; drawnKey = key; lastN = n; lastFirstT = cs[0].t;
  }

  // 실시간 가격으로 마지막 캔들만 갱신 (봉이 바뀌었으면 새 캔들 추가). r 은 draw 로 그린 그 결과여야 함
  function live(r, px, unitMs) {
    if (!series || r !== drawnR || !r.candles || !r.candles.length) return;
    const cs = r.candles, barT = Math.floor(Date.now() / unitMs) * unitMs;
    let last = cs[cs.length - 1];
    if (barT > last.t) { last = { t: barT, o: px, h: px, l: px, c: px }; cs.push(last); lastN = cs.length; }
    else if (barT === last.t) { last.h = Math.max(last.h, px); last.l = Math.min(last.l, px); last.c = px; }
    else return;
    series.update({ time: T(last), open: last.o, high: last.h, low: last.l, close: last.c });
    // 방금 진입가에 닿았으면 이 캔들에 바로 "진입" 화살표
    const cur = r.current;
    if (cur && cur.touched && cur.touchT == null) { cur.touchT = last.t; series.setMarkers(buildMarkers(r)); }
  }

  // 다크/라이트를 바꾸면 차트 색을 바로 다시 칠함 (보던 위치는 그대로)
  function restyle() {
    if (chart) {
      chart.applyOptions({
        layout: { background: { color: cssVar("--card") }, textColor: cssVar("--muted") },
        grid: { vertLines: { color: cssVar("--line") }, horzLines: { color: cssVar("--line") } },
        rightPriceScale: { borderColor: cssVar("--line") },
        timeScale: { borderColor: cssVar("--line") },
      });
      series.applyOptions({ upColor: cssVar("--up"), downColor: cssVar("--down"), wickUpColor: cssVar("--up"), wickDownColor: cssVar("--down") });
      if (drawnR && lastEl) draw(lastEl, drawnR, lastOpts);          // 가로선·화살표 색도 새로
    }
    // 트레이딩뷰는 색을 만들 때만 정할 수 있어서 보이는 중이면 다시 만듦
    if (tvArgs && tvArgs.el.querySelector("#tv-widget") && tvArgs.el.offsetParent !== null) tradingView(tvArgs.el, tvArgs.symbol, tvArgs.interval);
  }
  addEventListener("themechange", restyle);

  // ── 트레이딩뷰 위젯 ────────────────────────────────────────────
  let tvLoading = null;
  function loadTV() {
    if (window.TradingView) return Promise.resolve();
    if (!tvLoading) tvLoading = new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = "https://s3.tradingview.com/tv.js";
      s.onload = ok; s.onerror = () => fail(new Error("트레이딩뷰를 불러오지 못했어요"));
      document.head.appendChild(s);
    });
    return tvLoading;
  }

  async function tradingView(el, symbol, interval) {
    tvArgs = { el, symbol, interval };
    el.innerHTML = '<p style="color:var(--muted);padding:20px">트레이딩뷰 불러오는 중…</p>';
    try { await loadTV(); } catch (e) { el.innerHTML = `<p style="color:var(--muted);padding:20px">${e.message}</p>`; return; }
    el.innerHTML = '<div id="tv-widget" style="height:100%"></div>';
    new TradingView.widget({
      container_id: "tv-widget", autosize: true, symbol, interval: String(interval),
      timezone: "Asia/Seoul", locale: "kr", style: "1",
      theme: isDark() ? "dark" : "light",
      allow_symbol_change: true, hide_side_toolbar: false,
    });
  }

  window.GwChart = { draw, live, tradingView };
})();
