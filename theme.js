/*
  theme.js — 다크 / 라이트 모드
  <head> 맨 앞에서 불러와야 해요 (페이지가 그려지기 전에 색을 정해서, 잠깐 반대 색으로 번쩍이는 걸 막음)
  - 버튼으로 고른 모드는 localStorage 에 저장 → <html data-theme="dark|light">
  - 한 번도 안 골랐으면 data-theme 을 비워 두고, 각 페이지 CSS 의 prefers-color-scheme 으로 기기 설정을 따라감
  - 모드가 바뀌면 window 에 "themechange" 이벤트를 보냄 (차트들이 색을 다시 칠함)
*/
(function () {
  "use strict";
  var KEY = "theme-v1", root = document.documentElement, mq = matchMedia("(prefers-color-scheme: dark)");
  function saved() { try { var v = localStorage.getItem(KEY); return v === "dark" || v === "light" ? v : null; } catch (e) { return null; } }
  function current() { return saved() || (mq.matches ? "dark" : "light"); }
  function apply() {
    var s = saved();
    if (s) root.setAttribute("data-theme", s); else root.removeAttribute("data-theme");
    root.style.colorScheme = current();                     // 스크롤바·기본 입력창 색도 같이
  }
  function fire() { try { window.dispatchEvent(new CustomEvent("themechange", { detail: current() })); } catch (e) {} }
  apply();
  mq.addEventListener && mq.addEventListener("change", function () { if (!saved()) { apply(); fire(); } });
  window.Theme = {
    get: current,
    set: function (t) { try { localStorage.setItem(KEY, t); } catch (e) {} apply(); fire(); },
    toggle: function () { this.set(current() === "dark" ? "light" : "dark"); },
  };
})();
