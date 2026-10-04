/* 마지막 확인 시각 이후의 1분봉으로 체결·TP·SL·청산을 소급 처리 */
const E = require("../../paper-engine");
const B = require("./binance");

async function sync(st, now) {
  const lastClosed = Math.floor(now / B.MIN) * B.MIN;
  const syms = [...new Set(st.pos.map(p => p.sym).concat(st.ord.map(o => o.sym)))];
  if (!syms.length) { st.chk = lastClosed; return { events: [], dirty: false, behind: false }; }   // 확인할 게 없으면 저장도 안 함 (명령 절약)
  if (st.chk >= lastClosed) return { events: [], dirty: false, behind: false };
  const from = st.chk;
  const res = await Promise.all(syms.map(s => B.klines(s, from, lastClosed)));
  const upTo = Math.min(...res.map(r => r.coveredTo));
  const candles = res.flatMap(r => r.candles).filter(k => k.t < upTo);
  const events = E.replay(st, candles);
  st.chk = upTo;
  // 아무 일 없으면 10분 넘게 밀렸을 때만 저장
  return { events, dirty: events.length > 0 || upTo - from > 10 * 60e3, behind: upTo < lastClosed };
}

module.exports = { sync };
