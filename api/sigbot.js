/* POST /api/sigbot — Signals 탭(LONG) 진입 신호 자동매매. 모의투자 계정 SIGBOT_NICKNAME(기본 "test")에만 주문해요.
   GitHub Actions(.github/workflows/sigbot.yml)가 5분마다 불러요. 규칙은 sigbot-core.js
   - 헤더 Authorization: Bearer <BOT_SECRET>  (추세추종 봇과 같은 비밀값)
   - SIGBOT_PAUSED=1 이면 잠시 멈춤 (이미 걸린 TP/SL 은 사이트에 들어가면 그대로 처리됨)
   - GET /api/sigbot (같은 헤더) → 봇 상태와 최근 기록
   흐름
   1) 1시간봉이 새로 시작됐으면 Signals 와 같은 계산으로 50개 코인 진입가·통계를 다시 계산해서 DB(sigbot:scan)에 저장
   2) 매번: 전체 코인 현재가 1번 받아서 상태(진입 구간 등) 갱신 → 계정 TP/SL·체결 소급 처리 → 새 진입 */
const crypto = require("crypto");
const db = require("./_lib/db");
const A = require("./_lib/auth");
const B = require("./_lib/binance");
const { sync } = require("./_lib/sync");
const E = require("../paper-engine");
const F = require("../fib-core");
const C = require("../sigbot-core");

const FAPI = "https://fapi.binance.com/fapi/v1";
const HOUR = 3600e3;
const SCAN_KEY = "sigbot:scan", RANK_KEY = "sigbot:rank";
const STABLES = new Set(["USDC", "FDUSD", "TUSD", "BUSD", "USDP", "DAI", "EUR", "AEUR", "USDE", "XUSD", "BFUSD", "RLUSD", "USD1", "PYUSD", "EURI"]);
const COMMODITY_TOKENS = new Set(["PAXG", "XAUT", "XAUM", "KAU", "KAG", "DGX", "PMGT", "XAU", "XAG", "XPT", "XPD"]);
const base = s => s.replace(/^(1000000|10000|1000|1M)(?=[A-Z])/, "");

async function jget(url, ms = 10000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${res.status} ${url.split("?")[0]}`);
  return res.json();
}

// 시가총액 순위 (코인게코 1~250위, 하루 한 번만 받고 실패하면 저장값 사용)
async function ranks(now) {
  const old = await db.getJSON(RANK_KEY);
  if (old && now - old.at < 24 * HOUR) return old.R;
  try {
    const rows = await jget("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1");
    const R = {};
    for (const c of rows) { const s = c.symbol.toUpperCase(); if (!R[s] && c.market_cap_rank) R[s] = c.market_cap_rank; }
    if (Object.keys(R).length) { await db.setJSON(RANK_KEY, { at: now, R }); return R; }
  } catch (e) {}
  return old ? old.R : null;
}

// Signals 자동 스캔과 같은 코인 고르기: 코인만 · 시총 150위 안 · 24시간 거래량 상위 50개
async function universe(R) {
  const [info, rows] = await Promise.all([jget(`${FAPI}/exchangeInfo`), jget(`${FAPI}/ticker/24hr`)]);
  const notCoin = new Set();
  for (const x of info.symbols) if (x.quoteAsset === "USDT" && x.underlyingType && x.underlyingType !== "COIN") notCoin.add(x.baseAsset);
  const dayAgo = Date.now() - 86400e3;
  return rows
    .filter(x => x.symbol.endsWith("USDT") && !x.symbol.includes("_") && +x.quoteVolume > 0 && x.closeTime > dayAgo)
    .map(x => ({ sym: x.symbol.slice(0, -4), vol: +x.quoteVolume }))
    .filter(x => !STABLES.has(x.sym) && !notCoin.has(x.sym) && !COMMODITY_TOKENS.has(base(x.sym)))
    .filter(x => { const r = R[base(x.sym)]; return r && r <= C.P.mcap; })
    .sort((a, b) => b.vol - a.vol)
    .slice(0, C.P.top)
    .map(x => x.sym);
}

// 1시간봉 2000개 (1500 + 500, 마지막 봉은 지금 만들어지는 중인 봉 — 사이트와 같음)
async function candles(sym) {
  let all = [], end = "";
  while (all.length < C.P.count) {
    const limit = Math.min(1500, C.P.count - all.length);
    const rows = await jget(`${FAPI}/klines?symbol=${sym}USDT&interval=${C.P.interval}&limit=${limit}` + (end ? `&endTime=${end}` : ""));
    if (!rows.length) break;
    all = rows.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] })).concat(all);
    end = rows[0][0] - 1;
    if (rows.length < limit) break;
  }
  return all;
}

async function scanAll(now) {
  const R = await ranks(now);
  if (!R) throw new Error("시가총액 순위(코인게코)를 못 받아서 이번 스캔은 건너뜀");
  const syms = await universe(R);
  const coins = [];
  let next = 0;
  async function worker() {
    while (next < syms.length) {
      const sym = syms[next++];
      try {
        const cs = await candles(sym);
        if (cs.length < 100) continue;
        const r = F.analyze(cs, { n: C.P.n, k: C.P.k, ratio: C.P.ratio, direction: "long" });
        coins.push({ sym, stats: r.stats, current: r.current });
      } catch (e) {}
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  coins.sort((a, b) => syms.indexOf(a.sym) - syms.indexOf(b.sym));
  return { bar: Math.floor(now / HOUR) * HOUR, at: now, coins };
}

module.exports = async (req, res) => {
  try {
    // BOT_SECRET(GitHub Actions) 또는 TICK_SECRET(Upstash QStash 5분 타이머) 둘 중 하나와 맞으면 통과
    const secs = [process.env.BOT_SECRET, process.env.TICK_SECRET].filter(Boolean);
    if (!secs.length) throw A.fail(503, "Bot is not set up (BOT_SECRET missing)");
    const h = String(req.headers.authorization || "");
    const got = crypto.createHash("sha256").update(h.startsWith("Bearer ") ? h.slice(7) : "").digest();
    if (!secs.some(s => crypto.timingSafeEqual(got, crypto.createHash("sha256").update(s).digest()))) throw A.fail(401, "Unauthorized");

    const key = A.userKey(process.env.SIGBOT_NICKNAME || "test");
    if (req.method === "GET") {
      const user = await db.getJSON(key);
      if (!user) throw A.fail(404, "Sigbot account not found");
      return res.status(200).json({ ok: true, sbot: user.sbot || null });
    }
    if (req.method !== "POST") throw A.fail(405, "GET or POST only");
    if (process.env.SIGBOT_PAUSED === "1") return res.status(200).json({ ok: true, paused: true });

    const now = Date.now();
    // 1) 1시간봉이 새로 시작됐으면 다시 계산 (계정은 아직 안 읽음 → 그동안 사용자가 주문해도 덮어쓰지 않음)
    let scan = await db.getJSON(SCAN_KEY), scanned = false, scanErr = null;
    if (!scan || scan.bar < Math.floor(now / HOUR) * HOUR) {
      try { scan = await scanAll(now); scanned = true; } catch (e) { scanErr = e.message; }
    }
    if (!scan) throw A.fail(503, scanErr || "No scan yet");

    // 2) 현재가 → 계정 소급 처리 → 규칙 실행
    const prices = {};
    for (const x of await jget(`${FAPI}/ticker/price`)) prices[x.symbol] = +x.price;
    const user = await db.getJSON(key);
    if (!user) throw A.fail(404, "Sigbot account not found (SIGBOT_NICKNAME)");
    const sy = await sync(user.st, now);
    if (E.mergeAll(user.st)) sy.dirty = true;
    if (sy.behind) {                                       // 밀린 1분봉이 많으면 이번엔 따라잡기만
      await db.setJSON(key, user);
      await db.setJSON(SCAN_KEY, scan);
      return res.status(202).json({ ok: true, catchingUp: true });
    }
    const out = C.step(user, scan, prices, now, E);
    if (out.dirty || sy.dirty) await db.setJSON(key, user);
    await db.setJSON(SCAN_KEY, scan);                      // 실시간으로 갱신된 도달 여부도 저장

    const hit = scan.coins.filter(c => F.label(c.current) === "진입 구간").map(c => c.sym);
    res.status(200).json({ ok: true, scanned, scanErr, coins: scan.coins.length, inZone: hit,
                           active: Object.keys(user.sbot.act), did: out.log, events: sy.events.length });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
};
