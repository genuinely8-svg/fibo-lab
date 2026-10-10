/* bt-examples.js — Backtest tab: rules to give an AI + the starter script shown on first visit (all English) */
window.BT_SPEC = `Gwave backtest script rules (JavaScript, runs inside the browser — NOT Node.js)

The whole backtest is ONE script. Put every setting at the top in a config object:
  const config = {
    symbol: "BTC",          // main coin, Binance USDT-M futures, no "USDT"
    interval: "4h",         // "1m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w"
    from: "2020-01-01",     // start date
    capital: 10000,         // starting balance (USDT)
    leverage: 10,           // default leverage (can be overridden per order with { lev })
    sizePct: 10,            // % of equity used as margin for ONE whole trade (all split entries together)
    fee: 0.05,              // fee per fill in %
    margin: "isolated",     // "isolated" | "cross"
    direction: "both",      // "long" | "short" | "both"
  };
Put strategy numbers right below it as plain constants (const FAST = 50; ...).

DATA & INDICATORS (await allowed at top level):
- await candles(config.symbol, config.interval, config.from) → [{t, o, h, l, c, v}] oldest first, closed candles only, t = UTC ms
  other coins: await candles("ETH", config.interval, config.from)
- ta.sma(arr, n), ta.ema(arr, n), ta.rsi(arr, n), ta.atr(candles, n), ta.highest(arr, n), ta.lowest(arr, n)
  ta.macd(arr, 12, 26, 9) → { macd, signal, hist }      (same length as input, NaN while warming up)

ACCOUNT SIMULATOR: const acct = new Account(config)
- The trade budget = equity × sizePct % is fixed when the account goes from flat to its first position.
- acct.open("long" | "short", price, t, { sym, share, usd, lev, sl, tp, note })  new position
    share = part of the trade budget (0..1, default 1)  OR  usd = exact margin in USDT
    lev = leverage for this fill (e.g. long 4, short 2); default config.leverage
- acct.add(price, t, { sym, share, usd, lev, sl, tp })   split entry / averaging (average entry recalculated)
- acct.close(price, t, "reason", { sym, frac })         close all (frac 1) or a part (frac 0.1 = 10% of the position)
- acct.setStop(sl, tp, { sym })                         move stop loss / take profit
- acct.update(candle, sym)   call FIRST on every candle for every coin you hold (main coin: sym can be omitted)
                             → stop loss / take profit / liquidation (isolated or cross) and the equity curve
- acct.pos / acct.position("ETH") → null or { side, entry (average), qty, margin, entries, sl, tp }
- acct.side, acct.canLong, acct.canShort (direction setting), acct.dead (balance gone), acct.budget, acct.equity
- sym defaults to config.symbol. Several coins can be held at the same time (one position per coin).
- End with: return acct.result();

RULES:
- Decide on candle close, no look-ahead. Loop: for each candle → acct.update(...) for held coins → if (acct.dead) break → logic.
- When a stop and a target could both be hit in the same candle, the stop is assumed first (acct.update already does).
- Other coins: build a Map by time (new Map(eth.map(c => [c.t, c]))) and look up the same t as the main candle.
- log(...) writes to the log box, progress(0..1) moves the progress bar.
- No require/import, no document, window, localStorage or fetch. Plain JavaScript, no external libraries.
- Reply with the complete script in one code block.`;

window.BT_EXAMPLE = `// Example: EMA crossover — long when the fast EMA crosses above the slow EMA, short when it crosses below.
// Edit the numbers and press Run. To build your own strategy, use "Copy AI prompt" above.

const config = {
  symbol: "BTC",          // coin (Binance USDT-M futures)
  interval: "4h",         // 1m 5m 15m 30m 1h 2h 4h 6h 12h 1d 1w
  from: "2020-01-01",     // start date
  capital: 10000,         // starting balance (USDT)
  leverage: 5,            // leverage
  sizePct: 20,            // % of equity used as margin per trade
  fee: 0.05,              // fee per fill (%)
  margin: "isolated",     // "isolated" | "cross"
  direction: "both",      // "long" | "short" | "both"
};

const FAST = 50;          // fast EMA length
const SLOW = 200;         // slow EMA length
const STOP_PCT = 3;       // stop loss, % from entry

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
    if (!acct.pos) acct.open("long", c.c, c.t, { sl: c.c * (1 - STOP_PCT / 100) });
  } else if (crossDown) {
    if (acct.side === "long") acct.close(c.c, c.t, "EMA cross down");
    if (!acct.pos) acct.open("short", c.c, c.t, { sl: c.c * (1 + STOP_PCT / 100) });
  }
  if (i % 2000 === 0) progress(i / cs.length);
}
return acct.result();
`;
