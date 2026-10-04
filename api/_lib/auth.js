/* 닉네임·PIN·로그인 토큰 */
const crypto = require("crypto");
const db = require("./db");

const fail = (status, msg) => { const e = new Error(msg); e.status = status; return e; };

const NICK_RE = /^[0-9A-Za-z_\-가-힣ㄱ-ㅎ]{2,16}$/u;
const normNick = s => String(s || "").normalize("NFC").trim().toLowerCase();
function checkNick(s) {
  const t = String(s || "").normalize("NFC").trim();
  if (!NICK_RE.test(t)) throw fail(400, "닉네임은 2~16자 (한글·영문·숫자·_ -)로 해주세요");
  return t;
}
const userKey = nick => "u:" + normNick(nick);

// PIN 은 scrypt 해시로만 저장 ("솔트:해시")
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(String(pin), salt, 32).toString("hex");
}
function verifyPin(pin, stored) {
  const [salt, h] = String(stored).split(":");
  const a = crypto.scryptSync(String(pin), salt, 32), b = Buffer.from(h, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 로그인 토큰: 서버에 저장하지 않는 서명 토큰 (Redis 명령 절약). PIN 이 바뀌면 자동으로 무효
function secret() {
  const s = process.env.PAPER_SECRET || db.tokenForSecret();
  if (!s) throw fail(500, "서버 비밀값(KV_REST_API_TOKEN 또는 PAPER_SECRET)을 못 찾았어요");
  return s;
}
const sign = (payload, ph) => crypto.createHmac("sha256", secret()).update(payload + "|" + ph).digest("base64url");
function makeToken(key, ph) {
  const payload = Buffer.from(JSON.stringify({ k: key, e: Date.now() + 180 * 86400e3 })).toString("base64url");
  return payload + "." + sign(payload, ph);
}

const adminKey = () => (process.env.ADMIN_NICKNAME ? "u:" + normNick(process.env.ADMIN_NICKNAME) : null);
const isAdminKey = key => !!adminKey() && key === adminKey();

// 요청의 토큰으로 사용자 불러오기 (Redis GET 1번)
async function authed(req) {
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [payload, sig] = tok.split(".");
  let p;
  try { p = JSON.parse(Buffer.from(payload || "", "base64url").toString()); } catch (e) { p = null; }
  if (!p || !p.k || !sig || p.e < Date.now()) throw fail(401, "다시 로그인해주세요");
  const user = await db.getJSON(p.k);
  if (!user) throw fail(401, "다시 로그인해주세요");
  const want = sign(payload, user.ph);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) throw fail(401, "다시 로그인해주세요");
  return { key: p.k, user };
}

module.exports = { fail, checkNick, normNick, userKey, hashPin, verifyPin, makeToken, authed, isAdminKey };
