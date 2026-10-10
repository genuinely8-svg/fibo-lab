/* bt-examples.js — Backtest tab: example scripts + rules to give an AI */
window.BT_SPEC = `Gwave backtest script rules (JavaScript, runs in the browser)

The settings panel is passed in as \`config\` (read-only):
  config.symbol     e.g. "BTC" (no USDT)        config.interval  "1m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w"
  config.from       start date "2020-01-01"     config.capital   starting capital (USDT)
  config.leverage   e.g. 10                     config.sizePct   % of equity used as margin per trade
  config.margin     "isolated" | "cross"        config.direction "long" | "short" | "both"
  config.fee        fee per fill in % (e.g. 0.05)

Available (await allowed):
- await candles(config.symbol, config.interval, config.from)
    → [{t, o, h, l, c, v}] oldest first, closed candles only, t = UTC time in ms (Binance futures)
    other coins: await candles("ETH", "1h", "2020-01-01")
- ta.sma(arr, n), ta.ema(arr, n), ta.rsi(arr, n), ta.atr(candles, n), ta.highest(arr, n), ta.lowest(arr, n)
  ta.macd(arr, 12, 26, 9) → { macd, signal, hist }
    → arrays with the same length as the input (NaN while warming up)
- const acct = new Account(config)   (uses capital, leverage, sizePct, fee, margin, direction from the panel)
    acct.update(candle)                         call FIRST on every candle: handles stop loss / take profit / liquidation, records equity
    acct.open("long" | "short", price, t, { sl, tp, note })   ignored if a position is open or the direction is disabled
    acct.close(price, t, "reason")
    acct.pos (null or { side, entry, qty, margin, sl, tp }), acct.side, acct.canLong, acct.canShort, acct.dead (account blown)
    return acct.result()                        → summary, equity curve and trade list for the screen
- stats(equity, seed), log(...) text in the log box, progress(0..1) progress bar

Rules:
- Put strategy-only numbers (indicator lengths, stop %, take-profit %) at the top as const.
  Capital, leverage, position size, margin mode, direction and fee come from config — do not hard-code them.
- Act on candle close (use candle i to decide, fill at its close or put sl/tp for later candles). No look-ahead.
- Loop: for each candle → acct.update(c) → if (acct.dead) break → your entry / exit logic.
- No document, window or localStorage. Plain JavaScript, no external libraries.
- End with: return acct.result();`;

window.BT_EXAMPLES = [
{ name: "예시 1 · 이동평균선 교차", code: `// EMA crossover: fast EMA crosses above slow EMA → long, crosses below → short (or close).
// Capital, leverage, position size, margin mode, direction and fee come from the panel on the right.
const FAST = 50;          // fast EMA length
const SLOW = 200;         // slow EMA length

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
{ name: "예시 2 · 이동평균선 + RSI", code: `// Trend filter + pullback: trade only in the direction of the 200 EMA,
// enter when RSI comes back out of oversold (long) / overbought (short). Fixed stop loss and take profit.
const TREND = 200;        // trend EMA length
const RSI_LEN = 14;
const RSI_LOW = 30;       // long when RSI crosses back above this (price above the EMA)
const RSI_HIGH = 70;      // short when RSI crosses back below this (price below the EMA)
const STOP = 2;           // stop loss % from entry
const TAKE = 4;           // take profit % from entry

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
{ name: "예시 3 · 이동평균선 + MACD", code: `// MACD signal-line cross in the direction of the 100 EMA trend.
// Exit on the opposite MACD cross, with an ATR-based stop loss.
const TREND = 100;        // trend EMA length
const ATR_LEN = 14;
const ATR_STOP = 2;       // stop loss = entry ∓ ATR × 2

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
const ZZ = 4;             // ZigZag: a swing is confirmed after a 4% reversal
const RET_MIN = 0.3, RET_MAX = 0.8;   // wave 2 retracement range of wave 1
const EXT = 1.6;          // wave 3 target = wave 1 length × 1.6
const RSI_LEN = 14;

const cs = await candles(config.symbol, config.interval, config.from);
const close = cs.map(c => c.c);
const m = ta.macd(close, 12, 26, 9), rsi = ta.rsi(close, RSI_LEN);
const acct = new Account(config);

// ZigZag built candle by candle: piv = confirmed swing points [{type: "H"|"L", price}]
const piv = [];
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
];
