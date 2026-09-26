/*
  meta.js — 코인 부가 정보 (로고, 이름, 시가총액 순위, 주식·원자재 구분)
  ---------------------------------------------------------------
  - 코인게코 시가총액 상위 1000개: 로고, 영문 이름, 순위        → 하루 동안 저장
  - 업비트 원화 마켓: 한글 이름                                → 하루 동안 저장
  - 바이낸스 선물 상품 정보: 코인이 아닌 것(금·은·주식 등) 구분  → 6시간 저장
  - 금·은 담보 토큰(PAXG, XAUT 등)도 원자재로 봄
  - 비트겟 선물의 실물자산(isRwa) 목록                         → 6시간 저장 (24시간변동률 페이지)
  사용: await CoinMeta.load();  CoinMeta.rank("BTC") → 1
*/
(function () {
  "use strict";
  const DAY = 24 * 3600e3;
  const get = (k, age) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); if (v && Date.now() - v.at < age) return v.data; } catch (e) {} return null; };
  const put = (k, d) => { try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), data: d })); } catch (e) {} };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  let top = { L: {}, N: {}, R: {} }, ko = {}, types = {}, loaded = false, loading = null;

  // 1000PEPE, 1000000MOG, 1MBABYDOGE 같은 선물 이름 → PEPE, MOG, BABYDOGE
  const base = s => String(s).toUpperCase().replace(/^(1000000|10000|1000|1M)(?=[A-Z])/, "");

  const TYPE_LABEL = { COMMODITY: "원자재", COMMODITY_TOKEN: "원자재 토큰", EQUITY: "미국 주식", KR_EQUITY: "한국 주식",
                      HK_EQUITY: "홍콩 주식", CN_EQUITY: "중국 주식", FX: "외환", PREMARKET: "상장 전 주식", INDEX: "지수", ETF: "ETF" };
  // 금·은·백금 가격을 따라가는 토큰 (코인 형태지만 원자재)
  const COMMODITY_TOKENS = new Set(["PAXG", "XAUT", "XAUM", "KAU", "KAG", "DGX", "PMGT", "XAU", "XAG", "XPT", "XPD"]);
  const typeOf = s => { const S = String(s).toUpperCase(); return types[S] || (COMMODITY_TOKENS.has(base(S)) ? "COMMODITY_TOKEN" : null); };

  async function loadTop() {
    const hit = get("cg-top1000-v1", DAY);
    if (hit) { top = hit; return; }
    const L = {}, N = {}, R = {};
    for (let page = 1; page <= 4; page++) {               // 250개씩 4번 = 1000위까지
      try {
        const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`);
        if (!res.ok) break;                               // 요청 제한이면 받은 데까지만
        for (const c of await res.json()) {
          const s = c.symbol.toUpperCase();
          if (R[s]) continue;                             // 같은 기호면 순위 높은 쪽
          R[s] = c.market_cap_rank; N[s] = c.name; L[s] = (c.image || "").replace("/large/", "/small/");
        }
      } catch (e) { break; }
      if (page < 4) await wait(1200);
    }
    if (!Object.keys(R).length) return;
    top = { L, N, R };
    put("cg-top1000-v1", top);
    put("cg-logos-v1", L); put("cg-names-v1", N);         // 다른 페이지(common.js)도 같이 씀
  }
  async function loadKo() {
    const hit = get("upbit-ko-v1", DAY);
    if (hit) { ko = hit; return; }
    try {
      const res = await fetch("https://api.upbit.com/v1/market/all?isDetails=false");
      if (!res.ok) return;
      for (const m of await res.json()) if (m.market.startsWith("KRW-")) ko[m.market.slice(4)] = m.korean_name;
      put("upbit-ko-v1", ko);
    } catch (e) {}
  }
  async function loadTypes() {
    const hit = get("bn-fut-types-v1", 6 * 3600e3);
    if (hit) { types = hit; return; }
    try {
      const j = await (await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo")).json();
      const t = {};
      for (const x of j.symbols) if (x.quoteAsset === "USDT" && x.underlyingType && x.underlyingType !== "COIN") t[x.baseAsset] = x.underlyingType;
      types = t; put("bn-fut-types-v1", t);
    } catch (e) {}
  }

  // 비트겟 선물에서 실물자산(주식·원자재) 상품의 기호 목록
  let rwaP = null;
  function bitgetRwa() {
    if (rwaP) return rwaP;
    rwaP = (async () => {
      let list = get("bitget-rwa-v1", 6 * 3600e3);
      if (!list) {
        const j = await (await fetch("https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES")).json();
        list = (j.data || []).filter(x => x.isRwa === "YES").map(x => x.baseCoin);
        put("bitget-rwa-v1", list);
      }
      return new Set(list);
    })();
    rwaP.catch(() => { rwaP = null; });
    return rwaP;
  }

  // 코인/주식·원자재 구분 정보만 먼저 필요할 때 (자동 스캔은 이것만 기다림)
  let typesP = null;
  const typesLoaded = () => typesP || (typesP = loadTypes());

  function load() {
    if (loaded) return Promise.resolve();
    if (!loading) loading = Promise.all([loadTop(), loadKo(), typesLoaded()]).then(() => { loaded = true; });
    return loading;
  }

  window.CoinMeta = {
    load,
    typesLoaded,
    base,
    rank: s => top.R[base(s)] || null,
    logo: s => top.L[base(s)] || null,
    name: s => top.N[base(s)] || null,
    ko: s => ko[base(s)] || null,
    type: typeOf,                                                        // "COMMODITY" 등, 코인이면 null
    typeLabel: s => { const t = typeOf(s); return t ? (TYPE_LABEL[t] || "전통 금융") : null; },
    isCrypto: s => !typeOf(s),
    bitgetRwa,
    isLoaded: () => loaded,
    hasTop: () => Object.keys(top.R).length > 0,
  };
})();
