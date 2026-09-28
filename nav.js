/*
  nav.js — 모든 페이지 위쪽의 탭 메뉴
  페이지에 <nav id="nav"></nav> 를 두고 이 파일을 불러오면 탭이 그려져요.
  탭을 추가하려면 아래 TABS 목록에 한 줄만 더 쓰면 돼요.
*/
(function () {
  const TABS = [
    ["index.html", "TEST 참고용"],
    ["liquidation.html", "청산히트맵"],
    ["oi.html", "OI"],
    ["rank.html", "코인순위"],
    ["movers.html", "24시간변동률"],
    ["kimp.html", "김치프리미엄"],
    ["news.html", "주요뉴스"],
  ];
  const style = document.createElement("style");
  style.textContent = `
    .navtabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid var(--line);margin:0 0 16px;scrollbar-width:none}
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
  const el = document.getElementById("nav");
  if (!el) return;
  el.className = "navtabs";
  el.innerHTML = TABS.map(([href, label]) =>
    `<a href="${href}"${href === here ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("");
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
  let busy = false;
  async function check() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const html = await (await fetch(location.pathname + "?check=" + Date.now(), { cache: "no-store" })).text();
      const m = html.match(/nav\.js\?v=([^"'&]+)/);
      if (m && m[1] !== cur) {
        const u = new URLSearchParams(location.search); u.set("v", m[1]);
        location.replace(location.pathname + "?" + u + location.hash);   // 새 주소로 열면 브라우저가 예전 것을 못 씀
        return;
      }
    } catch (e) {}
    busy = false;
  }
  setTimeout(check, 2000);                       // 열자마자 한 번
  setInterval(check, 3 * 60 * 1000);             // 켜두면 3분마다
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });   // 다른 앱 갔다 돌아오면
})();
