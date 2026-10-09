/*
  intro.js — 첫 화면 인트로 (C안 · Grid Ticker)
  - index.html 의 <body> 바로 아래에서 불러와요 (메인 화면이 먼저 번쩍 보이지 않게)
  - 흰 모눈 배경 + 위아래로 흐르는 실시간 시세(바이낸스) + 뒤에 흐린 모의투자 화면 + 큰 GWAVE 글자
  - [ JOIN THE TERMINAL ] 누르면 인트로가 흐려지며 사라지고 메인(Crypto)이 나타남
  - 한 번 들어가면 브라우저 창을 닫기 전까지(sessionStorage) 다시 안 보여요
  - 안 보이는 경우: Stock 탭(/signals-rwa), 주소 뒤에 ?nointro
  - 다시 보고 싶으면 주소 뒤에 ?intro
*/
(function () {
  "use strict";
  var KEY = "gwave-intro-seen";
  var qs = location.search;
  var path = location.pathname.toLowerCase();
  if (/nointro/.test(qs) || path.indexOf("signals-rwa") >= 0) return;
  if (!/[?&]intro\b/.test(qs)) {
    try { if (sessionStorage.getItem(KEY)) return; } catch (e) {}
  }

  var root = document.documentElement;
  root.classList.add("gw-on");

  var GREEN = "#05875A", UP = "#0ECB81", DOWN = "#E5484D", INK = "#0B1220", MUTED = "#5B6474";
  var COINS = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "AVAX", "LINK", "TON", "ADA", "SUI", "TRX"];

  var css = document.createElement("style");
  css.textContent = [
    "html.gw-on,html.gw-on body{overflow:hidden!important}",
    "html.gw-on .wrap{opacity:0}",
    "html.gw-out .wrap{opacity:1;transition:opacity .8s ease .35s}",
    "#gw{position:fixed;inset:0;z-index:9999;overflow:hidden;background-color:#fff;color:" + INK + ";",
    "  background-image:linear-gradient(#EEF1F4 1px,transparent 1px),linear-gradient(90deg,#EEF1F4 1px,transparent 1px);background-size:48px 48px;",
    "  font-family:'IBM Plex Sans',system-ui,sans-serif;transition:opacity .8s ease,filter .8s ease}",
    "#gw.out{opacity:0;filter:blur(8px);pointer-events:none}",
    "#gw *{box-sizing:border-box}",
    "#gw .mono{font-family:'IBM Plex Mono',ui-monospace,monospace}",
    "#gw .sg{font-family:'Space Grotesk',system-ui,sans-serif}",
    /* 뒤쪽 흐린 모의투자 화면 */
    "#gw .term-box{position:absolute;left:50%;bottom:-380px;width:1200px;height:740px;transform:translateX(-50%) scale(1.15);opacity:.5;",
    "  -webkit-mask-image:linear-gradient(180deg,transparent 0%,#000 45%);mask-image:linear-gradient(180deg,transparent 0%,#000 45%);pointer-events:none}",
    "@media (max-width:900px){#gw .term-box{transform:translateX(-50%) scale(.7);bottom:-300px}}",
    "#gw .term{width:1200px;height:740px;background:#fff;border:1px solid #E3E8EE;border-radius:16px;overflow:hidden;display:flex;flex-direction:column}",
    "#gw .row{display:flex;align-items:center}",
    "#gw .hd1{height:56px;gap:28px;padding:0 20px;border-bottom:1px solid #EEF1F4;font-size:13px;color:" + MUTED + "}",
    "#gw .hd2{height:64px;gap:32px;padding:0 20px;border-bottom:1px solid #EEF1F4}",
    "#gw .chart{position:relative;height:420px;margin:0 20px;background-image:linear-gradient(#F2F4F7 1px,transparent 1px),linear-gradient(90deg,#F2F4F7 1px,transparent 1px);background-size:100% 70px,96px 100%}",
    "#gw .chart i{position:absolute;display:block}",
    "#gw .side{width:300px;flex:none;padding:20px;display:flex;flex-direction:column;gap:14px;font-size:12px}",
    "#gw .btn-l,#gw .btn-s{text-align:center;padding:14px 0;border-radius:8px;color:#fff;font-size:15px;font-weight:600}",
    /* 훑고 지나가는 녹색 빛 */
    "@keyframes gwscan{0%{top:-10%}100%{top:110%}}",
    "#gw .scan{position:absolute;left:0;right:0;height:120px;background:linear-gradient(180deg,rgba(14,203,129,0) 0%,rgba(14,203,129,.08) 50%,rgba(14,203,129,0) 100%);animation:gwscan 6s linear infinite;pointer-events:none}",
    /* 위아래 시세 띠 */
    "@keyframes gwmq{from{transform:translateX(0)}to{transform:translateX(-50%)}}",
    "@keyframes gwmqr{from{transform:translateX(-50%)}to{transform:translateX(0)}}",
    "#gw .tape{position:absolute;left:0;right:0;height:44px;background:rgba(255,255,255,.9);overflow:hidden;display:flex;align-items:center}",
    "#gw .tape.top{top:0;border-bottom:1px solid #E3E8EE}",
    "#gw .tape.bot{bottom:0;border-top:1px solid #E3E8EE}",
    "#gw .tape .run{display:flex;gap:40px;white-space:nowrap;font-size:13px;padding-left:40px}",
    "#gw .tape.top .run{animation:gwmq 40s linear infinite}",
    "#gw .tape.bot .run{animation:gwmqr 46s linear infinite}",
    "#gw .tape .px{color:" + MUTED + "}",
    /* 가운데 */
    "@keyframes gwrise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}",
    "@keyframes gwblink{0%,49%{opacity:1}50%,100%{opacity:0}}",
    "#gw .mid{position:absolute;inset:44px 0 44px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 16px;text-align:center}",
    "#gw .r1{animation:gwrise 1s cubic-bezier(.2,.7,.2,1) both}",
    "#gw .r2{animation:gwrise 1s cubic-bezier(.2,.7,.2,1) .25s both}",
    "#gw .r3{animation:gwrise 1s cubic-bezier(.2,.7,.2,1) .5s both}",
    "#gw .boot{font-size:13px;color:#4A5363;letter-spacing:.1em}",
    "#gw .cur{color:" + GREEN + ";animation:gwblink 1s steps(1) infinite}",
    "#gw h1{margin:20px 0 0;font-weight:700;font-size:clamp(64px,13vw,128px);line-height:.95;letter-spacing:.06em;color:" + INK + "}",
    "#gw h1 b{color:" + GREEN + ";font-weight:700}",
    "#gw .sub{margin-top:18px;display:flex;gap:14px;flex-wrap:wrap;justify-content:center;font-size:14px;color:#4A5363}",
    "#gw .sub s{text-decoration:none;color:#CBD2DC}",
    "#gw .pos{margin-top:40px;display:flex;align-items:center;gap:18px;padding:14px 22px;border:1px solid #DCE3EA;border-radius:12px;background:#fff;box-shadow:0 20px 50px -24px rgba(5,135,90,.4)}",
    "#gw .pos small{font-size:12px;color:" + MUTED + ";text-align:left;line-height:1.5}",
    "#gw .pos strong{font-size:34px;font-weight:500;color:" + GREEN + "}",
    "#gw .join{margin-top:40px;height:56px;padding:0 40px;border:1.5px solid " + GREEN + ";border-radius:4px;background:#fff;color:" + GREEN + ";",
    "  font-size:15px;font-weight:500;letter-spacing:.12em;cursor:pointer;transition:background .2s ease,color .2s ease}",
    "#gw .join:hover,#gw .join:focus-visible{background:" + GREEN + ";color:#fff;outline:none}",
    "@media (max-width:600px){#gw .sub{font-size:12px;gap:8px}#gw .pos strong{font-size:26px}#gw .join{padding:0 24px;font-size:13px}}",
    "@media (prefers-reduced-motion:reduce){#gw *{animation:none!important}}"
  ].join("\n");
  document.head.appendChild(css);

  var fonts = document.createElement("link");
  fonts.rel = "stylesheet";
  fonts.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap";
  document.head.appendChild(fonts);

  /* 뒤쪽 모의투자 화면의 캔들 (모양만 보여 주는 장식용) */
  function candles() {
    var s = 7, rnd = function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    var N = 68, W = 860, H = 420, raw = [], p = 100, i;
    for (i = 0; i < N; i++) {
      var o = p, c = o + (rnd() - 0.4) * 3.2;
      raw.push({ o: o, c: c, hi: Math.max(o, c) + rnd() * 1.6, lo: Math.min(o, c) - rnd() * 1.6 });
      p = c;
    }
    var mx = -1e9, mn = 1e9;
    raw.forEach(function (r) { mx = Math.max(mx, r.hi); mn = Math.min(mn, r.lo); });
    var y = function (v) { return Math.round((mx - v) / (mx - mn) * (H - 40) + 20); };
    var step = W / N, out = "";
    raw.forEach(function (r, i) {
      var col = r.c >= r.o ? UP : DOWN, bt = y(Math.max(r.o, r.c)), bb = y(Math.min(r.o, r.c));
      out += '<i style="left:' + Math.round(i * step + 4) + "px;top:" + y(r.hi) + "px;width:1px;height:" + Math.max(1, y(r.lo) - y(r.hi)) + "px;background:" + col + '"></i>';
      out += '<i style="left:' + Math.round(i * step) + "px;top:" + bt + "px;width:8px;height:" + Math.max(2, bb - bt) + "px;background:" + col + ';border-radius:1px"></i>';
    });
    var ey = y(raw[44].c);
    out += '<i style="left:0;right:0;top:' + ey + "px;border-top:1px dashed " + GREEN + '"></i>';
    return out;
  }

  var tapeItems = COINS.map(function (c) {
    return '<span data-c="' + c + '">' + c + 'USDT <span class="px">—</span> <span class="ch"></span></span>';
  }).join("");

  var el = document.createElement("div");
  el.id = "gw";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Gwave intro");
  el.innerHTML =
    '<div class="term-box" aria-hidden="true"><div class="term">' +
      '<div class="row hd1"><span class="sg" style="font-weight:700;letter-spacing:.08em;font-size:16px;color:' + INK + '"><span style="color:' + GREEN + '">G</span>WAVE</span>' +
        "<span>Crypto</span><span>Stock</span><span>Trading Engine</span>" +
        '<span style="color:' + INK + ";font-weight:500;border-bottom:2px solid " + GREEN + ';padding:18px 0">Paper Trading</span><span>Insights</span>' +
        '<span class="mono" style="margin-left:auto;font-size:12px;padding:4px 10px;border-radius:6px;background:#E8F8F0;color:' + GREEN + '">DEMO · 10,000.00 USDT</span></div>' +
      '<div class="row hd2 mono"><span class="sg" style="font-size:18px;font-weight:600">BTCUSDT <span style="font-size:12px;color:' + MUTED + ';font-weight:400">Perp</span></span>' +
        '<span id="gw-btc" style="font-size:22px;color:' + GREEN + ';font-weight:500">—</span></div>' +
      '<div style="flex:1;display:flex;min-height:0">' +
        '<div style="flex:1;border-right:1px solid #EEF1F4;padding-top:36px"><div class="chart">' + candles() + "</div></div>" +
        '<div class="side mono">' +
          '<div style="border:1px solid #E3E8EE;border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between"><span style="color:' + MUTED + '">Leverage</span><span>10x Cross</span></div>' +
          '<div style="border:1px solid #E3E8EE;border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between"><span style="color:' + MUTED + '">Size</span><span>0.150 BTC</span></div>' +
          '<span class="btn-l sg" style="background:' + GREEN + '">Buy / Long</span>' +
          '<span class="btn-s sg" style="background:' + DOWN + '">Sell / Short</span>' +
        "</div>" +
      "</div>" +
    "</div></div>" +
    '<div class="scan" aria-hidden="true"></div>' +
    '<div class="tape top mono" aria-hidden="true"><div class="run">' + tapeItems + tapeItems + "</div></div>" +
    '<div class="mid">' +
      '<div class="boot mono r1">&gt; INITIALIZING TRADING TERMINAL<span class="cur">_</span></div>' +
      '<h1 class="sg r2"><b>G</b>WAVE</h1>' +
      '<div class="sub mono r2"><span>Crypto &amp; Stock Signals</span><s>/</s><span>Trading Engine</span><s>/</s><span>Paper Trading</span></div>' +
      '<div class="pos mono r3"><small>PAPER POSITION · DEMO<br>BTCUSDT · LONG 10x</small><strong>+<span id="gw-pnl">0.00</span>%</strong></div>' +
      '<button type="button" class="join mono r3" id="gw-join">[ JOIN THE TERMINAL ]</button>' +
    "</div>" +
    '<div class="tape bot mono" aria-hidden="true"><div class="run">' + tapeItems + tapeItems + "</div></div>";

  (document.body || root).appendChild(el);

  /* 데모 수익률 숫자가 0 → 4.82 로 올라감 */
  var pnl = 0, pnlEl = el.querySelector("#gw-pnl");
  var iv = setInterval(function () {
    pnl = Math.min(4.82, pnl + 0.07);
    pnlEl.textContent = pnl.toFixed(2);
    if (pnl >= 4.82) clearInterval(iv);
  }, 30);

  /* 시세 띠: 바이낸스 현물 24시간 시세 (실패하면 코인 이름만) */
  var fmt = function (v) {
    var n = +v;
    return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : n >= 1 ? n.toFixed(2) : n.toFixed(4);
  };
  var syms = encodeURIComponent(JSON.stringify(COINS.map(function (c) { return c + "USDT"; })));
  fetch("https://api.binance.com/api/v3/ticker/24hr?symbols=" + syms)
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (list) {
      (list || []).forEach(function (t) {
        var c = t.symbol.replace(/USDT$/, ""), chg = +t.priceChangePercent;
        el.querySelectorAll('[data-c="' + c + '"]').forEach(function (s) {
          s.querySelector(".px").textContent = fmt(t.lastPrice);
          var ch = s.querySelector(".ch");
          ch.textContent = (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%";
          ch.style.color = chg >= 0 ? GREEN : "#D13438";
        });
        if (c === "BTC") el.querySelector("#gw-btc").textContent = fmt(t.lastPrice);
      });
    })
    .catch(function () {});

  /* 들어가기: 인트로가 흐려지며 사라지고 메인이 나타남 */
  var btn = el.querySelector("#gw-join");
  btn.addEventListener("click", function () {
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    el.classList.add("out");
    root.classList.add("gw-out");
    root.classList.remove("gw-on");
    setTimeout(function () {
      clearInterval(iv);
      el.remove();
      css.textContent = "html.gw-out .wrap{opacity:1;transition:opacity .8s ease}";
    }, 1200);
  });
})();
