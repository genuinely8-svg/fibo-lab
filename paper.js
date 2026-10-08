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

  let adminView = null;                                     // 관리자: 상세 보기 중인 사용자 정보 (실시간 포지션)
  const S = { token: ls.get(K.token), nick: ls.get(K.nick), admin: false, st: null, sym: ls.get(K.sym) || "BTCUSDT", iv: "15m", ctab: ls.get(K.ctab) === "mine" ? "mine" : "tv",
              otype: ls.get("paper-otype-v1") === "limit" ? "limit" : "market", mode: ls.get(K.mode) === "cross" ? "cross" : "isolated", tab: "pos", px: {}, t24: {}, mark: {}, book: null, trades: [], coins: [],
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
      // 체결음: "띵-동" 두 음 차임 (종소리처럼 배음을 섞고 길게 울리며 사라짐)
      //   ding: 체결·포지션 오픈/종료 (높은 음 → 낮은 음), warn: 경고 (같은 음 두 번), bad: 청산·실패 (낮은 두 음)
      const seq = kind === "ding" ? [[1318.5, 0, .55, .16], [1046.5, .16, .9, .16]]
        : kind === "ok" ? [[1174.7, 0, .35, .1]]
        : kind === "warn" ? [[880, 0, .25, .12], [880, .2, .3, .12]]
        : [[392, 0, .35, .15], [311.1, .22, .5, .15]];
      for (const [f, at, d, vol] of seq) {
        const t0 = actx.currentTime + at, out = actx.createGain();
        out.gain.setValueAtTime(.0001, t0); out.gain.exponentialRampToValueAtTime(vol, t0 + .006); out.gain.exponentialRampToValueAtTime(.0001, t0 + d);
        out.connect(actx.destination);
        for (const [mul, amp] of [[1, 1], [2, .28], [3, .08]]) {            // 기본음 + 배음 → 종소리 느낌
          const o = actx.createOscillator(), g = actx.createGain();
          o.type = "sine"; o.frequency.value = f * mul; g.gain.value = amp;
          o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + d + .05);
        }
      }
    } catch (e) {}
  }
  // 아이폰은 화면을 한 번 눌러야 소리를 낼 수 있어서, 첫 터치 때 소리 장치를 미리 깨워둠
  const unlockAudio = () => {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      const b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
    } catch (e) {}
    removeEventListener("pointerdown", unlockAudio); removeEventListener("keydown", unlockAudio);
  };
  addEventListener("pointerdown", unlockAudio); addEventListener("keydown", unlockAudio);
  // kind: ok(초록) | warn(주황) | bad(빨강, 청산·실패)
  function notify(kind, title, text, quiet, snd) {
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
    beep(snd || kind);
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
  $("snd").onclick = () => { S.sound = !S.sound; ls.set(K.sound, S.sound ? "1" : "0"); renderBell(); if (S.sound) beep("ding"); };
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
        if (!(await ask(`'${nick}' is a new nickname.\nCreate a new account with this nickname and PIN?`, "Create"))) return;
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
  const EV_TITLE = { fill: ["ok", "Limit filled · Position opened"], tp: ["ok", "Take-profit triggered"], sl: ["warn", "Stop-loss triggered"], liq: ["bad", "Liquidated"], rclose: ["ok", "Limit close filled"], trail: ["ok", "Trailing stop triggered"] };
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
    for (const e of events) notify(EV_TITLE[e.type][0], EV_TITLE[e.type][1], evText(e), false, ["fill", "tp", "rclose", "trail"].includes(e.type) ? "ding" : undefined);
  }
  function handleInfo(i) {
    if (!i) return;
    if (i.kind === "order") {
      const t = `${base(i.sym)} ${modeTxt(i.mode)} ${sideTxt(i.side)} ${i.lev}x · ${fq(i.qty)} @ ${fp(i.price)}`;
      if (i.filled) notify("ok", i.merged ? "Added to position" : "Position opened", t, false, "ding"); else notify("ok", "Order placed", "Limit · " + t);
    } else if (i.kind === "cancel") notify("ok", "Order cancelled", "Open order cancelled");
    else if (i.kind === "close") notify(i.pnl >= 0 ? "ok" : "warn", i.pct >= 100 ? "Position closed" : `Partial close ${i.pct}%`, `${base(i.sym)} ${sideTxt(i.side)} @ ${fp(i.price)} · PnL ${sg(i.pnl)} USDT`, false, "ding");
    else if (i.kind === "closeLimit") notify("ok", "Limit close order placed", `${base(i.sym)} ${i.pct}% @ ${fp(i.price)}`);
    else if (i.kind === "edit") notify("ok", "TP/SL updated", base(i.sym));
    else if (i.kind === "ptpAdd") notify("ok", "Partial TP/SL added", base(i.sym));
    else if (i.kind === "ptpDel") notify("ok", "Partial TP/SL cancelled", base(i.sym));
    else if (i.kind === "trailSet") notify("ok", "Trailing TP/SL set", base(i.sym));
    else if (i.kind === "trailDel") notify("ok", "Trailing TP/SL cancelled", base(i.sym));
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
    if (adminView) for (const x of adminView.pos.concat(adminView.ord)) if (x.sym !== S.sym) set.add(x.sym.toLowerCase() + "@miniTicker");   // 관리자: 보고 있는 사용자의 코인
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
          const k = d.k, kt = Math.floor(k.t / 1000) + KST; series.update({ time: kt, open: +k.o, high: +k.h, low: +k.l, close: +k.c }); if (barTimes && !barTimes.has(kt)) { barTimes.add(kt); drawMarks(); }
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
  // 코인 목록 (Crypto: 시총 100위 안 코인) + 토큰화 주식·원자재 등 (Stocks · RWA: 바이낸스 선물이 코인이 아니라고 분류한 상품, 모의투자 탭에서만)
  const RWA_LABEL = { EQUITY: "US stock", KR_EQUITY: "KR stock", HK_EQUITY: "HK stock", CN_EQUITY: "CN stock", PREMARKET: "Pre-IPO", COMMODITY: "Commodity",
                      COMMODITY_TOKEN: "Gold/silver token", INDEX: "Index", ETF: "ETF", FX: "FX" };
  S.ptab = ls.get("paper-ptab-v1") === "rwa" ? "rwa" : "crypto";
  async function loadCoins() {
    try {
      const [arr] = await Promise.all([fetch("https://fapi.binance.com/fapi/v1/ticker/24hr").then(r => r.json()), CoinMeta.load().catch(() => {})]);
      const dayAgo = Date.now() - 86400e3;
      const all = arr.filter(x => /^[A-Z0-9]+USDT$/.test(x.symbol) && +x.closeTime > dayAgo).map(x => ({ sym: x.symbol, b: base(x.symbol), last: +x.lastPrice, chg: +x.priceChangePercent, vol: +x.quoteVolume }));
      let list = all.filter(x => CoinMeta.isCrypto(x.sym.replace(/USDT$/, "")) && !STABLES.has(x.b));
      if (CoinMeta.hasTop()) { list = list.filter(x => CoinMeta.rank(x.b) && CoinMeta.rank(x.b) <= 100).sort((a, b) => CoinMeta.rank(a.b) - CoinMeta.rank(b.b)); }
      else { list = list.sort((a, b) => b.vol - a.vol).slice(0, 100); }   // 코인게코가 막혔을 때: 거래대금 상위 100
      S.coins = list;
      S.rwa = all.filter(x => !CoinMeta.isCrypto(x.sym.replace(/USDT$/, ""))).map(x => ({ ...x, ty: CoinMeta.type(x.sym.replace(/USDT$/, "")) })).sort((a, b) => b.vol - a.vol);
      for (const c of list.concat(S.rwa)) if (!S.px[c.sym]) S.px[c.sym] = c.last;      // 처음 한 번만 채움 (실시간 값을 덮어쓰지 않음)
      renderPicker();
    } catch (e) { $("plist").innerHTML = '<div class="muted">Could not load coin list</div>'; }
  }
  function setPtab(t) {
    S.ptab = t === "rwa" ? "rwa" : "crypto"; ls.set("paper-ptab-v1", S.ptab);
    [...$("ptabs").children].forEach(b => b.classList.toggle("on", b.dataset.p === S.ptab));
    $("psearch").placeholder = S.ptab === "rwa" ? "Search stocks · RWA (Binance Futures)" : "Search coins (top 100)";
    renderPicker();
  }
  $("ptabs").onclick = e => { const b = e.target.closest("button"); if (b) setPtab(b.dataset.p); };
  CoinMeta.load().then(() => renderHd()).catch(() => {});        // 처음 열 때 로고(코인게코) 받아서 위쪽 코인 버튼에 표시
  const logoImg = b => CoinMeta.logo(b) ? `<img src="${esc(CoinMeta.logo(b))}" alt="" onerror="this.outerHTML='<span class=ph></span>'">` : `<span class="ph"></span>`;
  function renderPicker() {
    const q = $("psearch").value.trim().toUpperCase();
    const src = S.ptab === "rwa" ? (S.rwa || []) : S.coins;
    const rows = src.filter(c => !q || c.b.includes(q) || (CoinMeta.ko(c.b) || "").includes(q)).map(c =>
      `<div data-s="${c.sym}">${logoImg(c.b)}<span class="s">${esc(c.b)} <span class="n">${esc(c.ty ? (RWA_LABEL[c.ty] || c.ty) : (CoinMeta.ko(c.b) || ""))}</span></span><span>${fp(c.last)}</span><span class="${pc(c.chg)}">${sg(c.chg)}%</span></div>`);
    $("plist").innerHTML = rows.join("") || `<div class="muted">${S.ptab === "rwa" && !S.rwa ? "Loading…" : "No results"}</div>`;
  }
  $("coinbtn").onclick = e => { e.stopPropagation(); const p = $("picker"); p.hidden = !p.hidden; if (!p.hidden) { $("psearch").value = ""; setPtab(S.ptab); loadCoins(); $("psearch").focus(); } };
  $("psearch").oninput = renderPicker;
  $("picker").onclick = e => e.stopPropagation();
  $("plist").onclick = e => { const d = e.target.closest("[data-s]"); if (d) setSym(d.dataset.s); };
  document.addEventListener("click", () => { $("picker").hidden = true; });

  // 어느 화면에서든 코인 이름(data-sym)을 누르면 그 코인 차트로 바꾸고 차트로 이동
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-sym]");
    if (!el) return;
    const sym = String(el.dataset.sym || "").toUpperCase();
    if (!/^[A-Z0-9]{2,20}USDT$/.test(sym)) return;
    e.preventDefault(); e.stopPropagation();
    if (S.sym !== sym) setSym(sym);
    const cb = $("chartbox"); if (cb) cb.scrollIntoView({ behavior: "smooth", block: "start" });
  }, true);
  function setSym(sym) {
    $("picker").hidden = true;
    S.sym = sym; ls.set(K.sym, sym); lastMid = 0; midDir = "";
    S.book = null; S.trades = []; renderBook(); renderTrades();
    $("oprice").value = ""; $("qty").value = ""; $("pct").value = 0; S.mktManual = false; $("oprice").classList.toggle("mkt", S.otype === "market"); showMktPrice();
    renderHd(); subscribe(); loadTicker(); renderTV(); loadChart(); renderOrderInfo();
  }

  // ── 상단 시세 ────────────────────────────────────────────────
  let lastPx = 0;
  function renderHd() {
    showMktPrice();
    const b = base(S.sym), p = S.px[S.sym], t = S.t24[S.sym], m = S.mark[S.sym];
    const ck = S.sym + (CoinMeta.logo(b) ? "|logo" : "");          // 로고 정보가 늦게 도착해도 다시 그림
    if ($("coinbtn").dataset.k !== ck) { $("coinbtn").innerHTML = `${logoImg(b)}<span>${esc(b)}<small> USDT Perp</small></span> ▾`; $("coinbtn").dataset.k = ck; }
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
  let lastMid = 0, midDir = "", bookN = 8;
  // 폰: 왼쪽 주문 패널 높이에 맞춰 호가 줄 수를 정함 (실제 줄 높이를 재서, 6~20줄)
  function fitBook() {
    if (!isMob() || !S.book) return;
    const box = $("bookbox"), ob = document.querySelector(".orderbox"), row = $("book").querySelector(".brow");
    if (!row || $("book").offsetParent === null) return;
    const rh = row.offsetHeight, rows = $("book").querySelectorAll(".brow").length;
    const book = $("book"), used = (book.offsetTop - box.offsetTop) + book.offsetHeight - rows * rh + 8;   // 줄을 뺀 나머지 (탭·제목·가운데 가격·여백)
    const n = Math.max(6, Math.min(20, Math.floor((ob.offsetHeight - used - 4) / rh / 2)));
    if (n !== bookN) { bookN = n; renderBook(); }
  }
  addEventListener("resize", () => setTimeout(fitBook, 50));
  function renderBook() {
    const el = $("book");
    if (!S.book) { el.innerHTML = '<div class="muted small" style="padding:10px">Loading…</div>'; return; }
    const N = isMob() ? bookN : 10;
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
    if (isMob() && !fitting) { fitting = true; requestAnimationFrame(() => { fitting = false; fitBook(); }); }
  }
  let fitting = false;
  $("book").onclick = e => { const r = e.target.closest("[data-p]"); if (r) { $("oprice").value = r.dataset.p; if (S.otype === "market") { S.mktManual = true; $("oprice").classList.remove("mkt"); } renderOrderInfo(); } };   // 호가를 누르면 지금 주문 방식 그대로 가격만 넣음
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
    series.setData([]); barTimes = null;
    try {
      const rows = await (await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${iv}&limit=500`)).json();
      if (id !== loadId) return;
      const data = rows.map(r => ({ time: Math.floor(r[0] / 1000) + KST, open: +r[1], high: +r[2], low: +r[3], close: +r[4] }));
      series.setData(data);
      barTimes = new Set(data.map(d => d.time));
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
      for (const o of p.pt || []) { add(o.tp, "#22b573", "Partial TP", 3); add(o.sl, "#ef4b5f", "Partial SL", 3); }
      add(E.trailStop(p), "#f59e0b", "Trailing", 3);
    }
    for (const o of S.st.ord) if (o.sym === S.sym) add(o.price, "#5b93f0", `${o.ro ? "Close" : sideTxt(o.side)} order`, 1);
    drawMarks();
  }
  // 차트에 내 매매 표시: 진입(▲ 롱 / ▼ 숏)과 청산(●) — 지금 포지션과 지난 매매 기록 (이 코인만, 화면에 있는 기간만)
  let barTimes = null;
  function drawMarks() {
    if (!series || !S.st) return;
    const ivMs = ({ m: 60e3, h: 3600e3, d: 86400e3 })[S.iv.slice(-1)] * parseInt(S.iv, 10);
    const bt = ms => Math.floor(ms / ivMs) * ivMs / 1000 + KST;
    const ok = t => barTimes && barTimes.has(t);
    const mk = [], seen = new Set();
    const entry = (t, side, price, now) => {
      const k = t + side + price; if (seen.has(k)) return; seen.add(k);
      const time = bt(t); if (!ok(time)) return;
      const L = side === "long";
      mk.push({ time, position: L ? "belowBar" : "aboveBar", shape: L ? "arrowUp" : "arrowDown", color: L ? "#22b573" : "#ef4b5f",
                text: `${now ? "▶ " : ""}${sideTxt(side)} ${fp(price)}` });
    };
    for (const p of S.st.pos) if (p.sym === S.sym) entry(p.t, p.side, p.entry, true);
    for (const t of S.st.th) {
      if (t.sym !== S.sym || t.kind === "deposit") continue;
      if (t.ot) entry(t.ot, t.side, t.entry);
      const time = bt(t.t); if (!ok(time)) continue;
      mk.push({ time, position: t.side === "long" ? "aboveBar" : "belowBar", shape: "circle", color: t.pnl >= 0 ? "#22b573" : "#ef4b5f",
                text: `${L(t.reason).replace(/ \(partial.*\)/, "")} ${fp(t.exit)} (${sg(t.pnl)})` });
    }
    mk.sort((a, b) => a.time - b.time);
    try { series.setMarkers(mk); } catch (e) {}
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
  const refPrice = () => num($("oprice").value) > 0 ? num($("oprice").value) : S.px[S.sym];   // 시장가도 입력한 가격이 있으면 그 가격으로 계산
  const rateNow = () => S.otype === "limit" ? E.FEE_MAKER : E.FEE_TAKER;
  const avail = () => S.st ? E.available(S.st) : 0;
  const stepOf = p => { const e = Math.ceil(Math.log10(p)); return { step: Math.pow(10, -e), dec: Math.max(0, e) }; };
  function maxQty() {
    const p = refPrice(); if (!p) return 0;
    const { step, dec } = stepOf(p), q = Math.floor(avail() / (p * (1 / lev() + rateNow())) / step) * step;
    return +q.toFixed(dec);
  }
  function setType(t) {
    const was = S.otype;
    S.otype = t; ls.set("paper-otype-v1", t);
    [...$("otype").children].forEach(b => b.classList.toggle("on", b.dataset.t === t));
    const mkt = t === "market";
    $("oprice").classList.toggle("mkt", mkt && !S.mktManual);
    $("prow").querySelector(".lt").textContent = mkt ? "Price (USDT) · Market" : "Price (USDT)";
    if (mkt && was !== "market") { S.mktManual = false; showMktPrice(); }
    else if (!mkt && was === "market" && !S.mktManual) $("oprice").value = S.px[S.sym] ? S.px[S.sym].toFixed(pdec(S.px[S.sym])) : "";
    renderOrderInfo();
  }
  // 시장가: 직접 입력하거나 호가를 누르기 전까지는 가격 칸에 지금 가격을 실시간으로 (입력한 가격은 수량·비용·청산가 계산에 쓰고, 체결은 주문 순간 시장가)
  function showMktPrice() {
    if (S.otype !== "market" || S.mktManual) return;
    const p = S.px[S.sym];
    $("oprice").value = p ? p.toFixed(pdec(p)) : "";
  }
  $("oprice").addEventListener("input", () => { if (S.otype === "market") { S.mktManual = $("oprice").value.trim() !== ""; $("oprice").classList.toggle("mkt", !S.mktManual); } });
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
  $("usecur").onclick = () => { if (S.px[S.sym]) { $("oprice").value = S.px[S.sym].toFixed(pdec(S.px[S.sym])); if (S.otype === "market") { S.mktManual = false; $("oprice").classList.add("mkt"); } renderOrderInfo(); } };   // 시장가에서 Last = 다시 실시간 가격 따라가기
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
    // TP/SL 예상 손익: 롱으로 열 때 / 숏으로 열 때 둘 다 (수수료 포함) — 입력칸 위 말풍선
    const est = (id, kind) => {
      const v = num($(id).value), el = $(id + "Est");
      if (!(v > 0) || !ref) { el.innerHTML = ""; return; }
      if (!(q > 0)) { el.innerHTML = "Enter size to see est. PnL"; return; }
      const fee = q * ref * rateNow() + q * v * (kind === "tp" ? E.FEE_MAKER : E.FEE_TAKER), mg = q * ref / lev();
      const row = (side, lbl) => { const pnl = E.pnlOf(side, ref, v, q) - fee, roe = pnl / mg * 100;
        return `<div><span class="${side === "long" ? "bl" : "sh"}">${lbl}</span> ≈ <span class="${pnl >= 0 ? "up" : "dn"}">${sg(pnl)} USDT (${sg(roe)}%)</span></div>`; };
      el.innerHTML = row("long", "Long") + row("short", "Short");
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
  $("tpon").onchange = () => { $("tpbox").hidden = !$("tpon").checked; renderBook(); };
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
  // 부분 TP/SL 개수 · 트레일링 요약 (없으면 빈 글자)
  const extraTp = p => [(p.pt && p.pt.length) ? `<span class="two x2">+${p.pt.length} partial</span>` : "", p.trl ? `<span class="two x2 o">Trail ${p.trl.cb}%${p.trl.ext != null ? " ●" : ""}</span>` : ""].join("");
  function posRow(p) {
    const d = posDyn(p), id = p.id;
    return [
      `<b class="cl" data-sym="${p.sym}" title="Open chart">${esc(base(p.sym))}</b> ${tagSide(p.side, E.modeOf(p), p.lev)}`,
      fq(p.qty), dyn("val:" + id, d.val), fp(p.entry), dyn("mark:" + id, d.mark), dyn("liq:" + id, d.liq),
      um(p.margin), dyn("ratio:" + id, d.ratio), dyn("pnl:" + id, d.pnl), `<span class="${pc(p.rp - p.fee)}">${sm(p.rp - p.fee)}</span>`,
      `<span class="g">TP ${p.tp ? fp(p.tp) : "-"}</span><span class="two r">SL ${p.sl ? fp(p.sl) : "-"}</span>${extraTp(p)}<button class="ghost mini" data-act="edit" data-id="${id}">Edit</button>`,
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
      <div class="h"><b class="cl" data-sym="${p.sym}" title="Open chart">${b}USDT</b><span class="chip ${p.side}">${sideTxt(p.side)}</span><span class="chip ${p.side}">${p.lev}x</span><span class="chip">${cl}</span><span class="chip">USDT</span></div>
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
        ${extraTp(p) ? `<div><span>Partial / Trailing</span><span class="ed" data-act="edit" data-id="${id}">${extraTp(p)}</span></div>` : ""}
        <div><span>Opened</span><span>${mdhm(p.t)}</span></div>
      </div>
      <div class="btn3"><button data-act="edit" data-id="${id}">TP/SL</button><button data-act="limitclose" data-id="${id}">Limit close</button><button data-act="closesheet" data-id="${id}">Close</button></div>
    </div>`;
  }
  const POS_HEADS = [{ h: "Symbol", c: "l" }, { h: "Size" }, { h: "Value" }, { h: "Entry price" }, { h: "Mark price" }, { h: "Liq. price" }, { h: "Margin" }, { h: "Margin ratio" },
                     { h: "Unrealized PnL (ROE)" }, { h: "Realized PnL" }, { h: "TP / SL" }, { h: "Opened" }, { h: "Close", c: "full" }];
  function ordRow(o) {
    const cur = S.px[o.sym], val = o.qty * o.price;
    return [`<b class="cl" data-sym="${o.sym}" title="Open chart">${esc(base(o.sym))}</b> ${tagSide(o.side, E.modeOf(o), o.lev)}`, o.ro ? `Limit close (${o.pct}%)` : "Limit", fp(o.price), fq(o.qty), um(val),
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
    if (S.tab === "ol") return st.ol.length ? tbl(OL_HEADS, st.ol.map(o => [`<b class="cl" data-sym="${o.sym}" title="Open chart">${esc(base(o.sym))}</b> ${tagSide(o.side, E.modeOf(o), o.lev)}`, esc(L(o.kind)), fp(o.price), fq(o.qty), um(o.qty * o.price), `<b>${esc(L(o.status))}</b>`, mdhm(o.t)])) : '<div class="empty">No order history</div>';
    if (S.tab === "th") return st.th.length ? tbl(TH_HEADS, st.th.map(t => t.kind === "deposit" ? depRow(t) : [`<b class="cl" data-sym="${t.sym}" title="Open chart">${esc(base(t.sym))}</b> ${tagSide(t.side, E.modeOf(t), t.lev)}`, fq(t.qty), fp(t.entry), fp(t.exit), um(t.qty * t.exit),
        `<b class="${pc(t.pnl)}">${sm(t.pnl)}</b><span class="two ${pc(t.roe)}">${sg(t.roe)}%</span>`, um(t.fee), esc(L(t.reason)), t.ot ? mdhm(t.ot) : "-", mdhm(t.t)])) : '<div class="empty">No trade history</div>';
    return "";
  }
  function renderTab() {
    const st = S.st, el = $("tabbody");
    [...$("tabs").children].forEach(b => b.classList.toggle("on", b.dataset.t === S.tab));
    if (S.tab === "adm") { if (!adminRows) loadAdmin(); else renderAdmin(); return; }
    // 구조(포지션 목록·TP/SL 등)가 바뀔 때만 통째로 그리고, 가격으로 바뀌는 칸만 제자리에서 갱신 → 버튼 누르는 중에 사라지지 않음
    const s = S.tab + JSON.stringify([st.pos.map(p => [p.id, p.qty, p.tp, p.sl, p.margin, p.rp, p.pt, p.trl]), st.ord.map(o => o.id), st.ol.length, st.th.length, st.th[0] && st.th[0].t, st.ol[0] && st.ol[0].status]);
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
      if (p) ask(`Market close ${pct}% of ${base(p.sym)} position?`, "Close").then(ok => { if (ok) sendAction({ action: "close", id, pct }).catch(() => {}); });
    } else if (act === "closesheet" && p) closeSheet(p);
    else if (act === "cancel") sendAction({ action: "cancel", id }).catch(() => {});
    else if (act === "limitclose" && p) {
      modal(`<h2>${esc(base(p.sym))} ${sideTxt(p.side)} · Limit close</h2>
        <label><span class="lt">Close price (USDT)</span><input id="mpx" inputmode="decimal" value="${S.px[p.sym] ? S.px[p.sym].toFixed(pdec(S.px[p.sym])) : ""}"></label>
        <label><span class="lt">Close ratio (%)</span><input id="mpct" inputmode="numeric" value="100"></label>
        <p class="small muted">Last ${fp(S.px[p.sym])} · Place ${p.side === "long" ? "above" : "below"} the last price; fills when touched (fee 0.02%). Fills immediately if the price is already better.</p>`,
        () => sendAction({ action: "closeLimit", id, price: num($("mpx").value), pct: num($("mpct").value) }));
    } else if (act === "edit" && p) tpslSheet(p);
  };
  // ── TP/SL 시트 (비트겟 스타일: 전체 포지션 / 부분 포지션(분할 익절) / 트레일링) ──
  //   가격을 넣으면 ROI(증거금 대비 수익률)가, ROI를 넣으면 가격이 자동으로 계산돼요
  //   ROI = 그 가격에서 정리했을 때 손익 ÷ 증거금 × 100 (수수료 제외, 비트겟과 같은 방식)
  let tpTab = "all";
  function tpslSheet(p0, tab) {
    const m = $("modal"), id = p0.id, b = esc(base(p0.sym)), cl = E.modeOf(p0) === "cross" ? "Cross" : "Isolated";
    if (tab) tpTab = tab;
    const P = () => S.st.pos.find(x => x.id === id);
    const long = p0.side === "long", dir = long ? 1 : -1;
    const dec = Math.max(pdec(p0.entry), stepOf(p0.entry).dec), qdec = Math.max(stepOf(p0.entry).dec, (String(p0.qty).split(".")[1] || "").length);
    const rnd = v => String(+v.toFixed(dec));
    // ROI(%) ↔ 가격. 증거금 = 포지션 증거금 (수량 비율만큼)
    const roiOf = (p, px) => E.pnlOf(p.side, p.entry, px, p.qty) / p.margin * 100;
    const pxOf2 = (p, roi) => p.entry + dir * roi / 100 * p.margin / p.qty;
    const tabs = [["all", "Entire position"], ["part", "Partial position"], ["trail", "Trailing TP/SL"]];
    const pfield = (k, lbl, cls, v) => `<div class="tpk"><span class="${cls}">${lbl}</span><small class="lastt">Last</small></div>
      <div class="prow tpr"><span class="pin"><input id="${k}px" inputmode="decimal" placeholder="Trigger price" value="${v != null ? rnd(v) : ""}"><small>USDT</small></span>
        <span class="pin roi"><input id="${k}roi" inputmode="decimal" placeholder="ROI"><small>%</small></span></div>
      <div class="dots sl5" data-k="${k}"><input id="${k}rng" type="range" min="0" max="${k.endsWith("sl") ? 100 : 200}" step="1" value="0"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="dl">${(k.endsWith("sl") ? [0, 25, 50, 75, 100] : [0, 50, 100, 150, 200]).map(x => `<span>${x}%</span>`).join("")}</div>
      <div class="kv"><span>Est. PnL</span><b id="${k}est">-</b></div>`;
    const qfield = (k, pct) => `<label class="qbox"><span class="lt">Quantity (${b})</span><input id="${k}q" inputmode="decimal"></label>
      <div class="dots"><input id="${k}qr" type="range" min="1" max="100" step="1" value="${pct}"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="dl"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>`;
    const draw = () => {
      const p = P(); if (!p) { m.hidden = true; return; }
      let body = "";
      if (tpTab === "all") {
        body = pfield("tp", "Take profit", "g", p.tp) + `<div class="gap"></div>` + pfield("sl", "Stop loss", "r", p.sl)
          + `<p class="small muted">Closes the <b>entire position</b> when the last price reaches the trigger. Leave empty to remove.</p>
             <button id="tok" class="confirm">Confirm</button>`;
      } else if (tpTab === "part") {
        const list = (p.pt || []).map(o => `<div class="ptl"><span><span class="g">TP ${o.tp ? fp(o.tp) : "--"}</span> / <span class="r">SL ${o.sl ? fp(o.sl) : "--"}</span></span>
            <span class="muted">${fq(o.qty)} ${b}</span><button class="ghost mini" data-del="${o.id}">Cancel</button></div>`).join("");
        body = pfield("ptp", "Take profit", "g") + `<div class="gap"></div>` + pfield("psl", "Stop loss", "r") + `<div class="gap"></div>` + qfield("p", 50)
          + `<p class="small muted">Closes only this quantity at the trigger. Whichever of TP / SL hits first runs and the other is cancelled. Add several for scale-out take-profits.</p>
             <button id="tok" class="confirm">Add partial TP/SL</button>`
          + (list ? `<h3 class="pth">Partial orders (${p.pt.length})</h3>${list}` : "");
      } else {
        const tr = p.trl;
        body = `<div class="tpk"><span>Callback rate</span></div>
          <div class="prow tpr"><span class="pin"><input id="tcb" inputmode="decimal" value="${tr ? tr.cb : 1}"><small>%</small></span></div>
          <div class="chips5">${[0.5, 1, 2, 3, 5].map(x => `<button class="ghost" data-cb="${x}">${x}%</button>`).join("")}</div>
          <div class="tpk"><span>Activation price <small class="muted">(optional)</small></span><small class="lastt">Last</small></div>
          <div class="prow tpr"><span class="pin"><input id="tact" inputmode="decimal" placeholder="Empty = start now" value="${tr && tr.act ? rnd(tr.act) : ""}"><small>USDT</small></span>
            <span class="pin roi"><input id="tactroi" inputmode="decimal" placeholder="ROI"><small>%</small></span></div>
          <div class="gap"></div>` + qfield("t", tr ? tr.pct || 100 : 100)
          + `<div class="kv"><span>Trigger price now</span><b id="tnow">-</b></div>
             <p class="small muted">After the price reaches the activation price (or right away if empty), the best price is tracked. When the price moves back by the callback rate from that best price, the quantity is closed at market (fee 0.05%).</p>
             <button id="tok" class="confirm">${tr ? "Update trailing" : "Set trailing"}</button>`
          + (tr ? `<h3 class="pth">Active trailing</h3><div class="ptl"><span>${tr.cb}% callback · ${tr.ext != null ? `<span class="g">Running</span> · best ${fp(tr.ext)}` : `Waits for ${fp(tr.act)}`}</span>
               <span class="muted">${tr.qty == null ? "100%" : fq(tr.qty) + " " + b}</span><button class="ghost mini" data-deltr="1">Cancel</button></div>` : "");
      }
      m.className = "sheet";
      m.innerHTML = `<div class="card tpss">
        <div class="shh"><h2>TP/SL</h2><button class="ghost x" id="cx" aria-label="Close">✕</button></div>
        <div class="h2l"><b>${b}USDT</b><span class="chip ${p.side}">${sideTxt(p.side)}</span><span class="chip ${p.side}">${p.lev}x</span><span class="chip">${cl}</span></div>
        <div class="ttabs">${tabs.map(([k, t]) => `<button data-tt="${k}" class="${k === tpTab ? "on" : ""}">${t}</button>`).join("")}</div>
        <div class="kv"><span>Entry price</span><b>${fp(p.entry)} USDT</b></div>
        <div class="kv"><span>Last price</span><b id="tlast">-</b></div>
        <div class="kv"><span>Est. liq. price</span><b class="o">${fp(E.liqOf(S.st, p, pxOf))}</b></div>
        <div class="kv"><span>Size</span><b>${fq(p.qty)} ${b}</b></div>
        ${body}</div>`;
      m.hidden = false;
      wire(p);
    };
    function wire(p) {
      $("cx").onclick = () => { m.hidden = true; };
      m.querySelectorAll("[data-tt]").forEach(x => x.onclick = () => { tpTab = x.dataset.tt; draw(); });
      const setR = (el, v) => { el.value = v; el.style.setProperty("--v", (v - el.min) / (el.max - el.min) * 100 + "%"); };
      const qtyOf = k => { const q = num($(k + "q").value); return q > 0 ? Math.min(q, p.qty) : 0; };
      // 가격 칸 하나(+ROI 칸 + 슬라이더) 묶기. sign: 익절 +1, 손절 -1
      const pair = (k, sign, qf) => {
        const px = $(k + "px"), roi = $(k + "roi"), rng = $(k + "rng");
        if (!px) return;
        const est = () => {
          const v = num(px.value), q = qf ? qf() : p.qty;
          if (!(v > 0) || !(q > 0)) { $(k + "est").textContent = "-"; return; }
          const g = E.pnlOf(p.side, p.entry, v, q);
          $(k + "est").innerHTML = `<span class="${pc(g)}">${sg(g)} USDT</span>`;
        };
        const fromPx = () => { const v = num(px.value); if (v > 0) { const r = roiOf(p, v); roi.value = (+r.toFixed(2)).toString(); setR(rng, Math.max(0, Math.min(+rng.max, Math.round(r * sign)))); } else { roi.value = ""; setR(rng, 0); } est(); };
        const fromRoi = r => { if (isFinite(r)) { const v = pxOf2(p, r); px.value = v > 0 ? rnd(v) : ""; } else px.value = ""; est(); };
        px.oninput = fromPx;
        roi.oninput = () => { const r = num(roi.value); if (isFinite(r)) { fromRoi(sign * Math.abs(r)); setR(rng, Math.min(+rng.max, Math.abs(r))); } else { px.value = ""; est(); } };
        roi.onblur = () => { const r = num(roi.value); if (isFinite(r)) roi.value = (sign * Math.abs(r)).toString(); };
        rng.oninput = () => { const r = +rng.value; setR(rng, r); if (r === 0) { px.value = roi.value = ""; est(); return; } roi.value = String(sign * r); fromRoi(sign * r); };
        fromPx();
        pair.est = pair.est || []; pair.est.push(est);
      };
      const qpair = k => {
        const q = $(k + "q"), qr = $(k + "qr"), upd = () => (pair.est || []).forEach(f => f());
        const fromPct = v => { setR(qr, v); q.value = v >= 100 ? String(p.qty) : String(+(p.qty * v / 100).toFixed(qdec)); upd(); };
        qr.oninput = () => fromPct(+qr.value);
        q.oninput = () => { const v = Math.max(1, Math.min(100, Math.round((num(q.value) || 0) / p.qty * 100))); setR(qr, v); upd(); };
        fromPct(+qr.value);
      };
      pair.est = [];
      const busy = async (fn) => { const bt = $("tok"); bt.disabled = true; try { await fn(); } catch (e) {} finally { const b2 = $("tok"); if (b2) b2.disabled = false; } };
      if (tpTab === "all") {
        pair("tp", 1); pair("sl", -1);
        $("tok").onclick = () => busy(async () => {
          await sendAction({ action: "edit", id, tp: $("tppx").value.trim() || undefined, sl: $("slpx").value.trim() || undefined });
          m.hidden = true;
        });
      } else if (tpTab === "part") {
        pair("ptp", 1, () => qtyOf("p")); pair("psl", -1, () => qtyOf("p")); qpair("p");
        $("tok").onclick = () => busy(async () => {
          const tp = $("ptppx").value.trim(), sl = $("pslpx").value.trim(), q = qtyOf("p");
          if (!tp && !sl) return notify("warn", "Partial TP/SL", "Enter a take-profit or stop-loss price");
          if (!(q > 0)) return notify("warn", "Partial TP/SL", "Enter a quantity");
          await sendAction({ action: "ptpAdd", id, tp: tp || undefined, sl: sl || undefined, qty: q });
          draw();
        });
        m.querySelectorAll("[data-del]").forEach(x => x.onclick = async () => { try { await sendAction({ action: "ptpDel", id, oid: +x.dataset.del }); draw(); } catch (e) {} });
      } else {
        qpair("t");
        const actRoi = $("tactroi"), act = $("tact");
        act.oninput = () => { const v = num(act.value); actRoi.value = v > 0 ? (+roiOf(p, v).toFixed(2)).toString() : ""; nowTrig(); };
        actRoi.oninput = () => { const r = num(actRoi.value); act.value = isFinite(r) ? rnd(pxOf2(p, r)) : ""; nowTrig(); };
        m.querySelectorAll("[data-cb]").forEach(x => x.onclick = () => { $("tcb").value = x.dataset.cb; nowTrig(); });
        $("tcb").oninput = () => nowTrig();
        act.oninput();
        $("tok").onclick = () => busy(async () => {
          const pct = +$("tqr").value;
          await sendAction({ action: "trailSet", id, cb: num($("tcb").value), act: act.value.trim() || undefined, pct });
          draw();
        });
        const d = m.querySelector("[data-deltr]");
        if (d) d.onclick = async () => { try { await sendAction({ action: "trailDel", id }); draw(); } catch (e) {} };
      }
    }
    // 트레일링: 지금 작동한다면 어디서 정리되나 (작동 중이면 실제 값)
    function nowTrig() {
      const el = $("tnow"), p = P(); if (!el || !p) return;
      const cb = num($("tcb").value), act = num($("tact").value), last = S.px[p.sym];
      const run = E.trailStop(p);
      if (run != null && p.trl && p.trl.cb === cb) { el.innerHTML = `<span class="o">${fp(run)}</span> <small class="muted">(running)</small>`; return; }
      const best = act > 0 ? act : last;
      if (!(cb > 0) || !best) { el.textContent = "-"; return; }
      el.textContent = fp(best * (1 - dir * cb / 100)) + (act > 0 ? " (after activation)" : "");
    }
    draw();
    const tick = setInterval(() => {
      if (m.hidden || !document.body.contains($("tlast"))) return clearInterval(tick);
      $("tlast").textContent = fp(S.px[p0.sym]) + " USDT";
      if (tpTab === "trail") nowTrig();
    }, 1000);
    $("tlast").textContent = fp(S.px[p0.sym]) + " USDT";
  }
  // ── 포지션 닫기 시트 (거래소 앱 스타일: 가격 비우면 시장가, 넣으면 지정가 / 수량 바) ──
  function closeSheet(p) {
    const m = $("modal"), id = p.id, b = esc(base(p.sym)), cl = E.modeOf(p) === "cross" ? "Cross" : "Isolated";
    const pending = S.st.ord.filter(o => o.ro === id).reduce((s, o) => s + o.qty, 0);
    const maxQ = Math.max(0, p.qty - pending), dec = Math.max(stepOf(p.entry).dec, (String(p.qty).split(".")[1] || "").length);
    m.className = "sheet";
    m.innerHTML = `<div class="card">
      <div class="shh"><h2>Close</h2><button class="ghost x" id="cx" aria-label="Close">✕</button></div>
      <div class="h2l"><b>${b}USDT</b><span class="chip ${p.side}">${sideTxt(p.side)}</span><span class="chip ${p.side}">${p.lev}x</span><span class="chip">${cl}</span></div>
      <div class="kv"><span>Current price</span><b id="cpx">-</b></div>
      <div class="kv"><span>Entry price</span><b>${fp(p.entry)} USDT</b></div>
      <div class="prow"><span class="pin"><input id="cprice" inputmode="decimal" placeholder="Fill at market price"><small>USDT</small></span><button class="ghost" id="cmkt">Market price</button></div>
      <label class="qbox"><span class="lt">Quantity (${b})</span><input id="cqty" inputmode="decimal" value="${String(+maxQ.toFixed(dec))}"></label>
      <div class="dots"><input id="cpct" type="range" min="0" max="100" step="1" value="100"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="kv"><span>Size</span><b>${fq(p.qty)} ${b}</b></div>
      <div class="kv"><span>Open orders</span><b>${fq(pending)} ${b}</b></div>
      <div class="kv"><span>Max close</span><b>${fq(maxQ)} ${b}</b></div>
      <div class="kv"><span>Est. closing profit</span><b id="cpnl">-</b></div>
      <div class="kv"><span>Est. closing fee</span><b id="cfee">-</b></div>
      <button id="cok" class="confirm">Confirm</button></div>`;
    m.hidden = false;
    const upd = () => {
      const lp = num($("cprice").value), mkt = !(lp > 0), px = mkt ? (S.px[p.sym] || p.entry) : lp, q = Math.min(maxQ, num($("cqty").value) || 0);
      $("cpx").textContent = fp(S.px[p.sym]) + " USDT";
      $("cmkt").classList.toggle("on", mkt);
      if (!(q > 0)) { $("cpnl").textContent = $("cfee").textContent = "-"; return; }
      const g = E.pnlOf(p.side, p.entry, px, q), roe = g / (p.margin * q / p.qty) * 100, fee = q * px * (mkt ? E.FEE_TAKER : E.FEE_MAKER);
      $("cpnl").innerHTML = `<span class="${pc(g)}">${sg(g)} USDT (${sg(roe)}%)</span>`;
      $("cfee").textContent = fu(fee, 4) + " USDT";
    };
    const setPct = v => { $("cpct").value = v; $("cpct").style.setProperty("--v", v + "%"); $("cqty").value = v >= 100 ? String(maxQ) : String(+(maxQ * v / 100).toFixed(dec)); upd(); };
    $("cpct").oninput = () => setPct(+$("cpct").value);
    $("cqty").oninput = () => { const v = maxQ > 0 ? Math.min(100, Math.round((num($("cqty").value) || 0) / maxQ * 100)) : 0; $("cpct").value = v; $("cpct").style.setProperty("--v", v + "%"); upd(); };
    $("cprice").oninput = upd;
    $("cmkt").onclick = () => { $("cprice").value = ""; upd(); };
    $("cx").onclick = () => { m.hidden = true; };
    $("cpct").style.setProperty("--v", "100%");
    upd(); const tick = setInterval(() => { if (m.hidden || !document.body.contains($("cpx"))) clearInterval(tick); else upd(); }, 1000);
    $("cok").onclick = async () => {
      const q = num($("cqty").value), lp = num($("cprice").value);
      if (!(q > 0)) return notify("warn", "Close", "Enter a quantity");
      if (q > maxQ * (1 + 1e-9)) return notify("warn", "Close", `Max close is ${fq(maxQ)} ${base(p.sym)}`);
      const pct = Math.min(100, q / p.qty * 100);
      if (pct < 1) return notify("warn", "Close", "Minimum is 1% of the position");
      $("cok").disabled = true;
      try {
        if (lp > 0) await sendAction({ action: "closeLimit", id, price: lp, pct });
        else await sendAction({ action: "close", id, pct: q >= p.qty * (1 - 1e-9) ? 100 : pct });
        m.hidden = true;
      } catch (e) {} finally { const b2 = $("cok"); if (b2) b2.disabled = false; }
    };
  }
  function modal(html, onOk, okText) {
    const m = $("modal"); m.className = "";
    m.innerHTML = `<div class="card">${html}<div class="btns">${onOk ? '<button class="ghost" id="mno">Cancel</button>' : ""}<button id="myes">${okText || "Confirm"}</button></div></div>`;
    m.hidden = false;
    if (onOk) $("mno").onclick = () => { m.hidden = true; };
    $("myes").onclick = async () => { if (!onOk) { m.hidden = true; return; } try { await onOk(); m.hidden = true; } catch (e) {} };
  }
  const backdrop = e => { if (e.target === $("modal")) $("modal").hidden = true; };
  $("modal").onclick = backdrop;
  // 확인 창 (브라우저 기본 confirm 대신): 화면을 멈추지 않아서 뒤의 가격·차트·호가가 계속 실시간으로 움직임
  function ask(msg, okText) {
    return new Promise(res => {
      const m = $("modal"); m.className = "";
      m.innerHTML = `<div class="card"><p style="white-space:pre-line;margin:0 0 6px;font-size:14px">${esc(msg)}</p><div class="btns"><button class="ghost" id="mno">Cancel</button><button id="myes">${esc(okText || "Confirm")}</button></div></div>`;
      m.hidden = false;
      const done = v => { m.hidden = true; m.onclick = backdrop; document.removeEventListener("keydown", key); res(v); };
      const key = e => { if (e.key === "Escape") done(false); else if (e.key === "Enter") { e.preventDefault(); done(true); } };
      $("mno").onclick = () => done(false);
      $("myes").onclick = () => done(true);
      m.onclick = e => { if (e.target === m) done(false); };
      document.addEventListener("keydown", key);
      $("myes").focus();
    });
  }

  // ── 관리자 ───────────────────────────────────────────────────
  let adminRows = null, adminLog = [];
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
  // 관리자: 끝난 매매 한 줄 상세 (평단·청산가·수량·금액·증거금·모드·보유 시간·수수료)
  function admTradeInfo(t) {
    const mg = t.roe ? Math.abs(t.pnl / t.roe * 100) : null;          // 증거금 = 손익 ÷ ROE
    const held = t.ot && t.t > t.ot ? t.t - t.ot : null;
    const dur = held == null ? "" : held < 3600e3 ? Math.round(held / 60e3) + "m" : held < 86400e3 ? (held / 3600e3).toFixed(1) + "h" : (held / 86400e3).toFixed(1) + "d";
    return `Avg entry <b>${fp(t.entry)}</b> → Exit <b>${fp(t.exit)}</b> · Size ${fq(t.qty)} ${esc(base(t.sym))} (${fu(t.qty * t.entry)} USDT)` +
      (mg ? ` · Margin ${fu(mg)}` : "") + ` · ${modeTxt(t.mode)} ${t.lev}x` + (t.fee ? ` · Fee ${fu(t.fee)}` : "") +
      `<br>${t.ot ? "Opened " + mdhm(t.ot) + " → " : ""}Closed ${mdhm(t.t)}${dur ? " (" + dur + ")" : ""}`;
  }
  function renderAdminDetail() {
    const d = adminView;
    const ord = d.ol.map(o => `<div class="lrow"><span><b class="cl" data-sym="${o.sym}" title="Open chart">${esc(base(o.sym))}</b> <span class="${o.side === "long" ? "g" : "r"}">${sideTxt(o.side)} ${o.lev}x</span> ${esc(L(o.kind))}</span><span>${fq(o.qty)} @ ${fp(o.price)} · <b>${esc(L(o.status))}</b></span><span class="m">${mdhm(o.t)}</span></div>`).join("") || '<div class="empty">None</div>';
    const th = d.th.map(t => t.kind === "deposit" ? `<div class="lrow"><span><b class="g">Admin deposit +${fu(t.amount)}</b> USDT</span><span class="m">${mdhm(t.t)}</span></div>`
      : `<div class="lrow"><span><b class="cl" data-sym="${t.sym}" title="Open chart">${esc(base(t.sym))}</b> <span class="${t.side === "long" ? "g" : "r"}">${sideTxt(t.side)} ${t.lev}x</span> · ${esc(L(t.reason))}</span><span class="${pc(t.pnl)}"><b>${sg(t.pnl)} USDT</b> (${sg(t.roe)}%)</span>
        <span class="m">${admTradeInfo(t)}</span></div>`).join("") || '<div class="empty">None</div>';
    const open = d.ord.map(o => `<div class="lrow"><span><b class="cl" data-sym="${o.sym}" title="Open chart">${esc(base(o.sym))}</b> <span class="${o.side === "long" ? "g" : "r"}">${sideTxt(o.side)} ${o.lev}x</span> ${o.ro ? "Limit close" : "Limit"}</span><span>${fq(o.qty)} @ ${fp(o.price)}</span><span class="m">${mdhm(o.t)}</span></div>`).join("") || '<div class="empty">None</div>';
    $("tabbody").innerHTML = `<button class="ghost mini" data-adm="back">← Back</button>
      <h2 style="margin:10px 0 4px">${esc(d.nick)} ${d.bl ? '<span class="tag short">Blocked</span>' : ""}</h2>
      <p class="sub">Joined ${dt(d.c)} · Last seen ${dt(d.la)} · Principal ${ut(d.dep)} · ${d.stats.w}W ${d.stats.n - d.stats.w}L</p>
      <div id="admlive"></div>
      <h2 style="margin-top:16px">Open orders (${d.ord.length})</h2>${open}
      <h2 style="margin-top:16px">Recent trades</h2>${th}<h2 style="margin-top:16px">Recent orders</h2>${ord}`;
    paintAdminLive();
  }
  // 관리자: 보고 있는 사용자의 포지션을 실시간 가격으로 (1초마다 다시 그림, 10초마다 서버에서 새로 받음)
  function paintAdminLive() {
    const d = adminView, el = $("admlive");
    if (!d || !el) return;
    const st = { bal: d.bal, pos: d.pos };
    let up = 0;
    const rows = d.pos.map(p => {
      const px = S.px[p.sym] || p.entry, u = E.pnlOf(p.side, p.entry, px, p.qty), roe = u / p.margin * 100;
      up += u;
      const liq = E.liqOf(st, p, pxOf);
      return `<div class="lrow"><span><b class="cl" data-sym="${p.sym}" title="Open chart">${esc(base(p.sym))}</b> ${tagSide(p.side, E.modeOf(p), p.lev)}</span>
        <span class="${pc(u)}"><b>${sg(u)} USDT</b> (${sg(roe)}%)</span>
        <span class="m">Size ${fq(p.qty)} (${fu(p.qty * px)} USDT) · Entry ${fp(p.entry)} → Now <b>${fp(px)}</b> · Margin ${fu(p.margin)}
          · Liq. <span class="o">${liq ? fp(liq) : "None"}</span> · TP ${p.tp ? fp(p.tp) : "-"} / SL ${p.sl ? fp(p.sl) : "-"} · ${mdhm(p.t)}</span></div>`;
    }).join("") || '<div class="empty">No open positions</div>';
    const eq = d.bal + d.pos.reduce((a, p) => a + p.margin, 0) + up, ret = (eq - d.dep) / d.dep * 100;
    el.innerHTML = `<div class="lrow" style="font-size:13.5px"><span>Equity <b>${ut(eq)}</b> <span class="${pc(ret)}">(${sg(ret)}%)</span></span>
        <span>Unrealized <b class="${pc(up)}">${sg(up)} USDT</b></span>
        <span class="m">Available ${ut(d.bal)} · updated ${new Date(d.at || Date.now()).toLocaleTimeString("en-GB")} · <span class="g">● live prices</span></span></div>
      <h2 style="margin-top:12px">Open positions (${d.pos.length})</h2>${rows}`;
  }
  let admBusy = false;
  async function reloadAdminView() {
    if (admBusy || !adminView || S.tab !== "adm" || document.hidden) return;
    admBusy = true;
    try {
      const nick = adminView.nick, r = await post("/api/admin", { action: "detail", nick });
      if (adminView && adminView.nick === nick) { adminView = r; renderAdminDetail(); mkt.sync(); }
    } catch (e) {} finally { admBusy = false; }
  }
  setInterval(() => { if (adminView && S.tab === "adm" && !document.hidden) paintAdminLive(); }, 1000);
  setInterval(reloadAdminView, 10000);
  $("tabbody").addEventListener("click", async e => {
    const b = e.target.closest("[data-adm]"); if (!b) return;
    const act = b.dataset.adm, nick = b.dataset.n;
    try {
      if (act === "back") { adminView = null; mkt.sync(); return renderAdmin(); }
      if (act === "detail") { adminView = await post("/api/admin", { action: "detail", nick }); mkt.sync(); return renderAdmin(); }
      let r;
      if (act === "charge") {
        const amt = num(b.parentElement.querySelector("input").value);
        if (!(amt > 0)) return notify("warn", "Deposit", "Enter an amount");
        if (!(await ask(`Deposit ${fu(amt)} USDT to ${nick}?`))) return;
        r = await post("/api/admin", { action: "charge", nick, amount: amt });
      } else if (act === "reset") {
        if (!(await ask(`Clear all of ${nick}'s balance, positions and history and reset to 10,000 USDT?`))) return;
        r = await post("/api/admin", { action: "reset", nick });
      } else if (act === "block" || act === "unblock") {
        if (!(await ask(`${act === "block" ? "Block" : "Unblock"} ${nick}?`))) return;
        r = await post("/api/admin", { action: act, nick });
      } else if (act === "delete") {
        if (!(await ask(`Delete ${nick}'s account? All data will be lost and cannot be undone.`))) return;
        if (!(await ask(`Really delete '${nick}'? (final confirmation)`))) return;
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
    setMode(S.mode); setLev(ls.get(K.lev) || 10); setType(S.otype);
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
          const ts = E.trailStop(p), pt = p.pt || [];
          return L ? ((lq && x <= lq) || (p.sl && x <= p.sl) || (p.tp && x >= p.tp) || (ts && x <= ts) || pt.some(o => (o.sl && x <= o.sl) || (o.tp && x >= o.tp)))
                   : ((lq && x >= lq) || (p.sl && x >= p.sl) || (p.tp && x <= p.tp) || (ts && x >= ts) || pt.some(o => (o.sl && x >= o.sl) || (o.tp && x <= o.tp))); })
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
