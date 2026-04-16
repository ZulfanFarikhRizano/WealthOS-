// ══════════════════════════════════════════════════════════════════
// Z-WEALTH · TRADING WORKER v3 — Supabase Edge Function
//
// STRATEGI (MURNI EMA CROSS):
//   BUY  → EMA13 (biru) memotong ke ATAS EMA21 (merah) = Golden Cross
//   SELL → EMA13 (biru) memotong ke BAWAH EMA21 (merah) = Dead Cross
//
// RULES:
//   • Market order only (bukan limit)
//   • Tidak ada Stop Loss — posisi ditahan sampai cross terjadi
//   • Tidak ada Hard SL — bot murni mengikuti sinyal EMA
//   • Max 3 posisi terbuka sekaligus per user
//   • Tidak buka posisi baru di simbol yang sudah ada posisi
//   • Mode SPOT atau FUTURES (pilihan per user)
//   • Futures: leverage 10x (bisa diubah per user di bot_configs)
//   • Mode SIMULATION jika API key kosong/default
//
// Deploy : supabase functions deploy trading-worker
// Cron   : setiap 1 menit
// ══════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── ENV ───────────────────────────────────────────────────────────
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_BOT_TOKEN         = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const CRON_SECRET          = Deno.env.get("CRON_SECRET") || "";

// ── KONSTANTA ─────────────────────────────────────────────────────
const MAX_POSITIONS = 3;    // max posisi terbuka sekaligus per user
const KLINE_LIMIT   = 50;   // jumlah candle untuk kalkulasi EMA

// ── TYPES ─────────────────────────────────────────────────────────
interface BotConfig {
  user_id:            string;
  exchange:           string;       // "bybit" | "binance"
  trade_mode:         string;       // "spot" | "futures"
  leverage:           number;       // default 10, hanya untuk futures
  api_key:            string;
  api_secret:         string;
  symbols:            string[];
  top_n_by_volume:    number;
  trade_amount_usdt:  number;
  telegram_chat_id:   string;
  is_active:          boolean;
}

interface Position {
  id:           string;
  user_id:      string;
  symbol:       string;
  exchange:     string;
  trade_mode:   string;
  entry_price:  number;
  qty:          number;
  amount_usdt:  number;
  leverage:     number;
  status:       string;   // "OPEN" | "CLOSED" | "SIM_OPEN" | "SIM_CLOSED"
  opened_at:    string;
}

interface Candle {
  close:  number;
  volume: number;
}

interface SignalResult {
  cross:  "GOLDEN" | "DEAD" | null;   // GOLDEN = beli, DEAD = jual
  ema13:  number;
  ema21:  number;
}

// ════════════════════════════════════════════════════════════════
// INDIKATOR EMA
// ════════════════════════════════════════════════════════════════

function calcEMA(values: number[], period: number): number[] {
  const k    = 2 / (period + 1);
  const emas = [values[0]];
  for (let i = 1; i < values.length; i++) {
    emas.push(values[i] * k + emas[i - 1] * (1 - k));
  }
  return emas;
}

/**
 * Deteksi apakah terjadi EMA cross pada candle terakhir.
 * GOLDEN CROSS : EMA13 dari BAWAH ke ATAS EMA21  → BUY
 * DEAD CROSS   : EMA13 dari ATAS ke BAWAH EMA21  → SELL
 */
function detectCross(candles: Candle[]): SignalResult {
  const empty: SignalResult = { cross: null, ema13: 0, ema21: 0 };
  if (candles.length < 25) return empty;

  const closes   = candles.map(c => c.close);
  const ema13Arr = calcEMA(closes, 13);
  const ema21Arr = calcEMA(closes, 21);
  const n        = closes.length - 1;

  const ema13Now  = ema13Arr[n],     ema13Prev = ema13Arr[n - 1];
  const ema21Now  = ema21Arr[n],     ema21Prev = ema21Arr[n - 1];

  let cross: "GOLDEN" | "DEAD" | null = null;

  // EMA13 dari bawah → melintas ke atas EMA21
  if (ema13Prev < ema21Prev && ema13Now >= ema21Now) cross = "GOLDEN";

  // EMA13 dari atas → melintas ke bawah EMA21
  if (ema13Prev > ema21Prev && ema13Now <= ema21Now) cross = "DEAD";

  return { cross, ema13: ema13Now, ema21: ema21Now };
}

// ════════════════════════════════════════════════════════════════
// MARKET DATA
// ════════════════════════════════════════════════════════════════

async function fetchBybitCandles(symbol: string, tradeMode: string): Promise<Candle[]> {
  const category = tradeMode === "futures" ? "linear" : "spot";
  const url      = `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol}&interval=1&limit=${KLINE_LIMIT}`;
  const res      = await fetch(url);
  const data     = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit kline [${symbol}]: ${data.retMsg}`);
  // list: newest first → reverse agar oldest first
  return (data.result?.list || []).reverse().map((k: string[]) => ({
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchBinanceCandles(symbol: string, tradeMode: string): Promise<Candle[]> {
  const base = tradeMode === "futures"
    ? "https://fapi.binance.com/fapi/v1/klines"
    : "https://api.binance.com/api/v3/klines";
  const url  = `${base}?symbol=${symbol}&interval=1m&limit=${KLINE_LIMIT}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Binance kline [${symbol}]: invalid`);
  return data.map((k: string[]) => ({
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchCandles(exchange: string, symbol: string, tradeMode: string): Promise<Candle[]> {
  return exchange === "bybit"
    ? fetchBybitCandles(symbol, tradeMode)
    : fetchBinanceCandles(symbol, tradeMode);
}

async function getTopSymbols(
  exchange: string, tradeMode: string, topN: number, whitelist: string[]
): Promise<string[]> {
  if (whitelist.length > 0) return whitelist;
  try {
    if (exchange === "bybit") {
      const category = tradeMode === "futures" ? "linear" : "spot";
      const res      = await fetch(`https://api.bybit.com/v5/market/tickers?category=${category}`);
      const data     = await res.json();
      return (data.result?.list || [])
        .filter((t: { symbol: string }) => t.symbol.endsWith("USDT"))
        .sort((a: { turnover24h: string }, b: { turnover24h: string }) =>
          parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
        .slice(0, topN)
        .map((t: { symbol: string }) => t.symbol);
    } else {
      const base = tradeMode === "futures"
        ? "https://fapi.binance.com/fapi/v1/ticker/24hr"
        : "https://api.binance.com/api/v3/ticker/24hr";
      const res  = await fetch(base);
      const data = await res.json() as Array<{ symbol: string; quoteVolume: string }>;
      return data
        .filter(t => t.symbol.endsWith("USDT"))
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, topN)
        .map(t => t.symbol);
    }
  } catch {
    return [];
  }
}

// ════════════════════════════════════════════════════════════════
// HMAC SIGNING
// ════════════════════════════════════════════════════════════════

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ════════════════════════════════════════════════════════════════
// ORDER EXECUTION — BYBIT
// ════════════════════════════════════════════════════════════════

async function bybitHeaders(apiKey: string, apiSecret: string, body: string) {
  const timestamp  = Date.now().toString();
  const recvWindow = "5000";
  const signature  = await hmacSign(apiSecret, `${timestamp}${apiKey}${recvWindow}${body}`);
  return {
    "Content-Type":       "application/json",
    "X-BAPI-API-KEY":     apiKey,
    "X-BAPI-SIGN":        signature,
    "X-BAPI-TIMESTAMP":   timestamp,
    "X-BAPI-RECV-WINDOW": recvWindow,
  };
}

async function bybitSetLeverage(symbol: string, leverage: number, apiKey: string, apiSecret: string) {
  const body = JSON.stringify({ category: "linear", symbol, buyLeverage: String(leverage), sellLeverage: String(leverage) });
  const hdrs = await bybitHeaders(apiKey, apiSecret, body);
  await fetch("https://api.bybit.com/v5/position/set-leverage", { method: "POST", headers: hdrs, body });
  // Error "leverage already set" aman diabaikan
}

async function bybitMarketOrder(
  symbol: string, side: "Buy" | "Sell", qty: string,
  category: "spot" | "linear", reduceOnly: boolean,
  apiKey: string, apiSecret: string
): Promise<{ orderId: string; ok: boolean; error?: string }> {
  const body = JSON.stringify({
    category,
    symbol,
    side,
    orderType:   "Market",
    qty,
    timeInForce: "IOC",
    ...(category === "linear" ? { reduceOnly } : {}),
  });
  const hdrs = await bybitHeaders(apiKey, apiSecret, body);
  const res  = await fetch("https://api.bybit.com/v5/order/create", { method: "POST", headers: hdrs, body });
  const data = await res.json();
  if (data.retCode === 0) return { orderId: data.result?.orderId || "OK", ok: true };
  return { orderId: "", ok: false, error: data.retMsg };
}

// ════════════════════════════════════════════════════════════════
// ORDER EXECUTION — BINANCE
// ════════════════════════════════════════════════════════════════

async function binanceSetLeverage(symbol: string, leverage: number, apiKey: string, apiSecret: string) {
  const ts  = Date.now();
  const qs  = `symbol=${symbol}&leverage=${leverage}&timestamp=${ts}`;
  const sig = await hmacSign(apiSecret, qs);
  await fetch(`https://fapi.binance.com/fapi/v1/leverage?${qs}&signature=${sig}`, {
    method: "POST", headers: { "X-MBX-APIKEY": apiKey },
  });
}

async function binanceMarketOrder(
  symbol: string, side: "BUY" | "SELL", qty: string,
  isFutures: boolean, reduceOnly: boolean,
  apiKey: string, apiSecret: string
): Promise<{ orderId: string; ok: boolean; error?: string }> {
  const ts   = Date.now();
  const base = isFutures ? "https://fapi.binance.com/fapi/v1/order" : "https://api.binance.com/api/v3/order";

  // Spot: pakai quoteOrderQty (jumlah USDT), Futures: pakai quantity (jumlah koin)
  const qsBase = isFutures
    ? `symbol=${symbol}&side=${side}&type=MARKET&quantity=${qty}&reduceOnly=${reduceOnly}&timestamp=${ts}&recvWindow=5000`
    : `symbol=${symbol}&side=${side}&type=MARKET&quoteOrderQty=${qty}&timestamp=${ts}&recvWindow=5000`;

  const sig = await hmacSign(apiSecret, qsBase);
  const res = await fetch(`${base}?${qsBase}&signature=${sig}`, {
    method: "POST", headers: { "X-MBX-APIKEY": apiKey },
  });
  const data = await res.json();
  if (data.orderId) return { orderId: String(data.orderId), ok: true };
  return { orderId: "", ok: false, error: data.msg || JSON.stringify(data) };
}

// ════════════════════════════════════════════════════════════════
// UNIFIED ORDER WRAPPER
// ════════════════════════════════════════════════════════════════

function isSim(apiKey: string): boolean {
  // Key terenkripsi AES mengandung ":" (format iv:ciphertext)
  // Key SIMULATION jika kosong, default, atau terenkripsi (server tidak bisa decrypt)
  return !apiKey
    || apiKey === "SIMULATION"
    || apiKey.startsWith("SIMULATION")
    || apiKey.includes(":");
}

interface OrderResult { orderId: string; ok: boolean; error?: string }

async function openOrder(
  exchange: string, tradeMode: string, symbol: string,
  amountUsdt: number, price: number, leverage: number,
  apiKey: string, apiSecret: string
): Promise<OrderResult> {
  if (isSim(apiKey)) return { orderId: `SIM_${Date.now()}`, ok: true };

  // Qty: spot = amount USDT worth of coin, futures = leveraged qty
  const qty = tradeMode === "futures"
    ? ((amountUsdt * leverage) / price).toFixed(4)
    : (amountUsdt / price).toFixed(6);

  if (exchange === "bybit") {
    const category = tradeMode === "futures" ? "linear" : "spot";
    if (tradeMode === "futures") await bybitSetLeverage(symbol, leverage, apiKey, apiSecret);
    return bybitMarketOrder(symbol, "Buy", qty, category, false, apiKey, apiSecret);
  } else {
    if (tradeMode === "futures") {
      await binanceSetLeverage(symbol, leverage, apiKey, apiSecret);
      return binanceMarketOrder(symbol, "BUY", qty, true, false, apiKey, apiSecret);
    } else {
      // Spot Binance: kirim quoteOrderQty (USDT amount)
      return binanceMarketOrder(symbol, "BUY", amountUsdt.toFixed(2), false, false, apiKey, apiSecret);
    }
  }
}

async function closeOrder(
  exchange: string, tradeMode: string, symbol: string,
  qty: number, apiKey: string, apiSecret: string
): Promise<OrderResult> {
  if (isSim(apiKey)) return { orderId: `SIM_CLOSE_${Date.now()}`, ok: true };

  if (exchange === "bybit") {
    const category = tradeMode === "futures" ? "linear" : "spot";
    const side     = "Sell";
    // Futures: reduceOnly=true, Spot: jual qty koin
    return bybitMarketOrder(symbol, side, qty.toFixed(tradeMode === "futures" ? 4 : 6), category, tradeMode === "futures", apiKey, apiSecret);
  } else {
    if (tradeMode === "futures") {
      return binanceMarketOrder(symbol, "SELL", qty.toFixed(4), true, true, apiKey, apiSecret);
    } else {
      return binanceMarketOrder(symbol, "SELL", qty.toFixed(6), false, false, apiKey, apiSecret);
    }
  }
}

// ════════════════════════════════════════════════════════════════
// TELEGRAM
// ════════════════════════════════════════════════════════════════

async function tgSend(chatId: string, text: string) {
  if (!TG_BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch { /* silent */ }
}

function wib() {
  return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
}

function tgBuyMsg(
  symbol: string, price: number, qty: number, amountUsdt: number,
  tradeMode: string, leverage: number, ema13: number, ema21: number, sim: boolean
): string {
  const tag = sim ? " 🔵<i>SIMULASI</i>" : " ✅";
  const lev = tradeMode === "futures" ? ` × ${leverage}x leverage` : " (spot)";
  return `🟢 <b>BUY ${symbol}</b>${tag}
━━━━━━━━━━━━━━━━━━━━
📊 Sinyal : <b>Golden Cross</b>
   EMA13 <code>${ema13.toFixed(4)}</code> ⬆ EMA21 <code>${ema21.toFixed(4)}</code>
💵 Harga  : <code>$${price.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
📦 Qty    : <code>${qty.toFixed(tradeMode === "futures" ? 4 : 6)}</code>
💰 Modal  : <code>$${amountUsdt} USDT${lev}</code>
⏰ ${wib()}`;
}

function tgSellMsg(
  symbol: string, entryPrice: number, exitPrice: number,
  qty: number, amountUsdt: number, tradeMode: string, leverage: number,
  ema13: number, ema21: number, pnl: number, sim: boolean
): string {
  const tag     = sim ? " 🔵<i>SIMULASI</i>" : " ✅";
  const pnlSign = pnl >= 0 ? "+" : "";
  const emoji   = pnl >= 0 ? "💰" : "💸";
  const pnlPct  = ((exitPrice - entryPrice) / entryPrice * 100 * (tradeMode === "futures" ? leverage : 1));
  return `🔴 <b>SELL ${symbol}</b>${tag}
━━━━━━━━━━━━━━━━━━━━
📊 Sinyal : <b>Dead Cross</b>
   EMA13 <code>${ema13.toFixed(4)}</code> ⬇ EMA21 <code>${ema21.toFixed(4)}</code>
💵 Entry  : <code>$${entryPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
💵 Exit   : <code>$${exitPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
${emoji} PnL    : <code>${pnlSign}${pnl.toFixed(2)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)</code>
⏰ ${wib()}`;
}

// ════════════════════════════════════════════════════════════════
// DATABASE HELPERS
// ════════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
type SB = ReturnType<typeof createClient<any>>;

async function getOpenPositions(sb: SB, userId: string): Promise<Position[]> {
  const { data } = await sb
    .from("positions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["OPEN", "SIM_OPEN"]);
  return (data || []) as Position[];
}

async function dbOpenPosition(
  sb: SB, userId: string, symbol: string,
  exchange: string, tradeMode: string, leverage: number,
  entryPrice: number, qty: number, amountUsdt: number, sim: boolean
) {
  await sb.from("positions").insert({
    user_id:     userId,
    symbol,
    exchange,
    trade_mode:  tradeMode,
    entry_price: entryPrice,
    qty,
    amount_usdt: amountUsdt,
    leverage,
    status:      sim ? "SIM_OPEN" : "OPEN",
    opened_at:   new Date().toISOString(),
  });
}

async function dbClosePosition(
  sb: SB, posId: string, exitPrice: number,
  closeOrderId: string, pnl: number, sim: boolean
) {
  await sb.from("positions").update({
    status:         sim ? "SIM_CLOSED" : "CLOSED",
    exit_price:     exitPrice,
    close_order_id: closeOrderId,
    close_reason:   "DEAD CROSS",
    pnl_usdt:       pnl,
    closed_at:      new Date().toISOString(),
  }).eq("id", posId);
}

async function dbLogTrade(
  sb: SB, userId: string, symbol: string,
  side: "BUY" | "SELL", price: number, amountUsdt: number,
  ema13: number, ema21: number, orderId: string,
  orderStatus: string, errorMsg: string | null, note: string
) {
  await sb.from("trades").insert({
    user_id:      userId, symbol, side, price,
    amount_usdt:  amountUsdt, ema13, ema21,
    order_id:     orderId, order_status: orderStatus,
    error_msg:    errorMsg, note,
    executed_at:  new Date().toISOString(),
  });
}

// ════════════════════════════════════════════════════════════════
// CORE LOGIC — proses satu user
// ════════════════════════════════════════════════════════════════

async function processUser(sb: SB, cfg: BotConfig): Promise<string[]> {
  const {
    user_id: userId, exchange, api_key: apiKey, api_secret: apiSecret,
    trade_mode: tradeMode = "spot", leverage = 10,
    trade_amount_usdt: amountUsdt, top_n_by_volume: topN,
    symbols: whitelist, telegram_chat_id: tgChat,
  } = cfg;

  const amount = parseFloat(String(amountUsdt)) || 10;
  const lev    = parseInt(String(leverage)) || 10;
  const sim    = isSim(apiKey);
  const log: string[] = [];

  // ── FASE 1: Cek EXIT untuk semua posisi terbuka ──────────────────
  const openPositions = await getOpenPositions(sb, userId);

  for (const pos of openPositions) {
    // Hanya proses posisi yang sesuai mode dan exchange cfg saat ini
    if (pos.exchange !== exchange || pos.trade_mode !== tradeMode) continue;

    try {
      const candles = await fetchCandles(exchange, pos.symbol, tradeMode);
      const { cross, ema13, ema21 } = detectCross(candles);

      // Hanya tutup jika ada Dead Cross
      if (cross !== "DEAD") continue;

      const exitPrice = candles[candles.length - 1].close;

      // Hitung PnL
      const priceDiff = exitPrice - pos.entry_price;
      const pnl = tradeMode === "futures"
        ? priceDiff / pos.entry_price * pos.leverage * pos.amount_usdt
        : priceDiff * pos.qty;

      // Eksekusi close order
      const result = await closeOrder(exchange, tradeMode, pos.symbol, pos.qty, apiKey, apiSecret);

      if (!result.ok) {
        await dbLogTrade(sb, userId, pos.symbol, "SELL", exitPrice, pos.amount_usdt, ema13, ema21, "", "ERROR", result.error || null, "CLOSE failed: Dead Cross");
        log.push(`${pos.symbol}:CLOSE_ERR:${result.error?.slice(0, 50)}`);
        continue;
      }

      // Update DB
      await dbClosePosition(sb, pos.id, exitPrice, result.orderId, pnl, sim);
      await dbLogTrade(sb, userId, pos.symbol, "SELL", exitPrice, pos.amount_usdt, ema13, ema21, result.orderId, sim ? "SIM_CLOSED" : "CLOSED", null, "EXIT: Dead Cross");

      // Telegram
      await tgSend(tgChat, tgSellMsg(pos.symbol, pos.entry_price, exitPrice, pos.qty, pos.amount_usdt, tradeMode, lev, ema13, ema21, pnl, sim));

      const pnlSign = pnl >= 0 ? "+" : "";
      log.push(`${pos.symbol}:CLOSED:DeadCross:PnL${pnlSign}${pnl.toFixed(2)}`);

    } catch (e: unknown) {
      log.push(`${pos.symbol}:EXIT_ERR:${String(e).slice(0, 60)}`);
      console.warn(`[Worker] Exit error ${pos.symbol}:`, e);
    }
  }

  // ── FASE 2: Scan ENTRY (hanya jika slot tersedia) ────────────────
  const currentPositions = await getOpenPositions(sb, userId);
  const openCount        = currentPositions.filter(p => p.exchange === exchange && p.trade_mode === tradeMode).length;
  const openSymbols      = new Set(currentPositions.map(p => p.symbol));

  if (openCount >= MAX_POSITIONS) {
    log.push(`FULL(${MAX_POSITIONS}/${MAX_POSITIONS}) - skip entry scan`);
    return log;
  }

  const slots   = MAX_POSITIONS - openCount;
  const symbols = await getTopSymbols(exchange, tradeMode, topN || 20, whitelist || []);
  let entered   = 0;

  for (const symbol of symbols.slice(0, 60)) {
    if (entered >= slots) break;
    if (openSymbols.has(symbol)) continue;   // sudah ada posisi di simbol ini

    try {
      const candles = await fetchCandles(exchange, symbol, tradeMode);
      const { cross, ema13, ema21 } = detectCross(candles);

      // Hanya BUY saat Golden Cross
      if (cross !== "GOLDEN") continue;

      const entryPrice = candles[candles.length - 1].close;
      const qty        = tradeMode === "futures"
        ? (amount * lev) / entryPrice
        : amount / entryPrice;

      // Eksekusi open order
      const result = await openOrder(exchange, tradeMode, symbol, amount, entryPrice, lev, apiKey, apiSecret);

      if (!result.ok) {
        await dbLogTrade(sb, userId, symbol, "BUY", entryPrice, amount, ema13, ema21, "", "ERROR", result.error || null, "ENTRY failed: Golden Cross");
        log.push(`${symbol}:ENTRY_ERR:${result.error?.slice(0, 50)}`);
        continue;
      }

      // Simpan posisi
      await dbOpenPosition(sb, userId, symbol, exchange, tradeMode, lev, entryPrice, qty, amount, sim);
      await dbLogTrade(sb, userId, symbol, "BUY", entryPrice, amount, ema13, ema21, result.orderId, sim ? "SIM_OPEN" : "OPEN", null, "ENTRY: Golden Cross");

      // Telegram
      await tgSend(tgChat, tgBuyMsg(symbol, entryPrice, qty, amount, tradeMode, lev, ema13, ema21, sim));

      log.push(`${symbol}:OPENED:GoldenCross:${sim ? "SIM" : "LIVE"}`);
      entered++;
      openSymbols.add(symbol);

    } catch (e: unknown) {
      console.warn(`[Worker] Entry error ${symbol}:`, e);
    }
  }

  if (entered === 0 && openCount < MAX_POSITIONS) {
    log.push("no_signal");
  }

  return log;
}

// ════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  // Auth
  const auth       = req.headers.get("Authorization") || "";
  const cronHeader = req.headers.get("x-cron-secret") || "";
  const isInternal = !auth && !!req.headers.get("x-supabase-edge-runtime");

  if (
    auth !== `Bearer ${SUPABASE_SERVICE_KEY}` &&
    !(CRON_SECRET && cronHeader === CRON_SECRET) &&
    !isInternal
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: configs, error } = await sb
    .from("bot_configs")
    .select("*")
    .eq("is_active", true);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!configs?.length) return new Response(JSON.stringify({ status: "no_active_bots" }), { status: 200 });

  const results: Record<string, string[]> = {};

  for (const cfg of configs as BotConfig[]) {
    try {
      results[cfg.user_id.slice(0, 8)] = await processUser(sb, cfg);
    } catch (e: unknown) {
      console.error(`[Worker] Fatal ${cfg.user_id}:`, e);
      results[cfg.user_id.slice(0, 8)] = [`FATAL: ${String(e).slice(0, 100)}`];
    }
  }

  return new Response(
    JSON.stringify({ status: "done", ts: new Date().toISOString(), results }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
