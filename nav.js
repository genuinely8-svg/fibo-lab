/*
  nav.js — 모든 페이지 위쪽의 탭 메뉴
  페이지에 <nav id="nav"></nav> 를 두고 이 파일을 불러오면 탭이 그려져요.
  탭을 추가하려면 아래 TABS 목록에 한 줄만 더 쓰면 돼요.
*/
(function () {
  const TABS = [
    ["index.html", "Signals"],
    ["paper.html", "모의투자"],
    ["calc.html", "계산기"],
    ["market.html", "시장 방향"],
    ["liquidation.html", "청산히트맵"],
    ["oi.html", "OI"],
    ["rank.html", "코인순위"],
    ["movers.html", "24시간변동률"],
    ["news.html", "주요뉴스"],
  ];
  const style = document.createElement("style");
  style.textContent = `
    /* 글꼴: 본문은 Pretendard(한글·숫자 깔끔), 로고 "Artha"는 Cinzel */
    body{font-family:"Pretendard Variable",Pretendard,system-ui,-apple-system,"Malgun Gothic",sans-serif;font-feature-settings:"tnum"}
    h1.brand{font-family:"Cinzel",serif;font-weight:700;letter-spacing:.12em;font-size:26px}
    @media (max-width:700px){ h1.brand{font-size:23px} }
    .navwrap{display:flex;align-items:stretch;margin:0 0 16px}
    /* overflow-y:hidden — 가로 스크롤 칸이 손가락 따라 위아래로 흔들리지 않게 (아이폰) */
    .navtabs{flex:1;min-width:0;display:flex;gap:4px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;
             border-bottom:1px solid var(--line);scrollbar-width:none}
    /* 다크/라이트 전환 버튼: 탭 오른쪽 끝에 고정 (탭이 옆으로 밀려도 안 가려짐) */
    .navwrap button.themebtn{flex:none;width:44px;padding:0;border:0;border-bottom:1px solid var(--line);border-radius:0;background:transparent;
                             color:var(--text);font-size:17px;line-height:1;cursor:pointer}
    .navwrap button.themebtn:hover{background:color-mix(in srgb,var(--accent) 10%,transparent)}
    .navtabs::-webkit-scrollbar{display:none}
    .navtabs a{flex:none;padding:10px 14px;color:var(--muted);text-decoration:none;font-weight:600;font-size:14px;
               border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
    .navtabs a:hover{color:var(--text)}
    .navtabs a.on{color:var(--text);border-bottom-color:var(--accent)}
    /* 탭이 화면보다 넓으면 가장자리를 흐리게 해서 "옆으로 더 있어요" 표시 */
    .navtabs.more-r{-webkit-mask-image:linear-gradient(90deg,#000 80%,transparent);mask-image:linear-gradient(90deg,#000 80%,transparent)}
    .navtabs.more-l{-webkit-mask-image:linear-gradient(90deg,transparent,#000 20%);mask-image:linear-gradient(90deg,transparent,#000 20%)}
    .navtabs.more-l.more-r{-webkit-mask-image:linear-gradient(90deg,transparent,#000 20%,#000 80%,transparent);mask-image:linear-gradient(90deg,transparent,#000 20%,#000 80%,transparent)}
    @media (max-width:700px){ .navtabs a{padding:9px 11px;font-size:13px} }`;
  document.head.appendChild(style);

  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const wrap = document.getElementById("nav");
  if (!wrap) return;
  wrap.className = "navwrap";
  wrap.innerHTML = '<div class="navtabs">' + TABS.map(([href, label]) =>
    `<a href="${href}"${href === here ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("") +
    '</div><button type="button" class="themebtn"></button>';
  const el = wrap.querySelector(".navtabs");
  // 다크 ↔ 라이트 전환 (theme.js): 다크일 때 ☀️, 라이트일 때 🌙
  const tbtn = wrap.querySelector(".themebtn");
  const paintTheme = () => {
    const dark = (window.Theme ? Theme.get() : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
    tbtn.textContent = dark ? "☀️" : "🌙";
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
  if (prev && prev.tagName === "H1") {
    const row = document.createElement("div"); row.className = "toprow";
    prev.before(row); row.append(prev, box);
  } else {
    const row = document.createElement("div"); row.className = "langrow";
    row.append(box); nav.before(row);
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
  // 원래 영어로 만든 페이지(모의투자: <html lang="en">)는 번역하지 않음 → 가격·주문 칸이 계속 바뀌어도 깜빡이지 않게
  if ((document.documentElement.lang || "").toLowerCase().startsWith("en")) return;
  const holder = document.createElement("div"); holder.id = "gt_el"; document.body.appendChild(holder);
  // 탭 이름은 기계번역이 어색해서("청산히트맵" → "Cheongsan Heatmap") 다른 언어에서는 정해 둔 영어 이름으로
  const EN = { "index.html": "Signals", "paper.html": "Paper Trading", "calc.html": "Calculator", "market.html": "Market Direction",
               "liquidation.html": "Liquidation Map", "oi.html": "OI", "rank.html": "Rankings", "movers.html": "Top Movers", "news.html": "News" };
  for (const a of nav.querySelectorAll(".navtabs a")) { const n = EN[a.getAttribute("href")]; if (n) { a.textContent = n; a.classList.add("notranslate"); a.translate = false; } }
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
