/* POST /api/auth  {nick, pin, create?}  → 로그인 / 새 계정 */
const db = require("./_lib/db");
const A = require("./_lib/auth");
const E = require("../paper-engine");

const MAX_FAILS = 5, LOCK_MS = 10 * 60e3;

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") throw A.fail(405, "POST 만 돼요");
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const nick = A.checkNick(b.nick);
    const pin = String(b.pin || "");
    if (pin.length < 4 || pin.length > 32) throw A.fail(400, "PIN 은 4자리 이상이에요");
    const key = A.userKey(nick);
    const user = await db.getJSON(key);

    if (!user) {
      // 오타로 계정이 만들어지지 않게, 한 번 물어본 뒤에만 만듦
      if (!b.create) return res.status(200).json({ needCreate: true });
      const now = Date.now();
      const fresh = { nick, ph: A.hashPin(pin), c: now, la: now, f: 0, lk: 0, st: E.newState(now) };
      const [ok] = await db.pipeline([["SET", key, JSON.stringify(fresh), "NX"], ["SADD", "users", key]]);
      if (ok !== "OK") throw A.fail(409, "방금 같은 닉네임이 만들어졌어요. 다시 시도해주세요");
      return res.status(200).json({ token: A.makeToken(key, fresh.ph), nick, created: true });
    }

    if (user.bl && !A.isAdminKey(key)) throw A.fail(403, A.BLOCKED);
    if (user.lk > Date.now()) throw A.fail(429, `PIN 을 여러 번 틀려서 ${Math.ceil((user.lk - Date.now()) / 60e3)}분 뒤에 다시 시도할 수 있어요`);
    if (!A.verifyPin(pin, user.ph)) {
      user.f = (user.f || 0) + 1;
      if (user.f >= MAX_FAILS) { user.f = 0; user.lk = Date.now() + LOCK_MS; }
      await db.setJSON(key, user);
      throw A.fail(401, "닉네임 또는 PIN 이 맞지 않아요");
    }
    user.f = 0; user.la = Date.now();
    await db.setJSON(key, user);
    res.status(200).json({ token: A.makeToken(key, user.ph), nick: user.nick });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
