/* POST /api/admin  {action: "list" | "detail" | "charge" | "reset" | "block" | "unblock" | "delete", nick, amount}
   관리자(환경변수 ADMIN_NICKNAME 의 닉네임)만 가능 — 요청마다 서버에서 다시 확인해요
   관리자 행동은 Redis 목록 "adminlog" 에 시간과 함께 남겨요 (최근 200개) */
const db = require("./_lib/db");
const A = require("./_lib/auth");
const E = require("../paper-engine");

const LOG_KEEP = 200;

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") throw A.fail(405, "POST only");
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { key, user: me } = await A.authed(req);
    if (!A.isAdminKey(key)) throw A.fail(403, "Admin only");
    const now = Date.now();

    if (b.action === "list") {
      const keys = await db.cmd("SMEMBERS", "users");
      const [rows, log] = await Promise.all([
        keys.length ? db.cmd("MGET", ...keys) : [],
        db.cmd("LRANGE", "adminlog", 0, 49),
      ]);
      const users = rows.filter(Boolean).map(r => {
        const u = JSON.parse(r), s = E.summary(u.st);
        return { nick: u.nick, c: u.c, la: u.la || null, bl: !!u.bl, bal: u.st.bal, equity: s.equity, dep: u.st.dep, ret: s.ret, n: u.st.st.n, pos: u.st.pos.length,
                 admin: A.isAdminKey(A.userKey(u.nick)) };
      }).sort((a, c) => c.ret - a.ret);
      return res.status(200).json({ users, log: log.map(x => JSON.parse(x)) });
    }

    const tnick = A.checkNick(b.nick);
    const tkey = A.userKey(tnick);
    const target = await db.getJSON(tkey);
    if (!target) throw A.fail(404, "User not found");
    const self = tkey === key;
    // 기록과 함께 한 번에 저장
    const logCmds = what => [["LPUSH", "adminlog", JSON.stringify({ t: now, by: me.nick, act: what, to: target.nick })], ["LTRIM", "adminlog", 0, LOG_KEEP - 1]];

    if (b.action === "detail") {
      const s = target.st;
      return res.status(200).json({ nick: target.nick, c: target.c, la: target.la || null, bl: !!target.bl, pos: s.pos, ord: s.ord, ol: s.ol.slice(0, 50), th: s.th.slice(0, 50), stats: s.st, bal: s.bal, dep: s.dep });
    }
    if (b.action === "charge") {
      const amt = Math.round(Number(b.amount) * 100) / 100;
      if (!(amt > 0 && amt <= 10000000)) throw A.fail(400, "Amount must be > 0 and ≤ 10,000,000");
      const s = target.st;
      s.bal += amt; s.dep += amt;                       // 충전금은 원금으로 → 수익률이 부풀려지지 않음
      E.logTrade(s, { id: s.seq++, t: now, kind: "deposit", amount: amt, note: `Admin deposit +${amt}` });
      await db.pipeline([["SET", tkey, JSON.stringify(target)], ...logCmds(`Deposit +${amt} USDT`)]);
      return res.status(200).json({ ok: true, msg: `Deposited ${amt} USDT to ${target.nick}` });
    }
    if (b.action === "reset") {
      target.st = E.newState(now);
      await db.pipeline([["SET", tkey, JSON.stringify(target)], ...logCmds("Balance reset")]);
      return res.status(200).json({ ok: true, msg: `Reset ${target.nick}` });
    }
    if (b.action === "block" || b.action === "unblock") {
      if (self) throw A.fail(400, "You cannot block yourself");
      target.bl = b.action === "block";
      await db.pipeline([["SET", tkey, JSON.stringify(target)], ...logCmds(target.bl ? "Blocked" : "Unblocked")]);
      return res.status(200).json({ ok: true, msg: `${target.bl ? "Blocked" : "Unblocked"} ${target.nick}` });
    }
    if (b.action === "delete") {
      if (self) throw A.fail(400, "You cannot delete yourself");
      await db.pipeline([["DEL", tkey], ["SREM", "users", tkey], ...logCmds("Account deleted")]);
      return res.status(200).json({ ok: true, msg: `Deleted ${target.nick}` });
    }
    throw A.fail(400, "Unknown request");
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
};
