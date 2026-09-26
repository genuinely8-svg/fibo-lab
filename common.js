/*
  common.js — 여러 페이지가 같이 쓰는 도구 모음
  (요청 보내기, 잠깐 저장, 숫자 보기 좋게, 코인 로고)
*/
"use strict";
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DEFAULT_COINS = ["BTC", "ETH", "SOL", "XRP", "ARB", "HYPE", "UNI", "ZEC", "ONDO"];

// 요청 (429 = 너무 많은 요청이면 잠깐 쉬고 다시)
async function getJSON(url, tries = 3) {
  let last = "";
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await fetch(url); }
    catch (e) { last = "연결이 안 돼요 (인터넷 또는 요청 제한)"; await sleep(1500); continue; }
    if (res.status === 429 || res.status === 418) { last = "요청 제한에 걸렸어요. 1분 뒤 다시 해보세요"; await sleep(4000); continue; }
    if (res.status === 400) throw new Error("없는 코인이거나 잘못된 요청이에요");
    if (!res.ok) throw new Error("응답 오류 " + res.status);
    return res.json();
  }
  throw new Error(last || "알 수 없는 오류");
}

// 브라우저에 잠깐 저장해두고 재사용 (요청 수 줄이기)
function cacheGet(key, maxAgeMs) {
  try { const v = JSON.parse(localStorage.getItem(key)); if (v && Date.now() - v.at < maxAgeMs) return v.data; } catch (e) {}
  return null;
}
function cacheSet(key, data) { try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch (e) {} }
async function cached(key, maxAgeMs, fn) {
  const hit = cacheGet(key, maxAgeMs);
  if (hit) return hit;
  const data = await fn();
  cacheSet(key, data);
  return data;
}

// ── 숫자 보기 좋게 ─────────────────────────────────────────────
const usd = v => v == null || !isFinite(v) ? "-" : "$" + (Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 })
                                                                      : v.toLocaleString("en-US", { maximumSignificantDigits: 5 }));
const pct = v => v == null || !isFinite(v) ? "-" : (v > 0 ? "+" : "") + v.toFixed(2) + "%";
const cls = v => v > 0 ? "up" : v < 0 ? "down" : "";
function bigUsd(v) {       // 1.69조 달러, 286.4억 달러
  if (v == null || !isFinite(v)) return "-";
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 1e12) return sign + (a / 1e12).toFixed(2) + "조 달러";
  if (a >= 1e8) return sign + (a / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "억 달러";
  if (a >= 1e4) return sign + (a / 1e4).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "만 달러";
  return sign + "$" + a.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function shortUsd(v) {     // 표 안에 들어가는 짧은 버전: $1.69T, $28.6B, $512M
  if (v == null || !isFinite(v)) return "-";
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 1e12) return sign + "$" + (a / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return sign + "$" + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return sign + "$" + (a / 1e3).toFixed(1) + "K";
  return sign + "$" + a.toFixed(0);
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return Math.floor(s / 60) + "분 전";
  if (s < 86400) return Math.floor(s / 3600) + "시간 전";
  return Math.floor(s / 86400) + "일 전";
}

// ── 코인 로고: 코인게코 시가총액 상위 250개의 로고를 하루 동안 저장해두고 씀 ──
let _logoMap = null;
async function logoMap() {
  if (_logoMap) return _logoMap;
  try {
    _logoMap = await cached("cg-logos-v1", 24 * 3600e3, async () => {
      const list = await getJSON("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1");
      const m = {};
      for (const c of list) { const s = c.symbol.toUpperCase(); if (!m[s]) m[s] = c.image.replace("/large/", "/small/"); }
      return m;
    });
  } catch (e) { _logoMap = {}; }
  return _logoMap;
}
// 로고 + 기호 한 덩어리 HTML (로고가 없으면 글자 동그라미)
function coinTag(sym, logos, sub, href) {
  const img = logos && logos[sym]
    ? `<img src="${esc(logos[sym])}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : `<span class="ph">${esc(sym.slice(0, 3))}</span>`;
  const inner = `${img}<span>${esc(sym)}${sub ? ` <small>${esc(sub)}</small>` : ""}</span>`;
  return href ? `<a class="coin" href="${esc(href)}">${inner}</a>` : `<span class="coin">${inner}</span>`;
}
