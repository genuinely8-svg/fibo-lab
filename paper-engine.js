/*
  paper-engine.js — 모의투자 계산 규칙 (서버와 브라우저가 같이 씀)
  ---------------------------------------------------------------
  - 서버(api/*.js)는 require 로, 브라우저(paper.html)는 <script> 로 불러와요 → 계산이 항상 똑같음
  - 격리 마진 / 시장가 수수료 0.05% / 지정가 수수료 0.02% / 유지증거금률 0.5% (청산가 계산)
  - 포지션 하나 = 주문 하나 (같은 코인을 여러 번 열면 각각 따로, 각자 TP/SL)
  - 펀딩비는 계산하지 않아요 (화면에 보여주기만)
  - 청산·체결 소급 처리(replay): 1분봉을 시간순으로 훑으면서 지정가 체결 / SL / 청산 / TP 확인
    한 봉에서 TP와 SL(또는 청산)이 둘 다 닿으면 보수적으로 SL(청산)이 먼저 난 것으로 처리
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PaperEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const START = 10000;
  const FEE_TAKER = 0.0005, FEE_MAKER = 0.0002;
  const MMR = 0.005;                     // 유지증거금률
  const MAX_POS = 20, MAX_ORD = 20, LOG_MAX = 200, MIN_NOTIONAL = 5;
  const MIN = 60000;

  const num = v => (v === "" || v == null ? NaN : Number(v));
  const ceilMin = t => Math.ceil(t / MIN) * MIN;
  const r8 = v => Math.round(v * 1e8) / 1e8;

  const liqPrice = (side, entry, lev) => side === "long" ? entry * (1 - 1 / lev + MMR) : entry * (1 + 1 / lev - MMR);
  const pnlOf = (side, entry, price, qty) => (side === "long" ? price - entry : entry - price) * qty;
  const needOf = (qty, price, lev, rate) => qty * price * (1 / lev + rate);    // 증거금 + 수수료

  function newState(now) {
    return { bal: START, dep: START, pos: [], ord: [], ol: [], th: [], st: { n: 0, w: 0, rp: 0, fee: 0 }, chk: now, seq: 1 };
  }
  const reserved = st => st.ord.reduce((s, o) => s + needOf(o.qty, o.price, o.lev, FEE_MAKER), 0);
  const available = st => st.bal - reserved(st);
  const sumMargin = st => st.pos.reduce((s, p) => s + p.margin, 0);

  function logOrder(st, e) {
    st.ol.unshift(e);
    if (st.ol.length > LOG_MAX) st.ol.length = LOG_MAX;
  }
  function logTrade(st, e) {
    st.th.unshift(e);
    if (st.th.length > LOG_MAX) st.th.length = LOG_MAX;
  }

  // TP/SL 방향 검사 (ref 보다 롱은 TP 위·SL 아래, 숏은 반대). 값이 비었으면 null
  function checkTpSl(side, ref, tp, sl) {
    tp = num(tp); sl = num(sl);
    const out = { tp: null, sl: null };
    if (!isNaN(tp)) {
      if (!(tp > 0)) throw new Error("익절가가 올바르지 않아요");
      if (side === "long" ? tp <= ref : tp >= ref) throw new Error(`익절가는 ${side === "long" ? "현재가(기준가)보다 높아야" : "현재가(기준가)보다 낮아야"} 해요`);
      out.tp = tp;
    }
    if (!isNaN(sl)) {
      if (!(sl > 0)) throw new Error("손절가가 올바르지 않아요");
      if (side === "long" ? sl >= ref : sl <= ref) throw new Error(`손절가는 ${side === "long" ? "현재가(기준가)보다 낮아야" : "현재가(기준가)보다 높아야"} 해요`);
      out.sl = sl;
    }
    return out;
  }

  function openPosition(st, o, t, rate, via, fillT) {
    const margin = o.qty * o.price / o.lev, fee = o.qty * o.price * rate;
    st.bal -= margin + fee;
    const p = { id: st.seq++, sym: o.sym, side: o.side, lev: o.lev, qty: o.qty, entry: o.price, margin, fee,
                liq: liqPrice(o.side, o.price, o.lev), tp: o.tp || null, sl: o.sl || null, t, via };
    if (fillT != null) p.fillT = fillT;
    st.pos.push(p);
    st.st.fee += fee;
    return p;
  }

  // 포지션 닫기. reason: "TP" | "SL" | "청산" | "수동"
  function closePosition(st, p, price, reason, t) {
    const rate = reason === "TP" ? FEE_MAKER : FEE_TAKER;
    let gross, closeFee;
    if (reason === "청산") { gross = -p.margin; closeFee = 0; }
    else { gross = pnlOf(p.side, p.entry, price, p.qty); closeFee = p.qty * price * rate; }
    st.bal += Math.max(0, p.margin + gross - closeFee);
    const net = gross - closeFee - p.fee;
    st.st.n++; if (net > 0) st.st.w++;
    st.st.rp += net; st.st.fee += closeFee;
    st.pos = st.pos.filter(x => x.id !== p.id);
    const tr = { id: p.id, t, ot: p.t, sym: p.sym, side: p.side, lev: p.lev, qty: p.qty, entry: p.entry, exit: price,
                 pnl: net, fee: p.fee + closeFee, roe: net / p.margin * 100, reason };
    logTrade(st, tr);
    return tr;
  }

  // 주문 접수 검증 + 체결/대기 처리. cur = 지금 가격. 반환: 접수 결과 메시지
  function placeOrder(st, req, cur, now) {
    const sym = String(req.sym || "").toUpperCase();
    if (!/^[A-Z0-9]{2,20}USDT$/.test(sym)) throw new Error("코인 정보가 올바르지 않아요");
    const side = req.side === "short" ? "short" : req.side === "long" ? "long" : null;
    if (!side) throw new Error("방향이 올바르지 않아요");
    const lev = Math.floor(num(req.lev));
    if (!(lev >= 1 && lev <= 20)) throw new Error("레버리지는 1~20배예요");
    const qty = r8(num(req.qty));
    if (!(qty > 0) || !isFinite(qty)) throw new Error("수량을 입력하세요");
    const limit = req.type === "limit";
    let price = cur;
    if (limit) {
      price = num(req.price);
      if (!(price > 0)) throw new Error("지정가 가격을 입력하세요");
    }
    if (qty * price < MIN_NOTIONAL) throw new Error(`주문 금액이 너무 작아요 (최소 ${MIN_NOTIONAL} USDT)`);
    // 바로 체결되는 지정가(현재가보다 유리하지 않은 방향)는 시장가처럼 현재가로 체결
    const immediate = !limit || (side === "long" ? price >= cur : price <= cur);
    const fillPrice = immediate ? cur : price;
    const { tp, sl } = checkTpSl(side, fillPrice, req.tp, req.sl);
    const rate = immediate ? FEE_TAKER : FEE_MAKER;
    if (needOf(qty, fillPrice, lev, rate) > available(st) + 1e-9) throw new Error("사용 가능한 잔고가 부족해요");
    const o = { sym, side, lev, qty, price: fillPrice, tp, sl };
    if (immediate) {
      if (st.pos.length >= MAX_POS) throw new Error(`포지션은 최대 ${MAX_POS}개까지예요`);
      const p = openPosition(st, o, now, rate, limit ? "지정가(즉시)" : "시장가");
      logOrder(st, { id: p.id, t: now, sym, side, lev, qty, price: fillPrice, kind: limit ? "지정가" : "시장가", status: "체결" });
      return { filled: true, pos: p };
    }
    if (st.ord.length >= MAX_ORD) throw new Error(`미체결 주문은 최대 ${MAX_ORD}개까지예요`);
    o.id = st.seq++; o.t = now;
    st.ord.push(o);
    logOrder(st, { id: o.id, t: now, sym, side, lev, qty, price, kind: "지정가", status: "접수" });
    return { filled: false, ord: o };
  }

  function cancelOrder(st, id, now) {
    const o = st.ord.find(x => x.id === id);
    if (!o) throw new Error("이미 체결됐거나 없는 주문이에요");
    st.ord = st.ord.filter(x => x.id !== id);
    logOrder(st, { id: o.id, t: now, sym: o.sym, side: o.side, lev: o.lev, qty: o.qty, price: o.price, kind: "지정가", status: "취소" });
  }

  // 1분봉 소급 처리. candles: [{t, sym, o, h, l, c}] (t = 봉 시작 ms). 반환: 일어난 일 목록
  function replay(st, candles) {
    const ev = [];
    candles = candles.slice().sort((a, b) => a.t - b.t);
    for (const k of candles) {
      // 1) 지정가 체결 (주문을 낸 시각 다음 봉부터 확인)
      for (const o of st.ord.slice()) {
        if (o.sym !== k.sym || k.t < ceilMin(o.t)) continue;
        if (!(o.side === "long" ? k.l <= o.price : k.h >= o.price)) continue;
        st.ord = st.ord.filter(x => x.id !== o.id);
        const p = openPosition(st, o, k.t, FEE_MAKER, "지정가", k.t);
        p.id = o.id;                                  // 주문 번호 그대로 포지션 번호로
        logOrder(st, { id: o.id, t: k.t, sym: o.sym, side: o.side, lev: o.lev, qty: o.qty, price: o.price, kind: "지정가", status: "체결" });
        ev.push({ t: k.t, type: "fill", sym: o.sym, side: o.side, price: o.price });
      }
      // 2) 포지션: 손절·청산 먼저, 그다음 익절 (체결된 바로 그 봉에서는 익절 안 봄)
      for (const p of st.pos.slice()) {
        if (p.sym !== k.sym || k.t < ceilMin(p.t)) continue;
        const long = p.side === "long";
        const liqHit = long ? k.l <= p.liq : k.h >= p.liq;
        const slHit = p.sl != null && (long ? k.l <= p.sl : k.h >= p.sl);
        if (liqHit || slHit) {
          const slFirst = slHit && (!liqHit || (long ? p.sl >= p.liq : p.sl <= p.liq));
          const tr = slFirst ? closePosition(st, p, p.sl, "SL", k.t + MIN) : closePosition(st, p, p.liq, "청산", k.t + MIN);
          ev.push({ t: k.t, type: slFirst ? "sl" : "liq", sym: p.sym, side: p.side, price: tr.exit, pnl: tr.pnl });
          continue;
        }
        if (p.tp != null && p.fillT !== k.t && (long ? k.h >= p.tp : k.l <= p.tp)) {
          const tr = closePosition(st, p, p.tp, "TP", k.t + MIN);
          ev.push({ t: k.t, type: "tp", sym: p.sym, side: p.side, price: tr.exit, pnl: tr.pnl });
        }
      }
    }
    return ev;
  }

  function summary(st) {                     // 가격 없이 계산되는 요약 (관리자 목록용: 실현 기준)
    const equity = st.bal + sumMargin(st);
    return { equity, ret: (equity - st.dep) / st.dep * 100 };
  }

  return { START, FEE_TAKER, FEE_MAKER, MMR, MAX_POS, MAX_ORD, MIN_NOTIONAL,
           liqPrice, pnlOf, needOf, newState, reserved, available, sumMargin, checkTpSl,
           placeOrder, cancelOrder, closePosition, replay, summary, logTrade };
});
