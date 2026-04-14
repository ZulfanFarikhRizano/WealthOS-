// ══════════════════════════════════════════════════════════════════
// Z-WEALTH · TRADING WORKER — Supabase Edge Function
// Strategi: EMA 13/21 Crossover · Bybit & Binance
// Deploy: supabase functions deploy trading-worker
// Cron:   setiap 1 menit via Supabase Cron / pg_cron
// ══════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MASTER_ENC_KEY     = Deno.env.get("BOT_MASTER_ENC_KEY") || "";
const TG_BOT_TOKEN       = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";

// ── AES-256-GCM decrypt (mirroring browser enkripsi) ─────────────
// CATATAN: enkripsi di browser menggunakan PBKDF2 dengan seed user sebagai kunci.
// Di server kita TIDAK bisa decrypt tanpa seed user — ini by design untuk keamanan.
// Jika api_key === 'SIMULATION' atau dimulai dengan 'SIMULATION', jalankan mode sim.
// Untuk real trading, user perlu menggunakan arsitektur di mana key di-relay secara aman.
// Untuk saat ini: jalankan mode SIMULATION jika key tidak bisa didekripsi.

function isSimulation(apiKey: string): boolean {
  return !apiKey || apiKey === "SIMULATION" || apiKey.startsWith("SIMULATION");
}

// ── Ambil OHLCV dari Bybit ─────────────────────────────────────────
async function fetchBybitKlines(symbol: string, interval = "1", limit = 30): Promise<number[][]> {
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit kline error: ${data.retMsg}`);
  // Format: [startTime, open, high, low, close, volume, turnover]
  return (data.result?.list || []).reverse(); // oldest first
}

// ── Ambil OHLCV dari Binance ──────────────────────────────────────
async function fetchBinanceKlines(symbol: string, interval = "1m", limit = 30): Promise<number[][]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("Binance kline error");
  return data;
}

// ── Kalkulasi EMA ─────────────────────────────────────────────────
function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const emas: number[] = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    emas.push(closes[i] * k + emas[i - 1] * (1 - k));
  }
  return emas;
}

// ── Deteksi sinyal cross ──────────────────────────────────────────
function detectSignal(closes: number[]): { signal: "BUY" | "SELL" | null; ema13: number; ema21: number } {
  if (closes.length < 22) return { signal: null, ema13: 0, ema21: 0 };
  const ema13Arr = calcEMA(closes, 13);
  const ema21Arr = calcEMA(closes, 21);
  const n = closes.length - 1;
  const ema13Cur = ema13Arr[n], ema13Prv = ema13Arr[n - 1];
  const ema21Cur = ema21Arr[n], ema21Prv = ema21Arr[n - 1];

  let signal: "BUY" | "SELL" | null = null;
  if (ema13Prv < ema21Prv && ema13Cur >= ema21Cur) signal = "BUY";
  if (ema13Prv > ema21Prv && ema13Cur <= ema21Cur) signal = "SELL";

  return { signal, ema13: ema13Cur, ema21: ema21Cur };
}

// ── Ambil top-N symbols berdasarkan volume ────────────────────────
async function getTopSymbols(exchange: string, topN: number, whitelist: string[]): Promise<string[]> {
  if (whitelist.length > 0) return whitelist;

  if (exchange === "bybit") {
    const res = await fetch("https://api.bybit.com/v5/market/tickers?category=spot");
    const data = await res.json();
    const tickers = (data.result?.list || []) as Array<{ symbol: string; turnover24h: string }>;
    return tickers
      .filter(t => t.symbol.endsWith("USDT"))
      .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
      .slice(0, topN)
      .map(t => t.symbol);
  } else {
    const res = await fetch("https://api.binance.com/api/v3/ticker/24hr");
    const data = await res.json() as Array<{ symbol: string; quoteVolume: string }>;
    return data
      .filter(t => t.symbol.endsWith("USDT"))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, topN)
      .map(t => t.symbol);
  }
}

// ── Eksekusi order ke Bybit (SIMULATION jika no real key) ─────────
async function placeOrder(
  exchange: string,
  symbol: string,
  side: "BUY" | "SELL",
  amountUsdt: number,
  price: number,
  apiKey: string,
  apiSecret: string,
): Promise<{ orderId: string; status: string; errorMsg?: string }> {
  // SIMULATION MODE
  if (isSimulation(apiKey)) {
    return { orderId: `SIM_${Date.now()}`, status: "SIMULATED" };
  }

  // ── Real order (Bybit spot market) ───────────────────────────────
  if (exchange === "bybit") {
    try {
      const qty = (amountUsdt / price).toFixed(6);
      const timestamp = Date.now().toString();
      const recvWindow = "5000";
      const paramStr = `${timestamp}${apiKey}${recvWindow}{"category":"spot","symbol":"${symbol}","side":"${side === "BUY" ? "Buy" : "Sell"}","orderType":"Market","qty":"${qty}"}`;

      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(paramStr));
      const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

      const res = await fetch("https://api.bybit.com/v5/order/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BAPI-API-KEY": apiKey,
          "X-BAPI-SIGN": signature,
          "X-BAPI-TIMESTAMP": timestamp,
          "X-BAPI-RECV-WINDOW": recvWindow,
        },
        body: JSON.stringify({ category: "spot", symbol, side: side === "BUY" ? "Buy" : "Sell", orderType: "Market", qty }),
      });
      const data = await res.json();
      if (data.retCode === 0) {
        return { orderId: data.result?.orderId || "BYBIT_OK", status: "FILLED" };
      }
      return { orderId: "", status: "ERROR", errorMsg: data.retMsg };
    } catch (e: unknown) {
      return { orderId: "", status: "ERROR", errorMsg: String(e) };
    }
  }

  // ── Real order (Binance spot market) ─────────────────────────────
  try {
    const qty = (amountUsdt / price).toFixed(6);
    const timestamp = Date.now();
    const paramStr = `symbol=${symbol}&side=${side}&type=MARKET&quoteOrderQty=${amountUsdt}&timestamp=${timestamp}&recvWindow=5000`;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(paramStr));
    const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

    const res = await fetch(`https://api.binance.com/api/v3/order?${paramStr}&signature=${signature}`, {
      method: "POST",
      headers: { "X-MBX-APIKEY": apiKey },
    });
    const data = await res.json();
    if (data.orderId) return { orderId: String(data.orderId), status: "FILLED" };
    return { orderId: "", status: "ERROR", errorMsg: data.msg || "Binance error" };
  } catch (e: unknown) {
    return { orderId: "", status: "ERROR", errorMsg: String(e) };
  }
}

// ── Kirim notif Telegram ──────────────────────────────────────────
async function sendTelegramMsg(chatId: string, text: string): Promise<void> {
  if (!TG_BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (_) { /* silent */ }
}

// ── Format pesan sinyal ───────────────────────────────────────────
function formatTgMsg(side: "BUY" | "SELL", symbol: string, price: number, amountUsdt: number, status: string, ema13: number, ema21: number): string {
  const emoji = side === "BUY" ? "🟢" : "🔴";
  const statusEmoji = status === "FILLED" ? "✅" : status === "SIMULATED" ? "🔵" : "⚠️";
  return `${emoji} <b>${side} ${symbol}</b>
💵 Price: <code>$${price.toLocaleString("en-US", { maximumFractionDigits: 4 })}</code>
💰 Size: <code>$${amountUsdt} USDT</code>
📊 EMA13: <code>${ema13.toFixed(4)}</code> | EMA21: <code>${ema21.toFixed(4)}</code>
${statusEmoji} Status: <b>${status}</b>
⏰ ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`;
}

// ══════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  // Hanya izinkan dari Supabase Cron (internal) atau header khusus
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${SUPABASE_SERVICE_KEY}` && req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    // Allow internal supabase invocation (no auth header needed for cron)
    if (!authHeader && req.headers.get("x-supabase-edge-runtime")) {
      // OK
    } else if (authHeader !== `Bearer ${SUPABASE_SERVICE_KEY}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Ambil semua bot aktif
  const { data: configs, error } = await supabase
    .from("bot_configs")
    .select("*")
    .eq("is_active", true);

  if (error) {
    console.error("[Worker] Failed to fetch configs:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!configs || configs.length === 0) {
    return new Response(JSON.stringify({ status: "no_active_bots" }), { status: 200 });
  }

  const results: string[] = [];

  for (const cfg of configs) {
    const userId      = cfg.user_id;
    const exchange    = cfg.exchange || "bybit";
    const apiKey      = cfg.api_key  || "SIMULATION";
    const apiSecret   = cfg.api_secret || "SIMULATION";
    const amountUsdt  = parseFloat(cfg.trade_amount_usdt) || 10;
    const topN        = cfg.top_n_by_volume || 20;
    const whitelist   = cfg.symbols || [];
    const tgChatId    = cfg.telegram_chat_id || "";

    try {
      const symbols = await getTopSymbols(exchange, topN, whitelist);

      for (const symbol of symbols.slice(0, 30)) { // max 30 symbols per run
        try {
          let closes: number[] = [];
          let volume24h = 0;

          if (exchange === "bybit") {
            const klines = await fetchBybitKlines(symbol, "1", 30);
            closes = klines.map(k => parseFloat(String(k[4]))); // close price
            volume24h = klines.length > 0 ? parseFloat(String(klines[klines.length - 1][5])) : 0;
          } else {
            const klines = await fetchBinanceKlines(symbol, "1m", 30);
            closes = klines.map(k => parseFloat(String(k[4])));
            volume24h = klines.length > 0 ? parseFloat(String(klines[klines.length - 1][5])) : 0;
          }

          const { signal, ema13, ema21 } = detectSignal(closes);
          if (!signal) continue;

          const price = closes[closes.length - 1];

          // Eksekusi order
          const { orderId, status, errorMsg } = await placeOrder(exchange, symbol, signal, amountUsdt, price, apiKey, apiSecret);

          // Log ke DB
          await supabase.from("trades").insert({
            user_id:      userId,
            symbol,
            side:         signal,
            price,
            amount_usdt:  amountUsdt,
            ema13,
            ema21,
            volume_24h:   volume24h,
            order_id:     orderId,
            order_status: status,
            error_msg:    errorMsg || null,
            executed_at:  new Date().toISOString(),
          });

          // Kirim notif Telegram
          if (tgChatId && (status === "FILLED" || status === "SIMULATED")) {
            await sendTelegramMsg(tgChatId, formatTgMsg(signal, symbol, price, amountUsdt, status, ema13, ema21));
          }

          results.push(`${userId.slice(0, 8)}...:${symbol}:${signal}:${status}`);
        } catch (symErr: unknown) {
          console.warn(`[Worker] Error processing ${symbol}:`, symErr);
          // Log error ke DB
          await supabase.from("trades").insert({
            user_id:      userId,
            symbol,
            side:         "BUY",
            price:        0,
            amount_usdt:  amountUsdt,
            order_status: "ERROR",
            error_msg:    String(symErr),
            executed_at:  new Date().toISOString(),
          });
        }
      }
    } catch (cfgErr: unknown) {
      console.error(`[Worker] Error for user ${userId}:`, cfgErr);
    }
  }

  return new Response(JSON.stringify({ status: "done", trades: results.length, detail: results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
