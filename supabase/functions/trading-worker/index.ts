// ══════════════════════════════════════════════════════════════════
// Z-WEALTH · TRADING WORKER + TELEGRAM WEBHOOK v4
//
// Satu Deno.serve menangani DUA jenis request:
//   1. POST /  dengan header x-cron-secret   → Cron Job trading (EMA Cross)
//   2. POST /  dari Telegram Webhook         → Handle /start command
//
// Strategi Trading: EMA 13/21 Crossover
//   BUY  → Golden Cross (EMA13 melintas ke ATAS EMA21)
//   SELL → Dead Cross   (EMA13 melintas ke BAWAH EMA21)
//
// Deploy : supabase functions deploy trading-worker
// Cron   : setiap 1 menit
// Webhook: set via https://api.telegram.org/bot<TOKEN>/setWebhook?url=<FUNCTION_URL>
// ══════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── ENV ───────────────────────────────────────────────────────────
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_BOT_TOKEN         = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const CRON_SECRET          = Deno.env.get("CRON_SECRET") || "";

// ── KONSTANTA ─────────────────────────────────────────────────────
const MAX_POSITIONS = 3;
const KLINE_LIMIT   = 50;

// ── TYPES ─────────────────────────────────────────────────────────
interface BotConfig {
  user_id:            string;
  exchange:           string;
  trade_mode:         string;
  leverage:           number;
  api_key:            string;
  api_secret:         string;
  symbols:            string[];
  top_n_by_volume:    number;
  trade_amount_usdt:  number;
  telegram_chat_id:   string;
  telegram_username:  string;
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
  status:       string;
  opened_at:    string;
}

interface Candle {
  close:  number;
  volume: number;
}

interface SignalResult {
  cross:  "GOLDEN" | "DEAD" | null;
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

function detectCross(candles: Candle[]): SignalResult {
  const empty: SignalResult = { cross: null, ema13: 0, ema21: 0 };
  if (candles.length < 25) return empty;

  const closes   = candles.map(c => c.close);
  const ema13Arr = calcEMA(closes, 13);
  const ema21Arr = calcEMA(closes, 21);
  const n        = closes.length - 1;

  const ema13Now  = ema13Arr[n], ema13Prev = ema13Arr[n - 1];
  const ema21Now  = ema21Arr[n], ema21Prev = ema21Arr[n - 1];

  let cross: "GOLDEN" | "DEAD" | null = null;
  if (ema13Prev < ema21Prev && ema13Now >= ema21Now) cross = "GOLDEN";
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
  return data.map((k: string[]) => ({ close: parseFloat(k[4]), volume: parseFloat(k[5]) }));
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
  } catch { return []; }
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
}

async function bybitMarketOrder(
  symbol: string, side: "Buy" | "Sell", qty: string,
  category: "spot" | "linear", reduceOnly: boolean,
  apiKey: string, apiSecret: string
): Promise<{ orderId: string; ok: boolean; error?: string }> {
  const body = JSON.stringify({
    category, symbol, side, orderType: "Market", qty, timeInForce: "IOC",
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
  return !apiKey || apiKey === "SIMULATION" || apiKey.startsWith("SIMULATION") || apiKey.includes(":");
}

interface OrderResult { orderId: string; ok: boolean; error?: string }

async function openOrder(
  exchange: string, tradeMode: string, symbol: string,
  amountUsdt: number, price: number, leverage: number,
  apiKey: string, apiSecret: string
): Promise<OrderResult> {
  if (isSim(apiKey)) return { orderId: `SIM_${Date.now()}`, ok: true };
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
    }
    return binanceMarketOrder(symbol, "BUY", amountUsdt.toFixed(2), false, false, apiKey, apiSecret);
  }
}

async function closeOrder(
  exchange: string, tradeMode: string, symbol: string,
  qty: number, apiKey: string, apiSecret: string
): Promise<OrderResult> {
  if (isSim(apiKey)) return { orderId: `SIM_CLOSE_${Date.now()}`, ok: true };
  if (exchange === "bybit") {
    const category = tradeMode === "futures" ? "linear" : "spot";
    return bybitMarketOrder(symbol, "Sell", qty.toFixed(tradeMode === "futures" ? 4 : 6), category, tradeMode === "futures", apiKey, apiSecret);
  } else {
    if (tradeMode === "futures") return binanceMarketOrder(symbol, "SELL", qty.toFixed(4), true, true, apiKey, apiSecret);
    return binanceMarketOrder(symbol, "SELL", qty.toFixed(6), false, false, apiKey, apiSecret);
  }
}

// ════════════════════════════════════════════════════════════════
// TELEGRAM
// ════════════════════════════════════════════════════════════════

async function tgSend(chatId: string | number, text: string) {
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
    user_id: userId, symbol, exchange, trade_mode: tradeMode,
    entry_price: entryPrice, qty, amount_usdt: amountUsdt, leverage,
    status: sim ? "SIM_OPEN" : "OPEN",
    opened_at: new Date().toISOString(),
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
    user_id: userId, symbol, side, price,
    amount_usdt: amountUsdt, ema13, ema21,
    order_id: orderId, order_status: orderStatus,
    error_msg: errorMsg, note,
    executed_at: new Date().toISOString(),
  });
}

// ════════════════════════════════════════════════════════════════
// CORE TRADING LOGIC — proses satu user
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

  // ── FASE 1: Cek EXIT posisi terbuka ──────────────────────────────
  const openPositions = await getOpenPositions(sb, userId);

  for (const pos of openPositions) {
    if (pos.exchange !== exchange || pos.trade_mode !== tradeMode) continue;
    try {
      const candles = await fetchCandles(exchange, pos.symbol, tradeMode);
      const { cross, ema13, ema21 } = detectCross(candles);
      if (cross !== "DEAD") continue;

      const exitPrice = candles[candles.length - 1].close;
      const priceDiff = exitPrice - pos.entry_price;
      const pnl       = tradeMode === "futures"
        ? priceDiff / pos.entry_price * pos.leverage * pos.amount_usdt
        : priceDiff * pos.qty;

      const result = await closeOrder(exchange, tradeMode, pos.symbol, pos.qty, apiKey, apiSecret);

      if (!result.ok) {
        await dbLogTrade(sb, userId, pos.symbol, "SELL", exitPrice, pos.amount_usdt, ema13, ema21, "", "ERROR", result.error || null, "CLOSE failed: Dead Cross");
        log.push(`${pos.symbol}:CLOSE_ERR:${result.error?.slice(0, 50)}`);
        continue;
      }

      await dbClosePosition(sb, pos.id, exitPrice, result.orderId, pnl, sim);
      await dbLogTrade(sb, userId, pos.symbol, "SELL", exitPrice, pos.amount_usdt, ema13, ema21, result.orderId, sim ? "SIM_CLOSED" : "CLOSED", null, "EXIT: Dead Cross");
      await tgSend(tgChat, tgSellMsg(pos.symbol, pos.entry_price, exitPrice, pos.qty, pos.amount_usdt, tradeMode, lev, ema13, ema21, pnl, sim));

      const pnlSign = pnl >= 0 ? "+" : "";
      log.push(`${pos.symbol}:CLOSED:DeadCross:PnL${pnlSign}${pnl.toFixed(2)}`);
    } catch (e: unknown) {
      log.push(`${pos.symbol}:EXIT_ERR:${String(e).slice(0, 60)}`);
    }
  }

  // ── FASE 2: Scan ENTRY (hanya jika slot tersedia) ─────────────────
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
    if (openSymbols.has(symbol)) continue;

    try {
      const candles = await fetchCandles(exchange, symbol, tradeMode);
      const { cross, ema13, ema21 } = detectCross(candles);
      if (cross !== "GOLDEN") continue;

      const entryPrice = candles[candles.length - 1].close;
      const qty        = tradeMode === "futures"
        ? (amount * lev) / entryPrice
        : amount / entryPrice;

      const result = await openOrder(exchange, tradeMode, symbol, amount, entryPrice, lev, apiKey, apiSecret);

      if (!result.ok) {
        await dbLogTrade(sb, userId, symbol, "BUY", entryPrice, amount, ema13, ema21, "", "ERROR", result.error || null, "ENTRY failed: Golden Cross");
        log.push(`${symbol}:ENTRY_ERR:${result.error?.slice(0, 50)}`);
        continue;
      }

      await dbOpenPosition(sb, userId, symbol, exchange, tradeMode, lev, entryPrice, qty, amount, sim);
      await dbLogTrade(sb, userId, symbol, "BUY", entryPrice, amount, ema13, ema21, result.orderId, sim ? "SIM_OPEN" : "OPEN", null, "ENTRY: Golden Cross");
      await tgSend(tgChat, tgBuyMsg(symbol, entryPrice, qty, amount, tradeMode, lev, ema13, ema21, sim));

      log.push(`${symbol}:OPENED:GoldenCross:${sim ? "SIM" : "LIVE"}`);
      entered++;
      openSymbols.add(symbol);
    } catch (e: unknown) {
      console.warn(`[Worker] Entry error ${symbol}:`, e);
    }
  }

  if (entered === 0 && openCount < MAX_POSITIONS) log.push("no_signal");

  return log;
}

// ════════════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK HANDLER — /start command
// ════════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleTelegramWebhook(sb: SB, body: any): Promise<Response> {
  const message  = body?.message;
  if (!message) return new Response("ok", { status: 200 });

  const chatId   = message.chat?.id;
  const username = message.from?.username || "";
  const text     = message.text || "";

  // ── Hanya handle command /start ──────────────────────────────────
  if (!text.startsWith("/start")) {
    return new Response("ok", { status: 200 });
  }

  // Bisa ada payload: /start LINK_CODE (dari deep link)
  const parts    = text.trim().split(" ");
  const linkCode = parts[1] || "";

  let userId: string | null = null;

  // ── Cara 1: cari via pending_tg_links (deep link flow) ───────────
  if (linkCode) {
    const now = new Date().toISOString();
    const { data: link } = await sb
      .from("pending_tg_links")
      .select("user_id")
      .eq("link_code", linkCode)
      .gt("expires_at", now)
      .single();

    if (link?.user_id) {
      userId = link.user_id;
      // Hapus link yang sudah dipakai
      await sb.from("pending_tg_links").delete().eq("link_code", linkCode);
    }
  }

  // ── Cara 2: fallback — cari via telegram_username di bot_configs ──
  if (!userId && username) {
    const { data: cfg } = await sb
      .from("bot_configs")
      .select("user_id")
      .eq("telegram_username", username)
      .single();

    if (cfg?.user_id) userId = cfg.user_id;
  }

  // ── User tidak ditemukan ─────────────────────────────────────────
  if (!userId) {
    await tgSend(chatId,
      `❌ <b>Akun tidak ditemukan.</b>\n\n` +
      `Pastikan kamu sudah:\n` +
      `1. Login ke <b>Z-Wealth</b>\n` +
      `2. Masuk ke menu <b>Bot Trading → Konfigurasi</b>\n` +
      `3. Klik tombol <b>"Hubungkan ke @zwealth_bot"</b>\n\n` +
      `Lalu klik link yang muncul untuk memulai verifikasi.`
    );
    return new Response("ok", { status: 200 });
  }

  // ── Update bot_configs: simpan chat_id dan tandai terhubung ───────
  const { error: updateErr } = await sb
    .from("bot_configs")
    .update({
      telegram_chat_id:    String(chatId),
      is_telegram_linked:  true,
      updated_at:          new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (updateErr) {
    console.error("[TgWebhook] Update error:", updateErr);
    await tgSend(chatId, "⚠️ Terjadi kesalahan saat menghubungkan akun. Coba lagi.");
    return new Response("ok", { status: 200 });
  }

  // ── Kirim pesan sukses ───────────────────────────────────────────
  const displayName = username ? `@${username}` : `user#${chatId}`;
  await tgSend(chatId,
    `✅ <b>Verifikasi Berhasil!</b>\n\n` +
    `Akun ${displayName} sekarang terhubung ke sistem <b>Z-Wealth</b>.\n` +
    `Anda akan menerima notifikasi trading di sini.\n\n` +
    `⚡ Bot aktif dan memantau pasar setiap 1 menit.\n` +
    `📊 Strategi: <b>EMA 13/21 Cross</b>\n\n` +
    `<i>Gunakan aplikasi Z-Wealth untuk mengatur konfigurasi bot.</i>`
  );

  console.log(`[TgWebhook] Linked: ${displayName} → user_id ${userId.slice(0, 8)}...`);
  return new Response("ok", { status: 200 });
}

// ════════════════════════════════════════════════════════════════
// MAIN HANDLER — membedakan Cron Job vs Telegram Webhook
// ════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  // ── Cek apakah request dari Telegram Webhook ─────────────────────
  // Telegram selalu kirim POST dengan body JSON yang ada field "update_id"
  const contentType  = req.headers.get("content-type") || "";
  const isTgWebhook  = req.method === "POST" && contentType.includes("application/json");

  if (isTgWebhook) {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }

    // Telegram webhook payload selalu memiliki field "update_id"
    if ("update_id" in body) {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      return await handleTelegramWebhook(sb, body);
    }

    // Bukan Telegram — lanjut ke auth check untuk Cron Job
    // ── Auth: Cron Job ─────────────────────────────────────────────
    const auth       = req.headers.get("Authorization") || "";
    const cronHeader = req.headers.get("x-cron-secret") || "";
    const isInternal = !auth && !!req.headers.get("x-supabase-edge-runtime");

    const authorized =
      auth === `Bearer ${SUPABASE_SERVICE_KEY}` ||
      (CRON_SECRET && cronHeader === CRON_SECRET) ||
      isInternal;

    if (!authorized) {
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
  }

  // ── GET request (health check) ────────────────────────────────────
  return new Response(JSON.stringify({ status: "ok", service: "z-wealth trading worker" }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
