/*
  bump.js — 새 버전 번호 붙이기
  모든 .html 파일 안의 우리 파일(.js / .css) 주소 뒤에 ?v=시각 을 붙여요.
  → 브라우저가 예전 파일을 기억해두고 계속 쓰는 문제(캐시)를 막음
  커밋할 때마다 자동으로 실행돼요 (.git/hooks/pre-commit)
  직접 실행: node bump.js
*/
const fs = require("fs");
const d = new Date(), p = n => String(n).padStart(2, "0");
const v = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
const changed = [];
for (const f of fs.readdirSync(".").filter(f => f.endsWith(".html"))) {
  const s = fs.readFileSync(f, "utf8");
  // src="fib-core.js" / href="common.css" 처럼 우리 폴더 안 파일만 (http 로 시작하는 외부 주소는 그대로)
  const t = s.replace(/(src|href)="([^":?#]+\.(?:js|css))(\?v=[^"]*)?"/g, `$1="$2?v=${v}"`);
  if (t !== s) { fs.writeFileSync(f, t); changed.push(f); }
}
console.log(`버전 ${v} → ${changed.length}개 파일`);
