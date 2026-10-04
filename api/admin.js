/* POST /api/admin  {action: "list" | "charge" | "reset", nick, amount}
   관리자(환경변수 ADMIN_NICKNAME 의 닉네임)만 가능 — 요청마다 서버에서 다시 확인해요 */
const db = require("./_lib/db");
const A = require("./_lib/auth");
const E = require("../paper-engine");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") throw A.fail(405, "POST 만 돼요");
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { key } = await A.authed(req);
    if (!A.isAdminKey(key)) throw A.fail(403, "관리자만 쓸 수 있어요");
    const now = Date.now();

    if (b.action === "list") {
      const keys = await db.cmd("SMEMBERS", "users");
      const rows = keys.length ? await db.cmd("MGET", ...keys) : [];
      const users = rows.filter(Boolean).map(r => {
        const u = JSON.parse(r), s = E.summary(u.st);
        return { nick: u.nick, bal: u.st.bal, equity: s.equity, dep: u.st.dep, ret: s.ret, n: u.st.st.n, pos: u.st.pos.length };
      }).sort((a, c) => c.ret - a.ret);
      return res.status(200).json({ users });
    }

    const tkey = A.userKey(A.checkNick(b.nick));
    const target = await db.getJSON(tkey);
    if (!target) throw A.fail(404, "그런 사용자가 없어요");

    if (b.action === "charge") {
      const amt = Math.round(Number(b.amount) * 100) / 100;
      if (!(amt > 0 && amt <= 10000000)) throw A.fail(400, "충전 금액은 0보다 크고 천만 이하로 해주세요");
      const s = target.st;
      s.bal += amt; s.dep += amt;                       // 충전금은 원금으로 → 수익률이 부풀려지지 않음
      E.logTrade(s, { id: s.seq++, t: now, kind: "deposit", amount: amt, note: `관리자 충전 +${amt}` });
      await db.setJSON(tkey, target);
      return res.status(200).json({ ok: true, msg: `${target.nick} 님에게 ${amt} USDT 충전했어요` });
    }
    if (b.action === "reset") {
      target.st = E.newState(now);
      await db.setJSON(tkey, target);
      return res.status(200).json({ ok: true, msg: `${target.nick} 님을 초기화했어요` });
    }
    throw A.fail(400, "알 수 없는 요청이에요");
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
};
