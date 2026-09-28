/*
  alert.js — 진입 신호 텔레그램 알림 (GitHub Actions가 5분마다 실행)
  ---------------------------------------------------------------
  사이트 메인(TEST 참고용)과 같은 계산:
    바이낸스 선물 · 1시간봉 · 캔들 2000개 · 스윙 민감도 5 · 관찰 봉 20 · 거래량 상위 50개 (코인만)
  알림:
    [근접] 진입까지 거리 0.3% 이내로 들어오면 1번
    [진입] 가격이 진입가에 닿으면(거리 0% 이하) 1번
    진입가가 새로 바뀌면(새 스윙) 다시 알림 가능
  필요한 비밀값 (GitHub → Settings → Secrets and variables → Actions):
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
*/
const fs = require("fs");
const FibCore = require("./fib-core.js");

const CFG = { interval: "1h", count: 2000, n: 5, k: 20, top: 50, near: 0.3 };
const STATE_FILE = ".alert-state/state.json";
const SITE = "https://genuinely8-svg.github.io/fibo-lab/";
const STABLES = new Set(["USDC", "FDUSD", "TUSD", "BUSD", "USDP", "DAI", "EUR", "AEUR", "USDE", "XUSD", "BFUSD", "RLUSD", "USD1", "PYUSD", "EURI"]);
const COMMODITY_TOKENS = new Set(["PAXG", "XAUT", "XAUM", "KAU", "KAG", "DGX", "PMGT", "XAU", "XAG", "XPT", "XPD"]);

// 바이낸스 선물이 막히면(미국 서버에서 가끔 막힘) 바이낸스 현물 공개 데이터로 대신 계산
const SOURCES = [
  { name: "바이낸스 선물", base: "https://fapi.binance.com/fapi/v1", max: 1500 },
  { name: "바이낸스 현물", base: "https://data-api.binance.vision/api/v3", max: 1000 },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url);
    if (res.status === 429 || res.status === 418) { await sleep(5000); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error("요청 제한 " + url);
}

async function pickSource() {
  for (const s of SOURCES) {
    try { await getJSON(`${s.base}/ping`); return s; } catch (e) { console.log(`${s.name} 접속 안 됨: ${e.message}`); }
  }
  throw new Error("바이낸스에 접속할 수 없어요");
}

async function universe(src) {
  // 선물이면 주식·원자재 상품 제외 목록을 받아둠
  const notCoin = new Set();
  if (src.name.includes("선물")) {
    try {
      const j = await getJSON(`${src.base}/exchangeInfo`);
      for (const x of j.symbols) if (x.quoteAsset === "USDT" && x.underlyingType && x.underlyingType !== "COIN") notCoin.add(x.baseAsset);
    } catch (e) {}
  }
  const rows = await getJSON(`${src.base}/ticker/24hr`);
  const dayAgo = Date.now() - 86400e3;
  const base = s => s.replace(/^(1000000|10000|1000|1M)(?=[A-Z])/, "");
  return rows
    .filter(x => x.symbol.endsWith("USDT") && !x.symbol.includes("_") && +x.quoteVolume > 0 && x.closeTime > dayAgo)
    .map(x => ({ sym: x.symbol.slice(0, -4), vol: +x.quoteVolume }))
    .filter(x => !STABLES.has(x.sym) && !notCoin.has(x.sym) && !COMMODITY_TOKENS.has(base(x.sym)))
    .sort((a, b) => b.vol - a.vol)
    .slice(0, CFG.top);
}

async function candles(src, sym) {
  let all = [], end = "";
  while (all.length < CFG.count) {
    const limit = Math.min(src.max, CFG.count - all.length);
    const rows = await getJSON(`${src.base}/klines?symbol=${sym}USDT&interval=${CFG.interval}&limit=${limit}` + (end ? `&endTime=${end}` : ""));
    if (!rows.length) break;
    all = rows.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] })).concat(all);
    end = rows[0][0] - 1;
    if (rows.length < limit) break;
  }
  return all;
}

const fmt = v => v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : v >= 1 ? v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : v.toPrecision(4);

async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.log("[텔레그램 비밀값 없음 → 화면에만 출력]\n" + text); return; }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  if (!res.ok) console.log("텔레그램 전송 실패", res.status, await res.text());
}

(async () => {
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
  const src = await pickSource();
  const coins = await universe(src);
  console.log(`${src.name} · 상위 ${coins.length}개 확인`);

  const msgs = [];
  for (const { sym } of coins) {
    let r;
    try {
      const cs = await candles(src, sym);
      if (cs.length < 100) continue;
      r = FibCore.analyze(cs, { n: CFG.n, k: CFG.k });
    } catch (e) { console.log(sym, e.message); continue; }
    await sleep(150);
    const cur = r.current;
    if (!cur || !cur.level) continue;
    const key = cur.level.toPrecision(8);          // 진입가가 바뀌면 새 알림
    const st = state[sym] && state[sym].key === key ? state[sym] : { key, near: false, entry: false };
    const d = cur.distance, s = r.stats;
    const info = `현재가 $${fmt(r.price)} · 진입가 $${fmt(cur.level)}` +
      (s.count ? `\n과거 터치 ${s.count}회 · 평균 반등 ${s.reboundAvg.toFixed(2)}% · 반등 우세 ${s.winRate.toFixed(1)}%` : "") +
      (cur.expected ? `\n예상 반등가 $${fmt(cur.expected)}` : "");
    if (cur.touched && cur.phase === "진입 구간" && !st.entry) {
      msgs.push(`🟢 [진입] ${sym}\n${info}`);
      st.entry = true; st.near = true;
    } else if (!cur.touched && d > 0 && d <= CFG.near && !st.near) {
      msgs.push(`🟡 [근접] ${sym} 진입까지 거리 ${d.toFixed(2)}%\n${info}`);
      st.near = true;
    }
    state[sym] = st;
  }

  for (const m of msgs) { await telegram(`${m}\n(1시간봉 · ${src.name})\n${SITE}`); await sleep(300); }
  console.log(`보낸 알림 ${msgs.length}개`);

  // 목록에서 빠진 지 오래된 코인 기록은 정리
  const live = new Set(coins.map(c => c.sym));
  for (const k of Object.keys(state)) if (!live.has(k)) delete state[k];
  fs.mkdirSync(".alert-state", { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
})().catch(e => { console.error(e); process.exit(1); });
