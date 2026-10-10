/*
  bt-worker.js — sandbox that runs pasted backtest scripts (Web Worker)
  Scripts run only here: they cannot touch the page, the login or paper-trading accounts.
  They can only download prices, calculate and send results back.
*/
"use strict";
const IV_MS = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3, "1h": 3600e3, "2h": 7200e3, "4h": 14400e3, "6h": 21600e3, "12h": 43200e3, "1d": 86400e3, "1w": 604800e3 };
const SRC = {
  futures: "https://fapi.binance.com/fapi/v1/klines",
  spot: "https://data-api.binance.vision/api/v3/klines",
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (type, data) => postMessage({ type, data });

// ── price cache (browser IndexedDB) ─────────────────────────────
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise(ok => {
    try {
      const r = indexedDB.open("gwave-bt", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("k");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
    } catch (e) { ok(null); }
  });
  return dbp;
}
async function cacheGet(key) {
  const d = await db(); if (!d) return null;
  return new Promise(ok => { try { const q = d.transaction("k").objectStore("k").get(key); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); } catch (e) { ok(null); } });
}
async function cachePut(key, val) {
  const d = await db(); if (!d) return;
  return new Promise(ok => { try { const tx = d.transaction("k", "readwrite"); tx.objectStore("k").put(val, key); tx.oncomplete = ok; tx.onerror = ok; } catch (e) { ok(); } });
}

async function getRows(url) {
  for (let i = 0; i < 5; i++) {
    let r;
    try { r = await fetch(url); } catch (e) { await sleep(2000); continue; }
    if (r.ok) return r.json();
    if (r.status === 400) throw new Error("없는 코인이거나 잘못된 봉 단위예요");
    if (r.status === 451 || r.status === 403) throw Object.assign(new Error("blocked"), { blocked: true });
    await sleep(r.status === 429 || r.status === 418 ? 15000 : 3000);
  }
  throw new Error("바이낸스에서 데이터를 못 받았어요. 잠시 뒤 다시 실행해 주세요");
}

async function download(market, sym, iv, from, to, label) {
  const ms = IV_MS[iv], out = [];
  let start = from;
  while (start < to) {
    const rows = await getRows(`${SRC[market]}?symbol=${sym}USDT&interval=${iv}&startTime=${start}&limit=1000`);
    if (!rows.length) break;
    for (const x of rows) if (x[0] + ms <= Date.now()) out.push([x[0], +x[1], +x[2], +x[3], +x[4], +x[5]]);
    start = rows[rows.length - 1][0] + ms;
    send("dl", `${label} 받는 중… ${new Date(Math.min(start, Date.now())).toISOString().slice(0, 10)}`);
    if (rows.length < 1000) break;
    await sleep(150);
  }
  return out;
}

/*
  candles(sym, interval, from, opts) → [{t, o, h, l, c, v}]  (oldest first, closed candles only)
  Downloaded data is cached in the browser, so later runs only fetch new candles.
*/
async function candles(sym, interval = "1h", from = "2020-01-01", opts = {}) {
  sym = String(sym).toUpperCase().replace(/USDT$/, "");
  if (!/^[A-Z0-9]{1,20}$/.test(sym)) throw new Error("코인 기호가 이상해요: " + sym);
  if (!IV_MS[interval]) throw new Error("봉 단위는 " + Object.keys(IV_MS).join(", ") + " 중 하나");
  let market = opts.market === "spot" ? "spot" : "futures";
  const t0 = typeof from === "number" ? from : Date.parse(from);
  if (!isFinite(t0)) throw new Error('시작일 형식: "2020-01-01"');
  const ms = IV_MS[interval], now = Date.now();
  const load = async mk => {
    const key = `${mk}|${sym}|${interval}`;
    let rows = await cacheGet(key);
    if (!rows || !rows.length || rows[0][0] > t0 + ms) rows = await download(mk, sym, interval, t0, now, `${sym} ${interval}`);
    else rows = rows.concat(await download(mk, sym, interval, rows[rows.length - 1][0] + ms, now, `${sym} ${interval}`));
    await cachePut(key, rows);
    return rows;
  };
  let rows;
  try { rows = await load(market); }
  catch (e) {
    if (!e.blocked || market === "spot") throw e;
    log(`이 지역에서 선물 데이터가 막혀서 현물 데이터로 대신 받아요 (${sym})`);
    rows = await load(market = "spot");
  }
  const arr = [];
  for (const r of rows) if (r[0] >= t0) arr.push({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] });
  return arr;
}

// ── indicators (array in → same-length array out, NaN while warming up) ──
const ta = {
  sma(a, n) { const o = Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; },
  ema(a, n) { const o = Array(a.length).fill(NaN), k = 2 / (n + 1); let e; for (let i = 0; i < a.length; i++) { e = i === 0 ? a[0] : a[i] * k + e * (1 - k); if (i >= n - 1) o[i] = e; } return o; },
  rsi(a, n = 14) { const o = Array(a.length).fill(NaN); let g = 0, l = 0;
    for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
      if (i >= n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; },
  macd(a, fast = 12, slow = 26, signal = 9) {
    const f = ta.ema(a, fast), s = ta.ema(a, slow), m = a.map((_, i) => f[i] - s[i]);
    const first = m.findIndex(x => isFinite(x)), sig = Array(a.length).fill(NaN);
    if (first >= 0) { const e = ta.ema(m.slice(first), signal); for (let i = 0; i < e.length; i++) sig[first + i] = e[i]; }
    return { macd: m, signal: sig, hist: m.map((x, i) => x - sig[i]) };
  },
  atr(cs, n = 14) { const o = Array(cs.length).fill(NaN); let v;
    for (let i = 0; i < cs.length; i++) { const c = cs[i], tr = i ? Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c)) : c.h - c.l;
      v = i < n ? (v || 0) + tr / n : (v * (n - 1) + tr) / n; if (i >= n - 1) o[i] = v; } return o; },
  highest(a, n) { const o = Array(a.length).fill(NaN); for (let i = n - 1; i < a.length; i++) { let m = -Infinity; for (let j = i - n + 1; j <= i; j++) m = Math.max(m, a[j]); o[i] = m; } return o; },
  lowest(a, n) { const o = Array(a.length).fill(NaN); for (let i = n - 1; i < a.length; i++) { let m = Infinity; for (let j = i - n + 1; j <= i; j++) m = Math.min(m, a[j]); o[i] = m; } return o; },
};

// equity [[t, value], ...] → return and max drawdown
function stats(equity, seed) {
  if (!equity.length) return {};
  const s = seed ?? equity[0][1];
  let peak = -Infinity, mdd = 0;
  for (const [, v] of equity) { peak = Math.max(peak, v); if (peak > 0) mdd = Math.max(mdd, (peak - v) / peak); }
  const end = equity[equity.length - 1][1];
  return { "시작 자산": Math.round(s), "최종 자산": Math.round(end), "수익률": ((end / s - 1) * 100).toFixed(1) + "%", "최대 낙폭": (mdd * 100).toFixed(1) + "%" };
}

/*
  Account — one position at a time, uses the settings panel (config):
    capital, leverage, sizePct (% of equity used as margin per trade), fee (%), margin ("isolated" | "cross"), direction
  acct.open("long" | "short", price, t, { sl, tp, note })   acct.close(price, t, reason)
  acct.update(candle)  ← call once per candle BEFORE your signals: handles SL / TP / liquidation and records equity
  acct.pos (null or {side, entry, qty, margin, sl, tp}), acct.dead (balance gone), acct.result()
*/
const MMR = 0.005;
const REASON = { "Stop loss": "손절", "Take profit": "익절", "Liquidation": "청산", "Signal": "신호" };
class Account {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.capital = +cfg.capital > 0 ? +cfg.capital : 10000;
    this.lev = Math.min(125, Math.max(1, +cfg.leverage || 1));
    this.sizePct = Math.min(100, Math.max(0.1, +cfg.sizePct || 100));
    this.fee = Math.max(0, cfg.fee == null ? 0.05 : +cfg.fee) / 100;
    this.cross = cfg.margin === "cross";
    this.cash = this.capital; this.pos = null; this.dead = false;
    this.trades = []; this.eq = []; this.liqs = 0;
  }
  get canLong() { return this.cfg.direction !== "short"; }
  get canShort() { return this.cfg.direction !== "long"; }
  get side() { return this.pos ? this.pos.side : null; }
  equityAt(px) { const p = this.pos; return this.cash + (p ? (p.side === "long" ? 1 : -1) * p.qty * (px - p.entry) : 0); }
  liqPrice() {
    const p = this.pos; if (!p) return null;
    if (!this.cross) return p.side === "long" ? p.entry * (1 - 1 / this.lev + MMR) : p.entry * (1 + 1 / this.lev - MMR);
    return p.side === "long" ? (p.qty * p.entry - this.cash) / (p.qty * (1 - MMR)) : (this.cash + p.qty * p.entry) / (p.qty * (1 + MMR));
  }
  open(side, price, t, o = {}) {
    if (this.pos || this.dead || !(price > 0)) return false;
    if (side === "long" && !this.canLong) return false;
    if (side === "short" && !this.canShort) return false;
    const margin = this.cash * this.sizePct / 100;
    if (!(margin > 0)) return false;
    const notional = margin * this.lev, fee = notional * this.fee;
    this.cash -= fee;
    this.pos = { side, entry: price, qty: notional / price, margin, t, fee, sl: o.sl || null, tp: o.tp || null, note: o.note || "" };
    return true;
  }
  close(price, t, reason = "Signal") {
    const p = this.pos; if (!p) return 0;
    const g = (p.side === "long" ? 1 : -1) * p.qty * (price - p.entry), fee = p.qty * price * this.fee;
    let pnl = g - fee;
    if (!this.cross && pnl < -p.margin) pnl = -p.margin;                      // isolated: can't lose more than the margin
    this.cash += pnl;
    if (this.cash <= 1e-9) { this.cash = 0; this.dead = true; }
    const net = pnl - p.fee;
    this.trades.push({ "진입 시각": p.t, "청산 시각": t, "방향": p.side === "long" ? "롱" : "숏", "진입가": p.entry, "청산가": price,
      "손익": Math.round(net * 100) / 100, "수익률": (net / p.margin * 100).toFixed(2) + "%", "사유": REASON[reason] || reason, ...(p.note ? { "메모": p.note } : {}) });
    this.pos = null;
    return net;
  }
  update(c) {
    const p = this.pos;
    if (p) {
      const L = p.side === "long", liq = this.liqPrice(), adv = L ? c.l : c.h;
      const hit = (x, price) => x && (L ? price <= x : price >= x);
      const slFirst = hit(p.sl, adv) && (!liq || (L ? p.sl >= liq : p.sl <= liq));
      if (slFirst) this.close(L ? Math.min(p.sl, c.o) : Math.max(p.sl, c.o), c.t, "Stop loss");
      else if (liq && (L ? adv <= liq : adv >= liq)) {
        this.liqs++;
        if (this.cross) { this.close(liq, c.t, "Liquidation"); this.cash = 0; this.dead = true; }
        else {                                                                 // isolated: the whole margin is lost
          const before = this.cash, m = p.margin + p.fee; this.close(liq, c.t, "Liquidation");
          const extra = Math.max(0, p.margin - (before - this.cash));
          this.cash = Math.max(0, this.cash - extra); if (this.cash <= 1e-9) this.dead = true;
          const tr = this.trades[this.trades.length - 1]; tr["손익"] = Math.round(-m * 100) / 100; tr["수익률"] = (-m / p.margin * 100).toFixed(2) + "%";
        }
      } else if (p.tp && (L ? c.h >= p.tp : c.l <= p.tp)) this.close(L ? Math.max(p.tp, c.o) : Math.min(p.tp, c.o), c.t, "Take profit");
    }
    this.eq.push([c.t, Math.max(0, this.equityAt(c.c))]);
  }
  result(extra = {}) {
    const step = Math.max(1, Math.ceil(this.eq.length / 3000));
    const equity = this.eq.filter((_, i) => i % step === 0 || i === this.eq.length - 1);
    const w = this.trades.filter(x => x["손익"] > 0), l = this.trades.filter(x => x["손익"] <= 0);
    const sum = a => a.reduce((s, x) => s + x["손익"], 0), gw = sum(w), gl = -sum(l);
    return {
      summary: { ...stats(this.eq, this.capital), "매매 수": this.trades.length, "승률": (w.length / (this.trades.length || 1) * 100).toFixed(0) + "%",
        "평균 수익": Math.round(gw / (w.length || 1)), "평균 손실": -Math.round(gl / (l.length || 1)), "손익비(PF)": gl ? (gw / gl).toFixed(2) : "-",
        "청산 횟수": this.liqs, ...extra },
      equity, trades: this.trades,
    };
  }
}

const log = (...a) => send("log", a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ").slice(0, 2000));
const progress = f => send("prog", Math.max(0, Math.min(1, +f || 0)));
let reported = null;
const report = r => { reported = r; };

onmessage = async ev => {
  const code = String(ev.data && ev.data.code || "");
  const config = Object.freeze({ ...(ev.data && ev.data.config || {}) });
  try {
    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFn("config", "candles", "ta", "stats", "Account", "log", "progress", "report", code);
    const ret = await fn(config, candles, ta, stats, Account, log, progress, report);
    const r = reported || ret;
    if (!r || typeof r !== "object") throw new Error("결과가 없어요. 스크립트 끝에서 return acct.result(); 또는 return { summary, equity, trades } 를 해 주세요");
    send("done", JSON.parse(JSON.stringify(r)));
  } catch (e) {
    send("error", (e && e.message) || String(e));
  }
};
