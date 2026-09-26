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
    .navtabs a.on{color:var(--text);border-bottom-color:var(--accent)}`;
  document.head.appendChild(style);

  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const el = document.getElementById("nav");
  if (!el) return;
  el.className = "navtabs";
  el.innerHTML = TABS.map(([href, label]) =>
    `<a href="${href}"${href === here ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("");
})();
