/*
  bt-worker.js — 백테스트 스크립트 실행 공간 (Web Worker)
  붙여넣은 스크립트는 여기서만 돌아요. 화면(로그인 정보·모의투자 계좌)에는 손댈 수 없고,
  할 수 있는 건 가격 데이터 받기 · 계산 · 결과 보내기뿐이에요.
*/
"use strict";
const IV_MS = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3, "1h": 3600e3, "2h": 7200e3, "4h": 14400e3, "6h": 21600e3, "12h": 43200e3, "1d": 86400e3, "1w": 604800e3 };
const SRC = {
  futures: "https://fapi.binance.com/fapi/v1/klines",
  spot: "https://data-api.binance.vision/api/v3/klines",
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (type, data) => postMessage({ type, data });

// ── 가격 데이터 보관 (브라우저 IndexedDB) ─────────────────────────
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
  candles(sym, interval, from, opts) → [{t, o, h, l, c, v}]  (오래된 것 → 최신, 마감된 봉만)
    sym: "BTC" · interval: "1m"~"1w" · from: "2020-01-01" 또는 ms · opts.market: "futures"(기본) | "spot"
  한 번 받은 데이터는 브라우저에 저장돼서 다음부터는 새로 생긴 봉만 받아요
*/
async function candles(sym, interval = "1h", from = "2020-01-01", opts = {}) {
  sym = String(sym).toUpperCase().replace(/USDT$/, "");
  if (!/^[A-Z0-9]{1,20}$/.test(sym)) throw new Error("코인 기호가 이상해요: " + sym);
  if (!IV_MS[interval]) throw new Error("봉 단위는 " + Object.keys(IV_MS).join(", ") + " 중 하나");
  let market = opts.market === "spot" ? "spot" : "futures";
  const t0 = typeof from === "number" ? from : Date.parse(from);
  if (!isFinite(t0)) throw new Error("시작일 형식: \"2020-01-01\"");
  const ms = IV_MS[interval], now = Date.now();
  const load = async mk => {
    const key = `${mk}|${sym}|${interval}`;
    let rows = await cacheGet(key);
    if (!rows || !rows.length || rows[0][0] > t0 + ms) rows = await download(mk, sym, interval, t0, now, `${sym} ${interval}`);
    else {
      const add = await download(mk, sym, interval, rows[rows.length - 1][0] + ms, now, `${sym} ${interval}`);
      rows = rows.concat(add);
    }
    await cachePut(key, rows);
    return rows;
  };
  let rows;
  try { rows = await load(market); }
  catch (e) {
    if (!e.blocked || market === "spot") throw e;
    log(`선물 데이터가 이 지역에서 막혀서 현물 데이터로 대신 받아요 (${sym})`);
    rows = await load(market = "spot");
  }
  const arr = [];
  for (const r of rows) if (r[0] >= t0) arr.push({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] });
  return arr;
}

// ── 기본 지표 (배열 → 같은 길이 배열, 앞부분은 NaN) ───────────────────
const ta = {
  sma(a, n) { const o = Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; },
  ema(a, n) { const o = Array(a.length).fill(NaN), k = 2 / (n + 1); let e; for (let i = 0; i < a.length; i++) { e = i === 0 ? a[0] : a[i] * k + e * (1 - k); if (i >= n - 1) o[i] = e; } return o; },
  rsi(a, n = 14) { const o = Array(a.length).fill(NaN); let g = 0, l = 0;
    for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
      if (i >= n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; },
  atr(cs, n = 14) { const o = Array(cs.length).fill(NaN); let v;
    for (let i = 0; i < cs.length; i++) { const c = cs[i], tr = i ? Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c)) : c.h - c.l;
      v = i < n ? (v || 0) + tr / n : (v * (n - 1) + tr) / n; if (i >= n - 1) o[i] = v; } return o; },
  highest(a, n) { const o = Array(a.length).fill(NaN); for (let i = n - 1; i < a.length; i++) { let m = -Infinity; for (let j = i - n + 1; j <= i; j++) m = Math.max(m, a[j]); o[i] = m; } return o; },
  lowest(a, n) { const o = Array(a.length).fill(NaN); for (let i = n - 1; i < a.length; i++) { let m = Infinity; for (let j = i - n + 1; j <= i; j++) m = Math.min(m, a[j]); o[i] = m; } return o; },
};

// 자산 곡선 [[t, 자산], ...] → 수익률·최대 낙폭
function stats(equity, seed) {
  if (!equity.length) return {};
  const s = seed ?? equity[0][1];
  let peak = -Infinity, mdd = 0;
  for (const [, v] of equity) { peak = Math.max(peak, v); mdd = Math.max(mdd, (peak - v) / peak); }
  const end = equity[equity.length - 1][1];
  return { "시작": Math.round(s), "최종": Math.round(end), "수익률": ((end / s - 1) * 100).toFixed(1) + "%", "최대 낙폭": (mdd * 100).toFixed(1) + "%" };
}

const log = (...a) => send("log", a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ").slice(0, 2000));
const progress = f => send("prog", Math.max(0, Math.min(1, +f || 0)));
let reported = null;
const report = r => { reported = r; };

onmessage = async ev => {
  const code = String(ev.data && ev.data.code || "");
  try {
    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFn("candles", "ta", "stats", "log", "progress", "report", code);
    const ret = await fn(candles, ta, stats, log, progress, report);
    const r = reported || ret;
    if (!r || typeof r !== "object") throw new Error("결과가 없어요. 스크립트 끝에서 return { summary, equity, ... } 또는 report({...}) 를 해 주세요");
    send("done", JSON.parse(JSON.stringify(r)));
  } catch (e) {
    send("error", (e && e.message) || String(e));
  }
};
