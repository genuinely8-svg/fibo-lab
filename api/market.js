/* GET /api/market?n=5&k=20&top=50&fee=0.1 — Market Score (시장 방향) 계산을 서버에서
   - 1시간봉이 새로 시작됐을 때 한 번만 계산해서 DB(Upstash)에 저장 → 방문자는 저장된 결과만 받음
   - 계산 엔진은 서버 안에만 있어요 (브라우저에는 점수와 그래프용 숫자만) */
const db = require("./_lib/db");
const F = require("./_lib/fib-core");

const FUT = "https://fapi.binance.com/fapi/v1";
const HOUR = 3600e3, WEEK = 7 * 24 * HOUR, WIN = 720;      // 점수 구간 = 최근 30일(1시간봉 720개)
const TOTAL = 2880, MAX_RANK = 100, EV_SCALE = 5;
const RANK_KEY = "sigbot:rank";                            // 자동매매 봇과 같은 시가총액 순위 저장값
const STABLES = new Set(["USDC", "FDUSD", "TUSD", "BUSD", "USDP", "DAI", "EUR", "AEUR", "USDE", "XUSD", "BFUSD", "RLUSD", "USD1", "PYUSD", "EURI"]);
const COMMODITY_TOKENS = new Set(["PAXG", "XAUT", "XAUM", "KAU", "KAG", "DGX", "PMGT", "XAU", "XAG", "XPT", "XPD"]);
const base = s => s.replace(/^(1000000|10000|1000|1M)(?=[A-Z])/, "");
const clamp = v => Math.max(-100, Math.min(100, v));
const avg = a => { const b = a.filter(x => x != null && isFinite(x)); return b.length ? b.reduce((s, x) => s + x, 0) / b.length : null; };
const num = (v, d, lo, hi) => { v = +v; return isFinite(v) && v >= lo && v <= hi ? v : d; };

async function jget(url, ms = 10000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${res.status} ${url.split("?")[0]}`);
  return res.json();
}

async function ranks(now) {
  const old = await db.getJSON(RANK_KEY).catch(() => null);
  if (old && now - old.at < 24 * HOUR) return old.R;
  try {
    const rows = await jget("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1");
    const R = {};
    for (const c of rows) { const s = c.symbol.toUpperCase(); if (!R[s] && c.market_cap_rank) R[s] = c.market_cap_rank; }
    if (Object.keys(R).length) { await db.setJSON(RANK_KEY, { at: now, R }).catch(() => {}); return R; }
  } catch (e) {}
  return old ? old.R : null;
}

async function universe(R, topN) {
  const [info, rows] = await Promise.all([jget(`${FUT}/exchangeInfo`), jget(`${FUT}/ticker/24hr`)]);
  const notCoin = new Set();
  for (const x of info.symbols) if (x.quoteAsset === "USDT" && x.underlyingType && x.underlyingType !== "COIN") notCoin.add(x.baseAsset);
  const dayAgo = Date.now() - 86400e3;
  return rows
    .filter(x => x.symbol.endsWith("USDT") && !x.symbol.includes("_") && +x.quoteVolume > 0 && x.closeTime > dayAgo)
    .map(x => ({ sym: x.symbol.slice(0, -4), vol: +x.quoteVolume }))
    .filter(x => !STABLES.has(x.sym) && !notCoin.has(x.sym) && !COMMODITY_TOKENS.has(base(x.sym)))
    .filter(x => { const r = R[base(x.sym)]; return r && r <= MAX_RANK; })
    .sort((a, b) => b.vol - a.vol).slice(0, topN).map(x => x.sym);
}

const toCandles = rows => rows.map(r => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
async function candles(sym) {
  const a = await jget(`${FUT}/klines?symbol=${sym}USDT&interval=1h&limit=1500`);
  if (!a.length || a.length < 1500) return toCandles(a);
  const b = await jget(`${FUT}/klines?symbol=${sym}USDT&interval=1h&limit=${TOTAL - 1500}&endTime=${a[0][0] - 1}`);
  return toCandles(b.concat(a));
}
function upTo(cs, T) {
  let lo = 0, hi = cs.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].t <= T) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

// 지표 3개 (각각 −100~+100): [터치 비율, 반등 우세 차이, 기대값 차이]
function metrics(cs, o) {
  const L = F.analyze(cs, { n: o.n, k: o.k, direction: "long" });
  const S = F.analyze(cs, { n: o.n, k: o.k, direction: "short" });
  const tot = L.stats.count + S.stats.count;
  const ratio = tot ? S.stats.count / tot * 100 : null;
  const win = L.stats.winRate != null && S.stats.winRate != null ? L.stats.winRate - S.stats.winRate : null;
  const el = F.expectancy(L.stats, o.fee), es = F.expectancy(S.stats, o.fee);
  const ev = el != null && es != null ? el - es : null;
  const raw = [ratio, win, ev];
  const s = [ratio == null ? null : clamp((ratio - 50) * 2), win == null ? null : clamp(win), ev == null ? null : clamp(ev / EV_SCALE * 100)];
  return { raw, s, score: avg(s) };
}
function aggregate(list) {
  const rawAvg = [0, 1, 2].map(j => avg(list.map(x => x.raw[j])));
  const sAvg = [0, 1, 2].map(j => avg(list.map(x => x.s[j])));
  return { rawAvg, sAvg, score: avg(sAvg) };
}

async function compute(o, now) {
  const R = await ranks(now);
  if (!R) throw Object.assign(new Error("시가총액 순위(코인게코)를 아직 못 받아왔어요. 몇 분 뒤 다시 눌러주세요"), { status: 503 });
  const coins = await universe(R, o.topN);
  if (!coins.length) throw Object.assign(new Error("분석할 코인을 못 찾았어요"), { status: 502 });
  const need = coins.includes("BTC") ? coins : ["BTC"].concat(coins);
  const data = {};
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < need.length) { const s = need[next++]; try { data[s] = await candles(s); } catch (e) {} }
  }));
  const usable = coins.filter(s => data[s] && data[s].length >= 300);
  if (!usable.length) throw Object.assign(new Error("캔들을 받지 못했어요. 잠시 뒤 다시 눌러주세요"), { status: 502 });
  const btc = data.BTC || data[usable[0]];
  const last = btc[btc.length - 1].t, pts = [];
  for (let T = last; T - (WIN - 1) * HOUR >= btc[0].t && pts.length < 13; T -= WEEK) pts.unshift({ T });
  let per = [];
  for (const p of pts) {
    const rows = [];
    for (const sym of usable) {
      const cs = data[sym], e = upTo(cs, p.T);
      if (e + 1 < 300) continue;
      const m = metrics(cs.slice(Math.max(0, e + 1 - WIN), e + 1), o);
      if (m.score != null) rows.push({ sym, ...m });
    }
    p.score = rows.length ? aggregate(rows).score : null; p.n = rows.length;
    per = rows;                                            // 마지막 점(지금)의 코인별 결과
  }
  if (!per.length) throw Object.assign(new Error("점수를 계산할 데이터가 부족해요"), { status: 502 });
  pts.forEach((p, i) => { const q = pts[i - 4]; p.chg = q && p.score != null && q.score != null && p.T - q.T === 4 * WEEK ? p.score - q.score : null; });
  const t0 = pts[0].T;
  return {
    v: 1, bar: Math.floor(now / HOUR) * HOUR, at: now,
    agg: aggregate(per), per, pts,
    btc: btc.filter(c => c.t >= t0).map(c => ({ t: c.t, c: c.c })),
  };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
    const q = req.query || {};
    const o = { n: Math.round(num(q.n, 5, 2, 30)), k: Math.round(num(q.k, 20, 3, 100)), topN: Math.round(num(q.top, 50, 1, 100)), fee: num(q.fee, 0.1, 0, 5) };
    const KEY = `market:v1:${o.n}:${o.k}:${o.topN}:${o.fee}`, LOCK = KEY + ":lock";
    const now = Date.now(), bar = Math.floor(now / HOUR) * HOUR;
    let cached = null;
    try { cached = await db.getJSON(KEY); } catch (e) {}
    if (!cached || cached.bar < bar) {
      let got = true;
      try { got = (await db.cmd("SET", LOCK, String(now), "NX", "EX", "90")) === "OK"; } catch (e) {}
      if (got || !cached) {
        try {
          cached = await compute(o, now);
          try { await db.setJSON(KEY, cached); await db.cmd("EXPIRE", KEY, 7 * 86400); } catch (e) {}
        } finally { try { await db.cmd("DEL", LOCK); } catch (e) {} }
      }
    }
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(cached);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "error" });
  }
};
