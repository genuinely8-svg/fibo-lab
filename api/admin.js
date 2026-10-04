/* POST /api/admin  {action: "list" | "detail" | "charge" | "reset" | "block" | "unblock" | "delete", nick, amount}
   관리자(환경변수 ADMIN_NICKNAME 의 닉네임)만 가능 — 요청마다 서버에서 다시 확인해요
   관리자 행동은 Redis 목록 "adminlog" 에 시간과 함께 남겨요 (최근 200개) */
const db = require("./_lib/db");
const A = require("./_lib/auth");
const E = require("../paper-engine");

const LOG_KEEP = 200;

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") throw A.fail(405, "POST 만 돼요");
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { key, user: me } = await A.authed(req);
    if (!A.isAdminKey(key)) throw A.fail(403, "관리자만 쓸 수 있어요");
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
    if (!target) throw A.fail(404, "그런 사용자가 없어요");
    const self = tkey === key;
    // 기록과 함께 한 번에 저장
    const logCmds = what => [["LPUSH", "adminlog", JSON.stringify({ t: now, by: me.nick, act: what, to: target.nick })], ["LTRIM", "adminlog", 0, LOG_KEEP - 1]];

    if (b.action === "detail") {
      const s = target.st;
      return res.status(200).json({ nick: target.nick, c: target.c, la: target.la || null, bl: !!target.bl, pos: s.pos, ord: s.ord, ol: s.ol.slice(0, 50), th: s.th.slice(0, 50), stats: s.st, bal: s.bal, dep: s.dep });
    }
    if (b.action === "charge") {
      const amt = Math.round(Number(b.amount) * 100) / 100;
      if (!(amt > 0 && amt <= 10000000)) throw A.fail(400, "충전 금액은 0보다 크고 천만 이하로 해주세요");
      const s = target.st;
      s.bal += amt; s.dep += amt;                       // 충전금은 원금으로 → 수익률이 부풀려지지 않음
      E.logTrade(s, { id: s.seq++, t: now, kind: "deposit", amount: amt, note: `관리자 충전 +${amt}` });
      await db.pipeline([["SET", tkey, JSON.stringify(target)], ...logCmds(`충전 +${amt} USDT`)]);
      return res.status(200).json({ ok: true, msg: `${target.nick} 님에게 ${amt} USDT 충전했어요` });
    }
    if (b.action === "reset") {
      target.st = E.newState(now);
      await db.pipeline([["SET", tkey, JSON.stringify(target)], ...logCmds("잔고 초기화")]);
      return res.status(200).json({ ok: true, msg: `${target.nick} 님을 초기화했어요` });
    }
    if (b.action === "block" || b.action === "unblock") {
      if (self) throw A.fail(400, "관리자 자신은 차단할 수 없어요");
      target.bl = b.action === "block";
      await db.pipeline([["SET", tkey, JSON.stringify(target)], ...logCmds(target.bl ? "차단" : "차단 해제")]);
      return res.status(200).json({ ok: true, msg: `${target.nick} 님을 ${target.bl ? "차단" : "차단 해제"}했어요` });
    }
    if (b.action === "delete") {
      if (self) throw A.fail(400, "관리자 자신은 삭제할 수 없어요");
      await db.pipeline([["DEL", tkey], ["SREM", "users", tkey], ...logCmds("계정 삭제")]);
      return res.status(200).json({ ok: true, msg: `${target.nick} 님의 계정을 삭제했어요` });
    }
    throw A.fail(400, "알 수 없는 요청이에요");
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
};
