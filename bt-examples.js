/* bt-examples.js — Backtest tab: example scripts + rules to give an AI (code stays in English) */
window.BT_SPEC = `Gwave backtest script rules (JavaScript, runs in the browser)

ACCOUNT SETTINGS come from the right panel as \`config\` (read-only):
  config.symbol     main coin, e.g. "BTC" (no USDT)   config.interval  "1m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w"
  config.from       start date "2020-01-01"           config.capital   starting capital (USDT)
  config.leverage   e.g. 10                           config.sizePct   % of equity used as margin for ONE whole trade (all split entries together)
  config.margin     "isolated" | "cross"              config.direction "long" | "short" | "both"
  config.fee        fee per fill in % (e.g. 0.05)
  Do not hard-code these.

STRATEGY SETTINGS: use input("Label", default) for every strategy number. The page reads these calls and
creates a field on the panel for each one, so the user can change values without touching code.
  const FAST = input("Fast EMA", 50);   const SPLITS = input("Split ratio", "1,2,4");   const USE_RSI = input("Use RSI filter", true);
  (label must be a plain string literal, default a number, string or true/false; write each input() once, at the top)

DATA & INDICATORS (await allowed):
- await candles(config.symbol, config.interval, config.from) → [{t, o, h, l, c, v}] oldest first, closed candles only, t = UTC ms
  other coins: await candles("ETH", config.interval, config.from)   (Binance USDT-M futures)
- ta.sma(arr, n), ta.ema(arr, n), ta.rsi(arr, n), ta.atr(candles, n), ta.highest(arr, n), ta.lowest(arr, n)
  ta.macd(arr, 12, 26, 9) → { macd, signal, hist }      (same length as input, NaN while warming up)

ACCOUNT SIMULATOR: const acct = new Account(config)
- The trade budget = equity × sizePct % is fixed when the account goes from flat to its first position.
- acct.open("long" | "short", price, t, { sym, share, sl, tp, note })  new position; share = part of the budget (0..1, default 1)
- acct.add(price, t, { sym, share, sl, tp })      split entry / averaging into the open position (average entry recalculated)
- acct.close(price, t, "reason", { sym, frac })   close all (frac 1) or a part (frac 0.1 = 10% of the position)
- acct.setStop(sl, tp, { sym })                   move stop loss / take profit
- acct.update(candle, sym)                        call FIRST on every candle for every coin you hold (main coin: sym can be omitted)
                                                  → stop loss / take profit / liquidation (isolated or cross) and the equity curve
- acct.pos / acct.position("ETH") → null or { side, entry (average), qty, margin, entries, sl, tp }
- acct.side, acct.canLong, acct.canShort (direction setting), acct.dead (balance gone), acct.budget
- sym defaults to config.symbol. Several coins can be held at the same time (one position per coin).
- End with: return acct.result();

RULES:
- Decide on candle close, no look-ahead. Loop: for each candle → acct.update(...) for held coins → if (acct.dead) break → logic.
- When a stop and a target could both be hit in the same candle, assume the stop first (acct.update already does).
- Other coins: build a Map by time (new Map(eth.map(c => [c.t, c])) and look up the same t as the main candle.
- log(...) writes to the log box, progress(0..1) moves the progress bar.
- No document, window or localStorage. Plain JavaScript, no external libraries.`;

window.BT_EXAMPLES = [
{ name: "예시 1 · 이동평균선 교차", code: `// EMA crossover: fast EMA crosses above slow EMA → long, crosses below → short (or close).
// Account settings (capital, leverage, size, margin mode, direction, fee) come from the panel.
const FAST = input("Fast EMA", 50);
const SLOW = input("Slow EMA", 200);

const cs = await candles(config.symbol, config.interval, config.from);
const close = cs.map(c => c.c);
const fast = ta.ema(close, FAST), slow = ta.ema(close, SLOW);
const acct = new Account(config);

for (let i = 1; i < cs.length; i++) {
  const c = cs[i];
  acct.update(c);
  if (acct.dead) break;
  const crossUp = fast[i - 1] <= slow[i - 1] && fast[i] > slow[i];
  const crossDown = fast[i - 1] >= slow[i - 1] && fast[i] < slow[i];
  if (crossUp) {
    if (acct.side === "short") acct.close(c.c, c.t, "EMA cross up");
    if (!acct.pos) acct.open("long", c.c, c.t);
  } else if (crossDown) {
    if (acct.side === "long") acct.close(c.c, c.t, "EMA cross down");
    if (!acct.pos) acct.open("short", c.c, c.t);
  }
  if (i % 2000 === 0) progress(i / cs.length);
}
return acct.result();` },
{ name: "예시 2 · 이동평균선 + RSI", code: `// Trend filter + pullback: trade only in the direction of the trend EMA,
// enter when RSI comes back out of oversold (long) / overbought (short). Fixed stop loss and take profit.
const TREND = input("Trend EMA", 200);
const RSI_LEN = input("RSI length", 14);
const RSI_LOW = input("RSI oversold", 30);
const RSI_HIGH = input("RSI overbought", 70);
const STOP = input("Stop loss %", 2);
const TAKE = input("Take profit %", 4);

const cs = await candles(config.symbol, config.interval, config.from);
const close = cs.map(c => c.c);
const ema = ta.ema(close, TREND), rsi = ta.rsi(close, RSI_LEN);
const acct = new Account(config);

for (let i = 1; i < cs.length; i++) {
  const c = cs[i];
  acct.update(c);
  if (acct.dead) break;
  if (acct.pos) continue;
  if (c.c > ema[i] && rsi[i - 1] < RSI_LOW && rsi[i] >= RSI_LOW)
    acct.open("long", c.c, c.t, { sl: c.c * (1 - STOP / 100), tp: c.c * (1 + TAKE / 100) });
  else if (c.c < ema[i] && rsi[i - 1] > RSI_HIGH && rsi[i] <= RSI_HIGH)
    acct.open("short", c.c, c.t, { sl: c.c * (1 + STOP / 100), tp: c.c * (1 - TAKE / 100) });
  if (i % 2000 === 0) progress(i / cs.length);
}
return acct.result();` },
{ name: "예시 3 · 이동평균선 + MACD", code: `// MACD signal-line cross in the direction of the trend EMA.
// Exit on the opposite MACD cross, with an ATR-based stop loss.
const TREND = input("Trend EMA", 100);
const ATR_LEN = input("ATR length", 14);
const ATR_STOP = input("Stop = ATR x", 2);

const cs = await candles(config.symbol, config.interval, config.from);
const close = cs.map(c => c.c);
const ema = ta.ema(close, TREND), m = ta.macd(close, 12, 26, 9), atr = ta.atr(cs, ATR_LEN);
const acct = new Account(config);

for (let i = 1; i < cs.length; i++) {
  const c = cs[i];
  acct.update(c);
  if (acct.dead) break;
  const up = m.macd[i - 1] <= m.signal[i - 1] && m.macd[i] > m.signal[i];
  const down = m.macd[i - 1] >= m.signal[i - 1] && m.macd[i] < m.signal[i];
  if (acct.side === "long" && down) acct.close(c.c, c.t, "MACD cross down");
  if (acct.side === "short" && up) acct.close(c.c, c.t, "MACD cross up");
  if (!acct.pos && isFinite(atr[i])) {
    if (up && c.c > ema[i]) acct.open("long", c.c, c.t, { sl: c.c - atr[i] * ATR_STOP });
    else if (down && c.c < ema[i]) acct.open("short", c.c, c.t, { sl: c.c + atr[i] * ATR_STOP });
  }
  if (i % 2000 === 0) progress(i / cs.length);
}
return acct.result();` },
{ name: "예시 4 · MACD + RSI + 엘리어트 파동 (단순화)", code: `// Simplified Elliott "wave 3" entry using a ZigZag:
//   wave 1 = swing from a low to a high, wave 2 = pullback that holds above the wave 1 start
//   and retraces 30–80% of wave 1. Enter long when price breaks the wave 1 high (start of wave 3)
//   while MACD histogram > 0 and RSI > 50. Stop at the wave 2 low, target = wave 1 length × 1.6.
//   Shorts are the mirror image. Swings are only used once confirmed (no look-ahead).
const ZZ = input("ZigZag reversal %", 4);
const RET_MIN = input("Wave 2 min retrace", 0.3);
const RET_MAX = input("Wave 2 max retrace", 0.8);
const EXT = input("Wave 3 target x wave 1", 1.6);
const RSI_LEN = input("RSI length", 14);

const cs = await candles(config.symbol, config.interval, config.from);
const close = cs.map(c => c.c);
const m = ta.macd(close, 12, 26, 9), rsi = ta.rsi(close, RSI_LEN);
const acct = new Account(config);

const piv = [];           // confirmed swing points [{type: "H"|"L", price}]
let dir = 0, ext = cs[0].c;
let armed = null;         // current wave-3 setup waiting for a breakout

for (let i = 1; i < cs.length; i++) {
  const c = cs[i];
  acct.update(c);
  if (acct.dead) break;

  // 1) entry: breakout of the wave 1 extreme
  if (!acct.pos && armed) {
    if (armed.side === "long" && c.h > armed.trigger && m.hist[i] > 0 && rsi[i] > 50) {
      const px = Math.max(armed.trigger, c.o);
      acct.open("long", px, c.t, { sl: armed.stop, tp: px + armed.len * EXT, note: "Wave 3 up" }); armed = null;
    } else if (armed.side === "short" && c.l < armed.trigger && m.hist[i] < 0 && rsi[i] < 50) {
      const px = Math.min(armed.trigger, c.o);
      acct.open("short", px, c.t, { sl: armed.stop, tp: px - armed.len * EXT, note: "Wave 3 down" }); armed = null;
    }
  }
  // 2) setup broken: price goes past the wave 2 extreme
  if (armed && (armed.side === "long" ? c.l < armed.stop : c.h > armed.stop)) armed = null;

  // 3) update the ZigZag with this candle
  if (dir >= 0) {
    if (c.h > ext) ext = c.h;
    else if (c.l <= ext * (1 - ZZ / 100)) { piv.push({ type: "H", price: ext }); dir = -1; ext = c.l; onPivot(); }
  }
  if (dir < 0) {
    if (c.l < ext) ext = c.l;
    else if (c.h >= ext * (1 + ZZ / 100)) { piv.push({ type: "L", price: ext }); dir = 1; ext = c.h; onPivot(); }
  }
  if (i % 2000 === 0) progress(i / cs.length);
}

function onPivot() {
  if (piv.length < 3) return;
  const [a, b, c] = piv.slice(-3);              // a = wave 1 start, b = wave 1 end, c = wave 2 end
  const len = Math.abs(b.price - a.price), ret = Math.abs(b.price - c.price) / len;
  if (a.type === "L" && b.type === "H" && c.type === "L" && c.price > a.price && ret >= RET_MIN && ret <= RET_MAX)
    armed = { side: "long", trigger: b.price, stop: c.price, len };
  else if (a.type === "H" && b.type === "L" && c.type === "H" && c.price < a.price && ret >= RET_MIN && ret <= RET_MAX)
    armed = { side: "short", trigger: b.price, stop: c.price, len };
}
return acct.result();` },
{ name: "예시 5 · 비트·이더·솔라나 교차 분할매수 (RSI 진입)", code: `// Split-entry cross trade (long only):
//   BTC RSI drops below the entry level → BTC entry 1 + ETH entry 1
//   BTC falls "Add 2 at %" from entry 1  → BTC entry 2 + ETH entry 2 + SOL entry 1
//   BTC falls "Add 3 at %"               → BTC entry 3 + ETH entry 3 + SOL entry 2
//   Take profit: BTC reaches "Take profit %" above BTC entry 1 → close all coins.
//   Stop: from BTC entry 1, close "Cut size %" of every coin at each "Cut at %" level, everything at "Full stop %".
// "Split ratio" splits the trade budget (panel: position size) across coins and entries.
const COINS = input("Coins (main first)", "BTC,ETH,SOL").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const SPLIT = input("Split ratio", "1,2,4").split(",").map(Number);
const RSI_IN = input("Enter when RSI below", 25);
const ADD2 = input("Add 2 at % below", 1.5);
const ADD3 = input("Add 3 at % below", 3);
const TP = input("Take profit %", 2);
const CUTS = input("Cut at % (comma)", "3,4,5").split(",").map(Number);
const CUT_FRAC = input("Cut size %", 10) / 100;
const FULL_STOP = input("Full stop %", 6);

const main = config.symbol;
const cs = await candles(main, config.interval, config.from);
const others = {};
for (const s of COINS.slice(1)) others[s] = new Map((await candles(s, config.interval, config.from)).map(c => [c.t, c]));
const rsi = ta.rsi(cs.map(c => c.c), 14);
const acct = new Account(config);

// budget share of every fill: main coin and coin 2 start at entry 1, coin 3 starts one step later
const steps = [0, ADD2, ADD3];
const plan = [];                                   // plan[step] = [{sym, w}]
COINS.forEach((s, k) => SPLIT.forEach((w, j) => { const step = j + Math.max(0, k - 1); if (step < steps.length) (plan[step] = plan[step] || []).push({ sym: s, w }); }));
const totalW = plan.flat().reduce((a, x) => a + x.w, 0);

let cyc = null;
for (let i = 1; i < cs.length; i++) {
  const c = cs[i];
  acct.update(c);
  for (const s in others) { const o = others[s].get(c.t); if (o) acct.update(o, s); }
  if (acct.dead) break;

  if (cyc && !acct.pos && cyc.step) {             // main coin closed (stop / liquidation) → close the rest, cycle over
    for (const s in others) { const o = others[s].get(c.t); if (o && acct.position(s)) acct.close(o.c, c.t, "Main coin closed", { sym: s }); }
    cyc = null;
  }
  if (!cyc && !acct.pos && rsi[i - 1] < RSI_IN) cyc = { L: c.o, step: 0, cut: 0 };
  if (!cyc) continue;

  // adverse first: entries and stop levels between the open and the low, highest price first
  const ev = [];
  for (let k = cyc.step; k < steps.length; k++) ev.push([cyc.L * (1 - steps[k] / 100), "add", k]);
  for (let k = cyc.cut; k < CUTS.length; k++) ev.push([cyc.L * (1 - CUTS[k] / 100), "cut", k]);
  ev.push([cyc.L * (1 - FULL_STOP / 100), "stop"]);
  ev.sort((a, b) => b[0] - a[0]);
  for (const [p0, type, k] of ev) {
    if (c.l > p0 || !cyc) continue;
    const px = Math.min(p0, c.o), ratio = px / c.o;             // other coins: assume the same % move within the candle
    const priceOf = s => s === main ? px : (others[s].get(c.t) ? others[s].get(c.t).o * ratio : null);
    if (type === "add" && k === cyc.step) {
      for (const f of plan[k] || []) {
        const p = priceOf(f.sym); if (!p) continue;
        const share = f.w / totalW;
        if (acct.position(f.sym)) acct.add(p, c.t, { sym: f.sym, share }); else acct.open("long", p, c.t, { sym: f.sym, share });
      }
      cyc.step++;
    } else if (type === "cut" && k === cyc.cut && acct.pos) {
      for (const s of COINS) { const p = priceOf(s); if (p && acct.position(s)) acct.close(p, c.t, "Split stop", { sym: s, frac: CUT_FRAC }); }
      cyc.cut++;
    } else if (type === "stop" && acct.pos) {
      for (const s of COINS) { const p = priceOf(s); if (p && acct.position(s)) acct.close(p, c.t, "Stop loss", { sym: s }); }
      cyc = null;
    }
  }
  if (cyc && acct.pos && c.h >= cyc.L * (1 + TP / 100)) {
    const px = Math.max(cyc.L * (1 + TP / 100), c.o), ratio = px / c.o;
    for (const s of COINS) {
      const o = s === main ? null : others[s].get(c.t);
      const p = s === main ? px : (o ? Math.min(o.h, Math.max(o.l, o.o * ratio)) : null);
      if (p && acct.position(s)) acct.close(p, c.t, "Take profit", { sym: s });
    }
    cyc = null;
  }
  if (i % 2000 === 0) progress(i / cs.length);
}
return acct.result();` },
];
