/* GET /api/lowsig?sym=BTC|ETH — Artha Trading Engine (비트코인·이더리움 12시간봉 추세추종) 과거 검증 결과
   - 신호는 12시간봉, 진입2·3·익절·SL의 정확한 시각·가격은 1분봉으로 계산 (lowsig-core.js, 봇과 같은 규칙)
   - 12시간봉이 새로 마감됐을 때 한 번만 계산해서 DB(Upstash)에 저장 → 방문자는 저장된 결과만 받음
     (방문자 브라우저가 바이낸스에 분봉을 수백 번 요청하지 않게)
   - 롱+숏 / 롱만 / 숏만 세 가지를 같이 계산해서 { both, long, short } 로 돌려줌 */
const db = require("./_lib/db");
const L = require("../lowsig-core");

const BASE = "https://fapi.binance.com";
const SYMS = { BTC: "BTCUSDT", ETH: "ETHUSDT" };             // 비트·이더만
const H12 = 12 * 3600e3;
const START = Date.UTC(2020, 0, 1);
const keyOf = c => `lowsig:${c.toLowerCase()}:v2`, lockOf = c => `lowsig:${c.toLowerCase()}:lock`;

async function jget(path) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) { const e = new Error("Binance error " + res.status); e.status = 502; throw e; }
  return res.json();
}
const toBar = r => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], ct: +r[6] });

// 2019년 6월부터 (400개 이평이 2020년 1월에 준비되게) 마감된 12시간봉
async function load12h(SYM, now) {
  let from = Date.UTC(2019, 5, 1), out = [];
  for (let k = 0; k < 10; k++) {
    const rows = await jget(`/fapi/v1/klines?symbol=${SYM}&interval=12h&startTime=${from}&limit=1500`);
    if (!rows.length) break;
    out = out.concat(rows.map(toBar));
    if (rows.length < 1500) break;
    from = +rows[rows.length - 1][0] + 1;
  }
  return out.filter(b => b.ct < now);
}
// 12시간봉 하나 안의 1분봉 720개 (limit 1000 → 요청 무게 5)
const minuteBars = (SYM, bar) => jget(`/fapi/v1/klines?symbol=${SYM}&interval=1m&startTime=${bar.t}&endTime=${bar.t + H12 - 1}&limit=1000`).then(r => r.map(toBar));

async function compute(SYM, now) {
  const bars = await load12h(SYM, now);
  if (bars.length < L.P.trendLen + 10) throw Object.assign(new Error("Not enough 12h candles"), { status: 502 });
  const dirs = ["both", "long", "short"];
  // 1) 12시간봉만으로 먼저 돌려서 "봉 안을 확인해야 하는 봉"을 모으고
  const need = new Set();
  for (const dir of dirs) for (const t of (await L.run(bars, { dir, startT: START, tight: true })).touchBars) need.add(t);
  // 2) 그 봉들의 1분봉을 8개씩 동시에 받아 두고
  const fine = new Map(), list = bars.filter(b => need.has(b.t));
  let idx = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (idx < list.length) { const b = list[idx++]; try { fine.set(b.t, await minuteBars(SYM, b)); } catch (e) {} }
  }));
  const getFine = async b => {
    if (fine.has(b.t)) return fine.get(b.t);
    try { const v = await minuteBars(SYM, b); fine.set(b.t, v); return v; } catch (e) { return null; }
  };
  // 3) 1분봉으로 다시 정확히 계산
  const out = { v: 1, sym: SYM, lastT: bars[bars.length - 1].t, at: now, startT: START };
  for (const dir of dirs) {
    const r = await L.run(bars, { dir, startT: START, tight: true, fine: getFine });
    out[dir] = {
      events: r.events, open: r.open, stats: r.stats,
      curve: r.trades.map(t => [t.t1, Math.round(t.eqAfter)]),      // 자산 곡선: 매매가 끝날 때마다 계좌 금액
      inexact: r.events.filter(e => !e.exact).length,
    };
  }
  return out;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
    const coin = String((req.query && req.query.sym) || "BTC").toUpperCase().replace(/USDT$/, "");
    const SYM = SYMS[coin];
    if (!SYM) return res.status(400).json({ error: "BTC or ETH only" });
    const KEY = keyOf(coin), LOCK = lockOf(coin);
    const now = Date.now();
    const lastClosed = Math.floor(now / H12) * H12 - H12;          // 가장 최근에 마감된 12시간봉의 시작 시각
    let cached = null;
    try { cached = await db.getJSON(KEY); } catch (e) {}
    const fresh = cached && cached.lastT >= lastClosed && !(cached.both && cached.both.inexact);
    if (!fresh) {
      // 여러 명이 동시에 열어도 계산은 한 번만 (90초 잠금). 잠금을 못 잡았는데 예전 결과가 있으면 그걸 줌
      let got = true;
      try { got = (await db.cmd("SET", LOCK, String(now), "NX", "EX", "90")) === "OK"; } catch (e) {}
      if (got || !cached) {
        try {
          cached = await compute(SYM, now);
          try { await db.setJSON(KEY, cached); } catch (e) {}
        } finally {
          try { await db.cmd("DEL", LOCK); } catch (e) {}
        }
      }
    }
    // 브라우저·Vercel 가장자리에서 2분 동안 재사용 (12시간마다 바뀌는 결과라 충분)
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=120, stale-while-revalidate=600");
    return res.status(200).json(cached);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "error" });
  }
};
