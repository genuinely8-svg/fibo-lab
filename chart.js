/*
  chart.js — 차트 그리기
  ---------------------------------------------------------------
  1) 분석 차트: 트레이딩뷰가 무료로 공개한 "Lightweight Charts" 라이브러리 사용
     캔들 + 우리가 계산한 H / L / -1 / 예상 반등가 선 + 과거 -1 터치 표시(▲)
  2) 트레이딩뷰 탭: 진짜 트레이딩뷰 차트를 통째로 넣음 (보조지표·그리기 도구 사용 가능)
*/
(function () {
  "use strict";
  const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const KST = 9 * 3600;   // 차트 시간을 한국 시간으로 보이게 9시간 더함

  let chart = null, series = null, lines = [];

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
      });
    }

    const cs = r.candles, cur = r.current;
    const T = c => Math.floor(c.t / 1000) + KST;
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
    if (cur && cur.H) add(cur.H, cssVar("--up"), "H", 2, 1);
    if (cur && cur.level) {
      add(cur.L, cssVar("--down"), "L", 2, 1);
      add(cur.level, cssVar("--accent"), "-1", 0, 2);
      add(cur.expected, cssVar("--accent"), "예상 반등", 1, 1);
    }

    // 과거 -1 터치 지점 ▲ 표시 (시간 순서대로 넣어야 함)
    const seen = new Set();
    const markers = r.touches
      .map(t => ({ time: T(cs[t.touchIdx]), position: "belowBar", color: cssVar("--accent"), shape: "arrowUp", text: "-1" }))
      .filter(m => !seen.has(m.time) && seen.add(m.time))
      .sort((a, b) => a.time - b.time);
    series.setMarkers(markers);

    // 최근 300개 봉이 보이게 (마우스 휠·드래그로 과거도 볼 수 있음)
    const n = cs.length;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 300), to: n + 5 });
  }

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
    el.innerHTML = '<p style="color:var(--muted);padding:20px">트레이딩뷰 불러오는 중…</p>';
    try { await loadTV(); } catch (e) { el.innerHTML = `<p style="color:var(--muted);padding:20px">${e.message}</p>`; return; }
    el.innerHTML = '<div id="tv-widget" style="height:100%"></div>';
    new TradingView.widget({
      container_id: "tv-widget", autosize: true, symbol, interval: String(interval),
      timezone: "Asia/Seoul", locale: "kr", style: "1",
      theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      allow_symbol_change: true, hide_side_toolbar: false,
    });
  }

  window.FiboChart = { draw, tradingView };
})();
