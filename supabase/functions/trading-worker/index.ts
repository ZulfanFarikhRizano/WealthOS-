// ══════════════════════════════════════════════════════════════════
// Z-WEALTH · TRADING WORKER + TELEGRAM WEBHOOK + BOT NOTIFY + EXCHANGE BALANCE v5
//
// Satu Deno.serve menangani EMPAT jenis request:
//   1. POST /  header x-cron-secret           → Cron Job trading (EMA Cross)
//   2. POST /  body "update_id"               → Telegram Webhook (/start command)
//   3. POST /  body "_type: bot_status_notif" → Kirim pesan Telegram dari browser
//   4. POST /  body "_type: exchange_balance" → Proxy fetch saldo exchange (fix CORS)
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

// ── CORS HEADERS (untuk request dari browser) ─────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

// ── KONSTANTA ─────────────────────────────────────────────────────
const MAX_POSITIONS     = 5;   // Maksimum posisi terbuka bersamaan
const MAX_ENTRY_PER_RUN = 1;   // FIXED: Hanya 1 entry per siklus cron (tidak serakah)
const KLINE_LIMIT       = 50;

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
// QTY NORMALIZATION — ambil stepSize & minQty dari exchange
// Tanpa ini, Bybit tolak order dengan "Qty invalid"
// ════════════════════════════════════════════════════════════════

interface InstrumentInfo {
  minQty:   number;
  stepSize: number;
  minNotional: number;
}

// Cache supaya tidak fetch berulang per simbol
const _instrumentCache = new Map<string, InstrumentInfo>();

async function getBybitInstrumentInfo(symbol: string, category: string): Promise<InstrumentInfo> {
  const cacheKey = `${category}:${symbol}`;
  if (_instrumentCache.has(cacheKey)) return _instrumentCache.get(cacheKey)!;

  try {
    const res  = await fetch(`https://api.bybit.com/v5/market/instruments-info?category=${category}&symbol=${symbol}`);
    const data = await res.json();
    const lot  = data.result?.list?.[0]?.lotSizeFilter;
    const info: InstrumentInfo = {
      minQty:      parseFloat(lot?.minOrderQty   || lot?.minTradingQty || "0.001"),
      stepSize:    parseFloat(lot?.qtyStep        || lot?.basePrecision || "0.001"),
      minNotional: parseFloat(lot?.minNotionalValue || "0"),
    };
    _instrumentCache.set(cacheKey, info);
    return info;
  } catch {
    return { minQty: 0.001, stepSize: 0.001, minNotional: 0 };
  }
}

// Round qty ke stepSize dan pastikan >= minQty
function normalizeQty(qty: number, stepSize: number, minQty: number, decimals: number): string {
  const steps    = Math.floor(qty / stepSize);
  const normalized = steps * stepSize;
  const final    = Math.max(normalized, minQty);
  return final.toFixed(decimals);
}

// Hitung jumlah desimal dari stepSize (misal 0.001 → 3, 0.1 → 1)
function stepDecimals(stepSize: number): number {
  const s = stepSize.toString();
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}



function isSim(apiKey: string): boolean {
  // FIXED: Hapus apiKey.includes(":") — API key Bybit bisa mengandung ":" secara sah
  // Hanya anggap simulasi jika key benar-benar kosong atau eksplisit "SIMULATION"
  return !apiKey || apiKey.trim() === "" || apiKey === "SIMULATION" || apiKey.startsWith("SIMULATION_");
}

interface OrderResult { orderId: string; ok: boolean; error?: string }

async function openOrder(
  exchange: string, tradeMode: string, symbol: string,
  amountUsdt: number, price: number, leverage: number,
  apiKey: string, apiSecret: string
): Promise<OrderResult> {
  if (isSim(apiKey)) return { orderId: `SIM_${Date.now()}`, ok: true };

  if (exchange === "bybit") {
    const category = tradeMode === "futures" ? "linear" : "spot";
    const info     = await getBybitInstrumentInfo(symbol, category);
    const dec      = stepDecimals(info.stepSize);
    const rawQty   = tradeMode === "futures"
      ? (amountUsdt * leverage) / price
      : amountUsdt / price;
    const qty      = normalizeQty(rawQty, info.stepSize, info.minQty, dec);

    // Guard: qty tidak boleh 0 atau di bawah minQty
    if (parseFloat(qty) <= 0 || parseFloat(qty) < info.minQty) {
      return { orderId: "", ok: false, error: `Qty ${qty} di bawah minQty ${info.minQty} untuk ${symbol}` };
    }

    if (tradeMode === "futures") await bybitSetLeverage(symbol, leverage, apiKey, apiSecret);
    return bybitMarketOrder(symbol, "Buy", qty, category, false, apiKey, apiSecret);
  } else {
    if (tradeMode === "futures") {
      const rawQty = (amountUsdt * leverage) / price;
      const qty    = rawQty.toFixed(3);
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
    const info     = await getBybitInstrumentInfo(symbol, category);
    const dec      = stepDecimals(info.stepSize);
    const qtyStr   = normalizeQty(qty, info.stepSize, info.minQty, dec);

    if (parseFloat(qtyStr) <= 0 || parseFloat(qtyStr) < info.minQty) {
      return { orderId: "", ok: false, error: `CloseQty ${qtyStr} di bawah minQty ${info.minQty} untuk ${symbol}` };
    }

    return bybitMarketOrder(symbol, "Sell", qtyStr, category, tradeMode === "futures", apiKey, apiSecret);
  } else {
    if (tradeMode === "futures") return binanceMarketOrder(symbol, "SELL", qty.toFixed(3), true, true, apiKey, apiSecret);
    return binanceMarketOrder(symbol, "SELL", qty.toFixed(6), false, false, apiKey, apiSecret);
  }
}

// ════════════════════════════════════════════════════════════════
// TELEGRAM — CORE SEND
// ════════════════════════════════════════════════════════════════

async function tgSend(chatId: string | number, text: string) {
  if (!TG_BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        chat_id:                  chatId,
        text,
        parse_mode:               "HTML",
        disable_web_page_preview: true,
      }),
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
  // FIXED Bug #2: Tampilkan status LIVE atau SIMULASI dengan jelas agar tidak bingung
  const statusLine = sim
    ? `🔵 Status : <b>SIMULASI</b> <i>(API key belum aktif / mode sim)</i>`
    : `✅ Status : <b>ORDER TERKIRIM (LIVE)</b>`;
  const lev = tradeMode === "futures" ? ` × ${leverage}x leverage` : " (spot)";
  return `🟢 <b>BUY ${symbol}</b>
━━━━━━━━━━━━━━━━━━━━
📊 Sinyal : <b>Golden Cross</b>
   EMA13 <code>${ema13.toFixed(4)}</code> ⬆ EMA21 <code>${ema21.toFixed(4)}</code>
💵 Harga  : <code>$${price.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
📦 Qty    : <code>${qty.toFixed(tradeMode === "futures" ? 4 : 6)}</code>
💰 Modal  : <code>$${amountUsdt} USDT${lev}</code>
${statusLine}
⏰ ${wib()}`;
}

function tgSellMsg(
  symbol: string, entryPrice: number, exitPrice: number,
  qty: number, amountUsdt: number, tradeMode: string, leverage: number,
  ema13: number, ema21: number, pnl: number, sim: boolean
): string {
  // FIXED Bug #2: Status jelas LIVE vs SIMULASI
  const statusLine = sim
    ? `🔵 Status : <b>SIMULASI</b>`
    : `✅ Status : <b>ORDER TERKIRIM (LIVE)</b>`;
  const pnlSign = pnl >= 0 ? "+" : "";
  const emoji   = pnl >= 0 ? "💰" : "💸";
  const pnlPct  = ((exitPrice - entryPrice) / entryPrice * 100 * (tradeMode === "futures" ? leverage : 1));
  return `🔴 <b>SELL ${symbol}</b>
━━━━━━━━━━━━━━━━━━━━
📊 Sinyal : <b>Dead Cross</b>
   EMA13 <code>${ema13.toFixed(4)}</code> ⬇ EMA21 <code>${ema21.toFixed(4)}</code>
💵 Entry  : <code>$${entryPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
💵 Exit   : <code>$${exitPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
${emoji} PnL    : <code>${pnlSign}${pnl.toFixed(2)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)</code>
${statusLine}
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

  // DEBUG: log status sim agar kelihatan di Supabase logs
  console.log(`[processUser] userId=${userId.slice(0,8)} exchange=${exchange} sim=${sim} apiKeyLen=${apiKey?.length || 0} apiKeyPreview=${apiKey?.slice(0,6) || "EMPTY"}`);

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

  const slots   = Math.min(MAX_POSITIONS - openCount, MAX_ENTRY_PER_RUN); // max 1 entry per run
  const symbols = await getTopSymbols(exchange, tradeMode, topN || 20, whitelist || []);
  let entered   = 0;

  // FIXED Bug #3: Fetch candles secara paralel (batch 10) agar tidak timeout.
  // Sequential 60 simbol bisa 18+ detik → Edge Function crash → bot mati sendiri.
  const BATCH_SIZE = 10;
  const candidateSymbols = symbols
    .filter(s => !openSymbols.has(s))
    .slice(0, Math.min(40, slots * 15));

  for (let i = 0; i < candidateSymbols.length && entered < slots; i += BATCH_SIZE) {
    const batch = candidateSymbols.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (symbol) => {
        const candles = await fetchCandles(exchange, symbol, tradeMode);
        const signal  = detectCross(candles);
        return { symbol, candles, signal };
      })
    );

    for (const res of batchResults) {
      if (entered >= slots) break;
      if (res.status !== "fulfilled") continue;
      const { symbol, candles, signal: { cross, ema13, ema21 } } = res.value;
      if (cross !== "GOLDEN") continue;

      try {
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
  }

  if (entered === 0 && openCount < MAX_POSITIONS) log.push("no_signal");

  return log;
}

// ════════════════════════════════════════════════════════════════
// HANDLER: BOT NOTIFY — relay pesan Telegram dari browser
// Body: { _type: "bot_status_notif", chat_id, message }
//    atau format lama: { chat_id, text }
// ════════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleBotNotify(body: any): Promise<Response> {
  const chatId = body.chat_id;
  const text   = body.message || body.text;

  if (!chatId || !text) {
    return new Response(
      JSON.stringify({ error: "Missing chat_id or message/text" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  if (!TG_BOT_TOKEN) {
    console.error("[bot-notify] TELEGRAM_BOT_TOKEN not set");
    return new Response(
      JSON.stringify({ error: "Bot token not configured" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    const tgRes  = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        chat_id:                  chatId,
        text,
        parse_mode:               "HTML",
        disable_web_page_preview: true,
      }),
    });
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      console.error("[bot-notify] Telegram error:", tgData);
      return new Response(
        JSON.stringify({ error: tgData.description || "Telegram error" }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    console.log(`[bot-notify] Sent to ${chatId}: ${String(text).slice(0, 60)}...`);
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[bot-notify] Error:", e);
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
}

// ════════════════════════════════════════════════════════════════
// HANDLER: EXECUTE ORDER — proxy order dari browser (fix CORS)
// Body: { _type: "execute_order", exchange, mode, leverage,
//         api_key, api_secret, symbol, side, qty, amount_usdt }
// ════════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleExecuteOrder(body: any): Promise<Response> {
  const {
    exchange    = "bybit",
    mode        = "spot",
    leverage    = 10,
    api_key,
    api_secret,
    symbol,
    side,
    qty,
    amount_usdt = 10,
  } = body;

  if (!api_key || !api_secret) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing api_key or api_secret" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
  if (!symbol || !side || !qty) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing symbol, side, or qty" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    const candles   = await fetchCandles(exchange, symbol, mode);
    const price     = candles[candles.length - 1]?.close || 1;
    const lev       = parseInt(String(leverage)) || 10;
    const amtUsdt   = parseFloat(String(amount_usdt)) || 10;
    const qtyNum    = parseFloat(String(qty));

    let result: OrderResult;
    if (side === "BUY") {
      result = await openOrder(exchange, mode, symbol, amtUsdt, price, lev, api_key, api_secret);
    } else {
      result = await closeOrder(exchange, mode, symbol, qtyNum, api_key, api_secret);
    }

    if (!result.ok) {
      console.error(`[execute-order] ${symbol} ${side} FAILED:`, result.error);
      return new Response(
        JSON.stringify({ ok: false, error: result.error }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    console.log(`[execute-order] ${exchange} ${symbol} ${side} OK — orderId: ${result.orderId}`);
    return new Response(
      JSON.stringify({ ok: true, orderId: result.orderId, symbol, side }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[execute-order] Error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
}

// ════════════════════════════════════════════════════════════════
// HANDLER: EXCHANGE BALANCE — proxy saldo Bybit/Binance (fix CORS)
// Body: { _type: "exchange_balance", exchange, mode, api_key, api_secret }
// Browser tidak bisa fetch exchange API langsung karena CORS block
// ════════════════════════════════════════════════════════════════

async function fetchBybitBalance(apiKey: string, apiSecret: string, _mode: string): Promise<number> {
  // Coba semua account type secara berurutan — Bybit punya struktur:
  //   UNIFIED  = Unified Trading Account (gabungan spot+futures modern)
  //   SPOT     = Classic Spot Account
  //   CONTRACT = Classic Futures/Derivatives Account
  // Ambil total dari semua yang berhasil agar saldo tidak kelihatan 0
  const accountTypes = ["UNIFIED", "SPOT", "CONTRACT"];
  let totalUsdt = 0;
  let anySuccess = false;
  let lastError = "";

  for (const accountType of accountTypes) {
    try {
      const ts         = Date.now().toString();
      const recvWindow = "5000";
      const qs         = "accountType=" + accountType;
      const signature  = await hmacSign(apiSecret, ts + apiKey + recvWindow + qs);

      const res  = await fetch(`https://api.bybit.com/v5/account/wallet-balance?${qs}`, {
        headers: {
          "X-BAPI-API-KEY":     apiKey,
          "X-BAPI-SIGN":        signature,
          "X-BAPI-TIMESTAMP":   ts,
          "X-BAPI-RECV-WINDOW": recvWindow,
        },
      });
      const data = await res.json();

      // retCode 0 = sukses, skip account type lain jika error (misal account type tidak aktif)
      if (data.retCode !== 0) { lastError = data.retMsg; continue; }

      const acct = data.result?.list?.[0];
      if (!acct) continue;

      // totalEquity = nilai total dalam USD termasuk unrealized PnL
      let usdt = parseFloat(acct.totalEquity || acct.totalWalletBalance || "0");

      // Fallback: sum coin by coin jika totalEquity tidak ada
      if (!usdt && acct.coin?.length) {
        usdt = acct.coin.reduce(
          (s: number, c: { usdValue?: string; walletBalance?: string; coin?: string }) => {
            const val = parseFloat(c.usdValue || "0") || parseFloat(c.walletBalance || "0");
            return s + val;
          }, 0
        );
      }

      if (usdt > 0) {
        totalUsdt += usdt;
        anySuccess = true;
        // Jika UNIFIED berhasil dan punya nilai, itu sudah mencakup semua — stop
        if (accountType === "UNIFIED" && usdt > 0) break;
      }
    } catch { /* skip account type ini */ }
  }

  if (!anySuccess && lastError) throw new Error(`Bybit: ${lastError}`);
  return totalUsdt;
}

async function fetchBinanceBalance(apiKey: string, apiSecret: string, mode: string): Promise<number> {
  const ts    = Date.now();
  const isFut = mode === "futures";
  const base  = isFut
    ? "https://fapi.binance.com/fapi/v2/balance"
    : "https://api.binance.com/api/v3/account";
  const qs  = `timestamp=${ts}&recvWindow=5000`;
  const sig = await hmacSign(apiSecret, qs);
  const res = await fetch(`${base}?${qs}&signature=${sig}`, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  const data = await res.json();
  if (isFut) {
    const asset = Array.isArray(data) ? data.find((a: { asset: string }) => a.asset === "USDT") : null;
    return parseFloat(asset?.balance || "0");
  } else {
    const asset = data.balances?.find((a: { asset: string }) => a.asset === "USDT");
    return parseFloat(asset?.free || "0");
  }
}

// deno-lint-ignore no-explicit-any
async function handleExchangeBalance(body: any): Promise<Response> {
  const { exchange = "bybit", mode = "spot", api_key, api_secret } = body;

  if (!api_key || !api_secret) {
    return new Response(
      JSON.stringify({ error: "Missing api_key or api_secret" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    let usdt = 0;
    if (exchange === "bybit") {
      usdt = await fetchBybitBalance(api_key, api_secret, mode);
    } else if (exchange === "binance") {
      usdt = await fetchBinanceBalance(api_key, api_secret, mode);
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported exchange: ${exchange}` }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    let idrRate = 16000;
    try {
      const rateRes  = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
      const rateData = await rateRes.json();
      idrRate = rateData?.rates?.IDR || 16000;
    } catch { /* pakai default */ }

    console.log(`[exchange-balance] ${String(exchange).toUpperCase()} ${mode}: ${usdt.toFixed(2)} USDT`);
    return new Response(
      JSON.stringify({ ok: true, usdt, idr: usdt * idrRate, idr_rate: idrRate, exchange, mode }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[exchange-balance] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
}

// ════════════════════════════════════════════════════════════════
// HANDLER: TELEGRAM WEBHOOK — /start command
// ════════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleTelegramWebhook(sb: SB, body: any): Promise<Response> {
  const message  = body?.message;

  // DEBUG: log semua update masuk agar kelihatan di Supabase logs
  console.log("[TgWebhook] Update received:", JSON.stringify({
    update_id: body?.update_id,
    chat_id:   message?.chat?.id,
    username:  message?.from?.username,
    text:      message?.text,
  }));

  if (!message) return new Response("ok", { status: 200 });


  const chatId   = message.chat?.id;
  const username = message.from?.username || "";
  const text     = message.text || "";

  if (!text.startsWith("/start")) {
    return new Response("ok", { status: 200 });
  }

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
      .maybeSingle();

    if (link?.user_id) {
      userId = link.user_id;
      await sb.from("pending_tg_links").delete().eq("link_code", linkCode);
    }
  }

  // ── Cara 2: fallback — cari via telegram_chat_id ─────────────────
  if (!userId) {
    const { data: cfg } = await sb
      .from("bot_configs")
      .select("user_id")
      .eq("telegram_chat_id", String(chatId))
      .maybeSingle();
    if (cfg?.user_id) userId = cfg.user_id;
  }

  // ── Cara 3: cari via telegram_username ───────────────────────────
  if (!userId && username) {
    const { data: cfg } = await sb
      .from("bot_configs")
      .select("user_id")
      .eq("telegram_username", username)
      .maybeSingle();
    if (cfg?.user_id) userId = cfg.user_id;
  }

  // ── User tidak ditemukan ─────────────────────────────────────────
  if (!userId) {
    await tgSend(chatId,
      `👋 <b>Selamat datang di Z-Wealth Bot!</b>\n\n` +
      `Untuk menghubungkan akun, ikuti langkah ini:\n\n` +
      `1️⃣ Buka aplikasi <b>Z-Wealth</b>\n` +
      `2️⃣ Masuk ke <b>Bot Trading → Konfigurasi Bot</b>\n` +
      `3️⃣ Klik tombol <b>"Hubungkan ke @zwealth_bot"</b>\n` +
      `4️⃣ Klik link yang muncul → otomatis terhubung!\n\n` +
      `<i>Jangan ketik /start manual — gunakan tombol di aplikasi.</i>`
    );
    return new Response("ok", { status: 200 });
  }

  // ── Update bot_configs: simpan chat_id ───────────────────────────
  const { error: updateErr } = await sb
    .from("bot_configs")
    .update({
      telegram_chat_id:   String(chatId),
      is_telegram_linked: true,
      updated_at:         new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (updateErr) {
    console.error("[TgWebhook] Update error:", updateErr);
    await tgSend(chatId, "⚠️ Terjadi kesalahan saat menghubungkan akun. Coba lagi.");
    return new Response("ok", { status: 200 });
  }

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
// MAIN HANDLER — router utama, membedakan semua jenis request
// ════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  // ── CORS preflight ────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // ── GET (health check) ────────────────────────────────────────
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ status: "ok", service: "z-wealth trading worker v5" }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // ── Parse body ────────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400, headers: CORS_HEADERS });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── ROUTE 1: Telegram Webhook — cek update_id (paling duluan) ────
  if ("update_id" in body) {
    return await handleTelegramWebhook(sb, body);
  }

  // ── ROUTE 2: Bot Notify dari browser — kirim pesan Telegram ──────
  // { _type: "bot_status_notif", chat_id, message }  ← format baru
  // { chat_id, text }                                ← format lama (kompatibel)
  if (
    body._type === "bot_status_notif" ||
    (body.chat_id && (body.message || body.text) && !body._type)
  ) {
    return await handleBotNotify(body);
  }

  // ── ROUTE 3: Exchange Balance — proxy saldo (fix CORS browser) ───
  // { _type: "exchange_balance", exchange, mode, api_key, api_secret }
  if (body._type === "exchange_balance") {
    return await handleExchangeBalance(body);
  }

  // ── ROUTE 3b: Execute Order — proxy order dari browser (fix CORS) ─
  // { _type: "execute_order", exchange, mode, leverage, api_key, api_secret, symbol, side, qty, amount_usdt }
  if (body._type === "execute_order") {
    return await handleExecuteOrder(body);
  }

  // ── ROUTE 4: Cron Job trading — perlu auth ────────────────────────
  const auth       = req.headers.get("Authorization") || "";
  const cronHeader = req.headers.get("x-cron-secret") || "";
  const isInternal = !auth && !!req.headers.get("x-supabase-edge-runtime");

  const authorized =
    auth === `Bearer ${SUPABASE_SERVICE_KEY}` ||
    (CRON_SECRET && cronHeader === CRON_SECRET) ||
    isInternal;

  if (!authorized) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  const { data: configs, error } = await sb
    .from("bot_configs")
    .select("*")
    .eq("is_active", true);

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
  if (!configs?.length) {
    return new Response(
      JSON.stringify({ status: "no_active_bots" }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

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
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
