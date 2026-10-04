/* POST /api/paper  {action, ...}  → 내 모의투자 상태 / 주문 / 취소 / 청산 / TP·SL 수정 / 초기화
   매 요청마다 먼저 "마지막 확인 이후 1분봉"으로 체결·TP·SL·청산을 소급 처리해요 */
const db = require("./_lib/db");
const A = require("./_lib/auth");
const B = require("./_lib/binance");
const { sync } = require("./_lib/sync");
const E = require("../paper-engine");

const LA_EVERY = 10 * 60e3;

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") throw A.fail(405, "POST 만 돼요");
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { key, user } = await A.authed(req);
    const st = user.st;
    const now = Date.now();
    let dirty = false, msg = null;

    // 1) 소급 처리
    let sy;
    try { sy = await sync(st, now); }
    catch (e) {
      if (b.action !== "state") throw A.fail(503, "바이낸스 기록을 못 가져와서 지금은 처리할 수 없어요. 잠시 후 다시 해주세요");
      sy = { events: [], dirty: false, behind: true, error: true };      // 상태 조회는 옛 상태라도 보여줌
    }
    dirty = sy.dirty;
    if (b.action !== "state" && sy.behind) {
      if (dirty) await db.setJSON(key, user);
      throw A.fail(409, "오래된 기록을 처리하는 중이에요. 몇 초 뒤 다시 눌러주세요");
    }

    // 2) 요청 처리
    const id = Number(b.id);
    switch (b.action) {
      case "state": break;
      case "order": {
        const sym = String(b.sym || "").toUpperCase();
        if (!/^[A-Z0-9]{2,20}USDT$/.test(sym)) throw A.fail(400, "코인 정보가 올바르지 않아요");
        const cur = await B.price(sym);
        const r = E.placeOrder(st, b, cur, now);
        msg = r.filled ? `체결: ${sym} ${r.pos.side === "long" ? "롱" : "숏"} @ ${r.pos.entry}` : "지정가 주문이 접수됐어요";
        dirty = true; break;
      }
      case "cancel": E.cancelOrder(st, id, now); msg = "주문을 취소했어요"; dirty = true; break;
      case "close": {
        const p = st.pos.find(x => x.id === id);
        if (!p) throw A.fail(404, "이미 닫혔거나 없는 포지션이에요");
        const tr = E.closePosition(st, p, await B.price(p.sym), "수동", now);
        msg = `청산 완료 (${tr.pnl >= 0 ? "+" : ""}${tr.pnl.toFixed(2)} USDT)`; dirty = true; break;
      }
      case "edit": {
        const p = st.pos.find(x => x.id === id);
        if (!p) throw A.fail(404, "이미 닫혔거나 없는 포지션이에요");
        const t = E.checkTpSl(p.side, await B.price(p.sym), b.tp, b.sl);
        p.tp = t.tp; p.sl = t.sl; msg = "TP/SL을 바꿨어요"; dirty = true; break;
      }
      case "reset": user.st = E.newState(now); msg = "초기화했어요 (10,000 USDT)"; dirty = true; break;
      default: throw A.fail(400, "알 수 없는 요청이에요");
    }

    if (now - (user.la || 0) > LA_EVERY) { user.la = now; dirty = true; }     // 마지막 접속은 10분에 한 번만 기록 (명령 절약)
    if (dirty) await db.setJSON(key, user);
    res.status(200).json({
      nick: user.nick, admin: A.isAdminKey(key), st: user.st, now, events: sy.events, msg,
      behind: !!sy.behind, syncError: !!sy.error,
    });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
};
