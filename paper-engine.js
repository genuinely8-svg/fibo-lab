/*
  paper-engine.js — 모의투자 계산 규칙 (서버와 브라우저가 같이 씀)
  ---------------------------------------------------------------
  - 서버(api/*.js)는 require 로, 브라우저(paper.html)는 <script> 로 불러와요 → 계산이 항상 똑같음
  - 마진 모드: 격리(포지션마다 증거금이 따로) / 교차(계정의 남은 잔고 전체가 증거금을 같이 씀)
  - 레버리지 1~100배, 시장가 수수료 0.05% / 지정가 수수료 0.02% / 유지증거금률 0.5%
  - 포지션 하나 = 주문 하나 (같은 코인을 여러 번 열면 각각 따로, 각자 TP/SL)
  - 펀딩비는 계산하지 않아요 (화면에 보여주기만)
  - 청산·체결 소급 처리(replay): 1분봉을 시간순으로 훑으면서 지정가 체결 / SL / 청산 / TP / 지정가 청산 확인
    한 봉에서 TP와 SL(또는 청산)이 둘 다 닿으면 보수적으로 SL(청산)이 먼저 난 것으로 처리
  - TP/SL 세 종류 (비트겟과 같은 구성)
    · 전체 포지션 TP/SL: p.tp / p.sl → 닿으면 포지션 전부 정리
    · 부분 포지션 TP/SL (분할 익절): p.pt = [{id, qty, tp, sl}] → 둘 중 먼저 닿는 쪽으로 qty 만큼 정리하고 그 주문은 사라짐 (OCO)
    · 트레일링: p.trl = {qty, cb(되돌림 %), act(작동 가격, 없으면 바로 작동), ext(작동 뒤 가장 유리했던 가격)}
      → 작동 뒤 가장 유리했던 가격에서 cb% 되돌아오면 qty 만큼 시장가로 정리
    · 한 봉 안에서 손절 쪽(SL·부분 SL·트레일링·청산)은 지금 가격에 가까운 것부터 차례로 처리
      트레일링의 "가장 유리했던 가격"은 봉이 끝난 뒤에 갱신 (같은 봉에서 올랐다 내렸다 한 건 순서를 몰라서 다음 봉부터 반영)
  - 교차 청산: 한 봉 안에서 교차 포지션 전부가 "가장 불리한 가격"(롱=저가, 숏=고가)에 동시에 있다고 보고
    계정 자산(잔고+증거금+미실현손익) <= 유지증거금 합계 이면 교차 포지션을 전부 청산 (보수적)
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PaperEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const START = 10000;
  const FEE_TAKER = 0.0005, FEE_MAKER = 0.0002;
  const MMR = 0.005;                     // 유지증거금률
  const MAX_LEV = 100;
  const MAX_POS = 20, MAX_ORD = 30, LOG_MAX = 200, MIN_NOTIONAL = 5;
  const MIN = 60000;

  const num = v => (v === "" || v == null ? NaN : Number(v));
  const ceilMin = t => Math.ceil(t / MIN) * MIN;
  const r8 = v => Math.round(v * 1e8) / 1e8;
  const modeOf = x => (x && x.mode === "cross" ? "cross" : "isolated");

  const liqPrice = (side, entry, lev) => side === "long" ? entry * (1 - 1 / lev + MMR) : entry * (1 + 1 / lev - MMR);
  const pnlOf = (side, entry, price, qty) => (side === "long" ? price - entry : entry - price) * qty;
  const needOf = (qty, price, lev, rate) => qty * price * (1 / lev + rate);    // 증거금 + 수수료
  const mmOf = (qty, price) => qty * price * MMR;                              // 유지증거금

  // ── 교차 마진 ──────────────────────────────────────────────
  // 교차 지갑 = 남은 잔고 + 교차 포지션 증거금 (격리 증거금은 따로 묶여 있어서 제외)
  const crossWallet = st => st.bal + st.pos.reduce((s, p) => s + (modeOf(p) === "cross" ? p.margin : 0), 0);
  // 한 포지션(target)의 가격만 움직이고 나머지는 지금 가격이라고 보고 계산한 교차 청산가
  //   others: 같은 교차 계정의 다른 포지션들 [{sym, side, entry, qty}], pxOf(sym): 현재가
  function crossLiqPrice(W, others, target, pxOf) {
    let A = W, B = 0;
    for (const o of others) { const x = pxOf(o.sym) || o.entry; A += pnlOf(o.side, o.entry, x, o.qty); B += mmOf(o.qty, x); }
    const q = target.qty;
    const P = target.side === "long" ? (B - A + q * target.entry) / (q * (1 - MMR)) : (A - B + q * target.entry) / (q * (1 + MMR));
    return P > 0 ? P : null;                        // 0 이하면 (그 방향으로는) 청산되지 않음
  }
  // 계정 전체(교차) 요약: 자산, 유지증거금, 증거금률 (%)
  function crossAccount(st, pxOf) {
    const cp = st.pos.filter(p => modeOf(p) === "cross");
    let eq = crossWallet(st), mm = 0, up = 0;
    for (const p of cp) { const x = pxOf(p.sym) || p.entry, u = pnlOf(p.side, p.entry, x, p.qty); eq += u; up += u; mm += mmOf(p.qty, x); }
    return { n: cp.length, equity: eq, mm, upnl: up, ratio: cp.length ? (eq > 0 ? mm / eq * 100 : 100) : 0 };
  }
  // 포지션 하나의 청산가 (격리: 저장된 값, 교차: 계정 기준 계산)
  function liqOf(st, p, pxOf) {
    if (modeOf(p) !== "cross") return p.liq;
    const W = crossWallet(st), others = st.pos.filter(o => o !== p && modeOf(o) === "cross");
    return crossLiqPrice(W, others, p, pxOf);
  }
  // 증거금률 (%): 유지증거금 / 증거금 잔액. 100% 가 되면 청산
  function ratioOf(st, p, pxOf) {
    if (modeOf(p) === "cross") return crossAccount(st, pxOf).ratio;
    const x = pxOf(p.sym) || p.entry, bal = p.margin + pnlOf(p.side, p.entry, x, p.qty);
    return bal > 0 ? mmOf(p.qty, x) / bal * 100 : 100;
  }

  function newState(now) {
    return { bal: START, dep: START, pos: [], ord: [], ol: [], th: [], st: { n: 0, w: 0, rp: 0, fee: 0 }, chk: now, seq: 1 };
  }
  // 지정가 청산(ro) 주문은 증거금을 묶지 않아요
  const reserved = st => st.ord.reduce((s, o) => s + (o.ro ? 0 : needOf(o.qty, o.price, o.lev, FEE_MAKER)), 0);
  const available = st => st.bal - reserved(st);
  const sumMargin = st => st.pos.reduce((s, p) => s + p.margin, 0);

  function logOrder(st, e) { st.ol.unshift(e); if (st.ol.length > LOG_MAX) st.ol.length = LOG_MAX; }
  function logTrade(st, e) { st.th.unshift(e); if (st.th.length > LOG_MAX) st.th.length = LOG_MAX; }

  // TP/SL 방향 검사 (ref 보다 롱은 TP 위·SL 아래, 숏은 반대). 값이 비었으면 null
  function checkTpSl(side, ref, tp, sl) {
    tp = num(tp); sl = num(sl);
    const out = { tp: null, sl: null };
    if (!isNaN(tp)) {
      if (!(tp > 0)) throw new Error("Invalid take-profit price");
      if (side === "long" ? tp <= ref : tp >= ref) throw new Error(`Take-profit must be ${side === "long" ? "above" : "below"} the current (reference) price`);
      out.tp = tp;
    }
    if (!isNaN(sl)) {
      if (!(sl > 0)) throw new Error("Invalid stop-loss price");
      if (side === "long" ? sl >= ref : sl <= ref) throw new Error(`Stop-loss must be ${side === "long" ? "below" : "above"} the current (reference) price`);
      out.sl = sl;
    }
    return out;
  }

  // 같은 코인·같은 방향·같은 마진 모드의 열린 포지션 (있으면 거기에 합침 = 물타기/불타기)
  const sameOf = (st, o) => st.pos.find(p => p.sym === o.sym && p.side === o.side && modeOf(p) === modeOf(o));
  // 합쳤을 때 추가로 필요한 돈 (레버리지를 새 주문 값으로 맞추면서 기존 증거금도 다시 계산)
  function mergeNeed(p, o, price, rate) {
    const q = r8(p.qty + o.qty), entry = (p.entry * p.qty + price * o.qty) / q;
    return q * entry / o.lev - p.margin + o.qty * price * rate;
  }
  // 예전에 따로 잡힌 같은 포지션들을 하나로 합침 (증거금은 그대로 더해서 잔고 변화 없음)
  function mergeAll(st) {
    let changed = false;
    for (let i = 0; i < st.pos.length; i++) {
      const a = st.pos[i];
      for (let j = st.pos.length - 1; j > i; j--) {
        const b = st.pos[j];
        if (b.sym !== a.sym || b.side !== a.side || modeOf(b) !== modeOf(a)) continue;
        const q = r8(a.qty + b.qty);
        a.entry = (a.entry * a.qty + b.entry * b.qty) / q; a.qty = q;
        a.margin += b.margin; a.fee += b.fee; a.rp += b.rp;
        a.lev = Math.max(1, Math.min(MAX_LEV, Math.round(a.qty * a.entry / a.margin)));
        if (modeOf(a) === "isolated") a.liq = liqPrice(a.side, a.entry, a.qty * a.entry / a.margin);
        a.tp = a.tp || b.tp; a.sl = a.sl || b.sl; a.t = Math.min(a.t, b.t);
        if (b.pt && b.pt.length) a.pt = (a.pt || []).concat(b.pt);
        if (b.trl && !a.trl) a.trl = b.trl;
        for (const o of st.ord) if (o.ro === b.id) o.ro = a.id;
        st.pos.splice(j, 1); changed = true;
      }
    }
    return changed;
  }

  function openPosition(st, o, t, rate, via, fillT) {
    const ex = sameOf(st, o);
    if (ex) {                                               // 물타기/불타기: 평균 진입가로 합침
      const fee = o.qty * o.price * rate, q = r8(ex.qty + o.qty), entry = (ex.entry * ex.qty + o.price * o.qty) / q;
      let margin = q * entry / o.lev, lev = o.lev;
      if (margin - ex.margin + fee > st.bal + 1e-9) {        // (소급 체결 중) 다시 맞출 돈이 모자라면: 증거금만 더하고 레버리지는 실제 비율로
        margin = ex.margin + o.qty * o.price / o.lev; lev = Math.max(1, Math.min(MAX_LEV, Math.round(q * entry / margin)));
      }
      st.bal -= margin - ex.margin + fee;
      ex.qty = q; ex.entry = entry; ex.margin = margin; ex.lev = lev; ex.fee += fee;
      if (modeOf(ex) === "isolated") ex.liq = liqPrice(ex.side, entry, q * entry / margin);
      if (o.tp) ex.tp = o.tp;
      if (o.sl) ex.sl = o.sl;
      st.st.fee += fee;
      return Object.defineProperty(ex, "_merged", { value: true, configurable: true, enumerable: false });
    }
    const mode = modeOf(o), margin = o.qty * o.price / o.lev, fee = o.qty * o.price * rate;
    st.bal -= margin + fee;
    const p = { id: st.seq++, sym: o.sym, side: o.side, mode, lev: o.lev, qty: o.qty, entry: o.price, margin, fee, rp: 0,
                liq: mode === "isolated" ? liqPrice(o.side, o.price, o.lev) : null, tp: o.tp || null, sl: o.sl || null, t, via };
    if (fillT != null) p.fillT = fillT;
    st.pos.push(p);
    st.st.fee += fee;
    return p;
  }

  // 포지션 닫기(전부 또는 일부). reason: "TP" | "SL" | "Liquidation" | "Manual" | "Limit close". qtyClose 없으면 전부
  function closePosition(st, p, price, reason, t, qtyClose) {
    const full = !(qtyClose > 0) || qtyClose >= p.qty * (1 - 1e-9);
    const q = full ? p.qty : r8(qtyClose), f = q / p.qty;
    const mg = p.margin * f, openFee = p.fee * f, cross = modeOf(p) === "cross";
    let gross, closeFee, back;
    if (reason === "Liquidation") {
      if (cross) { gross = pnlOf(p.side, p.entry, price, q); closeFee = mmOf(q, price); back = mg + gross - closeFee; }   // 교차: 계정 전체가 같이 정산 (바닥은 0)
      else { gross = -mg; closeFee = 0; back = 0; }
    } else {
      gross = pnlOf(p.side, p.entry, price, q);
      closeFee = q * price * (reason === "TP" || reason === "Limit close" ? FEE_MAKER : FEE_TAKER);
      back = Math.max(0, mg + gross - closeFee);
    }
    st.bal += back;
    const net = gross - closeFee - openFee;
    st.st.rp += net; st.st.fee += closeFee;
    const lev = p.lev, tr = { id: p.id, t, ot: p.t, sym: p.sym, side: p.side, mode: modeOf(p), lev, qty: q, entry: p.entry, exit: price,
                 pnl: net, fee: openFee + closeFee, roe: net / mg * 100, reason: full ? reason : `${reason} (partial ${Math.round(f * 100)}%)` };
    if (full) {
      st.st.n++; if (p.rp + net > 0) st.st.w++;     // 승패는 포지션이 완전히 닫힐 때 전체 손익으로 한 번만
      st.pos = st.pos.filter(x => x.id !== p.id);
      st.ord = st.ord.filter(o => o.ro !== p.id);   // 이 포지션의 지정가 청산 주문은 같이 정리
    } else { p.qty = r8(p.qty - q); p.margin -= mg; p.fee -= openFee; p.rp += net; }
    logTrade(st, tr);
    return tr;
  }

  // 주문 접수 검증 + 체결/대기 처리. cur = 지금 가격
  function placeOrder(st, req, cur, now) {
    const sym = String(req.sym || "").toUpperCase();
    if (!/^[A-Z0-9]{2,20}USDT$/.test(sym)) throw new Error("Invalid symbol");
    const side = req.side === "short" ? "short" : req.side === "long" ? "long" : null;
    if (!side) throw new Error("Invalid side");
    const lev = Math.floor(num(req.lev));
    if (!(lev >= 1 && lev <= MAX_LEV)) throw new Error(`Leverage must be 1–${MAX_LEV}x`);
    const mode = modeOf(req);
    const qty = r8(num(req.qty));
    if (!(qty > 0) || !isFinite(qty)) throw new Error("Enter a quantity");
    const limit = req.type === "limit";
    let price = cur;
    if (limit) {
      price = num(req.price);
      if (!(price > 0)) throw new Error("Enter a limit price");
    }
    if (qty * price < MIN_NOTIONAL) throw new Error(`Order value too small (min ${MIN_NOTIONAL} USDT)`);
    // 바로 체결되는 지정가(현재가보다 유리하지 않은 방향)는 시장가처럼 현재가로 체결
    const immediate = !limit || (side === "long" ? price >= cur : price <= cur);
    const fillPrice = immediate ? cur : price;
    const { tp, sl } = checkTpSl(side, fillPrice, req.tp, req.sl);
    const rate = immediate ? FEE_TAKER : FEE_MAKER;
    const o = { sym, side, mode, lev, qty, price: fillPrice, tp, sl };
    const ex = immediate ? sameOf(st, o) : null;
    const need = ex ? mergeNeed(ex, o, fillPrice, rate) : needOf(qty, fillPrice, lev, rate);
    if (need > available(st) + 1e-9) throw new Error("Insufficient available balance");
    if (immediate) {
      if (!ex && st.pos.length >= MAX_POS) throw new Error(`Max ${MAX_POS} open positions`);
      const p = openPosition(st, o, now, rate, limit ? "Limit (instant)" : "Market");
      logOrder(st, { id: p.id, t: now, sym, side, mode, lev, qty, price: fillPrice, kind: limit ? "Limit" : "Market", status: "Filled" });
      return { filled: true, pos: p, fill: fillPrice, merged: !!ex };
    }
    if (st.ord.length >= MAX_ORD) throw new Error(`Max ${MAX_ORD} open orders`);
    o.id = st.seq++; o.t = now;
    st.ord.push(o);
    logOrder(st, { id: o.id, t: now, sym, side, mode, lev, qty, price, kind: "Limit", status: "Open" });
    return { filled: false, ord: o };
  }

  // 지정가 청산: 포지션의 pct% 를 정한 가격에 닫는 주문 (롱은 위에서 팔고, 숏은 아래에서 삼). 이미 유리한 가격이면 바로 체결
  function placeCloseLimit(st, id, pct, price, cur, now) {
    const p = st.pos.find(x => x.id === id);
    if (!p) throw new Error("Position already closed or not found");
    pct = Math.floor(num(pct));
    if (!(pct >= 1 && pct <= 100)) throw new Error("Close ratio must be 1–100%");
    price = num(price);
    if (!(price > 0)) throw new Error("Enter a limit price");
    const qty = pct >= 100 ? p.qty : r8(p.qty * pct / 100);
    const immediate = p.side === "long" ? price <= cur : price >= cur;
    if (immediate) { const tr = closePosition(st, p, cur, "Manual", now, qty); return { filled: true, tr }; }
    if (st.ord.length >= MAX_ORD) throw new Error(`Max ${MAX_ORD} open orders`);
    const o = { id: st.seq++, ro: p.id, sym: p.sym, side: p.side, mode: modeOf(p), lev: p.lev, qty, pct, price, t: now };
    st.ord.push(o);
    logOrder(st, { id: o.id, t: now, sym: p.sym, side: p.side, mode: modeOf(p), lev: p.lev, qty, price, kind: "Limit close", status: "Open" });
    return { filled: false, ord: o };
  }


  // ── 부분 포지션 TP/SL (분할 익절) ─────────────────────────────
  const MAX_PT = 10;
  // req: { pct(1~100) 또는 qty, tp, sl } — tp·sl 중 하나 이상. cur = 지금 가격
  function addPartial(st, p, req, cur) {
    if (!p) throw new Error("Position already closed or not found");
    p.pt = p.pt || [];
    if (p.pt.length >= MAX_PT) throw new Error(`Max ${MAX_PT} partial TP/SL orders per position`);
    const { tp, sl } = checkTpSl(p.side, cur, req.tp, req.sl);
    if (tp == null && sl == null) throw new Error("Enter a take-profit or stop-loss price");
    let qty = num(req.qty);
    if (!(qty > 0)) { const pct = num(req.pct); if (!(pct > 0 && pct <= 100)) throw new Error("Enter a quantity"); qty = p.qty * pct / 100; }
    qty = r8(Math.min(qty, p.qty));
    if (!(qty > 0) || qty * cur < MIN_NOTIONAL) throw new Error(`Quantity too small (min ${MIN_NOTIONAL} USDT)`);
    const o = { id: st.seq++, qty, tp, sl };
    p.pt.push(o);
    return o;
  }
  function delPartial(p, oid) {
    if (!p || !p.pt || !p.pt.some(o => o.id === oid)) throw new Error("Order not found");
    p.pt = p.pt.filter(o => o.id !== oid);
    if (!p.pt.length) delete p.pt;
  }
  // ── 트레일링 TP/SL ──────────────────────────────────────────
  // req: { cb: 되돌림 % (0.1~20), act: 작동 가격(선택), pct: 정리할 비율 % }
  function setTrail(p, req, cur) {
    if (!p) throw new Error("Position already closed or not found");
    const cb = num(req.cb);
    if (!(cb >= 0.1 && cb <= 20)) throw new Error("Callback rate must be 0.1–20%");
    const pct = isNaN(num(req.pct)) ? 100 : num(req.pct);
    if (!(pct >= 1 && pct <= 100)) throw new Error("Quantity must be 1–100%");
    let act = num(req.act);
    if (isNaN(act)) act = null;
    else {
      if (!(act > 0)) throw new Error("Invalid activation price");
      if (p.side === "long" ? act <= cur : act >= cur) throw new Error(`Activation price must be ${p.side === "long" ? "above" : "below"} the current price`);
    }
    const qty = pct >= 100 ? null : r8(p.qty * pct / 100);           // null = 그때 남아 있는 전부
    if (qty != null && qty * cur < MIN_NOTIONAL) throw new Error(`Quantity too small (min ${MIN_NOTIONAL} USDT)`);
    p.trl = { cb, act, qty, pct, ext: act == null ? cur : null };
    return p.trl;
  }
  // 트레일링이 작동 중이면 지금 정리 가격 (아니면 null)
  const trailStop = p => p.trl && p.trl.ext != null ? (p.side === "long" ? p.trl.ext * (1 - p.trl.cb / 100) : p.trl.ext * (1 + p.trl.cb / 100)) : null;

  function cancelOrder(st, id, now) {
    const o = st.ord.find(x => x.id === id);
    if (!o) throw new Error("Order already filled or not found");
    st.ord = st.ord.filter(x => x.id !== id);
    logOrder(st, { id: o.id, t: now, sym: o.sym, side: o.side, mode: modeOf(o), lev: o.lev, qty: o.qty, price: o.price, kind: o.ro ? "Limit close" : "Limit", status: "Cancelled" });
  }

  // 1분봉 소급 처리. candles: [{t, sym, o, h, l, c}] (t = 봉 시작 ms). 반환: 일어난 일 목록
  function replay(st, candles) {
    const ev = [], byT = new Map(), lastC = {};
    for (const k of candles) { if (!byT.has(k.t)) byT.set(k.t, []); byT.get(k.t).push(k); }
    for (const t of [...byT.keys()].sort((a, b) => a - b)) {
      const ks = byT.get(t), K = {};
      for (const k of ks) K[k.sym] = k;
      const live = p => t >= ceilMin(p.t);                       // 이 봉에서 이미 열려 있었던 포지션
      const push = (type, p, tr) => ev.push({ t, type, sym: p.sym, side: p.side, mode: modeOf(p), price: tr.exit, pnl: tr.pnl, qty: tr.qty });

      // 1) 지정가 진입 체결 (주문을 낸 시각 다음 봉부터 확인)
      for (const k of ks) for (const o of st.ord.slice()) {
        if (o.ro || o.sym !== k.sym || t < ceilMin(o.t)) continue;
        if (!(o.side === "long" ? k.l <= o.price : k.h >= o.price)) continue;
        st.ord = st.ord.filter(x => x.id !== o.id);
        const p = openPosition(st, o, t, FEE_MAKER, "Limit", t);
        if (!p._merged) p.id = o.id;                             // 새 포지션이면 주문 번호 그대로 포지션 번호로
        logOrder(st, { id: o.id, t, sym: o.sym, side: o.side, mode: modeOf(o), lev: o.lev, qty: o.qty, price: o.price, kind: "Limit", status: "Filled" });
        ev.push({ t, type: "fill", sym: o.sym, side: o.side, mode: modeOf(o), price: o.price, qty: o.qty });
      }
      // 2) 손절 쪽: 전체 SL / 격리 청산 / 부분 SL / 트레일링 — 지금 가격에 가까운(먼저 닿는) 것부터
      for (const k of ks) for (const p of st.pos.slice()) {
        if (p.sym !== k.sym || !live(p)) continue;
        const long = p.side === "long", cross = modeOf(p) === "cross";
        const hit = x => (long ? k.l <= x : k.h >= x);
        const list = [];
        if (!cross && p.liq) list.push({ px: p.liq, kind: "liq", pri: 0 });
        if (p.sl != null) list.push({ px: p.sl, kind: "sl", pri: 1 });
        for (const o of p.pt || []) if (o.sl != null) list.push({ px: o.sl, kind: "psl", o, pri: 2 });
        const ts = trailStop(p);
        if (ts != null) list.push({ px: ts, kind: "trail", pri: 3 });
        // 롱은 높은 가격부터(먼저 닿음), 숏은 낮은 가격부터. 같은 가격이면 부분 → 전체 → 청산 순
        list.sort((a, b) => (long ? b.px - a.px : a.px - b.px) || b.pri - a.pri);
        for (const x of list) {
          if (!st.pos.includes(p)) break;
          if (!hit(x.px)) continue;
          if (x.kind === "liq") push("liq", p, closePosition(st, p, p.liq, "Liquidation", t + MIN));
          else if (x.kind === "sl") push("sl", p, closePosition(st, p, p.sl, "SL", t + MIN));
          else if (x.kind === "psl") {
            if (!p.pt || !p.pt.includes(x.o)) continue;
            p.pt = p.pt.filter(o => o !== x.o);
            push("sl", p, closePosition(st, p, x.px, "SL", t + MIN, Math.min(p.qty, x.o.qty)));
          } else if (x.kind === "trail" && p.trl) {
            const q = p.trl.qty == null ? p.qty : Math.min(p.qty, p.trl.qty);
            delete p.trl;
            push("trail", p, closePosition(st, p, x.px, "Trailing", t + MIN, q));
          }
        }
        if (st.pos.includes(p) && p.pt && !p.pt.length) delete p.pt;
        // 트레일링: 작동 확인 + 가장 유리했던 가격 갱신 (봉이 끝난 뒤)
        if (st.pos.includes(p) && p.trl) {
          const fav = long ? k.h : k.l, tr = p.trl;
          if (tr.ext == null) { if (tr.act == null || (long ? k.h >= tr.act : k.l <= tr.act)) tr.ext = fav; }
          else tr.ext = long ? Math.max(tr.ext, fav) : Math.min(tr.ext, fav);
        }
      }
      // 3) 교차 청산: 교차 포지션이 전부 가장 불리한 가격에 있다고 보고 계정 단위로 확인
      const cp = st.pos.filter(p => modeOf(p) === "cross" && live(p));
      if (cp.length) {
        const adv = p => { const k = K[p.sym]; return k ? (p.side === "long" ? k.l : k.h) : (lastC[p.sym] != null ? lastC[p.sym] : p.entry); };
        let W = st.bal;                                          // 이 시각의 교차 지갑 (아직 안 열린 포지션이 쓴 돈은 되돌려 계산)
        for (const p of st.pos) { if (modeOf(p) === "cross" && live(p)) W += p.margin; else if (!live(p)) W += p.margin + p.fee; }
        let eq = W, mm = 0;
        for (const p of cp) { const x = adv(p); eq += pnlOf(p.side, p.entry, x, p.qty); mm += mmOf(p.qty, x); }
        if (eq <= mm) {
          for (const p of cp) { const tr = closePosition(st, p, adv(p), "Liquidation", t + MIN); push("liq", p, tr); }
          if (st.bal < 0) st.bal = 0;
        }
      }
      // 4) 익절: 전체 TP / 부분 TP (체결된 바로 그 봉에서는 안 봄) — 먼저 닿는 것부터 → 그다음 지정가 청산 주문
      for (const k of ks) for (const p of st.pos.slice()) {
        if (p.sym !== k.sym || !live(p) || p.fillT === t) continue;
        const long = p.side === "long", hit = x => (long ? k.h >= x : k.l <= x);
        const list = [];
        if (p.tp != null) list.push({ px: p.tp, kind: "tp", pri: 0 });
        for (const o of p.pt || []) if (o.tp != null) list.push({ px: o.tp, kind: "ptp", o, pri: 1 });
        list.sort((a, b) => (long ? a.px - b.px : b.px - a.px) || b.pri - a.pri);
        for (const x of list) {
          if (!st.pos.includes(p)) break;
          if (!hit(x.px)) continue;
          if (x.kind === "tp") push("tp", p, closePosition(st, p, p.tp, "TP", t + MIN));
          else {
            if (!p.pt || !p.pt.includes(x.o)) continue;
            p.pt = p.pt.filter(o => o !== x.o);
            push("tp", p, closePosition(st, p, x.px, "TP", t + MIN, Math.min(p.qty, x.o.qty)));
          }
        }
        if (st.pos.includes(p) && p.pt && !p.pt.length) delete p.pt;
      }
      for (const k of ks) for (const o of st.ord.slice()) {
        if (!o.ro || o.sym !== k.sym || t < ceilMin(o.t)) continue;
        const p = st.pos.find(x => x.id === o.ro);
        if (!p) { st.ord = st.ord.filter(x => x.id !== o.id); continue; }
        if (!(o.side === "long" ? k.h >= o.price : k.l <= o.price)) continue;
        st.ord = st.ord.filter(x => x.id !== o.id);
        const q = o.pct >= 100 ? p.qty : Math.min(p.qty, r8(p.qty * o.pct / 100));
        logOrder(st, { id: o.id, t, sym: o.sym, side: o.side, mode: modeOf(o), lev: o.lev, qty: q, price: o.price, kind: "Limit close", status: "Filled" });
        push("rclose", p, closePosition(st, p, o.price, "Limit close", t + MIN, q));
      }
      for (const k of ks) lastC[k.sym] = k.c;
    }
    return ev;
  }

  function summary(st) {                     // 가격 없이 계산되는 요약 (관리자 목록용: 실현 기준)
    const equity = st.bal + sumMargin(st);
    return { equity, ret: (equity - st.dep) / st.dep * 100 };
  }

  return { mergeAll, START, FEE_TAKER, FEE_MAKER, MMR, MAX_LEV, MAX_POS, MAX_ORD, MIN_NOTIONAL,
           liqPrice, pnlOf, needOf, mmOf, modeOf, crossWallet, crossLiqPrice, crossAccount, liqOf, ratioOf,
           newState, reserved, available, sumMargin, checkTpSl, addPartial, delPartial, setTrail, trailStop, MAX_PT,
           placeOrder, placeCloseLimit, cancelOrder, closePosition, replay, summary, logTrade };
});
