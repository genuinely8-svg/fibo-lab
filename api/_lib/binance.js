/* 바이낸스 선물 REST (서버 지역은 vercel.json 에서 서울 icn1 — 미국 지역은 차단됨) */
const BASE = "https://fapi.binance.com";
const MIN = 60000;

async function jget(path) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    const e = new Error(res.status === 400 ? "Unknown symbol" : "Binance error " + res.status);
    e.status = res.status === 400 ? 400 : 502;
    throw e;
  }
  return res.json();
}

async function price(sym) {
  const p = +(await jget("/fapi/v1/ticker/price?symbol=" + sym)).price;
  if (!(p > 0)) { const e = new Error("Could not get price"); e.status = 502; throw e; }
  return p;
}

// from 부터 to(포함 안 함) 사이 닫힌 1분봉. 한 번에 최대 6번(약 6.2일) 받고, 못 받은 만큼은 coveredTo 로 알려줌
async function klines(sym, from, to) {
  const out = [];
  let start = from, pages = 0;
  while (start < to && pages < 6) {
    pages++;
    const rows = await jget(`/fapi/v1/klines?symbol=${sym}&interval=1m&startTime=${start}&endTime=${to - 1}&limit=1500`);
    for (const r of rows) out.push({ t: r[0], sym, o: +r[1], h: +r[2], l: +r[3], c: +r[4] });
    if (rows.length < 1500) { start = to; break; }
    start = rows[rows.length - 1][0] + MIN;
  }
  return { candles: out, coveredTo: Math.min(start, to) };
}

// 최근 봉 limit 개 (자동매매용 12시간봉 등). 마지막 봉은 아직 안 닫혔을 수 있어서 ct(마감 시각)도 같이
async function candles(sym, interval, limit) {
  const rows = await jget(`/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`);
  return rows.map(r => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], ct: r[6] }));
}

module.exports = { price, klines, candles, MIN };
