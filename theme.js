/*
  theme.js — 다크 / 라이트 모드
  <head> 맨 앞에서 불러와야 해요 (페이지가 그려지기 전에 색을 정해서, 잠깐 반대 색으로 번쩍이는 걸 막음)
  - 버튼으로 고른 모드는 localStorage 에 저장 → <html data-theme="dark|light">
  - 한 번도 안 골랐으면 기본은 라이트 모드 (기기가 다크 모드여도 라이트로 시작)
  - 모드가 바뀌면 window 에 "themechange" 이벤트를 보냄 (차트들이 색을 다시 칠함)
*/
(function () {
  "use strict";
  var KEY = "theme-v1", root = document.documentElement;
  function saved() { try { var v = localStorage.getItem(KEY); return v === "dark" || v === "light" ? v : null; } catch (e) { return null; } }
  function current() { return saved() || "light"; }       // 기본 = 라이트
  function apply() {
    var t = current();
    root.setAttribute("data-theme", t);                       // 항상 지정 → CSS 의 기기 다크 설정 무시
    root.style.colorScheme = t;                               // 스크롤바·기본 입력창 색도 같이
  }
  function fire() { try { window.dispatchEvent(new CustomEvent("themechange", { detail: current() })); } catch (e) {} }
  apply();
  window.Theme = {
    get: current,
    set: function (t) { try { localStorage.setItem(KEY, t); } catch (e) {} apply(); fire(); },
    toggle: function () { this.set(current() === "dark" ? "light" : "dark"); },
  };
})();
