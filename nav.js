/*
  nav.js — 모든 페이지 위쪽의 탭 메뉴
  페이지에 <nav id="nav"></nav> 를 두고 이 파일을 불러오면 탭이 그려져요.
  탭을 추가하려면 아래 TABS 목록에 한 줄만 더 쓰면 돼요.
*/
(function () {
  const TABS = [
    ["index.html", "TEST 참고용"],
    ["paper.html", "모의투자"],
    ["market.html", "시장 방향"],
    ["liquidation.html", "청산히트맵"],
    ["oi.html", "OI"],
    ["rank.html", "코인순위"],
    ["movers.html", "24시간변동률"],
    ["news.html", "주요뉴스"],
  ];
  const style = document.createElement("style");
  style.textContent = `
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
