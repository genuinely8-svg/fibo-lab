/*
  paper.js — 모의투자 화면
  가격·호가·체결은 바이낸스 선물 웹소켓(브라우저가 직접), 계좌·주문·체결 처리는 서버(/api/paper)가 해요.
  계산 규칙은 paper-engine.js (서버와 같은 파일)
*/
(function () {
  "use strict";
  const E = PaperEngine;
  const KST = 9 * 3600;
  const TOKEN_KEY = "paper-token-v1", NICK_KEY = "paper-nick-v1", SYM_KEY = "paper-sym-v1", CH_KEY = "paper-chart-collapsed-v1";
  const STABLES = new Set(["USDC", "FDUSD", "TUSD", "USDE", "BUSD", "DAI", "USDP", "USDS", "USD1"]);
  const IVS = ["1m", "5m", "15m", "1h", "4h", "1d"];
  const $ = id => document.getElementById(id);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    del: k => { try { localStorage.removeItem(k); } catch (e) {} },
  };

  const S = { token: ls.get(TOKEN_KEY), nick: ls.get(NICK_KEY), admin: false, st: null, sym: ls.get(SYM_KEY) || "BTCUSDT", iv: "15m",
              otype: "limit", tab: "pos", px: {}, t24: {}, mark: {}, book: null, trades: [], coins: [], lastSync: 0, syncing: false, lastCross: 0 };
  const base = s => CoinMeta.base(s.replace(/USDT$/, ""));

  // ── 숫자 표시 ────────────────────────────────────────────────
  const pdec = p => p >= 10000 ? 1 : p >= 100 ? 2 : p >= 1 ? 4 : p >= 0.1 ? 5 : 7;
  const fp = p => p == null || !isFinite(p) ? "-" : p.toLocaleString("en-US", { minimumFractionDigits: pdec(p), maximumFractionDigits: pdec(p) });
  const fu = (v, d = 2) => v == null || !isFinite(v) ? "-" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sg = (v, d = 2) => (v > 0 ? "+" : "") + fu(v, d);
  const pc = v => v > 0 ? "g" : v < 0 ? "r" : "";
  const fq = q => q >= 100 ? fu(q, 2) : q >= 1 ? fu(q, 3) : fu(q, 5);
  const hms = t => new Date(t + 9 * 3600e3).toISOString().slice(11, 19);
  const mdhm = t => { const d = new Date(t + 9 * 3600e3).toISOString(); return d.slice(5, 10) + " " + d.slice(11, 16); };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => { const n = parseFloat(String(v).replace(/,/g, "")); return isFinite(n) ? n : NaN; };

  let toastT;
  function toast(msg) { const el = $("toast"); el.textContent = msg; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 3500); }

  // ── 서버 요청 ────────────────────────────────────────────────
  async function post(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(S.token ? { Authorization: "Bearer " + S.token } : {}) }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if ((res.status === 401 || (res.status === 403 && /차단/.test(j.error || ""))) && S.token && url !== "/api/auth") { logout(true, j.error); throw new Error(j.error || "다시 로그인해주세요"); }
    if (!res.ok) throw new Error(j.error || "서버 오류 " + res.status);
    return j;
  }

  // ── 로그인 ───────────────────────────────────────────────────
  $("lform").addEventListener("submit", async ev => {
    ev.preventDefault();
    const nick = $("nick").value.trim(), pin = $("pin").value;
    $("lerr").textContent = ""; $("lbtn").disabled = true;
    try {
      let r = await post("/api/auth", { nick, pin });
      if (r.needCreate) {
        if (!confirm(`'${nick}' 은(는) 처음 보는 닉네임이에요.\n이 닉네임과 입력한 PIN 으로 새 계정을 만들까요?`)) return;
        r = await post("/api/auth", { nick, pin, create: true });
      }
      S.token = r.token; S.nick = r.nick; ls.set(TOKEN_KEY, r.token); ls.set(NICK_KEY, r.nick);
      $("pin").value = "";
      start();
    } catch (e) { $("lerr").textContent = e.message; }
    finally { $("lbtn").disabled = false; }
  });
  function logout(silent, msg) {
    ls.del(TOKEN_KEY); S.token = null; S.st = null; S.admin = false;
    try { ws && ws.close(); } catch (e) {}
    ws = null; started = false;
    $("app").hidden = true; $("login").hidden = false;
    if (silent) $("lerr").textContent = msg || "다시 로그인해주세요";
  }
  $("logout").onclick = () => { logout(); location.reload(); };

  // ── 서버 상태 ────────────────────────────────────────────────
  const EV_TXT = { fill: "지정가 체결", tp: "익절(TP)", sl: "손절(SL)", liq: "청산" };
  async function sendAction(body, quiet) {
    if (body.action === "state") { if (S.syncing) return; }
    else while (S.syncing) await new Promise(r => setTimeout(r, 100));     // 다른 요청이 끝나길 기다렸다가
    S.syncing = true;
    try {
      const r = await post("/api/paper", body);
      S.st = r.st; S.admin = r.admin; S.nick = r.nick; S.lastSync = Date.now();
      for (const e of r.events || []) toast(`${base(e.sym)} ${EV_TXT[e.type]} @ ${fp(e.price)}${e.pnl != null ? ` (${sg(e.pnl)} USDT)` : ""}`);
      if (r.msg && !quiet) toast(r.msg);
      if (r.syncError && !quiet) toast("바이낸스 기록을 못 받아서 옛 상태를 보여줘요");
      afterState();
      if (r.behind && !r.syncError) setTimeout(() => sendAction({ action: "state" }, true), 1500);   // 오래 비웠으면 이어서 처리
      return r;
    } catch (e) { if (!quiet) toast(e.message); throw e; }
    finally { S.syncing = false; }
  }
  const refresh = quiet => sendAction({ action: "state" }, quiet).catch(() => {});
  const hasOpen = () => S.st && (S.st.pos.length || S.st.ord.length);

  function afterState() {
    $("who").textContent = S.nick || "";
    $("admtab").hidden = !S.admin;
    if (!S.admin && S.tab === "adm") S.tab = "pos";
    subscribe(); drawLines(); renderAll();
  }

  // ── 웹소켓 ───────────────────────────────────────────────────
  let ws = null, have = new Set(), wsTimer = null;
  const streams = () => {
    const s = S.sym.toLowerCase(), set = new Set([`${s}@aggTrade`, `${s}@depth20@500ms`, `${s}@ticker`, `${s}@markPrice@1s`, `${s}@kline_${S.iv}`]);
    if (S.st) for (const x of S.st.pos.concat(S.st.ord)) if (x.sym !== S.sym) set.add(x.sym.toLowerCase() + "@miniTicker");
    return set;
  };
  function subscribe() {
    if (!ws || ws.readyState !== 1) return;
    const want = streams();
    const add = [...want].filter(x => !have.has(x)), del = [...have].filter(x => !want.has(x));
    if (del.length) ws.send(JSON.stringify({ method: "UNSUBSCRIBE", params: del, id: 2 }));
    if (add.length) ws.send(JSON.stringify({ method: "SUBSCRIBE", params: add, id: 1 }));
    have = want;
  }
  function connect() {
    clearTimeout(wsTimer);
    ws = new WebSocket("wss://fstream.binance.com/ws");
    const me = ws;
    ws.onopen = () => { have = new Set(); subscribe(); };
    ws.onmessage = m => { try { onMsg(JSON.parse(m.data)); } catch (e) {} };
    ws.onclose = () => { if (ws === me && started) wsTimer = setTimeout(connect, 2000); };
    ws.onerror = () => { try { me.close(); } catch (e) {} };
  }
  let dirtyHd = false, dirtyBook = false, dirtyTr = false;
  function onMsg(d) {
    const sym = d.s;
    switch (d.e) {
      case "aggTrade":
        S.px[sym] = +d.p;
        if (sym === S.sym) { S.trades.unshift({ p: +d.p, q: +d.q, T: d.T, m: d.m }); if (S.trades.length > 30) S.trades.length = 30; dirtyTr = dirtyHd = true; }
        break;
      case "24hrTicker":
        S.px[sym] = +d.c; S.t24[sym] = { chg: +d.P, hi: +d.h, lo: +d.l, vol: +d.q }; dirtyHd = true; break;
      case "24hrMiniTicker": S.px[sym] = +d.c; break;
      case "markPriceUpdate": S.mark[sym] = { r: +d.r, T: d.T, p: +d.p }; dirtyHd = true; break;
      case "depthUpdate": if (sym === S.sym) { S.book = { a: d.a, b: d.b }; dirtyBook = true; } break;
      case "kline":
        if (sym === S.sym && d.k.i === S.iv && series) {
          const k = d.k; series.update({ time: Math.floor(k.t / 1000) + KST, open: +k.o, high: +k.h, low: +k.l, close: +k.c });
        }
        break;
    }
  }
  // 화면은 0.25초에 한 번만 다시 그림 (메시지가 너무 많아서)
  setInterval(() => {
    if (dirtyHd) { dirtyHd = false; renderHd(); }
    if (dirtyBook) { dirtyBook = false; renderBook(); }
    if (dirtyTr) { dirtyTr = false; renderTrades(); }
  }, 250);

  // ── 코인 선택 ────────────────────────────────────────────────
  async function loadCoins() {
    try {
      const [arr] = await Promise.all([fetch("https://fapi.binance.com/fapi/v1/ticker/24hr").then(r => r.json()), CoinMeta.load().catch(() => {})]);
      let list = arr.filter(x => /^[A-Z0-9]+USDT$/.test(x.symbol)).map(x => ({ sym: x.symbol, b: base(x.symbol), last: +x.lastPrice, chg: +x.priceChangePercent, vol: +x.quoteVolume }))
        .filter(x => CoinMeta.isCrypto(x.sym.replace(/USDT$/, "")) && !STABLES.has(x.b));
      if (CoinMeta.hasTop()) { list = list.filter(x => CoinMeta.rank(x.b) && CoinMeta.rank(x.b) <= 100).sort((a, b) => CoinMeta.rank(a.b) - CoinMeta.rank(b.b)); }
      else { list = list.sort((a, b) => b.vol - a.vol).slice(0, 100); }   // 코인게코가 막혔을 때: 거래대금 상위 100
      S.coins = list;
      for (const c of list) if (!S.px[c.sym]) S.px[c.sym] = c.last;
      renderPicker();
    } catch (e) { $("plist").innerHTML = '<div class="muted">코인 목록을 못 받았어요</div>'; }
  }
  const logoImg = b => CoinMeta.logo(b) ? `<img src="${esc(CoinMeta.logo(b))}" alt="" onerror="this.style.visibility='hidden'">` : `<span class="ph"></span>`;
  function renderPicker() {
    const q = $("psearch").value.trim().toUpperCase();
    const rows = S.coins.filter(c => !q || c.b.includes(q) || (CoinMeta.ko(c.b) || "").includes(q)).map(c =>
      `<div data-s="${c.sym}">${logoImg(c.b)}<span class="s">${esc(c.b)} <span class="n">${esc(CoinMeta.ko(c.b) || "")}</span></span><span>${fp(c.last)}</span><span class="${pc(c.chg)}">${sg(c.chg)}%</span></div>`);
    $("plist").innerHTML = rows.join("") || '<div class="muted">없어요</div>';
  }
  $("coinbtn").onclick = e => { e.stopPropagation(); const p = $("picker"); p.hidden = !p.hidden; if (!p.hidden) { $("psearch").value = ""; renderPicker(); loadCoins(); $("psearch").focus(); } };
  $("psearch").oninput = renderPicker;
  $("picker").onclick = e => e.stopPropagation();
  $("plist").onclick = e => { const d = e.target.closest("[data-s]"); if (d) setSym(d.dataset.s); };
  document.addEventListener("click", () => { $("picker").hidden = true; });

  function setSym(sym) {
    $("picker").hidden = true;
    S.sym = sym; ls.set(SYM_KEY, sym);
    S.book = null; S.trades = []; renderBook(); renderTrades();
    $("oprice").value = ""; $("qty").value = ""; $("pct").value = 0;
    renderHd(); subscribe(); loadChart(); renderOrderInfo();
  }

  // ── 상단 ─────────────────────────────────────────────────────
  let lastPx = 0;
  function renderHd() {
    const b = base(S.sym), p = S.px[S.sym], t = S.t24[S.sym], m = S.mark[S.sym];
    $("coinbtn").innerHTML = `${logoImg(b)}<span>${esc(b)}<small> USDT 무기한</small></span> ▾`;
    $("qunit").textContent = b;
    const el = $("price");
    el.textContent = fp(p);
    if (p && lastPx) el.style.color = p > lastPx ? "var(--buy)" : p < lastPx ? "var(--sell)" : "";
    lastPx = p || lastPx;
    if (t) {
      $("chg").textContent = sg(t.chg) + "%"; $("chg").className = pc(t.chg);
      $("hi").textContent = fp(t.hi); $("lo").textContent = fp(t.lo);
      $("vol").textContent = shortUsd(t.vol).replace("$", "") + " USDT";
    }
    if (m) {
      const left = Math.max(0, m.T - Date.now()), h = Math.floor(left / 3600e3), mi = Math.floor(left % 3600e3 / 60e3), s = Math.floor(left % 60e3 / 1e3);
      $("fund").textContent = `${(m.r * 100).toFixed(4)}% / ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
  }

  // ── 호가·체결 ────────────────────────────────────────────────
  function renderBook() {
    const el = $("book");
    if (!S.book) { el.innerHTML = '<div class="muted small" style="padding:10px">불러오는 중…</div>'; return; }
    const N = matchMedia("(max-width:900px)").matches ? 7 : 10;
    const asks = S.book.a.slice(0, N).map(x => [+x[0], +x[1]]), bids = S.book.b.slice(0, N).map(x => [+x[0], +x[1]]);
    const cum = arr => { let s = 0; return arr.map(x => (s += x[1])); };
    const ca = cum(asks), cb = cum(bids), mx = Math.max(ca[ca.length - 1] || 1, cb[cb.length - 1] || 1);
    const row = (cls, x, c) => `<div class="brow ${cls}" data-p="${x[0]}"><i style="width:${(c / mx * 100).toFixed(0)}%"></i><span>${fp(x[0])}</span><span>${fq(x[1])}</span></div>`;
    const p = S.px[S.sym], mk = S.mark[S.sym];
    el.innerHTML = `<div class="bhead"><span>가격(USDT)</span><span>수량(${esc(base(S.sym))})</span></div>`
      + asks.map((x, i) => row("a", x, ca[i])).reverse().join("")
      + `<div class="mid">${fp(p)}<small>마크 ${fp(mk && mk.p)}</small></div>`
      + bids.map((x, i) => row("b", x, cb[i])).join("");
  }
  $("book").onclick = e => { const r = e.target.closest("[data-p]"); if (r) { setType("limit"); $("oprice").value = r.dataset.p; renderOrderInfo(); } };
  function renderTrades() {
    $("trades").innerHTML = `<div class="bhead"><span>시간</span><span>가격</span><span>수량</span></div>` + S.trades.map(t =>
      `<div class="trow"><span class="muted">${hms(t.T)}</span><span class="${t.m ? "r" : "g"}">${fp(t.p)}</span><span>${fq(t.q)}</span></div>`).join("");
  }
  $("bseg").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    [...$("bseg").children].forEach(x => x.classList.toggle("on", x === b));
    $("bookbox").classList.toggle("showbook", b.dataset.v === "book"); $("bookbox").classList.toggle("showtr", b.dataset.v === "tr");
  };

  // ── 차트 ─────────────────────────────────────────────────────
  let chart = null, series = null, lines = [], loadId = 0;
  function initChart() {
    if (chart || !window.LightweightCharts) { if (!window.LightweightCharts) $("chart").innerHTML = '<p class="muted" style="padding:20px">차트 라이브러리를 불러오지 못했어요</p>'; return; }
    chart = LightweightCharts.createChart($("chart"), {
      autoSize: true,
      layout: { background: { color: css("--card") }, textColor: css("--muted"), fontFamily: "system-ui,'Malgun Gothic',sans-serif" },
      grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
      rightPriceScale: { borderColor: css("--line") },
      timeScale: { borderColor: css("--line"), timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    series = chart.addCandlestickSeries({ upColor: "#22b573", downColor: "#ef4b5f", wickUpColor: "#22b573", wickDownColor: "#ef4b5f", borderVisible: false });
  }
  window.addEventListener("themechange", () => {
    if (!chart) return;
    chart.applyOptions({ layout: { background: { color: css("--card") }, textColor: css("--muted") }, grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
                         rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") } });
    drawLines();
  });
  async function loadChart() {
    initChart(); if (!series) return;
    const id = ++loadId, sym = S.sym, iv = S.iv;
    series.setData([]);
    try {
      const rows = await (await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${iv}&limit=500`)).json();
      if (id !== loadId) return;
      series.setData(rows.map(r => ({ time: Math.floor(r[0] / 1000) + KST, open: +r[1], high: +r[2], low: +r[3], close: +r[4] })));
      series.applyOptions({ priceFormat: { type: "price", precision: pdec(+rows[rows.length - 1][4]), minMove: Math.pow(10, -pdec(+rows[rows.length - 1][4])) } });
      chart.timeScale().scrollToRealTime();
      drawLines();
    } catch (e) { if (id === loadId) toast("차트를 못 받았어요"); }
  }
  // 진입가·청산가·TP/SL·미체결 주문 가격선
  function drawLines() {
    if (!series) return;
    for (const l of lines) series.removePriceLine(l);
    lines = [];
    if (!S.st) return;
    const add = (price, color, title, style) => { if (price) lines.push(series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })); };
    for (const p of S.st.pos) {
      if (p.sym !== S.sym) continue;
      const k = p.side === "long" ? "롱" : "숏";
      add(p.entry, css("--muted"), `${k} 진입`, 0); add(p.liq, "#f59e0b", `${k} 청산`, 2);
      add(p.tp, "#22b573", "TP", 2); add(p.sl, "#ef4b5f", "SL", 2);
    }
    for (const o of S.st.ord) if (o.sym === S.sym) add(o.price, "#5b93f0", `${o.side === "long" ? "롱" : "숏"} 주문`, 1);
  }
  IVS.forEach(v => { const b = document.createElement("button"); b.textContent = v; b.dataset.v = v; if (v === S.iv) b.className = "on"; $("iv").appendChild(b); });
  $("iv").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    S.iv = b.dataset.v; [...$("iv").children].forEach(x => x.classList.toggle("on", x === b));
    subscribe(); loadChart();
  };
  function setCollapsed(c) { $("chartbox").classList.toggle("collapsed", c); $("ctoggle").textContent = c ? "차트 펼치기" : "차트 접기"; ls.set(CH_KEY, c ? "1" : "0"); }
  $("ctoggle").onclick = () => setCollapsed(!$("chartbox").classList.contains("collapsed"));

  // ── 주문 패널 ────────────────────────────────────────────────
  const lev = () => +$("lev").value;
  const refPrice = () => S.otype === "limit" && num($("oprice").value) > 0 ? num($("oprice").value) : S.px[S.sym];
  const rateNow = () => S.otype === "limit" ? E.FEE_MAKER : E.FEE_TAKER;
  const avail = () => S.st ? E.available(S.st) : 0;
  const stepOf = p => { const e = Math.ceil(Math.log10(p)); return { step: Math.pow(10, -e), dec: Math.max(0, e) }; };
  function maxQty() {
    const p = refPrice(); if (!p) return 0;
    const { step, dec } = stepOf(p), q = Math.floor(avail() / (p * (1 / lev() + rateNow())) / step) * step;
    return +q.toFixed(dec);
  }
  function setType(t) {
    S.otype = t;
    [...$("otype").children].forEach(b => b.classList.toggle("on", b.dataset.t === t));
    $("prow").hidden = t !== "limit";
    renderOrderInfo();
  }
  $("otype").onclick = e => { const b = e.target.closest("button"); if (b) setType(b.dataset.t); };
  $("usecur").onclick = () => { if (S.px[S.sym]) { $("oprice").value = S.px[S.sym].toFixed(pdec(S.px[S.sym])); renderOrderInfo(); } };
  $("lev").oninput = () => { $("levchip").textContent = lev() + "x"; if ($("pct").value > 0) pctToQty(+$("pct").value); renderOrderInfo(); };
  function pctToQty(p) {
    const ref = refPrice(); if (!ref) return;
    const { step, dec } = stepOf(ref), q = Math.floor(maxQty() * p / 100 / step) * step;
    $("qty").value = q > 0 ? q.toFixed(dec) : "";
    renderOrderInfo();
  }
  $("pct").oninput = () => pctToQty(+$("pct").value);
  document.querySelector(".pcts").onclick = e => { const b = e.target.closest("button"); if (b) { $("pct").value = b.dataset.p; pctToQty(+b.dataset.p); } };
  $("qty").oninput = () => { const m = maxQty(), q = num($("qty").value); $("pct").value = m > 0 && q > 0 ? Math.min(100, Math.round(q / m * 100)) : 0; renderOrderInfo(); };
  ["oprice", "tp", "sl"].forEach(id => $(id).addEventListener("input", renderOrderInfo));
  function renderOrderInfo() {
    const ref = refPrice(), q = num($("qty").value);
    $("avail").textContent = S.st ? fu(avail()) + " USDT" : "-";
    if (ref && q > 0) { const need = E.needOf(q, ref, lev(), rateNow()); $("need").textContent = fu(need) + " USDT"; $("need").className = need > avail() ? "r" : ""; }
    else { $("need").textContent = "-"; $("need").className = ""; }
    $("liqL").textContent = ref ? fp(E.liqPrice("long", ref, lev())) : "-";
    $("liqS").textContent = ref ? fp(E.liqPrice("short", ref, lev())) : "-";
  }
  let ordering = false;
  async function submit(side) {
    if (ordering) return;
    const q = num($("qty").value);
    if (!(q > 0)) return toast("수량을 입력하세요");
    if (S.otype === "limit" && !(num($("oprice").value) > 0)) return toast("지정가 가격을 입력하세요");
    ordering = true; $("bLong").disabled = $("bShort").disabled = true;
    try {
      await sendAction({ action: "order", sym: S.sym, side, lev: lev(), qty: q, type: S.otype, price: S.otype === "limit" ? num($("oprice").value) : undefined,
                         tp: $("tp").value.trim() || undefined, sl: $("sl").value.trim() || undefined });
      $("qty").value = ""; $("pct").value = 0; renderOrderInfo();
    } catch (e) {}
    ordering = false; $("bLong").disabled = $("bShort").disabled = false;
  }
  $("bLong").onclick = () => submit("long");
  $("bShort").onclick = () => submit("short");

  // ── 계좌 요약 + 아래 탭 ──────────────────────────────────────
  function calc() {
    const st = S.st; let upnl = 0, marg = 0;
    for (const p of st.pos) { const px = S.px[p.sym] || p.entry; upnl += E.pnlOf(p.side, p.entry, px, p.qty); marg += p.margin; }
    const equity = st.bal + marg + upnl;
    return { upnl, marg, equity, ret: (equity - st.dep) / st.dep * 100 };
  }
  function renderTiles() {
    const st = S.st, c = calc(), s = st.st;
    const tile = (k, v, cls, sub) => `<div class="tile"><div class="k">${k}</div><div class="v ${cls || ""}">${v}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
    $("tiles").innerHTML = tile("총 자산 (USDT)", fu(c.equity), "", `원금 ${fu(st.dep)}`)
      + tile("사용 가능", fu(E.available(st)), "", `증거금 ${fu(c.marg)}`)
      + tile("미실현 손익", sg(c.upnl), pc(c.upnl))
      + tile("누적 수익률", sg(c.ret) + "%", pc(c.ret), `실현 ${sg(s.rp)} USDT`)
      + tile("승률", s.n ? (s.w / s.n * 100).toFixed(1) + "%" : "-", "", `${s.w}승 ${s.n - s.w}패 / ${s.n}회`);
  }
  function posCard(p) {
    const px = S.px[p.sym] || p.entry, up = E.pnlOf(p.side, p.entry, px, p.qty), roe = up / p.margin * 100;
    const k = p.side === "long";
    return `<div class="pc"><div class="h"><div><b>${esc(base(p.sym))}</b> <span class="tag ${p.side}">${k ? "롱" : "숏"} ${p.lev}x</span> <span class="muted small">격리</span></div>
      <div class="pnl ${pc(up)}">${sg(up)} USDT<small>${sg(roe)}%</small></div></div>
      <div class="grid"><div><span>수량(${esc(base(p.sym))})</span><b>${fq(p.qty)}</b></div><div><span>진입가</span><b>${fp(p.entry)}</b></div><div><span>현재가</span><b>${fp(px)}</b></div>
      <div><span>청산가</span><b style="color:#f59e0b">${fp(p.liq)}</b></div><div><span>증거금</span><b>${fu(p.margin)}</b></div>
      <div><span>TP / SL</span><b><span class="g" style="display:inline">${p.tp ? fp(p.tp) : "-"}</span> / <span class="r" style="display:inline">${p.sl ? fp(p.sl) : "-"}</span></b></div></div>
      <div class="act"><button class="ghost" data-act="edit" data-id="${p.id}">TP/SL 수정</button><button class="ghost" data-act="close" data-id="${p.id}">시장가 청산</button></div></div>`;
  }
  function ordCard(o) {
    return `<div class="pc"><div class="h"><div><b>${esc(base(o.sym))}</b> <span class="tag ${o.side}">${o.side === "long" ? "롱" : "숏"} ${o.lev}x</span> <span class="muted small">지정가 · ${mdhm(o.t)}</span></div>
      <button class="ghost mini" data-act="cancel" data-id="${o.id}">취소</button></div>
      <div class="grid"><div><span>가격</span><b>${fp(o.price)}</b></div><div><span>수량</span><b>${fq(o.qty)}</b></div><div><span>현재가</span><b>${fp(S.px[o.sym])}</b></div>
      <div><span>TP / SL</span><b>${o.tp ? fp(o.tp) : "-"} / ${o.sl ? fp(o.sl) : "-"}</b></div></div></div>`;
  }
  const sideTxt = s => s === "long" ? "롱" : "숏";
  function renderTab() {
    const st = S.st, el = $("tabbody");
    [...$("tabs").children].forEach(b => b.classList.toggle("on", b.dataset.t === S.tab));
    if (S.tab === "pos") el.innerHTML = st.pos.length ? `<div class="cards">${st.pos.map(posCard).join("")}</div>` : '<div class="empty">보유 중인 포지션이 없어요</div>';
    else if (S.tab === "ord") el.innerHTML = st.ord.length ? `<div class="cards">${st.ord.map(ordCard).join("")}</div>` : '<div class="empty">미체결 주문이 없어요</div>';
    else if (S.tab === "ol") el.innerHTML = st.ol.length ? st.ol.map(o => `<div class="lrow"><span><b>${esc(base(o.sym))}</b> <span class="${o.side === "long" ? "g" : "r"}">${sideTxt(o.side)} ${o.lev}x</span> ${o.kind}</span>
        <span>${fq(o.qty)} @ ${fp(o.price)} · <b>${o.status}</b></span><span class="m">${mdhm(o.t)}</span></div>`).join("") : '<div class="empty">주문 기록이 없어요</div>';
    else if (S.tab === "th") el.innerHTML = st.th.length ? st.th.map(t => t.kind === "deposit"
        ? `<div class="lrow"><span><b class="g">관리자 충전 +${fu(t.amount)}</b> USDT</span><span class="m">${mdhm(t.t)}</span></div>`
        : `<div class="lrow"><span><b>${esc(base(t.sym))}</b> <span class="${t.side === "long" ? "g" : "r"}">${sideTxt(t.side)} ${t.lev}x</span> · ${esc(t.reason)}</span>
          <span class="${pc(t.pnl)}"><b>${sg(t.pnl)} USDT</b> (${sg(t.roe)}%)</span>
          <span class="m">${fq(t.qty)} · ${fp(t.entry)} → ${fp(t.exit)} · 수수료 ${fu(t.fee)} · ${mdhm(t.t)}</span></div>`).join("") : '<div class="empty">거래 기록이 없어요</div>';
    else if (S.tab === "adm") { if (!adminRows) loadAdmin(); else renderAdmin(); }
  }
  function renderAll() { if (!S.st) return; renderHd(); renderTiles(); if (S.tab !== "adm") renderTab(); renderOrderInfo(); }
  $("tabs").onclick = e => { const b = e.target.closest("button"); if (b) { S.tab = b.dataset.t; adminRows = null; adminView = null; renderTab(); } };

  // 포지션 카드 버튼
  $("tabbody").onclick = async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = +b.dataset.id, act = b.dataset.act;
    if (act === "close") { if (confirm("시장가로 전부 청산할까요?")) sendAction({ action: "close", id }).catch(() => {}); }
    else if (act === "cancel") sendAction({ action: "cancel", id }).catch(() => {});
    else if (act === "edit") {
      const p = S.st.pos.find(x => x.id === id); if (!p) return;
      modal(`<h2>${esc(base(p.sym))} ${sideTxt(p.side)} TP/SL 수정</h2>
        <label>익절가 (TP)<input id="mtp" inputmode="decimal" value="${p.tp ?? ""}" placeholder="비우면 삭제"></label><br>
        <label>손절가 (SL)<input id="msl" inputmode="decimal" value="${p.sl ?? ""}" placeholder="비우면 삭제"></label>
        <p class="small muted">현재가 ${fp(S.px[p.sym])} · 청산가 ${fp(p.liq)}</p>`, () =>
        sendAction({ action: "edit", id, tp: $("mtp").value.trim() || undefined, sl: $("msl").value.trim() || undefined }));
    }
  };
  function modal(html, onOk) {
    const m = $("modal");
    m.innerHTML = `<div class="card">${html}<div class="btns"><button class="ghost" id="mno">닫기</button><button id="myes">저장</button></div></div>`;
    m.hidden = false;
    $("mno").onclick = () => { m.hidden = true; };
    $("myes").onclick = async () => { try { await onOk(); m.hidden = true; } catch (e) {} };
  }
  $("modal").onclick = e => { if (e.target === $("modal")) $("modal").hidden = true; };
  $("reset").onclick = () => { if (confirm("잔고와 포지션, 모든 기록이 지워지고 10,000 USDT 로 다시 시작해요. 계속할까요?")) sendAction({ action: "reset" }).catch(() => {}); };

  // ── 관리자 ───────────────────────────────────────────────────
  let adminRows = null, adminLog = [], adminView = null;     // adminView: 상세 보기 중인 사용자 정보
  const dt = t => t ? mdhm(t) : "-";
  async function loadAdmin() {
    $("tabbody").innerHTML = '<div class="empty">불러오는 중…</div>';
    try { const r = await post("/api/admin", { action: "list" }); adminRows = r.users; adminLog = r.log; renderAdmin(); }
    catch (e) { $("tabbody").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  function renderAdmin() {
    if (adminView) return renderAdminDetail();
    const rows = adminRows.map(u => `<div class="adm"><div class="nm"><b class="lnk" data-adm="detail" data-n="${esc(u.nick)}">${esc(u.nick)}</b>
        ${u.bl ? '<span class="tag short">차단</span>' : ""}${u.admin ? '<span class="tag long">관리자</span>' : ""}<br>
        <span class="muted small">가입 ${dt(u.c)} · 마지막 접속 ${dt(u.la)}<br>잔고 ${fu(u.bal)} · 거래 ${u.n}회 · 포지션 ${u.pos}개</span></div>
      <b class="${pc(u.ret)}">${sg(u.ret)}%</b>
      <input inputmode="decimal" placeholder="충전 USDT" data-n="${esc(u.nick)}"><button class="mini" data-adm="charge" data-n="${esc(u.nick)}">충전</button>
      <button class="ghost mini" data-adm="reset" data-n="${esc(u.nick)}">잔고 초기화</button>
      ${u.admin ? "" : `<button class="ghost mini" data-adm="${u.bl ? "unblock" : "block"}" data-n="${esc(u.nick)}">${u.bl ? "차단 해제" : "차단"}</button>
      <button class="ghost mini r" data-adm="delete" data-n="${esc(u.nick)}">삭제</button>`}</div>`).join("") || '<div class="empty">사용자가 없어요</div>';
    const log = adminLog.map(l => `<div class="lrow"><span><b>${esc(l.to)}</b> · ${esc(l.act)}</span><span class="m">${mdhm(l.t)} · ${esc(l.by)}</span></div>`).join("") || '<div class="empty">아직 기록이 없어요</div>';
    $("tabbody").innerHTML = rows + '<h2 style="margin-top:18px">관리자 활동 기록 (최근 50개)</h2>' + log;
  }
  function renderAdminDetail() {
    const d = adminView;
    const ord = d.ol.map(o => `<div class="lrow"><span><b>${esc(base(o.sym))}</b> <span class="${o.side === "long" ? "g" : "r"}">${sideTxt(o.side)} ${o.lev}x</span> ${o.kind}</span><span>${fq(o.qty)} @ ${fp(o.price)} · <b>${o.status}</b></span><span class="m">${mdhm(o.t)}</span></div>`).join("") || '<div class="empty">없어요</div>';
    const th = d.th.map(t => t.kind === "deposit" ? `<div class="lrow"><span><b class="g">관리자 충전 +${fu(t.amount)}</b> USDT</span><span class="m">${mdhm(t.t)}</span></div>`
      : `<div class="lrow"><span><b>${esc(base(t.sym))}</b> <span class="${t.side === "long" ? "g" : "r"}">${sideTxt(t.side)} ${t.lev}x</span> · ${esc(t.reason)}</span><span class="${pc(t.pnl)}"><b>${sg(t.pnl)} USDT</b> (${sg(t.roe)}%)</span>
        <span class="m">${fq(t.qty)} · ${fp(t.entry)} → ${fp(t.exit)} · ${mdhm(t.t)}</span></div>`).join("") || '<div class="empty">없어요</div>';
    $("tabbody").innerHTML = `<button class="ghost mini" data-adm="back">← 목록으로</button>
      <h2 style="margin:10px 0 4px">${esc(d.nick)} ${d.bl ? '<span class="tag short">차단</span>' : ""}</h2>
      <p class="sub">가입 ${dt(d.c)} · 마지막 접속 ${dt(d.la)} · 잔고 ${fu(d.bal)} · 원금 ${fu(d.dep)} · ${d.stats.w}승 ${d.stats.n - d.stats.w}패 · 보유 포지션 ${d.pos.length}개 · 미체결 ${d.ord.length}개</p>
      <h2>최근 거래 기록</h2>${th}<h2 style="margin-top:16px">최근 주문 기록</h2>${ord}`;
  }
  $("tabbody").addEventListener("click", async e => {
    const b = e.target.closest("[data-adm]"); if (!b) return;
    const act = b.dataset.adm, nick = b.dataset.n;
    try {
      if (act === "back") { adminView = null; return renderAdmin(); }
      if (act === "detail") { adminView = await post("/api/admin", { action: "detail", nick }); return renderAdmin(); }
      if (act === "charge") {
        const amt = num(b.parentElement.querySelector("input").value);
        if (!(amt > 0)) return toast("충전 금액을 입력하세요");
        if (!confirm(`${nick} 님에게 ${fu(amt)} USDT 를 충전할까요?`)) return;
        toast((await post("/api/admin", { action: "charge", nick, amount: amt })).msg);
      } else if (act === "reset") {
        if (!confirm(`${nick} 님의 잔고·포지션·기록을 전부 지우고 10,000 USDT 로 초기화할까요?`)) return;
        toast((await post("/api/admin", { action: "reset", nick })).msg);
      } else if (act === "block" || act === "unblock") {
        if (!confirm(`${nick} 님을 ${act === "block" ? "차단" : "차단 해제"}할까요?`)) return;
        toast((await post("/api/admin", { action: act, nick })).msg);
      } else if (act === "delete") {
        if (!confirm(`${nick} 님의 계정을 삭제할까요? 잔고와 모든 기록이 사라지고 되돌릴 수 없어요.`)) return;
        if (!confirm(`정말 '${nick}' 계정을 삭제할까요? (마지막 확인)`)) return;
        toast((await post("/api/admin", { action: "delete", nick })).msg);
      } else return;
      adminView = null; loadAdmin();
      if (nick.toLowerCase() === (S.nick || "").toLowerCase()) refresh(true);
    } catch (err) { toast(err.message); }
  });

  // ── 시작 ─────────────────────────────────────────────────────
  let started = false;
  function start() {
    if (started) return;
    started = true;
    $("login").hidden = true; $("app").hidden = false;
    setCollapsed(ls.get(CH_KEY) === "1");
    setType("limit");
    renderHd(); renderBook(); renderTrades();
    connect(); loadChart(); loadCoins();
    refresh();
  }
  // 1초마다: 미실현 손익·주문 정보 갱신 / 가격이 TP·SL·청산·지정가를 넘었으면 서버 확인 요청
  setInterval(() => {
    if (!S.st || $("app").hidden) return;
    renderTiles(); if (S.tab === "pos") renderTab(); renderOrderInfo();
    const now = Date.now();
    if (now - S.lastSync > 20e3 && now - S.lastCross > 20e3) {
      const hit = S.st.pos.some(p => { const x = S.px[p.sym]; if (!x) return false; const L = p.side === "long";
          return L ? (x <= p.liq || (p.sl && x <= p.sl) || (p.tp && x >= p.tp)) : (x >= p.liq || (p.sl && x >= p.sl) || (p.tp && x <= p.tp)); })
        || S.st.ord.some(o => { const x = S.px[o.sym]; return x && (o.side === "long" ? x <= o.price : x >= o.price); });
      if (hit) { S.lastCross = now; refresh(true); }
    }
  }, 1000);
  setInterval(() => { if (!document.hidden && hasOpen() && Date.now() - S.lastSync > 55e3) refresh(true); }, 30e3);      // 열어두면 1분마다 서버 확인
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.token && started && Date.now() - S.lastSync > 30e3) refresh(true); });

  if (S.token) start(); else $("login").hidden = false;
})();
