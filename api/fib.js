/* GET /api/fib?ex=futures&iv=1h&count=2000&n=5&k=20&d=c&dir=long&syms=BTC,ETH,...
   Crypto · Stock · 코인 상세 화면의 진입가 계산을 서버에서 해서 "결과만" 돌려줘요.
   계산 엔진(_lib/fib-core.js)은 서버 안에만 있고 브라우저로는 절대 내려가지 않아요.
   - 돌려주는 것: 현재가, 진입가, 예상가, 거리, 상태, 통계, 과거 터치 시각
   - 돌려주지 않는 것: 계산에 쓴 기준 고점·저점, 깊이 비율 같은 계산 재료
   - 같은 주소(같은 설정·같은 코인 묶음)는 Vercel 가장자리에서 잠깐 재사용 → 방문자가 많아도 서버 계산은 조금만 */
const F = require("./_lib/fib-core");

const BASE = { futures: { url: "https://fapi.binance.com/fapi/v1", max: 1500 }, binance: { url: "https://api.binance.com/api/v3", max: 1000 } };
const IV = new Set(["15m", "30m", "1h", "2h", "4h", "1d"]);
const DEPTH = { a: 0.5, b: 0.618, c: 1 };          // 화면에는 A·B·C 이름만 보여요
const MAX_SYMS = 12;

const bad = msg => Object.assign(new Error(msg), { status: 400 });
const intIn = (v, d, lo, hi) => { v = Math.round(+v); return Number.isFinite(v) && v >= lo && v <= hi ? v : d; };

async function jget(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (res.status === 400) throw new Error("이 거래소에 없는 코인이에요");
  if (!res.ok) throw new Error("거래소 응답 오류 " + res.status);
  return res.json();
}

// 오래된 것 → 최신 순 캔들 count 개 (마지막 봉은 지금 만들어지는 중인 봉 — 화면과 같음)
async function candles(ex, sym, iv, count) {
  const B = BASE[ex];
  let all = [], end = "";
  const limit = Math.min(count, B.max);
  while (all.length < count) {
    const rows = await jget(`${B.url}/klines?symbol=${sym}USDT&interval=${iv}&limit=${limit}` + (end ? `&endTime=${end}` : ""));
    if (!rows.length) break;
    all = rows.concat(all);
    end = rows[0][0] - 1;
    if (rows.length < limit) break;
  }
  return all.slice(-count).map(r => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
}

// 화면에 필요한 값만 골라 담기 (계산 재료는 빼고)
function publicResult(sym, res, cs) {
  const c = res.current || {};
  const short = res.direction === "short";
  const r2 = v => v == null || !Number.isFinite(v) ? null : v;
  const cur = c.level ? {
    state: c.state, level: c.level, expected: r2(c.expected), distance: r2(c.distance),
    touched: !!c.touched, touchT: c.touchIdx != null && cs[c.touchIdx] ? cs[c.touchIdx].t : null,
    minSince: r2(c.minSince), maxSince: r2(c.maxSince),
    brk: short ? c.L : c.H,                            // 이 가격을 반대로 넘으면 지금 신호가 끝남 (실시간 판정용)
    outLimit: r2(c.outLimit), phase: c.phase || null, progress: r2(c.progress), lowPct: r2(c.lowPct), highPct: r2(c.highPct),
  } : { state: c.state || null, level: null };
  return { market: sym, direction: res.direction, price: res.price, stats: res.stats, current: cur, touchT: res.touches.map(t => t.t) };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") throw Object.assign(new Error("GET only"), { status: 405 });
    const q = req.query || {};
    const ex = q.ex === "binance" ? "binance" : "futures";
    const iv = IV.has(String(q.iv)) ? String(q.iv) : "1h";
    const count = intIn(q.count, 2000, 100, 2000);
    const n = intIn(q.n, 5, 2, 30), k = intIn(q.k, 20, 3, 100);
    const ratio = DEPTH[String(q.d || "c").toLowerCase()] || DEPTH.c;
    const direction = q.dir === "short" ? "short" : "long";
    const syms = [...new Set(String(q.syms || "").toUpperCase().split(",").map(s => s.trim()).filter(Boolean))];
    if (!syms.length) throw bad("syms 가 필요해요");
    if (syms.length > MAX_SYMS) throw bad(`한 번에 ${MAX_SYMS}개까지만`);
    if (syms.some(s => !/^[A-Z0-9]{1,20}$/.test(s))) throw bad("코인 기호가 올바르지 않아요");

    const rows = new Array(syms.length);
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < syms.length) {
        const i = next++, sym = syms[i];
        try {
          const cs = await candles(ex, sym, iv, count);
          if (cs.length < 100) throw new Error(`상장된 지 얼마 안 돼서 데이터가 부족해요 (캔들 ${cs.length}개)`);
          rows[i] = publicResult(sym, F.analyze(cs, { n, k, ratio, direction }), cs);
        } catch (e) { rows[i] = { market: sym, error: e.message }; }
      }
    }));
    // 진행 중인 봉 기준이라 짧게만 재사용 (실시간 가격은 브라우저가 따로 받아서 반영)
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=30");
    res.status(200).json({ at: Date.now(), rows });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "error" });
  }
};
