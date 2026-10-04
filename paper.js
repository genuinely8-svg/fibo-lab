/*
  paper.js — 모의투자 화면
  가격·호가·체결은 바이낸스 선물 웹소켓(브라우저가 직접), 계좌·주문·체결 처리는 서버(/api/paper)가 해요.
  계산 규칙은 paper-engine.js (서버와 같은 파일)
  ※ 바이낸스 선물 웹소켓은 주소가 둘로 나뉘어 있어요: /market/ws (체결·티커·마크가·캔들), /public/ws (호가)
     예전 주소(/ws)는 호가만 보내줘서 현재가·마크가가 멈춰 보였어요
*/
(function () {
  "use strict";
  const E = PaperEngine;
  const KST = 9 * 3600;
  const K = { token: "paper-token-v1", nick: "paper-nick-v1", sym: "paper-sym-v1", collapsed: "paper-chart-collapsed-v1", collapsedM: "paper-chart-collapsed-m-v1", ctab: "paper-ctab-v1",
              mode: "paper-mode-v1", lev: "paper-lev-v1", sound: "paper-sound-v1", notes: "paper-notes-v1:", dep: "paper-dep-v1:" };
  const STABLES = new Set(["USDC", "FDUSD", "TUSD", "USDE", "BUSD", "DAI", "USDP", "USDS", "USD1"]);
  const IVS = ["1m", "5m", "15m", "1h", "4h", "1d"];
  const $ = id => document.getElementById(id);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    del: k => { try { localStorage.removeItem(k); } catch (e) {} },
  };

  const S = { token: ls.get(K.token), nick: ls.get(K.nick), admin: false, st: null, sym: ls.get(K.sym) || "BTCUSDT", iv: "15m", ctab: ls.get(K.ctab) === "mine" ? "mine" : "tv",
              otype: "limit", mode: ls.get(K.mode) === "cross" ? "cross" : "isolated", tab: "pos", px: {}, t24: {}, mark: {}, book: null, trades: [], coins: [],
              lastSync: 0, syncing: false, lastCross: 0, first: true, notes: [], unread: 0, sound: ls.get(K.sound) !== "0", warned: {} };
  const base = s => CoinMeta.base(s.replace(/USDT$/, ""));
  const pxOf = s => S.px[s];

  // ── 숫자 표시 ────────────────────────────────────────────────
  const pdec = p => p >= 10000 ? 1 : p >= 100 ? 2 : p >= 1 ? 4 : p >= 0.1 ? 5 : 7;
  const fp = p => p == null || !isFinite(p) ? "-" : p.toLocaleString("en-US", { minimumFractionDigits: pdec(p), maximumFractionDigits: pdec(p) });
  const fu = (v, d = 2) => v == null || !isFinite(v) ? "-" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sg = (v, d = 2) => v == null || !isFinite(v) ? "-" : (v > 0 ? "+" : "") + fu(v, d);
  const um = v => `${fu(v)} <small class="u">USDT</small>`;                        // 금액 + 단위 (HTML)
  const sm = v => `${sg(v)} <small class="u">USDT</small>`;                        // 부호 있는 금액 + 단위
  const ut = v => `${fu(v)} USDT`;                                                  // 글자만
  const pc = v => v > 0 ? "g" : v < 0 ? "r" : "";
  const fq = q => q >= 100 ? fu(q, 2) : q >= 1 ? fu(q, 3) : fu(q, 5);
  const hms = t => new Date(t + 9 * 3600e3).toISOString().slice(11, 19);
  const mdhm = t => { const d = new Date(t + 9 * 3600e3).toISOString(); return d.slice(5, 10) + " " + d.slice(11, 16); };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => { const n = parseFloat(String(v).replace(/,/g, "")); return isFinite(n) ? n : NaN; };
  const sideTxt = s => s === "long" ? "Long" : "Short";
  const modeTxt = m => m === "cross" ? "Cross" : "Isolated";
  // 예전(한글) 기록 값 → 영어 표시
  const LEG = { "지정가": "Limit", "시장가": "Market", "지정가(즉시)": "Limit (instant)", "지정가 청산": "Limit close", "체결": "Filled", "접수": "Open", "취소": "Cancelled",
                "청산": "Liquidation", "수동": "Manual", "부분": "partial" };
  const LA = s => String(s ?? "").replace(/잔고 초기화/g, "Balance reset").replace(/차단 해제/g, "Unblocked").replace(/계정 삭제/g, "Account deleted").replace(/차단/g, "Blocked").replace(/충전/g, "Deposit");
  const L = s => String(s ?? "").replace(/지정가\(즉시\)|지정가 청산|지정가|시장가|체결|접수|취소|청산|수동|부분/g, m => LEG[m] || m);
  const tagSide = (side, mode, lev) => `<span class="tag ${side}">${sideTxt(side)}</span> <span class="tag gray">${modeTxt(mode)} ${lev}x</span>`;

  // ── 알림: 위쪽 토스트 + 종 아이콘 기록 + 소리 ───────────────────
  let actx = null;
  function beep(kind) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      const seq = kind === "ok" ? [[880, 0, .09]] : kind === "warn" ? [[660, 0, .1], [660, .16, .1]] : [[330, 0, .16], [247, .2, .22]];
      for (const [f, at, d] of seq) {
        const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + at;
        o.frequency.value = f; o.type = "sine"; g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(.12, t0 + .01); g.gain.exponentialRampToValueAtTime(.0001, t0 + d);
        o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + d + .02);
      }
    } catch (e) {}
  }
  // kind: ok(초록) | warn(주황) | bad(빨강, 청산·실패)
  function notify(kind, title, text, quiet) {
    S.notes.unshift({ t: Date.now(), k: kind, title, text: text || "" });
    if (S.notes.length > 50) S.notes.length = 50;
    S.unread++; saveNotes(); renderBell();
    if (quiet) return;
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.innerHTML = `<b>${esc(title)}</b>${text ? esc(text) : ""}`;
    $("toasts").prepend(el);
    while ($("toasts").children.length > 4) $("toasts").lastChild.remove();
    setTimeout(() => el.remove(), kind === "ok" ? 4000 : 6000);
    beep(kind);
  }
  const fail = e => notify("bad", "Failed", e.message || String(e));
  function saveNotes() { ls.set(K.notes + (S.nick || ""), JSON.stringify(S.notes)); }
  function loadNotes() { try { S.notes = JSON.parse(ls.get(K.notes + (S.nick || "")) || "[]"); } catch (e) { S.notes = []; } S.unread = 0; renderBell(); }
  function renderBell() {
    $("bellN").hidden = !S.unread; $("bellN").textContent = S.unread > 9 ? "9+" : S.unread;
    $("snd").textContent = S.sound ? "Sound off" : "Sound on";
    if (!$("bellpanel").hidden) $("blist").innerHTML = S.notes.map(n => `<div class="${n.k}"><span><b>${esc(n.title)}</b> ${esc(n.text)}<small>${mdhm(n.t)}</small></span></div>`).join("") || '<div class="muted" style="--c:transparent">No notifications</div>';
  }
  $("bell").onclick = e => { e.stopPropagation(); const p = $("bellpanel"); p.hidden = !p.hidden; if (!p.hidden) { S.unread = 0; } renderBell(); };
  $("bellpanel").onclick = e => e.stopPropagation();
  $("snd").onclick = () => { S.sound = !S.sound; ls.set(K.sound, S.sound ? "1" : "0"); renderBell(); if (S.sound) beep("ok"); };
  $("bclear").onclick = () => { S.notes = []; S.unread = 0; saveNotes(); renderBell(); };
  document.addEventListener("click", () => { $("bellpanel").hidden = true; });

  // ── 서버 요청 ────────────────────────────────────────────────
  async function post(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(S.token ? { Authorization: "Bearer " + S.token } : {}) }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if ((res.status === 401 || (res.status === 403 && /차단|blocked/i.test(j.error || ""))) && S.token && url !== "/api/auth") { logout(true, j.error); throw new Error(j.error || "Please log in again"); }
    if (!res.ok) throw new Error(j.error || "Server error " + res.status);
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
        if (!confirm(`'${nick}' is a new nickname.\nCreate a new account with this nickname and PIN?`)) return;
        r = await post("/api/auth", { nick, pin, create: true });
      }
      S.token = r.token; S.nick = r.nick; ls.set(K.token, r.token); ls.set(K.nick, r.nick);
      $("pin").value = "";
      start();
    } catch (e) { $("lerr").textContent = e.message; }
    finally { $("lbtn").disabled = false; }
  });
  function logout(silent, msg) {
    ls.del(K.token); S.token = null; S.st = null; S.admin = false;
    closeSocks(); started = false; S.first = true;
    $("app").hidden = true; $("login").hidden = false;
    if (silent) $("lerr").textContent = msg || "Please log in again";
  }
  $("logout").onclick = () => { logout(); location.reload(); };

  // ── 서버 상태 ────────────────────────────────────────────────
  const EV_TITLE = { fill: ["ok", "Limit filled · Position opened"], tp: ["ok", "Take-profit triggered"], sl: ["warn", "Stop-loss triggered"], liq: ["bad", "Liquidated"], rclose: ["ok", "Limit close filled"] };
  const evText = e => `${base(e.sym)} ${sideTxt(e.side)} @ ${fp(e.price)}${e.pnl != null ? ` · PnL ${sg(e.pnl)} USDT` : ""}`;
  function handleEvents(events) {
    if (!events || !events.length) return;
    if (S.first) {                                       // 접속하지 않은 동안 처리된 것들: 한 번에 묶어서 알려줌
      for (const e of events) notify(EV_TITLE[e.type][0], EV_TITLE[e.type][1], evText(e), true);
      notify("warn", `${events.length} event(s) while you were away`, "Processed while you were offline");
      modal(`<h2>${events.length} event(s) while you were away</h2><p class="sub">Processed from 1-minute candles while you were offline</p>`
        + events.map(e => `<div class="lrow"><span class="${EV_TITLE[e.type][0] === "bad" ? "r" : EV_TITLE[e.type][0] === "warn" ? "o" : "g"}"><b>${EV_TITLE[e.type][1]}</b></span><span>${esc(evText(e))}</span><span class="m">${mdhm(e.t)}</span></div>`).join(""), null, "확인");
      return;
    }
    for (const e of events) notify(EV_TITLE[e.type][0], EV_TITLE[e.type][1], evText(e));
  }
  function handleInfo(i) {
    if (!i) return;
    if (i.kind === "order") {
      const t = `${base(i.sym)} ${modeTxt(i.mode)} ${sideTxt(i.side)} ${i.lev}x · ${fq(i.qty)} @ ${fp(i.price)}`;
      if (i.filled) notify("ok", i.merged ? "Added to position" : "Position opened", t); else notify("ok", "Order placed", "Limit · " + t);
    } else if (i.kind === "cancel") notify("ok", "Order cancelled", "Open order cancelled");
    else if (i.kind === "close") notify(i.pnl >= 0 ? "ok" : "warn", i.pct >= 100 ? "Position closed" : `Partial close ${i.pct}%`, `${base(i.sym)} ${sideTxt(i.side)} @ ${fp(i.price)} · PnL ${sg(i.pnl)} USDT`);
    else if (i.kind === "closeLimit") notify("ok", "Limit close order placed", `${base(i.sym)} ${i.pct}% @ ${fp(i.price)}`);
    else if (i.kind === "edit") notify("ok", "TP/SL updated", base(i.sym));
    else if (i.kind === "reset") notify("ok", "Reset", "Starting again with 10,000 USDT");
  }
  function checkDeposits() {
    const deps = S.st.th.filter(t => t.kind === "deposit"), key = K.dep + S.nick, saved = ls.get(key);
    const last = saved == null ? -1 : +saved, max = deps.reduce((m, t) => Math.max(m, t.id), last < 0 ? 0 : last);
    for (const d of deps.slice().reverse()) if (d.id > last && (saved != null || Date.now() - d.t < 86400e3)) notify("ok", "Deposit received", `+${fu(d.amount)} USDT`);
    if (String(max) !== saved) ls.set(key, String(max));
  }
  async function sendAction(body, quiet) {
    if (body.action === "state") { if (S.syncing) return; }
    else while (S.syncing) await new Promise(r => setTimeout(r, 100));     // 다른 요청이 끝나길 기다렸다가
    S.syncing = true;
    try {
      const r = await post("/api/paper", body);
      S.st = r.st; S.admin = r.admin; S.nick = r.nick; S.lastSync = Date.now();
      if (S.first) loadNotes();
      handleEvents(r.events);
      S.first = false;
      if (!quiet) handleInfo(r.info);
      if (r.syncError && !quiet) notify("warn", "Binance data delayed", "Showing last known state");
      checkDeposits();
      afterState();
      if (r.behind && !r.syncError) setTimeout(() => sendAction({ action: "state" }, true), 1500);   // 오래 비웠으면 이어서 처리
      return r;
    } catch (e) { if (!quiet) fail(e); throw e; }
    finally { S.syncing = false; }
  }
  const refresh = quiet => sendAction({ action: "state" }, quiet).catch(() => {});
  const hasOpen = () => S.st && (S.st.pos.length || S.st.ord.length);

  function afterState() {
    $("who").textContent = S.nick || "";
    $("admtab").hidden = !S.admin;
    if (!S.admin && S.tab === "adm") S.tab = "pos";
    subscribe(); drawLines(); sig = ""; renderAll();
  }

  // ── 웹소켓 (주소 둘: market / public) — 끊기면 자동 재연결 ──────
  function Sock(path, want) {
    this.path = path; this.want = want; this.have = new Set(); this.ws = null; this.timer = null; this.closed = false; this.last = 0; this.tries = 0;
  }
  Sock.prototype.open = function () {
    clearTimeout(this.timer); this.closed = false;
    const me = this, ws = this.ws = new WebSocket("wss://fstream.binance.com" + this.path);
    ws.onopen = () => { me.tries = 0; me.last = Date.now(); me.have = new Set(); me.sync(); renderDot(); };
    ws.onmessage = m => { me.last = Date.now(); try { onMsg(JSON.parse(m.data)); } catch (e) {} };
    ws.onclose = () => { renderDot(); if (me.ws === ws && !me.closed) me.timer = setTimeout(() => me.open(), Math.min(10000, 1000 * ++me.tries)); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  };
  Sock.prototype.sync = function () {
    const ws = this.ws; if (!ws || ws.readyState !== 1) return;
    const want = this.want(), add = [...want].filter(x => !this.have.has(x)), del = [...this.have].filter(x => !want.has(x));
    if (del.length) ws.send(JSON.stringify({ method: "UNSUBSCRIBE", params: del, id: 2 }));
    if (add.length) ws.send(JSON.stringify({ method: "SUBSCRIBE", params: add, id: 1 }));
    this.have = want;
  };
  // 열려 있는데 15초 넘게 아무 소식이 없으면 멈춘 연결로 보고 다시 연결
  Sock.prototype.alive = function () { return !!this.ws && this.ws.readyState === 1 && Date.now() - this.last < 15000; };
  Sock.prototype.watch = function () {
    if (this.closed || !this.ws) return;
    if (this.ws.readyState === 1 && Date.now() - this.last > 20000) { try { this.ws.close(); } catch (e) {} }
    else if (this.ws.readyState === 3) this.open();
  };
  Sock.prototype.close = function () { this.closed = true; clearTimeout(this.timer); try { this.ws && this.ws.close(); } catch (e) {} this.ws = null; };
  const mkt = new Sock("/market/ws", () => {
    const s = S.sym.toLowerCase(), set = new Set([`${s}@aggTrade`, `${s}@ticker`, `${s}@markPrice@1s`]);
    if (S.ctab === "mine") set.add(`${s}@kline_${S.iv}`);
    if (S.st) for (const x of S.st.pos.concat(S.st.ord)) if (x.sym !== S.sym) { set.add(x.sym.toLowerCase() + "@miniTicker"); }
    return set;
  });
  const pub = new Sock("/public/ws", () => new Set([`${S.sym.toLowerCase()}@depth20@500ms`]));
  const subscribe = () => { mkt.sync(); pub.sync(); };
  const closeSocks = () => { mkt.close(); pub.close(); };
  // 연결 상태 점: 초록 = 가격(market)·호가(public) 모두 실시간 수신 중 / 빨강 = 끊김 (자동 재연결 중)
  function renderDot() {
    const m = mkt.alive(), p = pub.alive(), el = $("wsdot");
    el.className = "wsdot " + (m && p ? "on" : "off");
    el.title = m && p ? "Live" : `Disconnected — reconnecting (price ${m ? "ok" : "down"} · book ${p ? "ok" : "down"})`;
    $("wstxt").textContent = m && p ? "Live" : "Reconnecting";
  }

  let dirtyHd = false, dirtyBook = false, dirtyTr = false;
  function onMsg(d) {
    const sym = d.s;
    switch (d.e) {
      case "aggTrade":
        S.px[sym] = +d.p;
        if (sym === S.sym) { S.trades.unshift({ p: +d.p, q: +d.q, T: d.T, m: d.m }); if (S.trades.length > 30) S.trades.length = 30; dirtyTr = dirtyHd = true; }
        break;
      case "24hrTicker": S.px[sym] = +d.c; S.t24[sym] = { chg: +d.P, hi: +d.h, lo: +d.l, vol: +d.q }; dirtyHd = true; break;
      case "24hrMiniTicker": S.px[sym] = +d.c; break;
      case "markPriceUpdate": S.mark[sym] = { r: +d.r, T: d.T, p: +d.p }; dirtyHd = dirtyBook = true; break;
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

  // 웹소켓이 늦거나 막혀도 상단 시세가 비지 않게: REST 로도 받아둠 (24hr ticker + premiumIndex)
  async function loadTicker() {
    const sym = S.sym;
    try {
      const [t, m] = await Promise.all([
        fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`).then(r => r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`).then(r => r.json()),
      ]);
      if (sym !== S.sym || !t.lastPrice) return;
      if (!mkt.alive()) S.px[sym] = +t.lastPrice;                 // 웹소켓이 살아 있으면 그쪽 값이 더 최신
      S.t24[sym] = { chg: +t.priceChangePercent, hi: +t.highPrice, lo: +t.lowPrice, vol: +t.quoteVolume };
      if (m.markPrice) S.mark[sym] = { r: +m.lastFundingRate, T: +m.nextFundingTime, p: +m.markPrice };
      dirtyHd = true;
    } catch (e) {}
  }
  setInterval(() => { if (started && !document.hidden) loadTicker(); }, 15000);

  // ── 코인 선택 ────────────────────────────────────────────────
  async function loadCoins() {
    try {
      const [arr] = await Promise.all([fetch("https://fapi.binance.com/fapi/v1/ticker/24hr").then(r => r.json()), CoinMeta.load().catch(() => {})]);
      let list = arr.filter(x => /^[A-Z0-9]+USDT$/.test(x.symbol)).map(x => ({ sym: x.symbol, b: base(x.symbol), last: +x.lastPrice, chg: +x.priceChangePercent, vol: +x.quoteVolume }))
        .filter(x => CoinMeta.isCrypto(x.sym.replace(/USDT$/, "")) && !STABLES.has(x.b));
      if (CoinMeta.hasTop()) { list = list.filter(x => CoinMeta.rank(x.b) && CoinMeta.rank(x.b) <= 100).sort((a, b) => CoinMeta.rank(a.b) - CoinMeta.rank(b.b)); }
      else { list = list.sort((a, b) => b.vol - a.vol).slice(0, 100); }   // 코인게코가 막혔을 때: 거래대금 상위 100
      S.coins = list;
      for (const c of list) if (!S.px[c.sym]) S.px[c.sym] = c.last;      // 처음 한 번만 채움 (실시간 값을 덮어쓰지 않음)
      renderPicker();
    } catch (e) { $("plist").innerHTML = '<div class="muted">Could not load coin list</div>'; }
  }
  const logoImg = b => CoinMeta.logo(b) ? `<img src="${esc(CoinMeta.logo(b))}" alt="" onerror="this.style.visibility='hidden'">` : `<span class="ph"></span>`;
  function renderPicker() {
    const q = $("psearch").value.trim().toUpperCase();
    const rows = S.coins.filter(c => !q || c.b.includes(q) || (CoinMeta.ko(c.b) || "").includes(q)).map(c =>
      `<div data-s="${c.sym}">${logoImg(c.b)}<span class="s">${esc(c.b)} <span class="n">${esc(CoinMeta.ko(c.b) || "")}</span></span><span>${fp(c.last)}</span><span class="${pc(c.chg)}">${sg(c.chg)}%</span></div>`);
    $("plist").innerHTML = rows.join("") || '<div class="muted">No results</div>';
  }
  $("coinbtn").onclick = e => { e.stopPropagation(); const p = $("picker"); p.hidden = !p.hidden; if (!p.hidden) { $("psearch").value = ""; renderPicker(); loadCoins(); $("psearch").focus(); } };
  $("psearch").oninput = renderPicker;
  $("picker").onclick = e => e.stopPropagation();
  $("plist").onclick = e => { const d = e.target.closest("[data-s]"); if (d) setSym(d.dataset.s); };
  document.addEventListener("click", () => { $("picker").hidden = true; });

  function setSym(sym) {
    $("picker").hidden = true;
    S.sym = sym; ls.set(K.sym, sym); lastMid = 0; midDir = "";
    S.book = null; S.trades = []; renderBook(); renderTrades();
    $("oprice").value = ""; $("qty").value = ""; $("pct").value = 0;
    renderHd(); subscribe(); loadTicker(); renderTV(); loadChart(); renderOrderInfo();
  }

  // ── 상단 시세 ────────────────────────────────────────────────
  let lastPx = 0;
  function renderHd() {
    const b = base(S.sym), p = S.px[S.sym], t = S.t24[S.sym], m = S.mark[S.sym];
    if ($("coinbtn").dataset.k !== S.sym) { $("coinbtn").innerHTML = `${logoImg(b)}<span>${esc(b)}<small> USDT Perp</small></span> ▾`; $("coinbtn").dataset.k = S.sym; }
    $("qunit").textContent = b;
    const el = $("price");
    el.textContent = fp(p);
    if (p && lastPx) el.style.color = p > lastPx ? "var(--buy)" : p < lastPx ? "var(--sell)" : "";
    lastPx = p || lastPx;
    if (t) {
      $("chg").textContent = sg(t.chg) + "%"; $("chg").className = pc(t.chg);
      $("hi").textContent = fp(t.hi); $("lo").textContent = fp(t.lo);
      $("vol").textContent = fu(t.vol, 0) + " USDT";
    }
    if (m) {
      $("mark").textContent = fp(m.p);
      const left = Math.max(0, m.T - Date.now()), h = Math.floor(left / 3600e3), mi = Math.floor(left % 3600e3 / 60e3), s = Math.floor(left % 60e3 / 1e3);
      $("fund").textContent = `${(m.r * 100).toFixed(4)}% / ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      $("fund").className = m.r > 0 ? "g" : m.r < 0 ? "r" : "";
    }
  }

  // ── 호가·체결 ────────────────────────────────────────────────
  const isMob = () => matchMedia("(max-width:900px)").matches;
  let lastMid = 0, midDir = "";
  function renderBook() {
    const el = $("book");
    if (!S.book) { el.innerHTML = '<div class="muted small" style="padding:10px">Loading…</div>'; return; }
    const N = isMob() ? 8 : 10;
    const asks = S.book.a.slice(0, N).map(x => [+x[0], +x[1]]), bids = S.book.b.slice(0, N).map(x => [+x[0], +x[1]]);
    const cum = arr => { let s = 0; return arr.map(x => (s += x[1])); };
    const ca = cum(asks), cb = cum(bids), mx = Math.max(ca[ca.length - 1] || 1, cb[cb.length - 1] || 1);
    const row = (cls, x, c) => `<div class="brow ${cls}" data-p="${x[0]}"><i style="width:${(c / mx * 100).toFixed(0)}%"></i><span>${fp(x[0])}</span><span>${fq(x[1])}</span></div>`;
    const p = S.px[S.sym], mk = S.mark[S.sym];
    if (p && lastMid && p !== lastMid) midDir = p > lastMid ? "up" : "dn";
    if (p) lastMid = p;
    el.innerHTML = `<div class="bhead"><span>Price(USDT)</span><span>Size(${esc(base(S.sym))})</span></div>`
      + asks.map((x, i) => row("a", x, ca[i])).reverse().join("")
      + `<div class="mid ${midDir}">${fp(p)}<small>Mark ${mk ? fp(mk.p) : "-"}</small></div>`
      + bids.map((x, i) => row("b", x, cb[i])).join("");
  }
  $("book").onclick = e => { const r = e.target.closest("[data-p]"); if (r) { setType("limit"); $("oprice").value = r.dataset.p; renderOrderInfo(); } };
  function renderTrades() {
    $("trades").innerHTML = `<div class="bhead"><span>Time</span><span>Price</span><span>Size</span></div>` + S.trades.map(t =>
      `<div class="trow"><span class="muted">${hms(t.T)}</span><span class="${t.m ? "r" : "g"}">${fp(t.p)}</span><span>${fq(t.q)}</span></div>`).join("");
  }
  $("bseg").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    [...$("bseg").children].forEach(x => x.classList.toggle("on", x === b));
    $("bookbox").classList.toggle("showbook", b.dataset.v === "book"); $("bookbox").classList.toggle("showtr", b.dataset.v === "tr");
  };

  // ── 차트: 트레이딩뷰(기본) / 내 포지션(Lightweight) ─────────────
  let tvLoading = null, tvKey = "";
  const isDark = () => (window.Theme ? Theme.get() : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
  function loadTV() {
    if (window.TradingView) return Promise.resolve();
    if (!tvLoading) tvLoading = new Promise((ok, no) => {
      const s = document.createElement("script");
      s.src = "https://s3.tradingview.com/tv.js";
      s.onload = ok; s.onerror = () => { tvLoading = null; no(new Error("Could not load TradingView")); };
      document.head.appendChild(s);
    });
    return tvLoading;
  }
  // 바이낸스 선물 무기한 심볼 (예: BINANCE:BTCUSDT.P). 코인·테마가 바뀌면 다시 만듦
  async function renderTV(force) {
    if (S.ctab !== "tv" || $("chartbox").classList.contains("collapsed")) return;
    const key = S.sym + "|" + (isDark() ? "d" : "l");
    if (!force && key === tvKey && $("tv").querySelector("#tv-widget")) return;
    tvKey = key;
    const el = $("tv");
    el.innerHTML = '<p class="tvmsg">Loading TradingView…</p>';
    try { await loadTV(); } catch (e) { el.innerHTML = `<p class="tvmsg">${esc(e.message)}</p>`; tvKey = ""; return; }
    if (key !== S.sym + "|" + (isDark() ? "d" : "l")) return;
    el.innerHTML = '<div id="tv-widget" style="height:100%"></div>';
    new TradingView.widget({
      container_id: "tv-widget", autosize: true, symbol: "BINANCE:" + S.sym + ".P", interval: "15",
      timezone: "Asia/Seoul", locale: "kr", style: "1", theme: isDark() ? "dark" : "light",
      allow_symbol_change: false, hide_side_toolbar: false, enable_publishing: false, withdateranges: true,
    });
  }

  let chart = null, series = null, lines = [], loadId = 0;
  function initChart() {
    if (chart || !window.LightweightCharts) { if (!window.LightweightCharts) $("chart").innerHTML = '<p class="tvmsg">Could not load chart library</p>'; return; }
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
    if (chart) {
      chart.applyOptions({ layout: { background: { color: css("--card") }, textColor: css("--muted") }, grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
                           rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") } });
      drawLines();
    }
    renderTV();
  });
  async function loadChart() {
    if (S.ctab !== "mine") return;
    initChart(); if (!series) return;
    const id = ++loadId, sym = S.sym, iv = S.iv;
    series.setData([]);
    try {
      const rows = await (await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${iv}&limit=500`)).json();
      if (id !== loadId) return;
      series.setData(rows.map(r => ({ time: Math.floor(r[0] / 1000) + KST, open: +r[1], high: +r[2], low: +r[3], close: +r[4] })));
      const last = +rows[rows.length - 1][4];
      series.applyOptions({ priceFormat: { type: "price", precision: pdec(last), minMove: Math.pow(10, -pdec(last)) } });
      chart.timeScale().scrollToRealTime();
      drawLines();
    } catch (e) { if (id === loadId) notify("warn", "Chart error", "Could not load candles"); }
  }
  // 진입가·청산가·TP/SL·미체결 주문 가격선 (내 포지션 탭에서만 보임)
  function drawLines() {
    if (!series) return;
    for (const l of lines) series.removePriceLine(l);
    lines = [];
    if (!S.st) return;
    const add = (price, color, title, style) => { if (price) lines.push(series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })); };
    for (const p of S.st.pos) {
      if (p.sym !== S.sym) continue;
      const k = sideTxt(p.side);
      add(p.entry, css("--muted"), `${k} Entry`, 0); add(E.liqOf(S.st, p, pxOf), "#f59e0b", `${k} Liq.`, 2);
      add(p.tp, "#22b573", "TP", 2); add(p.sl, "#ef4b5f", "SL", 2);
    }
    for (const o of S.st.ord) if (o.sym === S.sym) add(o.price, "#5b93f0", `${o.ro ? "Close" : sideTxt(o.side)} order`, 1);
  }
  IVS.forEach(v => { const b = document.createElement("button"); b.textContent = v; b.dataset.v = v; if (v === S.iv) b.className = "on"; $("iv").appendChild(b); });
  $("iv").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    S.iv = b.dataset.v; [...$("iv").children].forEach(x => x.classList.toggle("on", x === b));
    subscribe(); loadChart();
  };
  function setCtab(c) {
    S.ctab = c; ls.set(K.ctab, c);
    [...$("ctabs").children].forEach(b => b.classList.toggle("on", b.dataset.c === c));
    $("tv").hidden = c !== "tv"; $("chart").hidden = c !== "mine";
    $("iv").hidden = c !== "mine"; $("chint").hidden = c !== "mine";
    subscribe();
    if (c === "tv") renderTV(); else loadChart();
  }
  $("ctabs").onclick = e => { const b = e.target.closest("button"); if (b) setCtab(b.dataset.c); };
  function setCollapsed(c) {
    $("chartbox").classList.toggle("collapsed", c); $("ctoggle").textContent = c ? "Show chart" : "Hide chart"; ls.set(isMob() ? K.collapsedM : K.collapsed, c ? "1" : "0");
    if (!c) { if (S.ctab === "tv") renderTV(); else loadChart(); }
  }
  $("ctoggle").onclick = () => setCollapsed(!$("chartbox").classList.contains("collapsed"));

  // ── 주문 패널: 마진 모드 · 레버리지 · 수량 ────────────────────
  const lev = () => Math.min(100, Math.max(1, Math.floor(+$("levn").value) || 1));
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
  function setMode(m, say) {
    S.mode = m; ls.set(K.mode, m);
    [...$("mmode").children].forEach(b => b.classList.toggle("on", b.dataset.m === m));
    renderOrderInfo();
    if (say) notify("ok", "Margin mode", `${modeTxt(m)} margin for new orders (open positions unchanged)`);
  }
  $("mmode").onclick = e => { const b = e.target.closest("button"); if (b && b.dataset.m !== S.mode) setMode(b.dataset.m, true); };
  function setLev(v, say) {
    v = Math.min(100, Math.max(1, Math.floor(+v) || 1));
    $("lev").value = v; $("levn").value = v; ls.set(K.lev, String(v));
    [...$("lquick").children].forEach(b => b.classList.toggle("on", +b.dataset.l === v));
    if ($("pct").value > 0) pctToQty(+$("pct").value);
    renderOrderInfo();
    if (say) notify("ok", "Leverage", `${v}x (open positions unchanged)`);
  }
  $("lev").oninput = () => setLev($("lev").value);            // 끄는 동안은 조용히 (청산가는 바로 갱신)
  $("lev").onchange = () => setLev($("lev").value, true);
  $("levn").oninput = () => { if ($("levn").value !== "") setLev($("levn").value); };
  $("levn").onchange = () => setLev($("levn").value, true);
  $("lquick").onclick = e => { const b = e.target.closest("button"); if (b) setLev(b.dataset.l, true); };
  $("usecur").onclick = () => { if (S.px[S.sym]) { $("oprice").value = S.px[S.sym].toFixed(pdec(S.px[S.sym])); renderOrderInfo(); } };
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

  // 예상 청산가: 격리 = 진입가·레버리지만으로, 교차 = 계정 전체 잔고·다른 교차 포지션까지 반영
  function previewLiq(side, ref, q) {
    if (S.mode !== "cross") return E.liqPrice(side, ref, lev());
    if (!S.st || !(q > 0)) return undefined;
    const W = E.crossWallet(S.st) - q * ref * rateNow();
    return E.crossLiqPrice(W, S.st.pos.filter(p => E.modeOf(p) === "cross"), { side, entry: ref, qty: q }, pxOf);
  }
  function renderOrderInfo() {
    const ref = refPrice(), qIn = num($("qty").value), q = qIn > 0 ? qIn : 0;
    $("avail").innerHTML = S.st ? um(avail()) : "-";
    if (ref && q > 0) { const need = E.needOf(q, ref, lev(), rateNow()); $("need").innerHTML = um(need); $("need").className = need > avail() ? "r" : ""; }
    else { $("need").textContent = "-"; $("need").className = ""; }
    const qq = q > 0 ? q : (S.mode === "cross" ? maxQty() : 0);
    const show = side => {
      if (!ref) return "-";
      const v = previewLiq(side, ref, qq);
      return v === undefined ? "Enter size" : v === null ? "None" : fp(v);
    };
    $("liqL").textContent = show("long"); $("liqS").textContent = show("short");
    // TP/SL 예상 손익: 가격이 진입가보다 위/아래인지로 롱·숏을 판단해서 (수수료 포함) 계산
    const est = (id, kind) => {
      const v = num($(id).value), el = $(id + "Est");
      if (!(v > 0) || !ref) { el.innerHTML = ""; return; }
      if (!(q > 0)) { el.innerHTML = '<span class="m">Enter size to see est. PnL</span>'; return; }
      const side = kind === "tp" ? (v > ref ? "long" : "short") : (v < ref ? "long" : "short");
      const fee = q * ref * rateNow() + q * v * (kind === "tp" ? E.FEE_MAKER : E.FEE_TAKER);
      const pnl = E.pnlOf(side, ref, v, q) - fee, roe = pnl / (q * ref / lev()) * 100;
      const mv = (v - ref) / ref * 100;
      el.innerHTML = `<span class="m">${kind === "tp" ? "TP" : "SL"} (${sideTxt(side)}) ${sg(mv)}% →</span> <b class="${pc(pnl)}">${sg(pnl)} USDT</b> <span class="${pc(roe)}">(${sg(roe)}%)</span>`;
    };
    est("tp", "tp"); est("sl", "sl");
    $("liqnote").textContent = S.mode === "cross"
      ? `Cross: liq. price based on whole account${q > 0 ? "" : " (uses full available balance if no size)"}`
      : `Isolated: at ${lev()}x, liquidated after ~${(100 / lev() - E.MMR * 100).toFixed(2)}% adverse move`;
  }
  let ordering = false;
  async function submit(side) {
    if (ordering) return;
    const q = num($("qty").value);
    if (!(q > 0)) return notify("warn", "Check order", "Enter a size");
    if (S.otype === "limit" && !(num($("oprice").value) > 0)) return notify("warn", "Check order", "Enter a limit price");
    ordering = true; $("bLong").disabled = $("bShort").disabled = true;
    try {
      await sendAction({ action: "order", sym: S.sym, side, mode: S.mode, lev: lev(), qty: q, type: S.otype, price: S.otype === "limit" ? num($("oprice").value) : undefined,
                         tp: $("tpon").checked ? $("tp").value.trim() || undefined : undefined, sl: $("tpon").checked ? $("sl").value.trim() || undefined : undefined });
      $("qty").value = ""; $("pct").value = 0; renderOrderInfo();
    } catch (e) {}
    ordering = false; $("bLong").disabled = $("bShort").disabled = false;
  }
  $("tpon").onchange = () => { $("tpbox").hidden = !$("tpon").checked; };
  $("bLong").onclick = () => submit("long");
  $("bShort").onclick = () => submit("short");

  // ── 계좌 요약 ────────────────────────────────────────────────
  function calc() {
    const st = S.st; let upnl = 0, marg = 0;
    for (const p of st.pos) { upnl += E.pnlOf(p.side, p.entry, S.px[p.sym] || p.entry, p.qty); marg += p.margin; }
    const equity = st.bal + marg + upnl;
    return { upnl, marg, equity, ret: (equity - st.dep) / st.dep * 100 };
  }
  function renderTiles() {
    const st = S.st, c = calc(), s = st.st;
    const tile = (k, v, cls, sub) => `<div class="tile"><div class="k">${k}</div><div class="v ${cls || ""}">${v}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
    $("tiles").innerHTML = tile("Total equity", um(c.equity), "", `Principal ${ut(st.dep)}`)
      + tile("Available", um(E.available(st)), "", `Margin ${ut(c.marg)}`)
      + tile("Unrealized PnL", sm(c.upnl), pc(c.upnl))
      + tile("Realized PnL", sm(s.rp), pc(s.rp), `Fees ${ut(s.fee)}`)
      + tile("Total return", sg(c.ret) + "%", pc(c.ret))
      + tile("Win rate", s.n ? (s.w / s.n * 100).toFixed(1) + "%" : "-", "", `${s.w}W ${s.n - s.w}L / ${s.n} trades`);
  }

  // ── 아래 표 (PC 표 → 좁은 화면 카드) ──────────────────────────
  // heads: [{h, c}]  c: "l"(왼쪽 정렬·카드에서 윗줄 전체) | "full"(카드에서 한 줄 전체) | ""
  function tbl(heads, rows) {
    return `<table class="pt"><thead><tr>${heads.map(h => `<th class="${h.c === "l" ? "l" : ""}">${h.h}</th>`).join("")}</tr></thead><tbody>`
      + rows.map(r => r.dep ? `<tr class="tr-dep"><td class="full l">${r.dep}</td></tr>`
        : `<tr>${r.map((c, i) => `<td class="${heads[i].c || ""}" data-l="${heads[i].h}">${c}</td>`).join("")}</tr>`).join("") + `</tbody></table>`;
  }
  const dyn = (k, html) => `<span data-k="${k}">${html}</span>`;
  function posDyn(p) {                                      // 가격 따라 계속 바뀌는 칸들
    const st = S.st, px = S.px[p.sym] || p.entry, mk = S.mark[p.sym], up = E.pnlOf(p.side, p.entry, px, p.qty), roe = up / p.margin * 100;
    const liq = E.liqOf(st, p, pxOf), ratio = E.ratioOf(st, p, pxOf);
    return {
      val: um(p.qty * px), mark: fp(mk ? mk.p : px),
      liq: `<span class="o">${liq ? fp(liq) : (E.modeOf(p) === "cross" ? "None" : "-")}</span>`,
      ratio: `<span class="${ratio >= 80 ? "r" : ratio >= 50 ? "o" : ""}">${ratio.toFixed(2)}%</span>`,
      pnl: `<b class="${pc(up)}">${sm(up)}</b><span class="two ${pc(roe)}">${sg(roe)}%</span>`,
      cpnl: `<b class="${pc(up)}">${sg(up)}</b>`, croe: `<b class="${pc(roe)}">${sg(roe)}%</b>`,
      mark2: fp(mk ? mk.p : px),
    };
  }
  function posRow(p) {
    const d = posDyn(p), id = p.id;
    return [
      `<b>${esc(base(p.sym))}</b> ${tagSide(p.side, E.modeOf(p), p.lev)}`,
      fq(p.qty), dyn("val:" + id, d.val), fp(p.entry), dyn("mark:" + id, d.mark), dyn("liq:" + id, d.liq),
      um(p.margin), dyn("ratio:" + id, d.ratio), dyn("pnl:" + id, d.pnl), `<span class="${pc(p.rp - p.fee)}">${sm(p.rp - p.fee)}</span>`,
      `<span class="g">TP ${p.tp ? fp(p.tp) : "-"}</span><span class="two r">SL ${p.sl ? fp(p.sl) : "-"}</span><button class="ghost mini" data-act="edit" data-id="${id}">Edit</button>`,
      mdhm(p.t),
      `<div class="acts"><button class="ghost" data-act="close" data-pct="100" data-id="${id}">Market close</button><button class="ghost" data-act="limitclose" data-id="${id}">Limit close</button>
        <span class="pp">${[25, 50, 75, 100].map(x => `<button class="ghost" data-act="close" data-pct="${x}" data-id="${id}">${x}%</button>`).join("")}</span></div>`,
    ];
  }
  // 좁은 화면용 포지션 카드 (거래소 앱 스타일)
  function posCard(p) {
    const d = posDyn(p), id = p.id, b = esc(base(p.sym)), cl = E.modeOf(p) === "cross" ? "Cross" : "Isolated";
    const rp = p.rp - p.fee;
    return `<div class="pcd">
      <div class="h"><b>${b}USDT</b><span class="chip ${p.side}">${sideTxt(p.side)}</span><span class="chip ${p.side}">${p.lev}x</span><span class="chip">${cl}</span><span class="chip">USDT</span></div>
      <div class="pnl"><div><span class="k">Unrealized PnL (USDT)</span>${dyn("cpnl:" + id, d.cpnl)}</div>
        <div class="rt"><span class="k">ROE</span>${dyn("croe:" + id, d.croe)}</div></div>
      <div class="grid">
        <div><span class="k">Size (${b})</span>${fq(p.qty)}</div>
        <div><span class="k">Margin (USDT)</span>${fu(p.margin)}</div>
        <div><span class="k">Margin ratio</span>${dyn("ratio2:" + id, d.ratio)}</div>
        <div><span class="k">Entry price</span>${fp(p.entry)}</div>
        <div><span class="k">Mark price</span>${dyn("mark2:" + id, d.mark)}</div>
        <div><span class="k">Est. liq. price</span>${dyn("liq2:" + id, d.liq)}</div>
      </div>
      <div class="sub2">
        <div><span>Realized PnL (USDT)</span><span class="${pc(rp)}">${sg(rp)}</span></div>
        <div><span>TP/SL</span><span class="ed" data-act="edit" data-id="${id}"><span class="g">${p.tp ? fp(p.tp) : "--"}</span> / <span class="r">${p.sl ? fp(p.sl) : "--"}</span> ✎</span></div>
        <div><span>Opened</span><span>${mdhm(p.t)}</span></div>
      </div>
      <div class="btn3"><button data-act="edit" data-id="${id}">TP/SL</button><button data-act="limitclose" data-id="${id}">Limit close</button><button data-act="closesheet" data-id="${id}">Close</button></div>
    </div>`;
  }
  const POS_HEADS = [{ h: "Symbol", c: "l" }, { h: "Size" }, { h: "Value" }, { h: "Entry price" }, { h: "Mark price" }, { h: "Liq. price" }, { h: "Margin" }, { h: "Margin ratio" },
                     { h: "Unrealized PnL (ROE)" }, { h: "Realized PnL" }, { h: "TP / SL" }, { h: "Opened" }, { h: "Close", c: "full" }];
  function ordRow(o) {
    const cur = S.px[o.sym], val = o.qty * o.price;
    return [`<b>${esc(base(o.sym))}</b> ${tagSide(o.side, E.modeOf(o), o.lev)}`, o.ro ? `Limit close (${o.pct}%)` : "Limit", fp(o.price), fq(o.qty), um(val),
      o.ro ? "-" : um(val / o.lev), dyn("cur:" + o.id, fp(cur)), o.ro ? "-" : `<span class="g">${o.tp ? fp(o.tp) : "-"}</span> / <span class="r">${o.sl ? fp(o.sl) : "-"}</span>`, mdhm(o.t),
      `<button class="ghost mini" data-act="cancel" data-id="${o.id}">Cancel</button>`];
  }
  const ORD_HEADS = [{ h: "Symbol", c: "l" }, { h: "Type" }, { h: "Price" }, { h: "Size" }, { h: "Value" }, { h: "Margin" }, { h: "Last price" }, { h: "TP / SL" }, { h: "Time" }, { h: "", c: "full" }];
  const OL_HEADS = [{ h: "Symbol", c: "l" }, { h: "Type" }, { h: "Price" }, { h: "Size" }, { h: "Value" }, { h: "Status" }, { h: "Time" }];
  const TH_HEADS = [{ h: "Symbol", c: "l" }, { h: "Size" }, { h: "Entry price" }, { h: "Exit price" }, { h: "Exit value" }, { h: "PnL (ROE)" }, { h: "Fee" }, { h: "Reason" }, { h: "Opened" }, { h: "Closed" }];
  const depRow = t => ({ dep: `<b class="g">Admin deposit +${fu(t.amount)} USDT</b> <span class="muted small">${mdhm(t.t)}</span>` });

  let sig = "";
  function tabHtml() {
    const st = S.st;
    if (S.tab === "pos") return st.pos.length ? `<div class="ptable">${tbl(POS_HEADS, st.pos.map(posRow))}</div><div class="pcards">${st.pos.map(posCard).join("")}</div>` : '<div class="empty">No open positions</div>';
    if (S.tab === "ord") return st.ord.length ? tbl(ORD_HEADS, st.ord.map(ordRow)) : '<div class="empty">No open orders</div>';
    if (S.tab === "ol") return st.ol.length ? tbl(OL_HEADS, st.ol.map(o => [`<b>${esc(base(o.sym))}</b> ${tagSide(o.side, E.modeOf(o), o.lev)}`, esc(L(o.kind)), fp(o.price), fq(o.qty), um(o.qty * o.price), `<b>${esc(L(o.status))}</b>`, mdhm(o.t)])) : '<div class="empty">No order history</div>';
    if (S.tab === "th") return st.th.length ? tbl(TH_HEADS, st.th.map(t => t.kind === "deposit" ? depRow(t) : [`<b>${esc(base(t.sym))}</b> ${tagSide(t.side, E.modeOf(t), t.lev)}`, fq(t.qty), fp(t.entry), fp(t.exit), um(t.qty * t.exit),
        `<b class="${pc(t.pnl)}">${sm(t.pnl)}</b><span class="two ${pc(t.roe)}">${sg(t.roe)}%</span>`, um(t.fee), esc(L(t.reason)), t.ot ? mdhm(t.ot) : "-", mdhm(t.t)])) : '<div class="empty">No trade history</div>';
    return "";
  }
  function renderTab() {
    const st = S.st, el = $("tabbody");
    [...$("tabs").children].forEach(b => b.classList.toggle("on", b.dataset.t === S.tab));
    if (S.tab === "adm") { if (!adminRows) loadAdmin(); else renderAdmin(); return; }
    // 구조(포지션 목록·TP/SL 등)가 바뀔 때만 통째로 그리고, 가격으로 바뀌는 칸만 제자리에서 갱신 → 버튼 누르는 중에 사라지지 않음
    const s = S.tab + JSON.stringify([st.pos.map(p => [p.id, p.qty, p.tp, p.sl, p.margin, p.rp]), st.ord.map(o => o.id), st.ol.length, st.th.length, st.th[0] && st.th[0].t, st.ol[0] && st.ol[0].status]);
    if (s !== sig) { sig = s; el.innerHTML = tabHtml(); }
    updateDyn();
  }
  function updateDyn() {
    if (!S.st) return;
    const set = (k, html) => { const n = $("tabbody").querySelector(`[data-k="${k}"]`); if (n && n.innerHTML !== html) n.innerHTML = html; };
    if (S.tab === "pos") for (const p of S.st.pos) { const d = posDyn(p); d.ratio2 = d.ratio; d.liq2 = d.liq; for (const k in d) set(k + ":" + p.id, d[k]); }
    else if (S.tab === "ord") for (const o of S.st.ord) set("cur:" + o.id, fp(S.px[o.sym]));
  }
  function renderAll() { if (!S.st) return; renderHd(); renderTiles(); renderTab(); renderOrderInfo(); }
  $("tabs").onclick = e => { const b = e.target.closest("button"); if (b) { S.tab = b.dataset.t; adminRows = null; adminView = null; sig = ""; renderTab(); } };

  // 표 안의 버튼
  $("tabbody").onclick = e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = +b.dataset.id, act = b.dataset.act, p = S.st.pos.find(x => x.id === id);
    if (act === "close") {
      const pct = +b.dataset.pct;
      if (p && confirm(`Market close ${pct}% of ${base(p.sym)} position?`)) sendAction({ action: "close", id, pct }).catch(() => {});
    } else if (act === "closesheet" && p) {
      modal(`<h2>${esc(base(p.sym))} ${sideTxt(p.side)} · Market close</h2>
        <p class="small muted">Size ${fq(p.qty)} · Last ${fp(S.px[p.sym])}</p>
        <div class="pctgrid" id="mpg">${[25, 50, 75, 100].map(x => `<button class="ghost${x === 100 ? " on" : ""}" data-p="${x}">${x}%</button>`).join("")}</div>`,
        () => sendAction({ action: "close", id, pct: +($("mpg").querySelector(".on") || {}).dataset.p || 100 }), "Close");
      $("mpg").onclick = e => { const x = e.target.closest("button"); if (x) [...$("mpg").children].forEach(y => y.classList.toggle("on", y === x)); };
    } else if (act === "cancel") sendAction({ action: "cancel", id }).catch(() => {});
    else if (act === "limitclose" && p) {
      modal(`<h2>${esc(base(p.sym))} ${sideTxt(p.side)} · Limit close</h2>
        <label><span class="lt">Close price (USDT)</span><input id="mpx" inputmode="decimal" value="${S.px[p.sym] ? S.px[p.sym].toFixed(pdec(S.px[p.sym])) : ""}"></label>
        <label><span class="lt">Close ratio (%)</span><input id="mpct" inputmode="numeric" value="100"></label>
        <p class="small muted">Last ${fp(S.px[p.sym])} · Place ${p.side === "long" ? "above" : "below"} the last price; fills when touched (fee 0.02%). Fills immediately if the price is already better.</p>`,
        () => sendAction({ action: "closeLimit", id, price: num($("mpx").value), pct: num($("mpct").value) }));
    } else if (act === "edit" && p) {
      modal(`<h2>${esc(base(p.sym))} ${sideTxt(p.side)} · TP/SL</h2>
        <label><span class="lt">Take profit (TP)</span><input id="mtp" inputmode="decimal" value="${p.tp ?? ""}" placeholder="Empty = remove"></label>
        <label><span class="lt">Stop loss (SL)</span><input id="msl" inputmode="decimal" value="${p.sl ?? ""}" placeholder="Empty = remove"></label>
        <p class="small muted">Last ${fp(S.px[p.sym])} · Liq. ${fp(E.liqOf(S.st, p, pxOf))}</p>`, () =>
        sendAction({ action: "edit", id, tp: $("mtp").value.trim() || undefined, sl: $("msl").value.trim() || undefined }));
    }
  };
  function modal(html, onOk, okText) {
    const m = $("modal");
    m.innerHTML = `<div class="card">${html}<div class="btns">${onOk ? '<button class="ghost" id="mno">Cancel</button>' : ""}<button id="myes">${okText || "Confirm"}</button></div></div>`;
    m.hidden = false;
    if (onOk) $("mno").onclick = () => { m.hidden = true; };
    $("myes").onclick = async () => { if (!onOk) { m.hidden = true; return; } try { await onOk(); m.hidden = true; } catch (e) {} };
  }
  $("modal").onclick = e => { if (e.target === $("modal")) $("modal").hidden = true; };
  $("reset").onclick = () => { if (confirm("This clears your balance, positions and history and restarts with 10,000 USDT. Continue?")) sendAction({ action: "reset" }).catch(() => {}); };

  // ── 관리자 ───────────────────────────────────────────────────
  let adminRows = null, adminLog = [], adminView = null;     // adminView: 상세 보기 중인 사용자 정보
  const dt = t => t ? mdhm(t) : "-";
  async function loadAdmin() {
    $("tabbody").innerHTML = '<div class="empty">Loading…</div>';
    try { const r = await post("/api/admin", { action: "list" }); adminRows = r.users; adminLog = r.log; renderAdmin(); }
    catch (e) { $("tabbody").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  function renderAdmin() {
    if (adminView) return renderAdminDetail();
    const rows = adminRows.map(u => `<div class="adm"><div class="nm"><b class="lnk" data-adm="detail" data-n="${esc(u.nick)}">${esc(u.nick)}</b>
        ${u.bl ? '<span class="tag short">Blocked</span>' : ""}${u.admin ? '<span class="tag long">Admin</span>' : ""}<br>
        <span class="muted small">Joined ${dt(u.c)} · Last seen ${dt(u.la)}<br>Balance ${ut(u.bal)} · ${u.n} trades · ${u.pos} positions</span></div>
      <b class="${pc(u.ret)}">${sg(u.ret)}%</b>
      <input inputmode="decimal" placeholder="USDT" data-n="${esc(u.nick)}"><button class="mini" data-adm="charge" data-n="${esc(u.nick)}">Deposit</button>
      <button class="ghost mini" data-adm="reset" data-n="${esc(u.nick)}">Reset</button>
      ${u.admin ? "" : `<button class="ghost mini" data-adm="${u.bl ? "unblock" : "block"}" data-n="${esc(u.nick)}">${u.bl ? "Unblock" : "Block"}</button>
      <button class="ghost mini r" data-adm="delete" data-n="${esc(u.nick)}">Delete</button>`}</div>`).join("") || '<div class="empty">No users</div>';
    const log = adminLog.map(l => `<div class="lrow"><span><b>${esc(l.to)}</b> · ${esc(LA(l.act))}</span><span class="m">${mdhm(l.t)} · ${esc(l.by)}</span></div>`).join("") || '<div class="empty">No activity yet</div>';
    $("tabbody").innerHTML = rows + '<h2 style="margin-top:18px">Admin activity (last 50)</h2>' + log;
  }
  function renderAdminDetail() {
    const d = adminView;
    const ord = d.ol.map(o => `<div class="lrow"><span><b>${esc(base(o.sym))}</b> <span class="${o.side === "long" ? "g" : "r"}">${sideTxt(o.side)} ${o.lev}x</span> ${esc(L(o.kind))}</span><span>${fq(o.qty)} @ ${fp(o.price)} · <b>${esc(L(o.status))}</b></span><span class="m">${mdhm(o.t)}</span></div>`).join("") || '<div class="empty">None</div>';
    const th = d.th.map(t => t.kind === "deposit" ? `<div class="lrow"><span><b class="g">Admin deposit +${fu(t.amount)}</b> USDT</span><span class="m">${mdhm(t.t)}</span></div>`
      : `<div class="lrow"><span><b>${esc(base(t.sym))}</b> <span class="${t.side === "long" ? "g" : "r"}">${sideTxt(t.side)} ${t.lev}x</span> · ${esc(L(t.reason))}</span><span class="${pc(t.pnl)}"><b>${sg(t.pnl)} USDT</b> (${sg(t.roe)}%)</span>
        <span class="m">${fq(t.qty)} · ${fp(t.entry)} → ${fp(t.exit)} · ${mdhm(t.t)}</span></div>`).join("") || '<div class="empty">None</div>';
    $("tabbody").innerHTML = `<button class="ghost mini" data-adm="back">← Back</button>
      <h2 style="margin:10px 0 4px">${esc(d.nick)} ${d.bl ? '<span class="tag short">Blocked</span>' : ""}</h2>
      <p class="sub">Joined ${dt(d.c)} · Last seen ${dt(d.la)} · Balance ${ut(d.bal)} · Principal ${ut(d.dep)} · ${d.stats.w}W ${d.stats.n - d.stats.w}L · ${d.pos.length} positions · ${d.ord.length} open orders</p>
      <h2>Recent trades</h2>${th}<h2 style="margin-top:16px">Recent orders</h2>${ord}`;
  }
  $("tabbody").addEventListener("click", async e => {
    const b = e.target.closest("[data-adm]"); if (!b) return;
    const act = b.dataset.adm, nick = b.dataset.n;
    try {
      if (act === "back") { adminView = null; return renderAdmin(); }
      if (act === "detail") { adminView = await post("/api/admin", { action: "detail", nick }); return renderAdmin(); }
      let r;
      if (act === "charge") {
        const amt = num(b.parentElement.querySelector("input").value);
        if (!(amt > 0)) return notify("warn", "Deposit", "Enter an amount");
        if (!confirm(`Deposit ${fu(amt)} USDT to ${nick}?`)) return;
        r = await post("/api/admin", { action: "charge", nick, amount: amt });
      } else if (act === "reset") {
        if (!confirm(`Clear all of ${nick}'s balance, positions and history and reset to 10,000 USDT?`)) return;
        r = await post("/api/admin", { action: "reset", nick });
      } else if (act === "block" || act === "unblock") {
        if (!confirm(`${act === "block" ? "Block" : "Unblock"} ${nick}?`)) return;
        r = await post("/api/admin", { action: act, nick });
      } else if (act === "delete") {
        if (!confirm(`Delete ${nick}'s account? All data will be lost and cannot be undone.`)) return;
        if (!confirm(`Really delete '${nick}'? (final confirmation)`)) return;
        r = await post("/api/admin", { action: "delete", nick });
      } else return;
      notify("ok", "Admin", r.msg);
      adminView = null; loadAdmin();
      if (nick.toLowerCase() === (S.nick || "").toLowerCase()) refresh(true);
    } catch (err) { fail(err); }
  });

  // ── 시작 ─────────────────────────────────────────────────────
  let started = false;
  function start() {
    if (started) return;
    started = true;
    $("login").hidden = true; $("app").hidden = false;
    loadNotes();
    setMode(S.mode); setLev(ls.get(K.lev) || 10); setType("limit");
    setCtab(S.ctab);
    setCollapsed(isMob() ? ls.get(K.collapsedM) !== "0" : ls.get(K.collapsed) === "1");   // 모바일은 기본 접힘
    renderHd(); renderBook(); renderTrades(); renderDot();
    mkt.open(); pub.open(); loadTicker(); loadCoins();
    refresh();
  }
  // 증거금률 경고: 80% 넘으면 한 번 알리고, 60% 아래로 내려가면 다시 알릴 수 있게 초기화
  function riskCheck() {
    const st = S.st, seen = new Set();
    for (const p of st.pos) {
      const cross = E.modeOf(p) === "cross", key = cross ? "cross" : "p" + p.id;
      if (seen.has(key)) continue; seen.add(key);
      const r = E.ratioOf(st, p, pxOf);
      if (r >= 80 && !S.warned[key]) { S.warned[key] = true; notify("warn", "Liquidation risk", `${cross ? "Cross account" : base(p.sym) + " " + sideTxt(p.side)} margin ratio ${r.toFixed(1)}% (liquidated at 100%)`); }
      else if (r < 60) delete S.warned[key];
    }
    for (const k of Object.keys(S.warned)) if (!seen.has(k)) delete S.warned[k];
  }
  // 1초마다: 연결 확인·상태 점 / 미실현 손익·청산가·총자산 갱신 / 증거금률 경고 / 가격이 TP·SL·청산·지정가를 넘었으면 서버 확인 요청
  setInterval(() => {
    if ($("app").hidden) return;
    mkt.watch(); pub.watch(); renderDot(); renderHd();
    if (!S.st) return;
    renderTiles(); updateDyn(); renderOrderInfo(); riskCheck();
    const now = Date.now();
    if (now - S.lastSync > 20e3 && now - S.lastCross > 20e3) {
      const hit = S.st.pos.some(p => { const x = S.px[p.sym]; if (!x) return false; const L = p.side === "long", lq = E.modeOf(p) === "cross" ? null : p.liq;
          return L ? ((lq && x <= lq) || (p.sl && x <= p.sl) || (p.tp && x >= p.tp)) : ((lq && x >= lq) || (p.sl && x >= p.sl) || (p.tp && x <= p.tp)); })
        || S.st.ord.some(o => { const x = S.px[o.sym]; return x && (o.side === "long" ? (o.ro ? x >= o.price : x <= o.price) : (o.ro ? x <= o.price : x >= o.price)); });
      if (hit) { S.lastCross = now; refresh(true); }
    }
  }, 1000);
  setInterval(() => { if (!document.hidden && hasOpen() && Date.now() - S.lastSync > 55e3) refresh(true); }, 30e3);      // 열어두면 1분마다 서버 확인
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !started) return;
    mkt.watch(); pub.watch(); loadTicker();                                   // 탭이 잠들었다 돌아오면 연결부터 확인
    if (S.token && Date.now() - S.lastSync > 30e3) refresh(true);
  });

  if (S.token) start(); else $("login").hidden = false;
})();
