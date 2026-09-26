/*
  server.js — 내 컴퓨터에서 돌리는 작은 서버
  ---------------------------------------------------------------
  왜 필요할까?
    업비트는 "웹페이지(브라우저)에서 직접" 오는 요청은 10초에 1번 정도만 허락해요.
    서버(프로그램)에서 보내는 요청은 1초에 10번까지 괜찮아요.
    그래서 브라우저 → 이 서버 → 업비트 순서로 대신 물어봐 줍니다.

  실행:  node server.js     →  브라우저에서 http://localhost:3000
  설치할 것 없음 (Node.js 기본 기능만 사용)
*/
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
                ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".md": "text/plain; charset=utf-8" };

// ── 업비트 요청 줄 세우기 ─────────────────────────────────────────
// 여러 요청이 한꺼번에 와도 한 번에 하나씩, 최소 GAP ms 간격으로 보냄.
// 업비트가 "너무 많아요(429)"라고 하면 기다렸다가 다시 시도.
const sleep = ms => new Promise(r => setTimeout(r, ms));
let GAP = 200;             // 기본 간격 (초당 5회)
let chain = Promise.resolve();
const cache = new Map();   // 같은 주소를 20초 안에 또 물으면 저장해둔 답을 줌

function upbit(url) {   // 이름은 upbit지만 바이낸스 요청도 같은 줄에 세움
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 20000) return Promise.resolve(hit.res);
  const job = chain.then(async () => {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "fibo-lab/1.0" } });
      const body = await r.text();
      if (r.status === 429 || r.status === 418) {
        const wait = Math.min(2000 * attempt, 10000);
        GAP = Math.min(GAP * 2, 1500);          // 제한에 걸리면 간격을 늘림
        console.log(`[업비트 ${r.status}] 잠시 쉬었다 다시 시도 (${wait / 1000}초) · 남은 허용량: ${r.headers.get("remaining-req") || "?"}`);
        await sleep(wait);
        continue;
      }
      await sleep(GAP);
      GAP = Math.max(200, GAP - 50);            // 잘 되면 간격을 조금씩 되돌림
      const res = { status: r.status, body };
      if (r.ok) cache.set(url, { at: Date.now(), res });
      return res;
    }
    return { status: 429, body: JSON.stringify({ error: "업비트가 계속 제한 중이에요. 1~2분 뒤 다시 시도하세요." }) };
  });
  chain = job.catch(() => {});
  return job;
}

http.createServer(async (req, res) => {
  try {
    // 1) 거래소 요청은 대신 물어봄 (줄 세워서)
    //    /upbit/...   → 업비트 (원화)
    //    /binance/... → 바이낸스 현물 (달러)
    //    /fapi/...    → 바이낸스 선물 (달러)
    const ROUTES = {
      "/upbit/": process.env.UPBIT_BASE || "https://api.upbit.com/v1/",
      "/binance/": process.env.BINANCE_BASE || "https://api.binance.com/api/v3/",
      "/fapi/": process.env.FAPI_BASE || "https://fapi.binance.com/fapi/v1/",
    };
    const prefix = Object.keys(ROUTES).find(p => req.url.startsWith(p));
    if (prefix) {
      const target = ROUTES[prefix] + req.url.slice(prefix.length);
      const r = await upbit(target);
      res.writeHead(r.status, { "content-type": "application/json; charset=utf-8" });
      res.end(r.body);
      return;
    }
    // 2) 나머지는 이 폴더의 파일(index.html, fib-core.js)을 보내줌
    const file = decodeURIComponent(req.url.split("?")[0]).slice(1) || "index.html";   // "/?watch=..." 도 index.html
    const full = path.join(__dirname, file);
    if (!full.startsWith(__dirname) || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); res.end("없는 파일"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(full)] || "application/octet-stream" });
    fs.createReadStream(full).on("error", () => res.end()).pipe(res);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("서버 오류: " + e.message);
  }
}).on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.log(`[!] ${PORT}번 포트를 이미 다른 프로그램이 쓰고 있어요.`);
    console.log("    이미 켜둔 서버 창이 있으면 그걸 쓰거나, 그 창을 닫고 다시 실행하세요.");
  } else {
    console.log("[!] 서버 오류:", e.message);
  }
}).listen(PORT, () => {
  console.log(`Fibo Lab running  ->  http://localhost:${PORT}`);
  console.log("Close this window to stop the server.");
});
