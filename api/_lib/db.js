/* Upstash Redis (REST) — Vercel 이 넣어준 환경변수에서만 접속 정보를 읽어요. 코드에 비밀 값 없음 */
const URL_NAMES = ["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"];
const TOKEN_NAMES = ["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"];
const pick = names => { for (const n of names) if (process.env[n]) return process.env[n]; return null; };

function conf() {
  const url = pick(URL_NAMES), token = pick(TOKEN_NAMES);
  if (!url || !token) {
    const e = new Error("DB environment variables not found (" + URL_NAMES.concat(TOKEN_NAMES).join(", ") + ")");
    e.status = 500;
    throw e;
  }
  return { url: url.replace(/\/$/, ""), token };
}

async function call(path, body) {
  const { url, token } = conf();
  const res = await fetch(url + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error("DB error: " + (j.error || res.status)); e.status = 502; throw e; }
  return j;
}

// 명령 하나: cmd("GET", "key")
const cmd = async (...args) => (await call("", args)).result;
// 여러 명령을 한 번에 (Upstash 명령 수는 똑같이 세지만 왕복이 줄어요)
const pipeline = async cmds => (await call("/pipeline", cmds)).map(r => r.result);

const getJSON = async key => { const v = await cmd("GET", key); return v ? JSON.parse(v) : null; };
const setJSON = (key, obj) => cmd("SET", key, JSON.stringify(obj));

module.exports = { cmd, pipeline, getJSON, setJSON, tokenForSecret: () => pick(TOKEN_NAMES) };
