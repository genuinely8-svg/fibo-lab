/*
  intro.js — 첫 화면 인트로 (C안 · Grid Ticker)
  - home.html(홈) 의 <body> 바로 아래에서 불러와요 (홈 화면이 먼저 번쩍 보이지 않게)
  - 흰 모눈 배경 + 위아래로 흐르는 실시간 시세(바이낸스) + 뒤에 흐린 모의투자 화면 + 큰 GWAVE 글자
  - [ JOIN THE TERMINAL ] 누르면 터미널 접속 문구 5줄이 1.5초쯤 찍히고(클릭하면 건너뜀)
    인트로가 흐려지며 사라지고 홈(터미널 화면)이 나타남 — 접속 문구는 이때만 나와요 (로고로 홈에 올 때는 안 나옴)
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
    "#gw h1{margin:22px 0 0;line-height:0}",
    "#gw h1 svg{height:clamp(44px,9vw,104px);width:auto;display:block}",
    "#gw .sub{margin-top:26px;display:flex;gap:18px;flex-wrap:wrap;justify-content:center;font-family:'Space Grotesk',system-ui,sans-serif;font-weight:500;font-size:15px;letter-spacing:.16em;text-transform:uppercase;color:#2B3443}",
    "#gw .sub s{text-decoration:none;color:#CBD2DC}",
    "#gw .pos{margin-top:40px;display:flex;align-items:center;gap:18px;padding:14px 22px;border:1px solid #DCE3EA;border-radius:12px;background:#fff;box-shadow:0 20px 50px -24px rgba(5,135,90,.4)}",
    "#gw .pos small{font-size:12px;color:" + MUTED + ";text-align:left;line-height:1.5}",
    "#gw .pos strong{font-size:34px;font-weight:500;color:" + GREEN + "}",
    "#gw .join{margin-top:40px;height:56px;padding:0 40px;border:1.5px solid " + GREEN + ";border-radius:4px;background:#fff;color:" + GREEN + ";",
    "  font-size:15px;font-weight:500;letter-spacing:.12em;cursor:pointer;transition:background .2s ease,color .2s ease}",
    "#gw .join:hover,#gw .join:focus-visible{background:" + GREEN + ";color:#fff;outline:none}",
    /* JOIN 누른 뒤 접속 문구 */
    "#gw .bootseq{width:100%;max-width:520px;display:flex;flex-direction:column;gap:10px;text-align:left;font-size:14px;cursor:pointer}",
    "#gw .bootseq svg{height:34px;width:auto;display:block;margin-bottom:16px}",
    "#gw .bl{display:flex;justify-content:space-between;gap:16px;color:#4A5363;animation:gwrise .25s ease both}",
    "#gw .bl b{color:" + GREEN + ";font-weight:600}",
    "#gw .bprog{height:3px;background:#EEF1F4;margin-top:12px;overflow:hidden}",
    "#gw .bprog i{display:block;height:3px;width:0;background:" + GREEN + ";transition:width .25s ease}",
    "#gw .bskip{font-size:12px;color:#8A93A0;margin-top:4px}",
    "@media (max-width:600px){#gw .sub{font-size:11px;gap:8px;letter-spacing:.1em}#gw .pos strong{font-size:26px}#gw .join{padding:0 24px;font-size:13px}}",
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
      '<h1 class="r2"><svg viewBox="0 0 617.1 100" role="img" aria-label="Gwave"><defs><linearGradient id="gwg-intro" x1="0" y1="0" x2="1" y2="0.6"><stop offset="0" stop-color="#3FB06E"/><stop offset="1" stop-color="#2E8A85"/></linearGradient></defs><path fill-rule="evenodd" fill="url(#gwg-intro)" d="M4.1,18.3L1.4,24.6L0.0,31.7L0.0,70.0L2.7,78.9L5.4,83.8L11.6,91.0L17.3,95.2L24.0,98.1L34.4,100.0L102.4,99.8L110.5,97.9L116.2,95.2L123.2,89.5L127.5,83.8L130.3,77.6L131.7,70.8L131.7,40.2L131.0,38.9L74.9,38.7L73.0,39.4L71.7,40.6L63.0,54.8L62.1,58.1L63.0,60.6L72.5,61.4L105.6,61.6L106.3,62.4L106.0,70.5L103.3,74.3L99.2,76.8L96.0,77.3L38.1,77.3L34.6,76.8L31.1,75.2L26.7,71.1L25.4,68.6L24.6,64.9L24.4,37.9L25.2,31.7L28.3,27.0L32.5,23.8L37.6,22.4L115.9,22.1L118.9,19.0L129.4,1.7L128.7,0.0L32.1,0.0L21.7,2.9L16.5,5.7L8.3,12.7Z"/><path fill-rule="evenodd" fill="#0B1220" d="M522.4,41.0L521.4,45.4L521.6,97.9L522.2,99.2L615.6,99.5L617.0,98.7L617.1,79.0L615.7,77.8L546.7,77.6L545.6,76.5L545.6,61.7L546.8,60.0L607.0,59.7L608.1,58.1L608.1,40.2L607.3,39.0L527.8,38.7L524.6,39.2ZM522.7,21.4L523.3,21.9L599.0,21.9L612.5,21.0L615.1,20.3L616.0,18.6L617.0,1.6L615.7,0.2L536.3,0.3L534.1,1.6L523.0,19.8ZM386.2,0.8L386.3,2.7L438.3,97.6L440.2,99.4L461.0,99.5L464.3,97.6L479.7,70.0L485.9,57.6L517.0,2.1L517.0,0.8L515.9,0.2L490.6,0.3L488.6,1.7L463.7,47.0L452.1,69.0L451.0,69.5L439.5,49.5L414.0,1.4L411.9,0.2L387.0,0.2ZM285.9,98.4L287.0,99.5L311.1,99.5L312.5,99.0L322.4,82.2L325.7,75.1L340.8,48.6L349.8,31.3L351.1,29.7L351.9,29.7L373.7,71.0L389.0,98.6L390.6,99.5L414.8,99.5L416.2,99.0L412.2,90.0L379.8,29.8L377.0,26.7L373.5,26.3L373.5,25.2L374.9,23.3L374.4,20.0L365.9,4.0L364.1,1.7L360.2,0.2L342.7,0.2L339.5,1.4L337.9,3.0L327.3,21.4ZM199.0,0.5L198.7,1.9L205.1,15.7L228.7,63.2L244.4,96.3L247.1,98.9L250.0,99.7L262.2,99.7L264.4,99.0L266.0,97.5L271.0,87.5L274.6,81.6L303.2,26.2L311.1,12.2L316.2,2.1L316.0,0.6L314.8,0.2L291.3,0.2L288.9,1.6L286.7,4.9L256.8,62.9L255.7,63.5L225.6,1.6L222.5,0.2ZM143.8,0.3L143.3,2.2L168.3,49.8L191.3,96.5L193.3,98.9L194.8,99.4L208.7,99.7L211.0,99.2L214.4,94.9L223.2,77.6L210.0,77.6L207.9,75.7L182.1,22.7L170.6,1.0L168.9,0.2Z"/></svg></h1>' +
      '<div class="sub r2"><span>Crypto &amp; Stock Signals</span><s>/</s><span>Trading Engine</span><s>/</s><span>Paper Trading</span></div>' +
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

  /* 들어가기: 터미널 접속 문구 → 인트로가 흐려지며 사라지고 홈이 나타남 */
  var BOOT = [
    ["Connecting to Gwave Terminal", "OK"],
    ["Loading market data (Binance)", "OK"],
    ["Syncing swing signals", "OK"],
    ["AI Trading Engine", "ONLINE"],
    ["Session ready", "\u2713"]
  ];
  var btn = el.querySelector("#gw-join"), leaving = false, bootTimer = null;
  function leave() {
    if (leaving) return;
    leaving = true;
    clearInterval(bootTimer);
    el.classList.add("out");
    root.classList.add("gw-out");
    root.classList.remove("gw-on");
    setTimeout(function () {
      clearInterval(iv);
      el.remove();
      css.textContent = "html.gw-out .wrap{opacity:1;transition:opacity .8s ease}";
    }, 1200);
  }
  btn.addEventListener("click", function () {
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return leave();
    var mid = el.querySelector(".mid"), logo = el.querySelector("h1 svg").outerHTML.replace(/gwg-intro/g, "gwg-boot");
    mid.innerHTML = '<div class="bootseq mono" role="status" aria-live="polite">' + logo +
      '<div id="gw-lines" style="display:flex;flex-direction:column;gap:10px"></div>' +
      '<div class="bprog"><i id="gw-prog"></i></div><div class="bskip">Click anywhere to skip</div></div>';
    var lines = mid.querySelector("#gw-lines"), prog = mid.querySelector("#gw-prog"), n = 0;
    mid.querySelector(".bootseq").addEventListener("click", leave);
    bootTimer = setInterval(function () {
      if (n >= BOOT.length) { clearInterval(bootTimer); setTimeout(leave, 350); return; }
      var row = document.createElement("div");
      row.className = "bl";
      row.innerHTML = "<span>&gt; " + BOOT[n][0] + "</span><b>" + BOOT[n][1] + "</b>";
      lines.appendChild(row);
      n++;
      prog.style.width = Math.round(n / BOOT.length * 100) + "%";
    }, 260);
  });
})();
