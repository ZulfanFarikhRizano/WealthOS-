// ══════════════════════════════════════════════════════════════════
// Z-WEALTH · TRADING WORKER v2 — Supabase Edge Function
//
// STRATEGI:
//   ENTRY  → Golden Cross: EMA13 memotong ke ATAS EMA21
//            + konfirmasi volume (candle terakhir > rata-rata volume)
//   EXIT   → Dead Cross  : EMA13 memotong ke BAWAH EMA21  (TP/SL alami)
//            ATAU Hard SL  : harga turun ≥ 5% dari entry price
//
// RULES:
//   • Max 3 posisi terbuka sekaligus (per user)
//   • Tidak boleh buka posisi baru di simbol yang sudah ada posisi
//   • Leverage 10x (linear/futures Bybit)  |  Binance futures
//   • Mode SIMULATION jika API key tidak diisi
//
// TABEL BARU DIPERLUKAN: positions
//   Jalankan: supabase/migrations/positions.sql
//
// Deploy: supabase functions deploy trading-worker
// Cron:   setiap 1 menit
// ══════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── ENV ───────────────────────────────────────────────────────────
const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const CRON_SECRET         = Deno.env.get("CRON_SECRET") || "";

// ── KONSTANTA STRATEGI ────────────────────────────────────────────
const LEVERAGE       = 10;          // leverage 10x
const HARD_SL_PCT    = 0.05;        // hard stop loss -5% dari entry
const MAX_POSITIONS  = 3;           // max posisi terbuka sekaligus
const VOL_MULTIPLIER = 1.2;         // volume candle terakhir harus > 1.2x rata-rata
const KLINE_LIMIT    = 50;          // candle untuk kalkulasi (lebih banyak = lebih akurat)
const CATEGORY       = "linear";    // bybit: linear (futures USDT-margined)

// ── TYPES ─────────────────────────────────────────────────────────
interface Position {
  id: string;
  user_id: string;
  symbol: string;
  entry_price: number;
  qty: number;
  amount_usdt: number;
  leverage: number;
  exchange: string;
  opened_at: string;
  status: "OPEN" | "CLOSED" | "SIM_OPEN" | "SIM_CLOSED";
}

interface BotConfig {
  user_id: string;
  exchange: string;
  api_key: string;
  api_secret: string;
  symbols: string[];
  top_n_by_volume: number;
  trade_amount_usdt: number;
  telegram_chat_id: string;
  is_active: boolean;
}

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SignalResult {
  signal: "BUY" | "SELL" | null;
  ema13: number;
  ema21: number;
  volumeOk: boolean;
  currentVolume: number;
  avgVolume: number;
}

// ════════════════════════════════════════════════════════════════
// MARKET DATA
// ════════════════════════════════════════════════════════════════

async function fetchBybitCandles(symbol: string, limit = KLINE_LIMIT): Promise<Candle[]> {
  // Gunakan linear (futures) untuk leverage
  const url = `https://api.bybit.com/v5/market/kline?category=${CATEGORY}&symbol=${symbol}&interval=1&limit=${limit}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit kline [${symbol}]: ${data.retMsg}`);
  // list: [startTime, open, high, low, close, volume, turnover] — newest first → reverse
  return (data.result?.list || []).reverse().map((k: string[]) => ({
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchBinanceCandles(symbol: string, limit = KLINE_LIMIT): Promise<Candle[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${limit}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Binance kline [${symbol}]: invalid response`);
  return data.map((k: string[]) => ({
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function getTopSymbols(exchange: string, topN: number, whitelist: string[]): Promise<string[]> {
  if (whitelist.length > 0) return whitelist;
  try {
    if (exchange === "bybit") {
      const res  = await fetch(`https://api.bybit.com/v5/market/tickers?category=${CATEGORY}`);
      const data = await res.json();
      return (data.result?.list || [] as Array<{ symbol: string; turnover24h: string }>)
        .filter((t: { symbol: string }) => t.symbol.endsWith("USDT"))
        .sort((a: { turnover24h: string }, b: { turnover24h: string }) =>
          parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
        .slice(0, topN)
        .map((t: { symbol: string }) => t.symbol);
    } else {
      const res  = await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr");
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
// INDIKATOR
// ════════════════════════════════════════════════════════════════

function calcEMA(values: number[], period: number): number[] {
  const k    = 2 / (period + 1);
  const emas = [values[0]];
  for (let i = 1; i < values.length; i++) {
    emas.push(values[i] * k + emas[i - 1] * (1 - k));
  }
  return emas;
}

function analyzeSignal(candles: Candle[]): SignalResult {
  const empty: SignalResult = { signal: null, ema13: 0, ema21: 0, volumeOk: false, currentVolume: 0, avgVolume: 0 };
  if (candles.length < 25) return empty;

  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const ema13Arr = calcEMA(closes, 13);
  const ema21Arr = calcEMA(closes, 21);
  const n        = closes.length - 1;

  const ema13Cur = ema13Arr[n],     ema13Prv = ema13Arr[n - 1];
  const ema21Cur = ema21Arr[n],     ema21Prv = ema21Arr[n - 1];

  // Konfirmasi volume: candle terakhir harus > VOL_MULTIPLIER × rata-rata 20 candle sebelumnya
  const recentVols   = volumes.slice(-21, -1); // 20 candle sebelum candle terakhir
  const avgVolume    = recentVols.reduce((s, v) => s + v, 0) / recentVols.length;
  const currentVol   = volumes[n];
  const volumeOk     = currentVol > avgVolume * VOL_MULTIPLIER;

  let signal: "BUY" | "SELL" | null = null;
  // Golden cross: EMA13 dari bawah ke atas EMA21
  if (ema13Prv < ema21Prv && ema13Cur >= ema21Cur) signal = "BUY";
  // Dead cross: EMA13 dari atas ke bawah EMA21
  if (ema13Prv > ema21Prv && ema13Cur <= ema21Cur) signal = "SELL";

  return { signal, ema13: ema13Cur, ema21: ema21Cur, volumeOk, currentVolume: currentVol, avgVolume };
}

// ════════════════════════════════════════════════════════════════
// ORDER EXECUTION (Bybit Linear / Binance Futures)
// ════════════════════════════════════════════════════════════════

function isSim(apiKey: string): boolean {
  return !apiKey || apiKey === "SIMULATION" || apiKey.startsWith("SIMULATION") || apiKey.includes(":");
  // key yg dienkripsi AES mengandung ":" (format iv:ciphertext)
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── SET LEVERAGE di Bybit (sekali sebelum order) ─────────────────
async function setBybitLeverage(symbol: string, leverage: number, apiKey: string, apiSecret: string): Promise<void> {
  const timestamp   = Date.now().toString();
  const recvWindow  = "5000";
  const body        = JSON.stringify({ category: CATEGORY, symbol, buyLeverage: String(leverage), sellLeverage: String(leverage) });
  const paramStr    = `${timestamp}${apiKey}${recvWindow}${body}`;
  const signature   = await hmacSign(apiSecret, paramStr);

  await fetch("https://api.bybit.com/v5/position/set-leverage", {
    method: "POST",
    headers: {
      "Content-Type":        "application/json",
      "X-BAPI-API-KEY":      apiKey,
      "X-BAPI-SIGN":         signature,
      "X-BAPI-TIMESTAMP":    timestamp,
      "X-BAPI-RECV-WINDOW":  recvWindow,
    },
    body,
  });
  // Error leverage sudah di-set sebelumnya tidak apa-apa, lanjut
}

async function placeBybitOrder(
  symbol: string, side: "Buy" | "Sell", qty: string,
  apiKey: string, apiSecret: string
): Promise<{ orderId: string; status: string; errorMsg?: string }> {
  const timestamp  = Date.now().toString();
  const recvWindow = "5000";
  const body = JSON.stringify({
    category: CATEGORY, symbol,
    side,
    orderType: "Market",
    qty,
    timeInForce: "IOC",
    reduceOnly: false,
  });
  const paramStr  = `${timestamp}${apiKey}${recvWindow}${body}`;
  const signature = await hmacSign(apiSecret, paramStr);

  const res  = await fetch("https://api.bybit.com/v5/order/create", {
    method: "POST",
    headers: {
      "Content-Type":        "application/json",
      "X-BAPI-API-KEY":      apiKey,
      "X-BAPI-SIGN":         signature,
      "X-BAPI-TIMESTAMP":    timestamp,
      "X-BAPI-RECV-WINDOW":  recvWindow,
    },
    body,
  });
  const data = await res.json();
  if (data.retCode === 0) return { orderId: data.result?.orderId || "BYBIT_OK", status: "FILLED" };
  return { orderId: "", status: "ERROR", errorMsg: data.retMsg };
}

async function placeBybitCloseOrder(
  symbol: string, side: "Buy" | "Sell", qty: string,
  apiKey: string, apiSecret: string
): Promise<{ orderId: string; status: string; errorMsg?: string }> {
  const timestamp  = Date.now().toString();
  const recvWindow = "5000";
  const body = JSON.stringify({
    category: CATEGORY, symbol,
    side,
    orderType: "Market",
    qty,
    timeInForce: "IOC",
    reduceOnly: true,   // ← close posisi yang ada
  });
  const paramStr  = `${timestamp}${apiKey}${recvWindow}${body}`;
  const signature = await hmacSign(apiSecret, paramStr);

  const res  = await fetch("https://api.bybit.com/v5/order/create", {
    method: "POST",
    headers: {
      "Content-Type":        "application/json",
      "X-BAPI-API-KEY":      apiKey,
      "X-BAPI-SIGN":         signature,
      "X-BAPI-TIMESTAMP":    timestamp,
      "X-BAPI-RECV-WINDOW":  recvWindow,
    },
    body,
  });
  const data = await res.json();
  if (data.retCode === 0) return { orderId: data.result?.orderId || "BYBIT_CLOSE", status: "CLOSED" };
  return { orderId: "", status: "ERROR", errorMsg: data.retMsg };
}

async function placeBinanceFuturesOrder(
  symbol: string, side: "BUY" | "SELL", qty: string, reduceOnly: boolean,
  apiKey: string, apiSecret: string
): Promise<{ orderId: string; status: string; errorMsg?: string }> {
  const timestamp = Date.now();
  const paramStr  = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${qty}&reduceOnly=${reduceOnly}&timestamp=${timestamp}&recvWindow=5000`;
  const signature = await hmacSign(apiSecret, paramStr);

  const res  = await fetch(`https://fapi.binance.com/fapi/v1/order?${paramStr}&signature=${signature}`, {
    method: "POST",
    headers: { "X-MBX-APIKEY": apiKey },
  });
  const data = await res.json();
  if (data.orderId) return { orderId: String(data.orderId), status: reduceOnly ? "CLOSED" : "FILLED" };
  return { orderId: "", status: "ERROR", errorMsg: data.msg || "Binance futures error" };
}

async function setBinanceLeverage(symbol: string, leverage: number, apiKey: string, apiSecret: string): Promise<void> {
  const timestamp = Date.now();
  const paramStr  = `symbol=${symbol}&leverage=${leverage}&timestamp=${timestamp}`;
  const signature = await hmacSign(apiSecret, paramStr);
  await fetch(`https://fapi.binance.com/fapi/v1/leverage?${paramStr}&signature=${signature}`, {
    method: "POST",
    headers: { "X-MBX-APIKEY": apiKey },
  });
}

// ════════════════════════════════════════════════════════════════
// TELEGRAM
// ════════════════════════════════════════════════════════════════

async function tgSend(chatId: string, text: string): Promise<void> {
  if (!TG_BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch { /* silent */ }
}

function msgEntry(
  symbol: string, price: number, qty: number, amountUsdt: number,
  ema13: number, ema21: number, volRatio: number, status: string
): string {
  const isSim = status.includes("SIM");
  return `🟢 <b>OPEN LONG ${symbol}</b> ${isSim ? "🔵<i>SIM</i>" : "✅"}
━━━━━━━━━━━━━━━━━━━
💵 Entry : <code>$${price.toLocaleString("en-US", { maximumFractionDigits: 4 })}</code>
📦 Qty   : <code>${qty.toFixed(4)}</code>
💰 Size  : <code>$${amountUsdt} × ${LEVERAGE}x = $${(amountUsdt * LEVERAGE).toFixed(0)} notional</code>
📊 EMA13 : <code>${ema13.toFixed(4)}</code>  EMA21: <code>${ema21.toFixed(4)}</code>
📈 Volume: <code>${(volRatio * 100).toFixed(0)}%</code> di atas rata-rata
🛡️ Hard SL: <code>$${(price * (1 - HARD_SL_PCT)).toFixed(4)}</code> (-${HARD_SL_PCT * 100}%)
⏰ ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`;
}

function msgExit(
  symbol: string, entryPrice: number, exitPrice: number,
  qty: number, amountUsdt: number, reason: string, pnlUsdt: number, status: string
): string {
  const pnlPct  = ((exitPrice - entryPrice) / entryPrice * 100 * LEVERAGE);
  const emoji   = pnlUsdt >= 0 ? "🟢" : "🔴";
  const isSim   = status.includes("SIM");
  return `${emoji} <b>CLOSE ${symbol}</b> ${isSim ? "🔵<i>SIM</i>" : "✅"}
━━━━━━━━━━━━━━━━━━━
📌 Reason: <b>${reason}</b>
💵 Entry : <code>$${entryPrice.toLocaleString("en-US", { maximumFractionDigits: 4 })}</code>
💵 Exit  : <code>$${exitPrice.toLocaleString("en-US", { maximumFractionDigits: 4 })}</code>
📦 Qty   : <code>${qty.toFixed(4)}</code>
${pnlUsdt >= 0 ? "💰" : "💸"} PnL    : <code>${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt.toFixed(2)} USDT (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)</code>
⏰ ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`;
}

// ════════════════════════════════════════════════════════════════
// POSITION HELPERS (Supabase)
// ════════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
type SB = ReturnType<typeof createClient>;

async function getOpenPositions(sb: SB, userId: string): Promise<Position[]> {
  const { data } = await sb
    .from("positions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["OPEN", "SIM_OPEN"]);
  return (data || []) as Position[];
}

async function openPosition(
  sb: SB, userId: string, symbol: string,
  entryPrice: number, qty: number, amountUsdt: number,
  exchange: string, simMode: boolean
): Promise<void> {
  await sb.from("positions").insert({
    user_id:     userId,
    symbol,
    entry_price: entryPrice,
    qty,
    amount_usdt: amountUsdt,
    leverage:    LEVERAGE,
    exchange,
    status:      simMode ? "SIM_OPEN" : "OPEN",
    opened_at:   new Date().toISOString(),
  });
}

async function closePosition(
  sb: SB, positionId: string, exitPrice: number,
  closeOrderId: string, reason: string, pnlUsdt: number, simMode: boolean
): Promise<void> {
  await sb.from("positions").update({
    status:         simMode ? "SIM_CLOSED" : "CLOSED",
    exit_price:     exitPrice,
    closed_at:      new Date().toISOString(),
    close_reason:   reason,
    pnl_usdt:       pnlUsdt,
    close_order_id: closeOrderId,
  }).eq("id", positionId);
}

async function logTrade(
  sb: SB, userId: string, symbol: string,
  side: "BUY" | "SELL", price: number, amountUsdt: number,
  ema13: number, ema21: number, volume24h: number,
  orderId: string, orderStatus: string, errorMsg: string | null,
  note: string
): Promise<void> {
  await sb.from("trades").insert({
    user_id:      userId,
    symbol,
    side,
    price,
    amount_usdt:  amountUsdt,
    ema13,
    ema21,
    volume_24h:   volume24h,
    order_id:     orderId,
    order_status: orderStatus,
    error_msg:    errorMsg,
    note,
    executed_at:  new Date().toISOString(),
  });
}

// ════════════════════════════════════════════════════════════════
// CORE LOGIC — proses satu user
// ════════════════════════════════════════════════════════════════

async function processUser(sb: SB, cfg: BotConfig): Promise<string[]> {
  const {
    user_id: userId, exchange, api_key: apiKey, api_secret: apiSecret,
    trade_amount_usdt, top_n_by_volume, symbols: whitelist, telegram_chat_id: tgChat,
  } = cfg;

  const amountUsdt = parseFloat(String(trade_amount_usdt)) || 10;
  const simMode    = isSim(apiKey);
  const log: string[] = [];

  // ── 1. Ambil posisi terbuka ──────────────────────────────────────
  const openPositions = await getOpenPositions(sb, userId);

  // ── 2. CEK EXIT pada posisi terbuka (prioritas utama) ────────────
  for (const pos of openPositions) {
    try {
      const candles = exchange === "bybit"
        ? await fetchBybitCandles(pos.symbol)
        : await fetchBinanceCandles(pos.symbol);

      const currentPrice = candles[candles.length - 1].close;
      const { signal, ema13, ema21 } = analyzeSignal(candles);

      const priceDrop = (pos.entry_price - currentPrice) / pos.entry_price;
      const hardSLHit = priceDrop >= HARD_SL_PCT;
      const deadCross = signal === "SELL";

      if (!hardSLHit && !deadCross) continue;

      const reason  = hardSLHit ? `HARD SL -${(priceDrop * 100).toFixed(2)}%` : "DEAD CROSS";
      // PnL dengan leverage: (exitPrice - entryPrice) / entryPrice * leverage * amountUsdt
      const pnlUsdt = (currentPrice - pos.entry_price) / pos.entry_price * LEVERAGE * pos.amount_usdt;

      let closeOrderId = `SIM_CLOSE_${Date.now()}`;
      let closeStatus  = "SIM_CLOSED";

      if (!simMode) {
        // Real close: sisi berlawanan dari posisi LONG
        const closeResult = exchange === "bybit"
          ? await placeBybitCloseOrder(pos.symbol, "Sell", pos.qty.toFixed(4), apiKey, apiSecret)
          : await placeBinanceFuturesOrder(pos.symbol, "SELL", pos.qty.toFixed(4), true, apiKey, apiSecret);

        closeOrderId = closeResult.orderId;
        closeStatus  = closeResult.status === "CLOSED" ? "CLOSED" : "ERROR";

        if (closeResult.status === "ERROR") {
          await logTrade(sb, userId, pos.symbol, "SELL", currentPrice, pos.amount_usdt, ema13, ema21, 0, "", "ERROR", closeResult.errorMsg || null, `CLOSE attempt: ${reason}`);
          log.push(`${pos.symbol}:CLOSE_ERROR:${reason}`);
          continue;
        }
      }

      // Update posisi → CLOSED
      await closePosition(sb, pos.id, currentPrice, closeOrderId, reason, pnlUsdt, simMode);

      // Log trade
      await logTrade(sb, userId, pos.symbol, "SELL", currentPrice, pos.amount_usdt, ema13, ema21, 0, closeOrderId, closeStatus, null, `EXIT: ${reason}`);

      // Telegram
      await tgSend(tgChat, msgExit(pos.symbol, pos.entry_price, currentPrice, pos.qty, pos.amount_usdt, reason, pnlUsdt, closeStatus));

      log.push(`${pos.symbol}:CLOSED:${reason}:PnL ${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt.toFixed(2)}USDT`);

    } catch (e: unknown) {
      console.warn(`[Worker] Exit check error ${pos.symbol}:`, e);
      log.push(`${pos.symbol}:EXIT_ERR:${String(e).slice(0, 60)}`);
    }
  }

  // ── 3. Re-fetch posisi terbuka setelah proses exit ───────────────
  const freshPositions = await getOpenPositions(sb, userId);
  const openCount      = freshPositions.length;
  const openSymbols    = new Set(freshPositions.map(p => p.symbol));

  // Max 3 posisi — tidak scan entry jika sudah penuh
  if (openCount >= MAX_POSITIONS) {
    log.push(`MAX_POSITIONS(${MAX_POSITIONS}) reached, skip entry scan`);
    return log;
  }

  // ── 4. SCAN ENTRY ────────────────────────────────────────────────
  const symbols = await getTopSymbols(exchange, top_n_by_volume || 20, whitelist || []);
  const slots   = MAX_POSITIONS - openCount; // berapa slot kosong

  let entryCount = 0;

  for (const symbol of symbols.slice(0, 50)) {
    if (entryCount >= slots) break;
    if (openSymbols.has(symbol)) continue; // sudah ada posisi di simbol ini

    try {
      const candles = exchange === "bybit"
        ? await fetchBybitCandles(symbol)
        : await fetchBinanceCandles(symbol);

      const { signal, ema13, ema21, volumeOk, currentVolume, avgVolume } = analyzeSignal(candles);

      // Hanya BUY (Golden Cross) + konfirmasi volume
      if (signal !== "BUY" || !volumeOk) continue;

      const price   = candles[candles.length - 1].close;
      const qty     = (amountUsdt * LEVERAGE) / price; // qty dengan leverage
      const volRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

      let orderId     = `SIM_OPEN_${Date.now()}`;
      let orderStatus = "SIM_OPEN";

      if (!simMode) {
        // Set leverage dulu
        if (exchange === "bybit") {
          await setBybitLeverage(symbol, LEVERAGE, apiKey, apiSecret);
          const r = await placeBybitOrder(symbol, "Buy", qty.toFixed(4), apiKey, apiSecret);
          orderId     = r.orderId;
          orderStatus = r.status === "FILLED" ? "OPEN" : "ERROR";
          if (r.status === "ERROR") {
            await logTrade(sb, userId, symbol, "BUY", price, amountUsdt, ema13, ema21, currentVolume, "", "ERROR", r.errorMsg || null, "ENTRY failed");
            continue;
          }
        } else {
          await setBinanceLeverage(symbol, LEVERAGE, apiKey, apiSecret);
          const r = await placeBinanceFuturesOrder(symbol, "BUY", qty.toFixed(4), false, apiKey, apiSecret);
          orderId     = r.orderId;
          orderStatus = r.status === "FILLED" ? "OPEN" : "ERROR";
          if (r.status === "ERROR") {
            await logTrade(sb, userId, symbol, "BUY", price, amountUsdt, ema13, ema21, currentVolume, "", "ERROR", r.errorMsg || null, "ENTRY failed");
            continue;
          }
        }
      }

      // Simpan posisi terbuka
      await openPosition(sb, userId, symbol, price, qty, amountUsdt, exchange, simMode);

      // Log trade
      await logTrade(sb, userId, symbol, "BUY", price, amountUsdt, ema13, ema21, currentVolume, orderId, orderStatus, null, "ENTRY: Golden Cross + Vol OK");

      // Telegram
      await tgSend(tgChat, msgEntry(symbol, price, qty, amountUsdt, ema13, ema21, volRatio, orderStatus));

      log.push(`${symbol}:OPEN:GoldenCross+Vol:${orderStatus}`);
      entryCount++;

    } catch (e: unknown) {
      console.warn(`[Worker] Entry error ${symbol}:`, e);
    }
  }

  return log;
}

// ════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  // Auth: terima dari Supabase cron (bearer) atau x-cron-secret
  const auth = req.headers.get("Authorization") || "";
  const cronHeader = req.headers.get("x-cron-secret") || "";

  const validBearer = auth === `Bearer ${SUPABASE_SERVICE_KEY}`;
  const validCron   = CRON_SECRET && cronHeader === CRON_SECRET;

  if (!validBearer && !validCron) {
    // Izinkan jika dipanggil internal dari Supabase runtime (tidak ada auth)
    const isInternal = !auth && req.headers.get("x-supabase-edge-runtime");
    if (!isInternal) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: configs, error } = await sb
    .from("bot_configs")
    .select("*")
    .eq("is_active", true);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!configs || configs.length === 0) {
    return new Response(JSON.stringify({ status: "no_active_bots" }), { status: 200 });
  }

  const allResults: Record<string, string[]> = {};

  for (const cfg of configs as BotConfig[]) {
    try {
      allResults[cfg.user_id.slice(0, 8)] = await processUser(sb, cfg);
    } catch (e: unknown) {
      console.error(`[Worker] Fatal error user ${cfg.user_id}:`, e);
      allResults[cfg.user_id.slice(0, 8)] = [`FATAL: ${String(e).slice(0, 100)}`];
    }
  }

  return new Response(
    JSON.stringify({ status: "done", ts: new Date().toISOString(), results: allResults }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
