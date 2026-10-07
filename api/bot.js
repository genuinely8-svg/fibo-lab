/* POST /api/bot — 양방향 추세추종 v4(12시간봉) 자동매매 (비트코인 + 이더리움, 코인마다 따로 같은 규칙). 관리자 계정(ADMIN_NICKNAME, 또는 BOT_NICKNAME)의 모의투자에만 주문해요.
   GitHub Actions(.github/workflows/bot.yml)가 15분마다 불러요.
   - 헤더 Authorization: Bearer <BOT_SECRET>  (Vercel 환경변수 BOT_SECRET 과 같아야 함 — 코드·저장소에는 없음)
   - BOT_SECRET 이 없으면 아무것도 하지 않아요. BOT_PAUSED=1 이면 잠시 멈춤
   - GET /api/bot (같은 헤더) → 지금 봇 상태와 최근 기록만 보기 */
const crypto = require("crypto");
const db = require("./_lib/db");
const A = require("./_lib/auth");
const B = require("./_lib/binance");
const { sync } = require("./_lib/sync");
const E = require("../paper-engine");
const C = require("../bot-core");

module.exports = async (req, res) => {
  try {
    // BOT_SECRET(GitHub Actions) 또는 TICK_SECRET(Upstash QStash 5분 타이머) 둘 중 하나와 맞으면 통과
    const secs = [process.env.BOT_SECRET, process.env.TICK_SECRET].filter(Boolean);
    if (!secs.length) throw A.fail(503, "Bot is not set up (BOT_SECRET missing)");
    const h = String(req.headers.authorization || "");
    const got = crypto.createHash("sha256").update(h.startsWith("Bearer ") ? h.slice(7) : "").digest();
    if (!secs.some(s => crypto.timingSafeEqual(got, crypto.createHash("sha256").update(s).digest()))) throw A.fail(401, "Unauthorized");

    const nick = process.env.BOT_NICKNAME || process.env.ADMIN_NICKNAME;
    if (!nick) throw A.fail(500, "BOT_NICKNAME / ADMIN_NICKNAME not set");
    const key = A.userKey(nick);
    const user = await db.getJSON(key);
    if (!user) throw A.fail(404, "Bot account not found");

    if (req.method === "GET") return res.status(200).json({ ok: true, bot: user.bot || null, bots: user.bots || null });
    if (req.method !== "POST") throw A.fail(405, "GET or POST only");
    if (process.env.BOT_PAUSED === "1") return res.status(200).json({ ok: true, paused: true });

    const now = Date.now();
    const sy = await sync(user.st, now);                // 먼저 SL·체결을 지금까지 처리
    if (E.mergeAll(user.st)) sy.dirty = true;
    if (sy.behind) {                                     // 밀린 기록이 많으면 이번엔 따라잡기만
      await db.setJSON(key, user);
      return res.status(202).json({ ok: true, catchingUp: true });
    }
    const data = await Promise.all(C.P.syms.map(s => Promise.all([B.candles(s, "12h", 1500), B.price(s)])));
    let dirty = sy.dirty;
    const did = [], state = {};
    C.P.syms.forEach((s, i) => {                          // 같은 계정이라 차례대로 (잔고를 같이 씀)
      const [bars, cur] = data[i];
      const out = C.step(user, bars, cur, now, E, s);
      if (out.dirty) dirty = true;
      did.push(...out.log);
      const b = C.stateOf(user, s);
      state[s] = { side: b.side, stop: b.stop || null };
    });
    if (dirty) await db.setJSON(key, user);
    res.status(200).json({ ok: true, did, events: sy.events, state, side: user.bot.side, stop: user.bot.stop || null });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
};
