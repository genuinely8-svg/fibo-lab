/*
  coinpicker.js — 코인 검색 칸 (자동완성)
  ---------------------------------------------------------------
  입력칸에 붙이면: 한글 이름·영문 이름·티커로 검색 → 로고·순위·거래량과 함께 목록이 뜸
  - 바이낸스 선물에서 거래되는 "코인"만 (원자재·주식 상품은 meta.js 로 걸러냄)
  - 빈 칸을 누르면 거래량 많은 코인부터 보여줌
  사용: CoinPicker.attach(inputElement, { onPick: sym => { ... } })
  meta.js 가 먼저 불러와져 있어야 해요.
*/
(function () {
  "use strict";
  const STABLES = new Set(["USDC", "FDUSD", "TUSD", "BUSD", "USDP", "DAI", "EUR", "AEUR", "USDE", "XUSD", "BFUSD", "RLUSD", "USD1", "PYUSD", "EURI"]);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const vol = v => v >= 1e9 ? "$" + (v / 1e9).toFixed(1) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(0) + "M" : "$" + (v / 1e3).toFixed(0) + "K";

  const st = document.createElement("style");
  st.textContent = `
    .cp-wrap{position:relative;display:inline-block}
    .cp-list{position:absolute;z-index:30;top:calc(100% + 4px);left:0;width:320px;max-height:360px;overflow:auto;background:var(--card);
             border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);font-size:13px;color:var(--text)}
    .cp-list .cp-h{padding:8px 10px 4px;font-size:11px;color:var(--muted);cursor:default}
    .cp-list .cp-i{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer}
    .cp-list .cp-i.on,.cp-list .cp-i:hover{background:color-mix(in srgb,var(--accent) 14%,transparent)}
    .cp-list img,.cp-list .ph{width:20px;height:20px;border-radius:50%;flex:none}
    .cp-list .ph{display:inline-grid;place-items:center;font-size:9px;color:var(--muted);border:1px solid var(--line)}
    .cp-list .nm{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px}
    .cp-list small{color:var(--muted);margin-left:auto;font-size:11px;flex:none}
    .cp-list .mc{font-size:11px;font-weight:600;padding:0 5px;border-radius:6px;border:1px solid var(--line);color:var(--muted);flex:none}`;
  document.head.appendChild(st);

  // 바이낸스 선물에서 거래되는 코인 목록 (거래량 순) — 한 번 받아서 5분 동안 씀
  let uni = null, uniAt = 0, uniP = null;
  function universe() {
    if (uni && Date.now() - uniAt < 5 * 60e3) return Promise.resolve(uni);
    if (uniP) return uniP;
    uniP = (async () => {
      const [rows] = await Promise.all([
        fetch("https://fapi.binance.com/fapi/v1/ticker/24hr").then(r => r.json()),
        CoinMeta.typesLoaded(),
      ]);
      const dayAgo = Date.now() - 86400e3;
      uni = rows
        .filter(x => x.symbol.endsWith("USDT") && !x.symbol.includes("_") && +x.quoteVolume > 0 && x.closeTime > dayAgo)
        .map(x => ({ sym: x.symbol.slice(0, -4), vol: +x.quoteVolume }))
        .filter(x => !STABLES.has(x.sym) && CoinMeta.isCrypto(x.sym))
        .sort((a, b) => b.vol - a.vol);
      uniAt = Date.now();
      return uni;
    })().finally(() => { uniP = null; });
    return uniP;
  }

  function attach(input, { onPick }) {
    input.removeAttribute("list");
    input.setAttribute("autocomplete", "off");
    if (!input.placeholder) input.placeholder = "코인 검색 (예: 비트, SOL)";
    const wrap = document.createElement("span");
    wrap.className = "cp-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const list = document.createElement("div");
    list.className = "cp-list"; list.hidden = true;
    wrap.appendChild(list);
    let items = [], idx = 0, fresh = false;   // fresh: 방금 클릭해서 아직 아무것도 안 친 상태 → 전체 목록
    CoinMeta.load().then(() => { if (!list.hidden) show(); });     // 로고·순위·한글 이름이 준비되면 다시 그림

    async function show() {
      let all = [];
      try { all = await universe(); } catch (e) { list.innerHTML = `<div class="cp-h">코인 목록을 못 불러왔어요</div>`; list.hidden = false; return; }
      const raw = fresh ? "" : input.value.trim(), Q = raw.toUpperCase(), low = raw.toLowerCase();
      const ko = s => CoinMeta.ko(s) || "", en = s => (CoinMeta.name(s) || "").toLowerCase();
      if (!raw) items = all.slice(0, 10);
      else {
        const score = u => u.sym === Q ? 0 : CoinMeta.base(u.sym) === Q ? 0 : u.sym.startsWith(Q) ? 1 : ko(u.sym).startsWith(raw) ? 2 : 3;
        items = all.filter(u => u.sym.includes(Q) || ko(u.sym).includes(raw) || en(u.sym).includes(low))
          .sort((a, b) => score(a) - score(b) || b.vol - a.vol).slice(0, 10);
      }
      idx = 0;
      const head = raw ? "" : `<div class="cp-h">거래량 많은 코인</div>`;
      list.innerHTML = head + (items.map((u, i) => {
        const logo = CoinMeta.logo(u.sym);
        const img = logo ? `<img src="${esc(logo)}" alt="" onerror="this.style.visibility='hidden'">` : `<span class="ph">${esc(CoinMeta.base(u.sym).slice(0, 3))}</span>`;
        const r = CoinMeta.rank(u.sym);
        return `<div class="cp-i${i === 0 ? " on" : ""}" data-i="${i}">${img}<b>${esc(u.sym)}</b>${r ? `<span class="mc">#${r}</span>` : ""}
          <span class="nm">${esc(ko(u.sym) || CoinMeta.name(u.sym) || "")}</span><small>${vol(u.vol)}</small></div>`;
      }).join("") || `<div class="cp-h">바이낸스 선물에 없는 코인이에요</div>`);
      list.hidden = false;
      for (const d of list.querySelectorAll(".cp-i")) d.onmousedown = e => { e.preventDefault(); pick(+d.dataset.i); };
    }
    function pick(i) {
      const u = items[i]; if (!u) return;
      input.value = u.sym; list.hidden = true;
      onPick(u.sym);
    }
    input.addEventListener("focus", () => { input.select(); fresh = true; show(); });
    input.addEventListener("input", () => { fresh = false; show(); });
    input.addEventListener("keydown", e => {
      const els = list.querySelectorAll(".cp-i");
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !list.hidden && els.length) {
        e.preventDefault();
        idx = (idx + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length;
        els.forEach((d, i) => d.classList.toggle("on", i === idx));
        els[idx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!list.hidden && items.length) pick(idx);
        else { list.hidden = true; onPick(input.value.trim().toUpperCase().replace(/USDT$/, "")); }
      } else if (e.key === "Escape") { list.hidden = true; input.blur(); }
    });
    input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150));
  }

  window.CoinPicker = { attach };
})();
