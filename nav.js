/*
  nav.js — 모든 페이지 위쪽의 탭 메뉴
  페이지에 <nav id="nav"></nav> 를 두고 이 파일을 불러오면 탭이 그려져요.
  탭을 추가하려면 아래 TABS 목록에 한 줄만 더 쓰면 돼요.
*/
(function () {
  const TABS = [
    ["index.html", "Crypto"],
    ["signals-rwa.html", "Stock"],
    ["lowsig.html", "Trading Engine"],
    ["paper.html", "Paper Trading"],
    ["calc.html", "Calculator"],
  ];
  // "인사이트" 묶음: PC는 마우스를 올리면 아래로 펼쳐지는 패널, 휴대폰은 누르면 아래에서 올라오는 시트
  // [주소, 한글 이름, 영어 이름, 한글 설명, 영어 설명, 아이콘, 색]
  const INSIGHTS = [
    ["market.html", "시장 방향", "Market Direction", "롱·숏 신호로 보는 상승장 / 하락장", "Bull or bear market at a glance", "trend", "#2563eb"],
    ["liquidation.html", "청산히트맵", "Liquidation Map", "청산이 몰려 있는 가격대", "Where liquidations cluster", "heat", "#ef4444"],
    ["oi.html", "OI", "OI", "미결제약정 · 펀딩비 · 롱숏 비율", "Open interest, funding, long/short", "bars", "#8b5cf6"],
    ["rank.html", "코인순위", "Rankings", "시가총액 순위", "Market cap ranking", "list", "#f59e0b"],
    ["movers.html", "24시간변동률", "Top Movers", "24시간 상승 · 하락 순위", "24h gainers & losers", "move", "#10b981"],
    ["news.html", "주요뉴스", "News", "코인 뉴스 · 거래소 공지", "Crypto news & exchange notices", "news", "#64748b"],
  ];
  const ICON = {
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    heat: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    move: '<path d="M7 17V5l-4 4M7 5l4 4"/><path d="M17 7v12l4-4M17 19l-4-4"/>',
    news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
  };
  const LANG = (() => { try { const v = localStorage.getItem("artha-lang"); if (v) return v; } catch (e) {} const m = document.cookie.match(/(?:^|;\s*)googtrans=\/ko\/([^;]+)/); return m ? decodeURIComponent(m[1]) : "en"; })();
  const KO = LANG === "ko";
  const style = document.createElement("style");
  style.textContent = `
    /* 글꼴: 본문은 Pretendard(한글·숫자 깔끔) · 로고는 GWAVE 벡터 로고 (G는 녹색 그라데이션, WAVE는 글자색이라 다크 모드에서도 보임) */
    body{font-family:"Pretendard Variable",Pretendard,system-ui,-apple-system,"Malgun Gothic",sans-serif;font-feature-settings:"tnum"}
    h1.brand{font-family:"Space Grotesk",system-ui,sans-serif;font-weight:700;letter-spacing:.08em;font-size:26px;line-height:1}
    h1.brand a{display:inline-flex;align-items:center;color:var(--text)}
    h1.brand svg{height:28px;width:auto;display:block}
    @media (max-width:700px){ h1.brand svg{height:24px} }
    @media (max-width:700px){ h1.brand{font-size:23px} }
    .navwrap{display:flex;align-items:stretch;margin:0 0 16px}
    /* overflow-y:hidden — 가로 스크롤 칸이 손가락 따라 위아래로 흔들리지 않게 (아이폰) */
    .navtabs{flex:1;min-width:0;display:flex;gap:4px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;
             border-bottom:1px solid var(--line);scrollbar-width:none}
    /* 다크/라이트 전환 버튼: 탭 오른쪽 끝에 고정 (탭이 옆으로 밀려도 안 가려짐) */
    /* 다크/라이트 전환: 아이폰 설정 스위치 모양 (작게) — 언어 버튼 옆 */
    button.themebtn{flex:none;display:inline-flex;align-items:center;padding:0;border:0;background:transparent;cursor:pointer;border-radius:999px}
    .tsw{position:relative;width:42px;height:24px;border-radius:999px;background:#d1d1d6;transition:background .3s ease}
    .tsw i{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 2px 5px rgba(0,0,0,.2);
           display:grid;place-items:center;transition:transform .3s cubic-bezier(.3,1.4,.6,1),width .15s}
    .tsw svg{width:12px;height:12px;fill:none;stroke:#8e8e93;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .tsw .mo{display:none} .tsw.dark .su{display:none} .tsw.dark .mo{display:block}
    .tsw.dark{background:#34c759}
    .tsw.dark i{transform:translateX(18px)}
    button.themebtn:active .tsw i{width:24px}
    button.themebtn:active .tsw.dark i{transform:translateX(14px)}
    button.themebtn:focus-visible .tsw{outline:2px solid var(--accent);outline-offset:2px}
    /* 로고 Gwave 누르면 홈 */
    h1.brand a{color:inherit;text-decoration:none}
    .navtabs::-webkit-scrollbar{display:none}
    /* 위쪽 탭·인사이트 이름 글꼴: IBM Plex Mono (인트로 문구와 같은 글꼴) — 설명(한글)은 본문 글꼴 그대로 */
    .navtabs a,.navpanel .ttl,.navsheet .ttl,.insi b{font-family:"IBM Plex Mono",ui-monospace,monospace;letter-spacing:.01em}
    .navtabs a{flex:none;padding:10px 14px;color:var(--muted);text-decoration:none;font-weight:500;font-size:14px;
               border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
    .navtabs a:hover{color:var(--text)}
    .navtabs a.on{color:var(--text);border-bottom-color:var(--accent)}
    /* 탭이 화면보다 넓으면 가장자리를 흐리게 해서 "옆으로 더 있어요" 표시 */
    .navtabs.more-r{-webkit-mask-image:linear-gradient(90deg,#000 80%,transparent);mask-image:linear-gradient(90deg,#000 80%,transparent)}
    .navtabs.more-l{-webkit-mask-image:linear-gradient(90deg,transparent,#000 20%);mask-image:linear-gradient(90deg,transparent,#000 20%)}
    .navtabs.more-l.more-r{-webkit-mask-image:linear-gradient(90deg,transparent,#000 20%,#000 80%,transparent);mask-image:linear-gradient(90deg,transparent,#000 20%,#000 80%,transparent)}
    @media (max-width:700px){ .navtabs a{padding:9px 11px;font-size:13px} }
    /* ── 인사이트 묶음 ── */
    .navwrap{position:relative}
    .navtabs a.navgrp{display:inline-flex;align-items:center;gap:5px;cursor:pointer;user-select:none}
    .navgrp .chev{font-size:10px;transition:transform .2s}
    .navwrap.open .navgrp .chev{transform:rotate(180deg)}
    .navpanel{position:absolute;top:calc(100% + 6px);z-index:60;width:min(640px,calc(100vw - 32px));padding:14px;border-radius:14px;
              background:var(--card);border:1px solid var(--line);box-shadow:0 18px 40px rgba(0,0,0,.28);
              display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;
              opacity:0;visibility:hidden;transform:translateY(-8px);transition:opacity .18s ease,transform .18s ease,visibility 0s linear .18s}
    .navwrap.open .navpanel{opacity:1;visibility:visible;transform:none;transition:opacity .18s ease,transform .18s ease}
    .navpanel .ttl{grid-column:1/-1;font-size:12px;color:var(--muted);font-weight:600;padding:2px 8px 8px;letter-spacing:.02em}
    .insi{display:flex;align-items:center;gap:12px;padding:10px;border-radius:10px;text-decoration:none;color:var(--text)}
    .insi:hover,.insi.on{background:color-mix(in srgb,var(--accent) 10%,transparent)}
    .insi .ic{flex:none;width:34px;height:34px;border-radius:9px;display:grid;place-items:center;color:#fff}
    .insi .ic svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .insi b{display:block;font-size:14px;font-weight:700}
    .insi small{display:block;font-size:12px;color:var(--muted);margin-top:2px;line-height:1.3}
    /* 휴대폰: 아래에서 올라오는 시트 */
    .navsheet-bg{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.45);opacity:0;visibility:hidden;transition:opacity .22s,visibility 0s linear .22s}
    .navsheet{position:fixed;left:0;right:0;bottom:0;z-index:91;background:var(--card);border-radius:18px 18px 0 0;border-top:1px solid var(--line);
              padding:8px 14px calc(16px + env(safe-area-inset-bottom));max-height:75vh;overflow-y:auto;transform:translateY(105%);transition:transform .26s cubic-bezier(.2,.8,.2,1)}
    .navsheet .grab{width:40px;height:4px;border-radius:2px;background:var(--line);margin:4px auto 10px}
    .navsheet .ttl{font-size:15px;font-weight:700;margin:0 4px 10px}
    .navsheet .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .navsheet .insi{flex-direction:column;align-items:flex-start;gap:8px;border:1px solid var(--line);padding:12px}
    .navsheet .insi small{font-size:11.5px}
    body.navsheet-on{overflow:hidden}
    body.navsheet-on .navsheet-bg{opacity:1;visibility:visible;transition:opacity .22s}
    body.navsheet-on .navsheet{transform:none}`;
  document.head.appendChild(style);
  // 로고 글꼴 (Space Grotesk) — 페이지마다 따로 안 넣어도 되게 여기서 한 번에
  if (!document.querySelector('link[href*="Space+Grotesk"]')) {
    const f = document.createElement("link");
    f.rel = "stylesheet";
    f.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(f);
  }

  const here =(location.pathname.split("/").pop() || "index.html").toLowerCase();
  const wrap = document.getElementById("nav");
  if (!wrap) return;
  wrap.className = "navwrap";
  const inHere = INSIGHTS.some(x => x[0] === here);
  const grpName = "Insights";                // 메뉴 이름은 언어와 상관없이 항상 영어
  const item = x => `<a class="insi notranslate${x[0] === here ? " on" : ""}" translate="no" href="${x[0]}"${x[0] === here ? ' aria-current="page"' : ""}>
      <span class="ic" style="background:${x[6]}"><svg viewBox="0 0 24 24">${ICON[x[5]]}</svg></span>
      <span><b>${x[2]}</b><small>${x[3]}</small></span></a>`;   // 이름은 영어, 설명은 한글
  wrap.innerHTML = '<div class="navtabs">' + TABS.map(([href, label]) =>
    `<a class="notranslate${href === here ? " on" : ""}" translate="no" href="${href}"${href === here ? ' aria-current="page"' : ""}>${label}</a>`).join("") +
    `<a class="navgrp notranslate${inHere ? " on" : ""}" translate="no" role="button" tabindex="0" aria-haspopup="true" aria-expanded="false">${grpName} <span class="chev">▾</span></a>` +
    '</div><button type="button" class="themebtn"></button>' +
    `<div class="navpanel" role="menu"><div class="ttl notranslate" translate="no">${grpName}</div>${INSIGHTS.map(item).join("")}</div>`;
  const el = wrap.querySelector(".navtabs");
  // 로고 "Gwave" 누르면 홈(Signals)으로
  const brand = document.querySelector("h1.brand");
  const LOGO = '<svg viewBox="0 0 680 100" role="img" aria-label="Gwave"><defs><linearGradient id="gwg-nav" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14C77B"/><stop offset="1" stop-color="#0B7F74"/></linearGradient></defs><path fill="url(#gwg-nav)" d="M128,0H24Q0,0 0,24V76Q0,100 24,100H128V42H64V62H106V78H26Q22,78 22,74V26Q22,22 26,22H128Z"/><path fill="currentColor" d="M142,0H168L208,100H182ZM222,0H248L208,100H182ZM222,0H248L288,100H262ZM302,0H328L288,100H262ZM380,0H406L366,100H340ZM380,0H406L446,100H420ZM456,0H482L522,100H496ZM536,0H562L522,100H496ZM576,0H680V22H602V39H670V61H602V78H680V100H576Z"/></svg>';
  if (brand) brand.innerHTML = `<a href="index.html" title="Home">${LOGO}</a>`;
  // ── 인사이트: PC(마우스)는 올리면 펼침, 휴대폰(터치)은 누르면 시트 ──
  (function () {
    const grp = wrap.querySelector(".navgrp"), panel = wrap.querySelector(".navpanel");
    const touch = () => matchMedia("(hover: none), (max-width: 700px)").matches;
    let shut = null;
    const place = () => {                                   // 패널을 버튼 아래에 (화면 밖으로 안 나가게)
      const w = wrap.getBoundingClientRect(), b = grp.getBoundingClientRect(), pw = panel.offsetWidth;
      panel.style.left = Math.max(0, Math.min(b.left - w.left - 12, w.width - pw)) + "px";
    };
    const open = () => { clearTimeout(shut); place(); wrap.classList.add("open"); grp.setAttribute("aria-expanded", "true"); };
    const close = () => { clearTimeout(shut); wrap.classList.remove("open"); grp.setAttribute("aria-expanded", "false"); };
    const later = () => { clearTimeout(shut); shut = setTimeout(close, 180); };   // 패널로 마우스를 옮기는 사이 닫히지 않게
    grp.addEventListener("mouseenter", () => { if (!touch()) open(); });
    grp.addEventListener("mouseleave", () => { if (!touch()) later(); });
    panel.addEventListener("mouseenter", () => { if (!touch()) clearTimeout(shut); });
    panel.addEventListener("mouseleave", () => { if (!touch()) later(); });
    // 휴대폰 시트 (처음 열 때 만듦)
    let sheet = null;
    const sheetOpen = () => {
      if (!sheet) {
        const bg = document.createElement("div"); bg.className = "navsheet-bg";
        sheet = document.createElement("div"); sheet.className = "navsheet"; sheet.setAttribute("role", "dialog");
        sheet.innerHTML = `<div class="grab"></div><div class="ttl notranslate" translate="no">${grpName}</div><div class="grid">${INSIGHTS.map(item).join("")}</div>`;
        document.body.append(bg, sheet);
        bg.onclick = sheetClose;
        let y0 = null, dy = 0;                                // 아래로 끌어내리면 닫힘
        sheet.addEventListener("touchstart", e => { if (sheet.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; sheet.style.transition = "none"; } }, { passive: true });
        sheet.addEventListener("touchmove", e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
        sheet.addEventListener("touchend", () => { if (y0 == null) return; sheet.style.transition = ""; sheet.style.transform = ""; if (dy > 80) sheetClose(); y0 = null; });
      }
      requestAnimationFrame(() => document.body.classList.add("navsheet-on"));
    };
    function sheetClose() { document.body.classList.remove("navsheet-on"); }
    grp.addEventListener("click", e => {
      e.preventDefault();
      if (touch()) return sheetOpen();
      wrap.classList.contains("open") ? close() : open();     // 마우스로 눌러도 열고 닫힘 (키보드 포함)
    });
    grp.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); grp.click(); } });
    document.addEventListener("click", e => { if (!wrap.contains(e.target)) close(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") { close(); sheetClose(); } });
    addEventListener("resize", () => { if (wrap.classList.contains("open")) place(); });
  })();
  // 다크 ↔ 라이트 전환 (theme.js): 다크일 때 ☀️, 라이트일 때 🌙
  const tbtn = wrap.querySelector(".themebtn");
  const paintTheme = () => {
    const dark = (window.Theme ? Theme.get() : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
    if (!tbtn.firstChild) tbtn.innerHTML = '<span class="tsw"><i><svg class="su" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' +
      '<svg class="mo" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></i></span>';
    tbtn.firstChild.classList.toggle("dark", dark);
    tbtn.setAttribute("role", "switch"); tbtn.setAttribute("aria-checked", String(dark));
    tbtn.title = tbtn.ariaLabel = dark ? "라이트 모드로 바꾸기" : "다크 모드로 바꾸기";
  };
  tbtn.onclick = () => window.Theme && Theme.toggle();
  addEventListener("themechange", paintTheme);
  paintTheme();
  // 옆으로 더 있는지 확인해서 가장자리 흐림 표시
  const edges = () => {
    el.classList.toggle("more-l", el.scrollLeft > 4);
    el.classList.toggle("more-r", el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };
  el.addEventListener("scroll", edges, { passive: true });
  addEventListener("resize", edges);
  // 지금 보고 있는 탭이 화면 밖이면 보이는 곳으로
  const on = el.querySelector("a.on");
  if (on && on.offsetLeft + on.offsetWidth > el.clientWidth) el.scrollLeft = on.offsetLeft - 16;
  edges();
})();

// ── 새 버전이 올라오면 알아서 새로고침 ─────────────────────────────
// 이 페이지가 불러온 nav.js?v=버전 과, 서버에 있는 최신 페이지의 버전을 비교해서 다르면 최신으로 다시 열어요.
// → 주소는 그대로 공유해도 항상 최신 화면이 보임
(function () {
  const me = document.querySelector('script[src*="nav.js"]');
  const cur = ((me && me.getAttribute("src").match(/[?&]v=([^&]+)/)) || [])[1];
  if (!cur) return;
  // 새 버전으로 열 때 붙였던 ?v= 는 주소창에서 지워서 깔끔하게
  const q = new URLSearchParams(location.search);
  if (q.has("v")) { q.delete("v"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); }
  let busy = false, newV = null, bar = null;
  const go = v => { const u = new URLSearchParams(location.search); u.set("v", v); location.replace(location.pathname + "?" + u + location.hash); };   // 새 주소로 열면 브라우저가 예전 것을 못 씀
  // 보고 있는 도중에는 화면을 갑자기 새로고침하지 않고, 아래에 작은 안내만 띄움 (누르면 새로고침)
  function showBar() {
    if (bar) return;
    bar = document.createElement("button");
    bar.type = "button";
    bar.textContent = "새 버전이 있어요 · 눌러서 새로고침";
    bar.style.cssText = "position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:90;padding:9px 16px;border-radius:999px;" +
      "border:1px solid var(--line);background:var(--card);color:var(--text);font-size:13px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer";
    bar.onclick = () => go(newV);
    document.body.appendChild(bar);
  }
  async function check(fromHidden) {
    if (busy) return;
    if (newV) { if (fromHidden) go(newV); return; }
    busy = true;
    try {
      const html = await (await fetch(location.pathname + "?check=" + Date.now(), { cache: "no-store" })).text();
      const m = html.match(/nav\.js\?v=([^"'&]+)/);
      if (m && m[1] !== cur) {
        newV = m[1];
        if (fromHidden) { go(newV); return; }     // 다른 앱 갔다 돌아온 순간이면 바로 최신으로 (눈에 안 띔)
        showBar();
      }
    } catch (e) {}
    busy = false;
  }
  setTimeout(() => check(true), 1500);            // 열자마자 한 번 (막 연 참이라 바로 최신으로)
  setInterval(() => { if (!document.hidden) check(false); }, 3 * 60 * 1000);   // 켜두면 3분마다 확인 → 안내만
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(true); });   // 다른 앱 갔다 돌아오면
})();

// ── 언어 선택 (구글 자동번역) ───────────────────────────────────────
// 다크모드 버튼 위(제목 줄 오른쪽)에 🌐 버튼. 고르면 googtrans 쿠키를 저장하고 새로고침 → 모든 탭이 같은 언어로 번역돼요
// 한국어(원문)를 고르면 쿠키를 지우고 원래대로. 번역 엔진(구글)은 다른 언어를 골랐을 때만 불러와요
(function () {
  const nav = document.getElementById("nav");
  if (!nav) return;
  // 바이비트를 쓸 수 있는 나라들의 언어 (미국·캐나다·싱가포르·중국 본토·홍콩 등은 이용 불가 → 간체 중국어 대신 번체)
  const LANGS = [
    ["ko", "한국어"], ["en", "English"], ["ja", "日本語"], ["zh-TW", "繁體中文"], ["vi", "Tiếng Việt"], ["th", "ไทย"],
    ["id", "Bahasa Indonesia"], ["ms", "Bahasa Melayu"], ["tl", "Filipino"], ["hi", "हिन्दी"], ["tr", "Türkçe"],
    ["ru", "Русский"], ["uk", "Українська"], ["ar", "العربية"], ["es", "Español"], ["pt", "Português"],
    ["fr", "Français"], ["de", "Deutsch"], ["it", "Italiano"], ["nl", "Nederlands"], ["pl", "Polski"],
  ];
  // 기본 언어는 영어. 한 번 고르면 이 브라우저에 기억 (한국어를 고른 사람은 계속 원문으로)
  const KEY = "artha-lang";
  const stored = (() => { try { return localStorage.getItem(KEY); } catch (e) { return null; } })();
  const fromCookie = (() => { const m = document.cookie.match(/(?:^|;\s*)googtrans=\/ko\/([^;]+)/); return m ? decodeURIComponent(m[1]) : null; })();
  const cur = stored || fromCookie || "en";
  window.ARTHA_LANG = cur;                                   // 페이지가 직접 영어로 쓸 부분을 고를 때 씀

  const style = document.createElement("style");
  style.textContent = `
    .toprow{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .toprow > h1{min-width:0}
    .langrow{display:flex;justify-content:flex-end;margin:0 0 6px}
    .langbox{position:relative;flex:none}
    .langbtn{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:transparent;
             color:var(--text);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
    .langbtn:hover{background:color-mix(in srgb,var(--accent) 10%,transparent)}
    .langbtn .cv{color:var(--muted);font-size:10px}
    .langlist{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:200px;max-height:min(60vh,420px);overflow:auto;padding:4px;
              background:var(--card);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.3)}
    .langlist button{display:flex;justify-content:space-between;width:100%;padding:8px 10px;border:0;border-radius:7px;background:transparent;
                     color:var(--text);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
    .langlist button:hover{background:color-mix(in srgb,var(--accent) 12%,transparent)}
    .langlist button.on{color:var(--accent);font-weight:700}
    .langlist button.on::after{content:"✓"}
    /* 구글 번역이 붙이는 위쪽 막대·말풍선·밑줄 숨김 */
    body > .skiptranslate, .goog-te-banner-frame, #goog-gt-tt, .goog-te-balloon-frame, #gt_el{display:none!important}
    body{top:0!important}
    .goog-text-highlight{background:none!important;box-shadow:none!important}
    /* 번역 중에 왼쪽 위에 뜨는 구글 로딩 아이콘·말풍선 (로고를 가림) */
    [class*="VIpgJd-ZVi9od-aZ2wEe"], [class*="VIpgJd-yAWNEb"]{display:none!important}`;
  document.head.appendChild(style);

  // 버튼 자리: 바로 위 제목(h1)과 한 줄로. 제목이 없는 페이지는 탭 위 오른쪽에
  const box = document.createElement("div");
  box.className = "langbox notranslate"; box.translate = false;
  const label = (LANGS.find(l => l[0] === cur) || LANGS[0])[1];
  box.innerHTML = `<button type="button" class="langbtn" aria-haspopup="listbox" aria-expanded="false" title="Language">🌐 <span>${label}</span><span class="cv">▾</span></button>
    <div class="langlist" role="listbox" hidden>${LANGS.map(([c, n]) => `<button type="button" role="option" data-c="${c}"${c === cur ? ' class="on" aria-selected="true"' : ""}>${n}</button>`).join("")}</div>`;
  const prev = nav.previousElementSibling;
  // 다크/라이트 스위치를 언어 버튼 오른쪽에 붙임
  const tb = nav.querySelector("button.themebtn");
  const ctl = document.createElement("div"); ctl.style.cssText = "display:flex;align-items:center;gap:10px;flex:none";
  ctl.append(box); if (tb) ctl.append(tb);
  if (prev && prev.tagName === "H1") {
    const row = document.createElement("div"); row.className = "toprow";
    prev.before(row); row.append(prev, ctl);
  } else {
    const row = document.createElement("div"); row.className = "langrow";
    row.append(ctl); nav.before(row);
  }
  const btn = box.querySelector(".langbtn"), list = box.querySelector(".langlist");
  const open = v => { list.hidden = !v; btn.setAttribute("aria-expanded", String(v)); };
  btn.onclick = e => { e.stopPropagation(); open(list.hidden); };
  document.addEventListener("click", e => { if (!box.contains(e.target)) open(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") open(false); });

  function setCookie(v) {
    const host = location.hostname, parts = host.split(".");
    const domains = ["", host, parts.length > 1 ? "." + parts.slice(-2).join(".") : null].filter(d => d !== null);
    for (const d of domains) {
      const dom = d ? `;domain=${d}` : "";
      document.cookie = v ? `googtrans=${v};path=/${dom};max-age=31536000` : `googtrans=;path=/${dom};expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
  for (const b of list.querySelectorAll("button")) b.onclick = () => {
    const c = b.dataset.c;
    if (c === cur) { open(false); return; }
    try { localStorage.setItem(KEY, c); } catch (e) {}
    setCookie(c === "ko" ? "" : `/ko/${c}`);
    location.reload();
  };

  if (cur === "ko") { if (fromCookie) setCookie(""); return; }
  if (fromCookie !== cur) setCookie(`/ko/${cur}`);          // 처음 온 사람(기본 영어)도 번역 엔진이 알 수 있게
  // 번역하면 안 되는 것: 로고, 코인 이름·기호, 가격, 순위 꼬리표 (MAG → "자석"처럼 바뀌는 것 방지)
  const KEEP = "h1.brand,.name,.px,.lv,.xp,td.rk,.rk,.chip,.mc,.tf,.tick,.ccard .c1 b,.aclist b,.ncell,.sym,.coin";
  const mark = () => { for (const e of document.querySelectorAll(KEEP)) if (!e.classList.contains("notranslate")) { e.classList.add("notranslate"); e.translate = false; } };
  mark();
  let t = null;
  new MutationObserver(() => { if (!t) t = setTimeout(() => { t = null; mark(); }, 200); }).observe(document.body, { childList: true, subtree: true });
  const holder = document.createElement("div"); holder.id = "gt_el"; document.body.appendChild(holder);
  // 탭 이름은 기계번역이 어색해서("청산히트맵" → "Cheongsan Heatmap") 다른 언어에서는 정해 둔 영어 이름으로
  const EN = { "index.html": "Crypto", "signals-rwa.html": "Stock", "lowsig.html": "Trading Engine", "paper.html": "Paper Trading", "calc.html": "Calculator", "market.html": "Market Direction",
               "liquidation.html": "Liquidation Map", "oi.html": "OI", "rank.html": "Rankings", "movers.html": "Top Movers", "news.html": "News" };
  for (const a of nav.querySelectorAll(".navtabs a")) { const n = EN[a.getAttribute("href")]; if (n) { a.textContent = n; a.classList.add("notranslate"); a.translate = false; } }
  // 원래 영어로 만든 페이지(모의투자: <html lang="en">)는 번역하지 않음 → 가격·주문 칸이 계속 바뀌어도 깜빡이지 않게
  if ((document.documentElement.lang || "").toLowerCase().startsWith("en")) return;
  // 위젯이 쿠키만으로는 번역을 시작하지 않을 때가 있어서, 숨겨 둔 언어 목록에 직접 골라 줌
  window.googleTranslateElementInit = () => {
    new google.translate.TranslateElement({ pageLanguage: "ko", autoDisplay: false }, "gt_el");
    let n = 0;
    const kick = setInterval(() => {
      const c = document.querySelector(".goog-te-combo");
      if (document.documentElement.classList.contains("translated-ltr") || document.documentElement.classList.contains("translated-rtl") || ++n > 40) return clearInterval(kick);
      if (c && [...c.options].some(o => o.value === cur)) { c.value = cur; c.dispatchEvent(new Event("change")); }
    }, 250);
  };
  const s = document.createElement("script");
  s.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
  document.body.appendChild(s);
})();
