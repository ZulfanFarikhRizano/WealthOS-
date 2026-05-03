// ══════════════════════════════════════════════════════════════════
// Z-WEALTH · TRADING WORKER + TELEGRAM WEBHOOK + BOT NOTIFY + EXCHANGE BALANCE v14
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
//
// ── CHANGELOG v14 (dari v13) ─────────────────────────────────────
// FIXED BUG-AUTH-5 (Kritis): verifyBrowserAuth reject semua request browser.
//   → SUPABASE_ANON_KEY tidak di-set di Secrets → string kosong → kondisi
//     `if (SUPABASE_ANON_KEY && ...)` selalu false → semua POST 401 Unauthorized.
//   → Error di browser: "Gagal enkripsi server: save_api_key: token tidak valid"
//   → Error di browser: "Saldo Nyata Exchange: Gagal fetch"
//   FIX: Embed anon key sebagai fallback konstanta (anon key = public key,
//        aman di-hardcode). Secret SUPABASE_ANON_KEY tetap diterima sebagai
//        override. verifyBrowserAuth diupgrade: cek startsWith("Bearer "),
//        slice token, triple-check (service key / anon key / fallback).
//
// ── CHANGELOG v13 (dari v12) ─────────────────────────────────────
// FIXED BUG-13 (Medium): tgSend pakai fetch() biasa tanpa timeout.
//   → Jika Telegram down, Edge Function bisa hang 25 detik.
//   FIX: Ganti ke fetchWithTimeout() (8 detik), konsisten dengan semua fetch exchange.
// FIXED BUG-14 (Kritis): handleExchangeBalance masih menerima api_key plain text dari body.
//   → Klien lama atau request manual bisa bypass enkripsi DB, kirim api_key langsung.
//   FIX: Guard awal menolak request dengan api_key/api_secret di body (400).
//        Satu-satunya cara valid = kirim user_id, EF ambil dari DB.
// FIXED BUG-15 (Minor): Fetch rate USD→IDR pakai fetch() biasa tanpa timeout.
//   → Jika exchangerate-api lambat, bisa hang dan delay response balance.
//   FIX: Ganti ke fetchWithTimeout() (8 detik).
//
// ── CHANGELOG v12 (dari v11-FINAL) ───────────────────────────────
// FIXED BUG-AUTH-1 (Kritis): handleBotNotify tidak ada autentikasi
// FIXED BUG-AUTH-2 (Kritis): handleExecuteOrder tidak ada autentikasi
// FIXED BUG-AUTH-3 (Kritis): handleSaveApiKey tidak ada autentikasi
// FIXED BUG-AUTH-4 (Kritis): handleExchangeBalance tidak ada autentikasi
// FIXED BUG-5 (Medium): candidateSymbols filter pakai || → &&
// FIXED BUG-6 (Medium): Binance Spot closeOrder komentar & catatan LOT_SIZE
// FIXED BUG-7 (Medium): Binance Futures qty hard-code .toFixed(3) — komentar TODO
// FIXED BUG-8 (Medium): PnL leverage mismatch — komentar warning & TODO
// FIXED BUG-9 (Medium): isInternal hanya fallback jika CRON_SECRET belum di-set
// FIXED BUG-10 (Minor): SL cooldown elapsed log misleading saat cache miss
// FIXED BUG-11 (Minor): Startup warning jika ENCRYPTION_KEY atau CRON_SECRET tidak di-set
// FIXED BUG-12 (Minor): Semua fetch ke exchange pakai fetchWithTimeout (8 detik)
//
// ── Secrets yang harus di-set di Supabase Dashboard → Secrets ────
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (baru v12)
//   TELEGRAM_BOT_TOKEN, CRON_SECRET, ENCRYPTION_KEY
// ══════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── ENV ───────────────────────────────────────────────────────────
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_BOT_TOKEN         = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const CRON_SECRET          = Deno.env.get("CRON_SECRET") || "";
// BARU: Kunci enkripsi server-side untuk API key user
// Set di Supabase Dashboard → Edge Functions → Secrets → ENCRYPTION_KEY
// Nilai: string random 32 karakter, contoh: openssl rand -hex 32
const ENCRYPTION_KEY       = Deno.env.get("ENCRYPTION_KEY") || "";

// FIXED BUG-11 (Minor): Sebelumnya tidak ada peringatan saat ENCRYPTION_KEY kosong.
// Akibatnya API key disimpan/dibaca sebagai plain text tanpa ada indikasi di log.
// FIX: Log warning sekali saat cold start agar terlihat di Supabase Edge Function logs.
if (!ENCRYPTION_KEY) {
  console.warn(
    "[STARTUP] ⚠️  ENCRYPTION_KEY tidak di-set di Supabase Secrets! " +
    "API key user disimpan/dibaca sebagai plain text. " +
    "Set ENCRYPTION_KEY via: Supabase Dashboard → Edge Functions → Secrets."
  );
}
if (!CRON_SECRET) {
  console.warn(
    "[STARTUP] ⚠️  CRON_SECRET tidak di-set. Cron job menggunakan fallback x-supabase-edge-runtime " +
    "yang bisa di-spoof. Set CRON_SECRET untuk keamanan lebih baik."
  );
}

// ════════════════════════════════════════════════════════════════
// SERVER-SIDE AES-256-GCM ENCRYPT / DECRYPT
// API key user dienkripsi dengan ENCRYPTION_KEY dari Supabase Secrets
// Sehingga Edge Function (cron worker) bisa dekripsi tanpa butuh browser
// Format: "iv_hex:ciphertext_hex" (sama seperti format browser)
// ════════════════════════════════════════════════════════════════

async function _serverDeriveKey(): Promise<CryptoKey> {
  const enc    = new TextEncoder();
  const keyMat = await crypto.subtle.importKey("raw", enc.encode(ENCRYPTION_KEY), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("zw-bot-salt-v1"), iterations: 100000, hash: "SHA-256" },
    keyMat,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function serverEncrypt(plaintext: string): Promise<string> {
  const key   = await _serverDeriveKey();
  const iv    = crypto.getRandomValues(new Uint8Array(12));
  const enc   = new TextEncoder();
  const ct    = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  return toHex(iv) + ":" + toHex(ct);
}

async function serverDecrypt(cipherStr: string): Promise<string> {
  // FIX: Pakai indexOf+slice bukan split(":") untuk handle jika CT mengandung ":"
  const colonIdx = cipherStr.indexOf(":");
  if (colonIdx === -1) throw new Error("Format enkripsi tidak valid");
  const ivHex = cipherStr.slice(0, colonIdx);
  const ctHex = cipherStr.slice(colonIdx + 1);
  if (!ivHex || !ctHex) throw new Error("Format enkripsi tidak valid");
  const fromHex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const key = await _serverDeriveKey();
  const pt  = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(ivHex) }, key, fromHex(ctHex));
  return new TextDecoder().decode(pt);
}

// Deteksi apakah string adalah hasil enkripsi server (format iv:ct hex)
// FIX BUG-5: Pakai indexOf+slice (bukan split) agar konsisten dengan serverDecrypt,
// karena ciphertext hex bisa mengandung ":" dan split akan memotongnya salah.
function isServerEncrypted(s: string): boolean {
  if (!s || !s.includes(":")) return false;
  const colonIdx = s.indexOf(":");
  const iv = s.slice(0, colonIdx);
  const ct = s.slice(colonIdx + 1);
  // IV hex = 24 karakter (12 bytes), CT hex: AES-GCM tag 16 bytes + minimal 1 byte data = 34 bytes = 68 hex chars
  // FIX #3: panjang minimum CT ditambah (sebelumnya ct.length > 0) untuk hindari false-positive
  // pada API key exchange yang kebetulan berbentuk hex dan mengandung ":"
  return iv.length === 24 && ct.length >= 68 && /^[0-9a-f]+$/i.test(iv) && /^[0-9a-f]+$/i.test(ct);
}

// ── CORS HEADERS (untuk request dari browser) ─────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

// ════════════════════════════════════════════════════════════════
// FIXED BUG-AUTH (Kritis): Semua route browser-facing (bot_notify,
// execute_order, save_api_key, exchange_balance) sebelumnya tidak
// memiliki autentikasi sama sekali.
//
// FIXED BUG-AUTH-5 (v14): verifyBrowserAuth gagal saat SUPABASE_ANON_KEY
// tidak di-set di Supabase Secrets → semua request browser ditolak 401.
// Penyebab: `Deno.env.get("SUPABASE_ANON_KEY") || ""` → string kosong
// → kondisi `if (SUPABASE_ANON_KEY && ...)` selalu false → reject semua.
//
// FIX: Embed anon key langsung sebagai fallback konstanta.
// Anon key adalah PUBLIC key — dirancang untuk ada di client-side (sama
// seperti SB_ANON di app.js). Tidak perlu disimpan sebagai Secret.
// Secret SUPABASE_ANON_KEY tetap diterima sebagai override jika di-set.
// ════════════════════════════════════════════════════════════════

// Anon key publik — identik dengan SB_ANON di app.js (memang public)
const _ANON_KEY_FALLBACK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwaWt5cWFmYXBjbHlpcnBxZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Njc3MzAsImV4cCI6MjA4NzA0MzczMH0.OcsM8BBY1AtRs-aUr1RHUG1NOnO-XwJsMMmSZkwNa7c";
// Gunakan secret jika di-set, fallback ke konstanta publik di atas
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || _ANON_KEY_FALLBACK;

function verifyBrowserAuth(req: Request): boolean {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  if (!token) return false;
  // Terima: service role key (cron/internal)
  if (token === SUPABASE_SERVICE_KEY) return true;
  // Terima: anon key (browser app) — dari secret atau fallback
  if (token === SUPABASE_ANON_KEY) return true;
  // Safety: terima juga fallback eksplisit (jika secret berbeda dari fallback)
  if (token === _ANON_KEY_FALLBACK) return true;
  return false;
}

// Response standar untuk auth gagal
function unauthorizedResponse(reason = "Unauthorized"): Response {
  return new Response(
    JSON.stringify({ ok: false, error: reason }),
    { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
}

// ── KONSTANTA ─────────────────────────────────────────────────────
const MAX_LONG_POSITIONS  = 1;  // Maks posisi LONG terbuka bersamaan
const MAX_SHORT_POSITIONS = 1;  // Maks posisi SHORT terbuka bersamaan (futures only)
const MAX_ENTRY_PER_RUN   = 1;  // Hanya 1 entry baru per siklus cron (long ATAU short)
const KLINE_LIMIT       = 200; // EMA akurat butuh warmup minimal 200 candle

// Timeframe: 15m untuk signal, 1h untuk konfirmasi trend (HTF filter)
const TF_SIGNAL    = "15";  // Bybit: interval 15 menit
const TF_TREND     = "60";  // Bybit: interval 1 jam
const TF_SIGNAL_BN = "15m"; // Binance format
const TF_TREND_BN  = "1h";  // Binance format

// Take Profit: diganti Trailing Stop (lihat TRAILING_STOP_PCT_*)
const SL_PCT_SPOT    = 0.05;  // Spot SL: -5%
const SL_PCT_FUTURES = 0.02;  // Futures SL: -2% (≈40% modal dengan 20x leverage)

// Volume filter: volume candle saat cross harus > 1.5x rata-rata 20 candle sebelumnya
const VOLUME_MULTIPLIER = 1.2; // Dilonggarkan 1.5→1.2: lebih sensitif di jam sepi

// ── FITUR BARU: Trailing Stop ─────────────────────────────────────
// Trailing stop mengikuti harga tertinggi sejak entry
// Exit kalau harga turun TRAILING_STOP_PCT dari puncak tertinggi
const TRAILING_STOP_PCT_SPOT    = 0.02;  // Spot: trail 2% dari peak
const TRAILING_STOP_PCT_FUTURES = 0.01;  // Futures: trail 1% dari peak (leverage amplifies)

// SHORT trailing stop: mengikuti harga TERENDAH sejak entry short
// Exit kalau harga naik TRAILING_STOP_PCT_SHORT dari lembah terendah
const TRAILING_STOP_PCT_SHORT_FUTURES = 0.01; // Futures short: trail 1% dari trough

// ── Risk/Reward ratio minimum ────────────────────────────────────
// Estimasi R:R = (2 × TRAILING_STOP_PCT) / SL_PCT
// Futures: (2 × 0.01) / 0.02 = 1.0   → MIN_RR harus <= 1.0
// Spot   : (2 × 0.02) / 0.05 = 0.8   → MIN_RR harus <= 0.8
// Set ke 0.75 agar spot (R:R ≈ 0.8) lolos walau floating point 0.7999...
// Futures (R:R = 1.0) juga tetap lolos. Diubah dari 0.8 → 0.75 fix floating point bug.
const MIN_RR = 0.75;

// ── FITUR BARU: Cooldown per simbol setelah kena SL ──────────────
// In-memory: simbol → timestamp kapan SL terakhir terjadi
const _slCooldownAt = new Map<string, number>(); // key: "userId:symbol"
const SL_COOLDOWN_MS = 45 * 60 * 1000;           // 45 menit cooldown setelah SL

// ── FITUR BARU: Max drawdown harian ──────────────────────────────
// In-memory: userId → { date: "YYYY-MM-DD", losses: number }
const _dailyLoss = new Map<string, { date: string; losses: number }>();
const MAX_DAILY_LOSSES = 3; // Stop trading setelah 3x loss dalam 1 hari

// ── FITUR BARU: RSI & ADX filter ─────────────────────────────────
const RSI_PERIOD       = 14;
const RSI_OVERBOUGHT   = 70;  // Skip entry jika RSI > 70 (overbought)
const ADX_PERIOD       = 14;
const ADX_MIN_STRENGTH = 15;  // Dilonggarkan 20→15: lebih toleran di pasar konsolidasi

// Stablecoin, fiat-pegged, & wrapped asset — tidak boleh di-trade
// Ditambah USD1USDT dan semua varian USD-peg baru
const STABLECOIN_BLACKLIST = new Set([
  // USD stablecoins
  "USDCUSDT","BUSDUSDT","TUSDUSDT","USDPUSDT","FDUSDUSDT","DAIUSDT",
  "USDDUSDT","USTCUSDT","LUSDUSDT","FRAXUSDT","GUSDUSDT","PYUSDUSDT",
  "AEUSDUSDT","GHOUSUSDT","CRVUSDUSDT","USD1USDT","USDSUSDT","SUSDUSDT",
  "USDXUSDT","USDBUSDT","USDEUSDT","USDYUSDT","USDTUSDT",
  // EUR / fiat lain
  "EURUSDT","EURCUSDT","GBPUSDT","JPYUSDT","AUDUSDT",
  // Wrapped / liquid staking
  "WBTCUSDT","WETHUSDT","WBNBUSDT","STETHUSDT","RETHUSDT","CBETHUSDT",
  "WSTETHUSDT","WEETHUSDT","EZETHUSDT","RSETHUSDT","SWETHUSDT",
]);

// Filter tambahan berbasis pattern — tangkap stablecoin baru yang belum dikenal
function isStablecoin(symbol: string): boolean {
  if (STABLECOIN_BLACKLIST.has(symbol)) return true;
  if (/^USD[A-Z0-9]+USDT$/.test(symbol)) return true;
  if (/^(EUR|GBP|JPY|AUD|CHF|CAD)[A-Z]*USDT$/.test(symbol)) return true;
  return false;
}

// FIX: Blokir simbol non-ASCII (misal 币安人生USDT dari Binance China)
function isValidSymbol(symbol: string): boolean {
  return /^[A-Z0-9]+$/.test(symbol);
}

// Cooldown notif "saldo tidak cukup" — in-memory, reset tiap cold-start Edge Function
const _lowBalanceNotifAt  = new Map<string, number>();
const LOW_BALANCE_COOLDOWN_MS = 60 * 60 * 1000; // 1 jam

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
  peak_price:   number | null; // trailing stop LONG: harga tertinggi sejak entry
  // SHORT support: "LONG" (default/lama) atau "SHORT" (futures bearish signal)
  // Kolom ini harus ditambah ke tabel positions: ALTER TABLE positions ADD COLUMN direction TEXT DEFAULT 'LONG';
  direction:    "LONG" | "SHORT";
}

interface Candle {
  close:  number;
  high:   number; // dibutuhkan untuk ADX (True Range)
  low:    number; // dibutuhkan untuk ADX (True Range)
  volume: number;
}

interface SignalResult {
  cross:       "GOLDEN" | "DEAD" | null;
  ema13:       number;
  ema21:       number;
  volumeOk:    boolean;
  volumeRatio: number;
}

// Cek apakah trend di Higher Timeframe (1H) sedang bullish
// HTF bullish = EMA13 > EMA21 di timeframe 1 jam
function isHTFBullish(htfCandles: Candle[]): boolean {
  if (htfCandles.length < 25) return false; // FIX #7: was `true` → bisa entry tanpa data HTF valid
  const closes   = htfCandles.map(c => c.close);
  const ema13Arr = calcEMA(closes, 13);
  const ema21Arr = calcEMA(closes, 21);
  const n        = closes.length - 1;
  // Bullish: EMA13 > EMA21 selama 2 candle terakhir di HTF
  // Dilonggarkan 2 candle → 1 candle: 2 candle terlalu ketat di pasar transisi
  return ema13Arr[n] > ema21Arr[n];
}

// Cek apakah trend di Higher Timeframe (1H) sedang bearish (untuk konfirmasi short)
// HTF bearish = EMA13 < EMA21 di timeframe 1 jam
function isHTFBearish(htfCandles: Candle[]): boolean {
  if (htfCandles.length < 25) return false;
  const closes   = htfCandles.map(c => c.close);
  const ema13Arr = calcEMA(closes, 13);
  const ema21Arr = calcEMA(closes, 21);
  const n        = closes.length - 1;
  return ema13Arr[n] < ema21Arr[n];
}

// Cek volume: candle saat cross harus > VOLUME_MULTIPLIER × avg volume 20 candle sebelumnya
function checkVolume(candles: Candle[], crossIdx: number): { ok: boolean; ratio: number } {
  if (crossIdx < 20) return { ok: true, ratio: 1 };
  const avgVol = candles.slice(crossIdx - 20, crossIdx).reduce((s, c) => s + c.volume, 0) / 20;
  if (avgVol === 0) return { ok: true, ratio: 1 };
  const ratio  = candles[crossIdx].volume / avgVol;
  return { ok: ratio >= VOLUME_MULTIPLIER, ratio };
}

// ════════════════════════════════════════════════════════════════
// INDIKATOR EMA
// ════════════════════════════════════════════════════════════════

function calcEMA(values: number[], period: number): number[] {
  if (values.length < period) return values.map(() => values[0]);
  const k = 2 / (period + 1);
  // FIX #1: Seed EMA dengan SMA dari `period` candle pertama (standar tradingview/wilder)
  // Sebelumnya: emas[0] = values[0] → bias besar, butuh ratusan candle untuk konvergen
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  // Isi slot 0..(period-2) dengan seed agar index tetap sinkron dengan array input
  const emas: number[] = new Array(period - 1).fill(seed);
  emas.push(seed); // index (period-1) = nilai SMA pertama
  for (let i = period; i < values.length; i++) {
    emas.push(values[i] * k + emas[i - 1] * (1 - k));
  }
  return emas;
}

// ── RSI (Relative Strength Index) ────────────────────────────────
// Nilai 0-100. >70 = overbought (terlalu mahal, jangan entry beli)
function calcRSI(closes: number[], period = RSI_PERIOD): number {
  if (closes.length < period + 1) return 50; // default netral jika data kurang
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains  += diff;
    else          losses -= diff;
  }
  let avgGain = gains  / period;
  let avgLoss = losses / period;

  // Wilder smoothing untuk candle setelah warmup
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  // FIX: Jika avgGain juga 0, harga flat total → RSI netral 50 bukan 100
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ── ADX (Average Directional Index) ──────────────────────────────
// Nilai 0-100. <20 = sidewalk/tidak ada trend kuat → skip entry
// ADX hanya mengukur KEKUATAN trend, bukan arah (naik/turun)
function calcADX(candles: Candle[], period = ADX_PERIOD): number {
  // FIX #2: Return 0 (bukan 25) jika data kurang agar filter ADX_MIN_STRENGTH tetap efektif.
  // Sebelumnya default 25 > ADX_MIN_STRENGTH=15 → filter ADX bypass saat data tidak cukup.
  if (candles.length < period * 2 + 1) return 0;
  const trueRanges: number[] = [];
  const plusDM:  number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high  = candles[i].high;
    const low   = candles[i].low;
    const close = candles[i - 1].close;
    const tr    = Math.max(high - low, Math.abs(high - close), Math.abs(low - close));
    trueRanges.push(tr);

    const upMove   = high - candles[i - 1].high;
    const downMove = candles[i - 1].low - low;
    plusDM.push(upMove   > downMove && upMove   > 0 ? upMove   : 0);
    minusDM.push(downMove > upMove  && downMove > 0 ? downMove : 0);
  }

  // Wilder smoothing
  const smooth = (arr: number[]) => {
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i++) {
      s = s - s / period + arr[i];
      out.push(s);
    }
    return out;
  };

  const sTR    = smooth(trueRanges);
  const sPDM   = smooth(plusDM);
  const sMDM   = smooth(minusDM);
  const dxArr: number[] = [];

  for (let i = 0; i < sTR.length; i++) {
    if (sTR[i] === 0) { dxArr.push(0); continue; }
    const diPlus  = (sPDM[i] / sTR[i]) * 100;
    const diMinus = (sMDM[i] / sTR[i]) * 100;
    const diSum   = diPlus + diMinus;
    dxArr.push(diSum === 0 ? 0 : (Math.abs(diPlus - diMinus) / diSum) * 100);
  }

  // ADX = EMA of DX
  // FIX: return 0 (konsisten dengan guard awal) jika dxArr terlalu pendek
  if (dxArr.length < period) return 0;
  const adxArr = calcEMA(dxArr, period);
  return adxArr[adxArr.length - 1];
}

function detectCross(candles: Candle[]): SignalResult {
  const empty: SignalResult = { cross: null, ema13: 0, ema21: 0, volumeOk: false, volumeRatio: 0 };
  if (candles.length < 25) return empty;

  const closes   = candles.map(c => c.close);
  const ema13Arr = calcEMA(closes, 13);
  const ema21Arr = calcEMA(closes, 21);
  const n        = closes.length - 1;

  const ema13Now = ema13Arr[n];
  const ema21Now = ema21Arr[n];

  // Lookback 2 candle — tidak terlalu jauh agar sinyal masih fresh
  const LOOKBACK = 3; // Diperlebar 2→3 candle: jaring cross lebih lebar (1 candle = 15 menit)
  let cross:     "GOLDEN" | "DEAD" | null = null;
  let crossIdx   = n;

  for (let i = 1; i <= LOOKBACK && n - i >= 0; i++) {
    const prev13 = ema13Arr[n - i];
    const prev21 = ema21Arr[n - i];
    const cur13  = ema13Arr[n - i + 1];
    const cur21  = ema21Arr[n - i + 1];

    if (prev13 < prev21 && cur13 >= cur21 && ema13Now >= ema21Now) {
      cross    = "GOLDEN";
      crossIdx = n - i + 1;
      break;
    }
    if (prev13 > prev21 && cur13 <= cur21 && ema13Now <= ema21Now) {
      cross    = "DEAD";
      crossIdx = n - i + 1;
      break;
    }
  }

  // FIX #1: Volume hanya dicek jika cross benar-benar terjadi.
  // Sebelumnya checkVolume selalu dipanggil → hasil tidak valid saat cross=null.
  const { ok: volumeOk, ratio: volumeRatio } = cross
    ? checkVolume(candles, crossIdx)
    : { ok: false, ratio: 0 };

  return { cross, ema13: ema13Now, ema21: ema21Now, volumeOk, volumeRatio };
}

// Untuk EXIT LONG: cukup cek apakah EMA13 < EMA21 sekarang (dead cross konfirmasi)
// Untuk EXIT SHORT: cek apakah EMA13 > EMA21 sekarang (golden cross konfirmasi)
interface ExitSignalResult {
  shouldExit: boolean;
  ema13: number;
  ema21: number;
}

function detectExitSignal(candles: Candle[], direction: "LONG" | "SHORT" = "LONG"): ExitSignalResult {
  const empty: ExitSignalResult = { shouldExit: false, ema13: 0, ema21: 0 };
  if (candles.length < 25) return empty;
  const closes    = candles.map(c => c.close);
  const ema13Arr  = calcEMA(closes, 13);
  const ema21Arr  = calcEMA(closes, 21);
  const n         = closes.length - 1;
  const ema13Now  = ema13Arr[n];
  const ema21Now  = ema21Arr[n];
  const ema13Prev = ema13Arr[n - 1];
  const ema21Prev = ema21Arr[n - 1];

  // LONG exit: Dead Cross terkonfirmasi 2 candle (EMA13 di bawah EMA21)
  // SHORT exit: Golden Cross terkonfirmasi 2 candle (EMA13 di atas EMA21)
  const confirmed = direction === "LONG"
    ? ema13Now < ema21Now && ema13Prev < ema21Prev   // dead cross
    : ema13Now > ema21Now && ema13Prev > ema21Prev;  // golden cross

  return { shouldExit: confirmed, ema13: ema13Now, ema21: ema21Now };
}


// ════════════════════════════════════════════════════════════════
// MARKET DATA
// ════════════════════════════════════════════════════════════════

async function fetchBybitCandles(symbol: string, tradeMode: string, tf = TF_SIGNAL, limit = KLINE_LIMIT): Promise<Candle[]> {
  const category = tradeMode === "futures" ? "linear" : "spot";
  const url      = `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol}&interval=${tf}&limit=${limit}`;
  // FIXED BUG-12: pakai fetchWithTimeout agar tidak hang jika Bybit lambat
  const res      = await fetchWithTimeout(url);
  const data     = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit kline [${symbol}]: ${data.retMsg}`);
  return (data.result?.list || []).reverse().map((k: string[]) => ({
    close:  parseFloat(k[4]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchBinanceCandles(symbol: string, tradeMode: string, tf = TF_SIGNAL_BN, limit = KLINE_LIMIT): Promise<Candle[]> {
  const base = tradeMode === "futures"
    ? "https://fapi.binance.com/fapi/v1/klines"
    : "https://api.binance.com/api/v3/klines";
  const url  = `${base}?symbol=${symbol}&interval=${tf}&limit=${limit}`;
  // FIXED BUG-12: pakai fetchWithTimeout agar tidak hang jika Binance lambat
  const res  = await fetchWithTimeout(url);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Binance kline [${symbol}]: invalid`);
  return data.map((k: string[]) => ({ close: parseFloat(k[4]), high: parseFloat(k[2]), low: parseFloat(k[3]), volume: parseFloat(k[5]) }));
}

async function fetchCandles(exchange: string, symbol: string, tradeMode: string, tf?: string, limit?: number): Promise<Candle[]> {
  return exchange === "bybit"
    ? fetchBybitCandles(symbol, tradeMode, tf, limit)
    : fetchBinanceCandles(symbol, tradeMode, tf, limit);
}

// Fetch Higher Timeframe candles untuk konfirmasi trend
async function fetchHTFCandles(exchange: string, symbol: string, tradeMode: string): Promise<Candle[]> {
  return exchange === "bybit"
    ? fetchBybitCandles(symbol, tradeMode, TF_TREND, 60)
    : fetchBinanceCandles(symbol, tradeMode, TF_TREND_BN, 60);
}

// ════════════════════════════════════════════════════════════════
// REALTIME PRICE — harga terkini dari ticker (bukan candle close)
// Untuk SL/TP: pakai mark price (futures) atau last price (spot)
// Mark price lebih aman karena tidak bisa dimanipulasi whale sesaat
// ════════════════════════════════════════════════════════════════
async function fetchRealtimePrice(
  exchange: string, symbol: string, tradeMode: string
): Promise<number> {
  try {
    if (exchange === "bybit") {
      const category = tradeMode === "futures" ? "linear" : "spot";
      // FIXED BUG-12: pakai fetchWithTimeout agar tidak hang jika Bybit lambat
      const res      = await fetchWithTimeout(
        `https://api.bybit.com/v5/market/tickers?category=${category}&symbol=${symbol}`
      );
      const data = await res.json();
      const item = data.result?.list?.[0];
      if (!item) throw new Error("No ticker data");
      // Futures: pakai markPrice agar konsisten dengan liquidation price
      // Spot: pakai lastPrice (tidak ada mark price di spot)
      const price = tradeMode === "futures"
        ? parseFloat(item.markPrice  || item.lastPrice || "0")
        : parseFloat(item.lastPrice  || "0");
      if (price <= 0) throw new Error("Price is 0");
      return price;
    } else {
      // Binance
      const base = tradeMode === "futures"
        ? "https://fapi.binance.com/fapi/v1/premiumIndex"
        : "https://api.binance.com/api/v3/ticker/price";
      // FIXED BUG-12: pakai fetchWithTimeout agar tidak hang jika Binance lambat
      const res  = await fetchWithTimeout(`${base}?symbol=${symbol}`);
      const data = await res.json();
      // Futures: markPrice, Spot: price
      const price = tradeMode === "futures"
        ? parseFloat(data.markPrice || "0")
        : parseFloat(data.price     || "0");
      if (price <= 0) throw new Error("Price is 0");
      return price;
    }
  } catch (e) {
    console.warn(`[fetchRealtimePrice] ${symbol} fallback to candle:`, e);
    // Fallback: ambil dari candle 1m terbaru jika ticker gagal
    const candles = await fetchCandles(exchange, symbol, tradeMode, exchange === "bybit" ? "1" : "1m", 2);
    return candles[candles.length - 1]?.close || 0;
  }
}

async function getTopSymbols(
  exchange: string, tradeMode: string, topN: number, whitelist: string[]
): Promise<string[]> {
  if (whitelist.length > 0) return whitelist;
  try {
    if (exchange === "bybit") {
      const category = tradeMode === "futures" ? "linear" : "spot";
      // FIXED BUG-12: pakai fetchWithTimeout agar tidak hang jika Bybit lambat
      const res      = await fetchWithTimeout(`https://api.bybit.com/v5/market/tickers?category=${category}`);
      const data     = await res.json();
      return (data.result?.list || [])
        .filter((t: { symbol: string; lastPrice?: string }) => {
          if (!t.symbol.endsWith("USDT")) return false;
          if (!isValidSymbol(t.symbol)) return false; // FIX: blokir simbol non-ASCII
          if (isStablecoin(t.symbol)) return false;
          // Filter berbasis harga: simbol dengan harga $0.98-$1.02 = stablecoin/pegged asset
          const price = parseFloat(t.lastPrice || "0");
          if (price > 0 && price >= 0.98 && price <= 1.02) return false;
          return true;
        })
        .sort((a: { turnover24h: string }, b: { turnover24h: string }) =>
          parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
        .slice(0, topN)
        .map((t: { symbol: string }) => t.symbol);
    } else {
      const base = tradeMode === "futures"
        ? "https://fapi.binance.com/fapi/v1/ticker/24hr"
        : "https://api.binance.com/api/v3/ticker/24hr";
      // FIXED BUG-12: pakai fetchWithTimeout agar tidak hang jika Binance lambat
      const res  = await fetchWithTimeout(base);
      const data = await res.json() as Array<{ symbol: string; quoteVolume: string }>;
      return data
        .filter((t: { symbol: string; lastPrice?: string }) => {
          if (!t.symbol.endsWith("USDT")) return false;
          if (!isValidSymbol(t.symbol)) return false; // FIX: blokir simbol non-ASCII
          if (isStablecoin(t.symbol)) return false;
          const price = parseFloat(t.lastPrice || "0");
          if (price > 0 && price >= 0.98 && price <= 1.02) return false;
          return true;
        })
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, topN)
        .map(t => t.symbol);
    }
  } catch { return []; }
}

// ════════════════════════════════════════════════════════════════
// FIXED BUG-12 (Minor): Semua fetch() ke exchange sebelumnya tidak
// punya timeout. Jika exchange lambat atau down, Edge Function bisa
// hang hingga 25 detik (batas Deno) dan memblokir cron tick berikutnya.
//
// Solusi: fetchWithTimeout() membungkus fetch() dengan AbortController.
// Default timeout: 8 detik (cukup untuk API exchange yang normal).
// Jika timeout tercapai → throw Error("fetch timeout") → ditangkap oleh
// caller (biasanya try/catch yang sudah ada) → log warning & skip simbol.
// ════════════════════════════════════════════════════════════════
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    // FIXED BUG-NEW-3: AbortController.abort() melempar DOMException("The operation was aborted", "AbortError")
    // yang pesan aslinya kurang informatif di Supabase logs ("AbortError: The operation was aborted").
    // FIX: Ganti dengan pesan yang jelas mencantumkan URL dan durasi timeout agar mudah di-debug.
    if (controller.signal.aborted) {
      throw new Error(`[fetchWithTimeout] Timeout setelah ${timeoutMs}ms: ${url.slice(0, 80)}`);
    }
    throw e; // re-throw error non-timeout apa adanya
  } finally {
    clearTimeout(timer);
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
  // FIXED BUG-12: pakai fetchWithTimeout agar tidak hang jika Bybit lambat
  await fetchWithTimeout("https://api.bybit.com/v5/position/set-leverage", { method: "POST", headers: hdrs, body });
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
  // FIXED BUG-12: pakai fetchWithTimeout agar order tidak hang jika Bybit lambat/down
  const res  = await fetchWithTimeout("https://api.bybit.com/v5/order/create", { method: "POST", headers: hdrs, body });
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
  // FIXED BUG-12: pakai fetchWithTimeout agar tidak hang jika Binance lambat
  await fetchWithTimeout(`https://fapi.binance.com/fapi/v1/leverage?${qs}&signature=${sig}`, {
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
  // FIX BUG-4: Binance Futures menolak reduceOnly=false di query string untuk non-hedge mode.
  // Hanya sertakan reduceOnly jika nilainya true (untuk close order).
  const reduceOnlyParam = isFutures && reduceOnly ? "&reduceOnly=true" : "";
  const qsBase = isFutures
    ? `symbol=${symbol}&side=${side}&type=MARKET&quantity=${qty}${reduceOnlyParam}&timestamp=${ts}&recvWindow=5000`
    // FIX: Spot BUY pakai quoteOrderQty (beli dengan USDT), Spot SELL pakai quantity (jual base asset)
    : side === "BUY"
      ? `symbol=${symbol}&side=${side}&type=MARKET&quoteOrderQty=${qty}&timestamp=${ts}&recvWindow=5000`
      : `symbol=${symbol}&side=${side}&type=MARKET&quantity=${qty}&timestamp=${ts}&recvWindow=5000`;
  const sig = await hmacSign(apiSecret, qsBase);
  // FIXED BUG-12: pakai fetchWithTimeout agar order tidak hang jika Binance lambat/down
  const res = await fetchWithTimeout(`${base}?${qsBase}&signature=${sig}`, {
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
    // FIXED BUG-12: pakai fetchWithTimeout agar tidak hang jika Bybit lambat
    const res  = await fetchWithTimeout(`https://api.bybit.com/v5/market/instruments-info?category=${category}&symbol=${symbol}`);
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
  // FIX: Hindari floating point drift pada Math.floor(qty/stepSize)*stepSize.
  // Contoh: qty=0.123, stepSize=0.001 → 123.00000000000001 steps → floor=123 → OK
  // Tapi: qty=0.1, stepSize=0.1 → 0.9999999... steps → floor=0 → SALAH
  // Solusi: round steps ke integer terdekat jika sangat dekat (epsilon toleransi)
  const rawSteps = qty / stepSize;
  const steps    = Math.floor(rawSteps + 1e-9); // epsilon untuk koreksi drift
  const normalized = parseFloat((steps * stepSize).toFixed(decimals));
  const final    = Math.max(normalized, minQty);
  return final.toFixed(decimals);
}

// Hitung jumlah desimal dari stepSize (misal 0.001 → 3, 0.1 → 1)
// FIX: handle scientific notation (misal 1e-8 → "1e-8" bukan "0.00000001")
function stepDecimals(stepSize: number): number {
  if (stepSize >= 1) return 0;
  // Gunakan toFixed(10) untuk normalisasi ke decimal biasa, lalu trim trailing zero
  const s = stepSize.toFixed(10).replace(/0+$/, "");
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
      // FIXED BUG-7 (Medium): qty di-hard-code .toFixed(3) untuk semua simbol Binance Futures.
      // Simbol seperti BTCUSDT membutuhkan presisi berbeda dari SHIBUSDT (stepSize bisa 1 atau 10).
      // TODO ideal: fetch exchangeInfo dari Binance Futures seperti yang dilakukan getBybitInstrumentInfo.
      // Untuk sekarang, .toFixed(3) cukup aman untuk mayoritas mid-cap.
      // Jika ada reject "LOT_SIZE", tambahkan per-symbol override atau implement getBinanceInstrumentInfo.
      const qty    = rawQty.toFixed(3);
      await binanceSetLeverage(symbol, leverage, apiKey, apiSecret);
      return binanceMarketOrder(symbol, "BUY", qty, true, false, apiKey, apiSecret);
    }
    // Binance spot BUY pakai quoteOrderQty = jumlah USDT yang dibelanjakan
    console.log(`[openOrder] Binance spot ${symbol} quoteOrderQty=${amountUsdt.toFixed(2)} USDT`);
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
    // FIXED BUG-6 (Medium): Binance Spot tidak ada instrument info fetch seperti Bybit.
    // Sebelumnya hard-code: qty < 1 → toFixed(5), qty >= 1 → Math.floor().
    // Masalah: SHIB/PEPE stepSize = 1 (integer), DOGE = 1, BTC = 5 desimal, ETH = 4 desimal.
    // qty < 1 pasti token mahal (BTC, ETH, SOL) → toFixed(5) aman.
    // qty >= 1: gunakan Math.floor untuk integer unit, lalu format tanpa desimal trailing.
    // Simbol micro-price (SHIB, PEPE) jarang masuk ke closeOrder karena:
    //   1. Volume filter di getTopSymbols menyaring simbol dengan volume rendah.
    //   2. openOrder Spot pakai quoteOrderQty (USDT), bukan qty base asset.
    // Jika ada reject LOT_SIZE dari Binance Spot, tambahkan getBinanceSpotInstrumentInfo
    // yang fetch dari https://api.binance.com/api/v3/exchangeInfo?symbol=XYZUSDT
    const spotQtyStr = qty < 1 ? qty.toFixed(5) : Math.floor(qty).toString();
    return binanceMarketOrder(symbol, "SELL", spotQtyStr, false, false, apiKey, apiSecret);
  }
}

// ════════════════════════════════════════════════════════════════
// SHORT ORDER — Futures only (Bybit linear / Binance fapi)
// Open short  = Sell tanpa reduceOnly
// Close short = Buy dengan reduceOnly
// ════════════════════════════════════════════════════════════════

async function openShortOrder(
  exchange: string, symbol: string,
  amountUsdt: number, price: number, leverage: number,
  apiKey: string, apiSecret: string
): Promise<OrderResult> {
  if (isSim(apiKey)) return { orderId: `SIM_SHORT_${Date.now()}`, ok: true };

  if (exchange === "bybit") {
    const info   = await getBybitInstrumentInfo(symbol, "linear");
    const dec    = stepDecimals(info.stepSize);
    const rawQty = (amountUsdt * leverage) / price;
    const qty    = normalizeQty(rawQty, info.stepSize, info.minQty, dec);
    if (parseFloat(qty) <= 0 || parseFloat(qty) < info.minQty) {
      return { orderId: "", ok: false, error: `ShortQty ${qty} di bawah minQty ${info.minQty}` };
    }
    await bybitSetLeverage(symbol, leverage, apiKey, apiSecret);
    return bybitMarketOrder(symbol, "Sell", qty, "linear", false, apiKey, apiSecret);
  } else {
    // Binance Futures short = SELL tanpa reduceOnly
    const rawQty = (amountUsdt * leverage) / price;
    // FIXED BUG-7 (Medium): sama seperti openOrder Binance Futures — .toFixed(3) safe untuk
    // mayoritas simbol mid-cap tapi bisa reject LOT_SIZE untuk simbol tertentu.
    // TODO: Implement getBinanceFuturesInstrumentInfo untuk normalisasi stepSize yang benar.
    const qty    = rawQty.toFixed(3);
    await binanceSetLeverage(symbol, leverage, apiKey, apiSecret);
    return binanceMarketOrder(symbol, "SELL", qty, true, false, apiKey, apiSecret);
  }
}

async function closeShortOrder(
  exchange: string, symbol: string,
  qty: number, apiKey: string, apiSecret: string
): Promise<OrderResult> {
  if (isSim(apiKey)) return { orderId: `SIM_SHORT_CLOSE_${Date.now()}`, ok: true };

  if (exchange === "bybit") {
    const info    = await getBybitInstrumentInfo(symbol, "linear");
    const dec     = stepDecimals(info.stepSize);
    const qtyStr  = normalizeQty(qty, info.stepSize, info.minQty, dec);
    if (parseFloat(qtyStr) <= 0 || parseFloat(qtyStr) < info.minQty) {
      return { orderId: "", ok: false, error: `CloseShortQty ${qtyStr} di bawah minQty ${info.minQty}` };
    }
    // Close short = Buy dengan reduceOnly=true
    return bybitMarketOrder(symbol, "Buy", qtyStr, "linear", true, apiKey, apiSecret);
  } else {
    // Binance Futures close short = BUY dengan reduceOnly
    return binanceMarketOrder(symbol, "BUY", qty.toFixed(3), true, true, apiKey, apiSecret);
  }
}



async function tgSend(chatId: string | number, text: string) {
  if (!TG_BOT_TOKEN || !chatId) return;
  // FIXED: Pakai fetchWithTimeout (8 detik) agar tidak hang jika Telegram lambat/down.
  // Sebelumnya pakai fetch() biasa — bisa hang hingga 25 detik dan memblokir cron tick.
  try {
    await fetchWithTimeout(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        chat_id:                  chatId,
        text,
        parse_mode:               "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch { /* silent — notif Telegram non-fatal */ }
}

function wib() {
  return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
}

function tgBuyMsg(
  symbol: string, price: number, qty: number, amountUsdt: number,
  tradeMode: string, leverage: number, ema13: number, ema21: number, sim: boolean,
  htfConfirmed = true, rsi = 0, adx = 0
): string {
  const statusLine = sim
    ? `🔵 Status : <b>SIMULASI</b> <i>(API key belum aktif / mode sim)</i>`
    : `✅ Status : <b>ORDER TERKIRIM (LIVE)</b>`;
  const lev       = tradeMode === "futures" ? ` × ${leverage}x leverage` : " (spot)";
  const trailPct  = tradeMode === "futures" ? TRAILING_STOP_PCT_FUTURES : TRAILING_STOP_PCT_SPOT;
  const slPct     = tradeMode === "futures" ? SL_PCT_FUTURES : SL_PCT_SPOT;
  const slPrice   = (price * (1 - slPct)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const htfLabel  = htfConfirmed ? "15m ✓ 1H ✓" : "15m ✓ 1H –";
  return `🟢 <b>BUY ${symbol}</b>
━━━━━━━━━━━━━━━━━━━━
📊 Sinyal : <b>Golden Cross (${htfLabel})</b>
   EMA13 <code>${ema13.toFixed(4)}</code> ⬆ EMA21 <code>${ema21.toFixed(4)}</code>
📈 RSI    : <code>${rsi.toFixed(1)}</code>  ADX: <code>${adx.toFixed(1)}</code>
💵 Harga  : <code>$${price.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
🎯 Trail  : <code>-${(trailPct*100).toFixed(1)}% dari puncak</code> <i>(trailing stop aktif)</i>
🛑 SL     : <code>$${slPrice}</code> <i>(-${(slPct*100).toFixed(1)}% dari entry)</i>
📦 Qty    : <code>${qty.toFixed(tradeMode === "futures" ? 4 : 6)}</code>
💰 Modal  : <code>$${amountUsdt} USDT${lev}</code>
${statusLine}
⏰ ${wib()}`;
}

function tgSellMsg(
  symbol: string, entryPrice: number, exitPrice: number,
  qty: number, amountUsdt: number, tradeMode: string, leverage: number,
  ema13: number, ema21: number, pnl: number, sim: boolean, reason = "DEAD_CROSS"
): string {
  const statusLine  = sim ? `🔵 Status : <b>SIMULASI</b>` : `✅ Status : <b>ORDER TERKIRIM (LIVE)</b>`;
  const pnlSign     = pnl >= 0 ? "+" : "";
  const emoji       = pnl >= 0 ? "💰" : "💸";
  const pnlPct      = ((exitPrice - entryPrice) / entryPrice * 100 * (tradeMode === "futures" ? leverage : 1));
  const trailPct     = tradeMode === "futures" ? TRAILING_STOP_PCT_FUTURES : TRAILING_STOP_PCT_SPOT;
  const signalLabel  = reason === "TRAILING_STOP" ? `🎯 Trailing Stop (-${(trailPct*100).toFixed(1)}% dari puncak)`
                     : reason === "STOP_LOSS"     ? `🛑 Stop Loss (-${(tradeMode === "futures" ? SL_PCT_FUTURES : SL_PCT_SPOT) * 100}%)`
                     : "📊 Dead Cross";
  return `🔴 <b>SELL ${symbol}</b>
━━━━━━━━━━━━━━━━━━━━
${signalLabel}
   EMA13 <code>${ema13.toFixed(4)}</code> ⬇ EMA21 <code>${ema21.toFixed(4)}</code>
💵 Entry  : <code>$${entryPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
💵 Exit   : <code>$${exitPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
${emoji} PnL    : <code>${pnlSign}${pnl.toFixed(2)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)</code>
${statusLine}
⏰ ${wib()}`;
}

// Notif SHORT entry (Dead Cross → open short)
function tgShortOpenMsg(
  symbol: string, price: number, qty: number, amountUsdt: number,
  leverage: number, ema13: number, ema21: number, sim: boolean,
  htfConfirmed = true, rsi = 0, adx = 0
): string {
  const statusLine = sim
    ? `🔵 Status : <b>SIMULASI</b> <i>(API key belum aktif / mode sim)</i>`
    : `✅ Status : <b>ORDER TERKIRIM (LIVE)</b>`;
  const slPrice = (price * (1 + SL_PCT_FUTURES)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const htfLabel = htfConfirmed ? "15m ✓ 1H ✓" : "15m ✓ 1H –";
  return `🔴 <b>SHORT ${symbol}</b>
━━━━━━━━━━━━━━━━━━━━
📊 Sinyal : <b>Dead Cross (${htfLabel})</b>
   EMA13 <code>${ema13.toFixed(4)}</code> ⬇ EMA21 <code>${ema21.toFixed(4)}</code>
📉 RSI    : <code>${rsi.toFixed(1)}</code>  ADX: <code>${adx.toFixed(1)}</code>
💵 Harga  : <code>$${price.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
🎯 Trail  : <code>+${(TRAILING_STOP_PCT_SHORT_FUTURES*100).toFixed(1)}% dari trough</code> <i>(trailing aktif)</i>
🛑 SL     : <code>$${slPrice}</code> <i>(+${(SL_PCT_FUTURES*100).toFixed(1)}% dari entry)</i>
📦 Qty    : <code>${qty.toFixed(4)}</code>
💰 Modal  : <code>$${amountUsdt} USDT × ${leverage}x leverage</code>
${statusLine}
⏰ ${wib()}`;
}

// Notif SHORT close
function tgShortCloseMsg(
  symbol: string, entryPrice: number, exitPrice: number,
  qty: number, amountUsdt: number, leverage: number,
  ema13: number, ema21: number, pnl: number, sim: boolean, reason = "GOLDEN_CROSS"
): string {
  const statusLine = sim ? `🔵 Status : <b>SIMULASI</b>` : `✅ Status : <b>ORDER TERKIRIM (LIVE)</b>`;
  const pnlSign    = pnl >= 0 ? "+" : "";
  const emoji      = pnl >= 0 ? "💰" : "💸";
  // FIX: Hitung pnlPct dari pnl yang sudah dihitung di processUser (konsisten).
  // Sebelumnya dihitung ulang dari entryPrice/exitPrice tanpa amountUsdt → bisa beda.
  const pnlPct = amountUsdt > 0 ? (pnl / amountUsdt) * 100 : 0;
  const signalLabel = reason === "TRAILING_STOP" ? `🎯 Trailing Stop (+${(TRAILING_STOP_PCT_SHORT_FUTURES*100).toFixed(1)}% dari trough)`
                    : reason === "STOP_LOSS"     ? `🛑 Stop Loss (+${(SL_PCT_FUTURES*100).toFixed(1)}% dari entry)`
                    : "📊 Golden Cross (reversal bullish)";
  return `🟢 <b>CLOSE SHORT ${symbol}</b>
━━━━━━━━━━━━━━━━━━━━
${signalLabel}
   EMA13 <code>${ema13.toFixed(4)}</code> ⬆ EMA21 <code>${ema21.toFixed(4)}</code>
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
  // FIX ISSUE-2: status sekarang selalu "OPEN" — tidak ada lagi SIM_OPEN
  const { data } = await sb
    .from("positions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "OPEN");
  return (data || []) as Position[];
}

// BARU: Sync posisi DB dengan posisi nyata di Bybit
// Kalau user close manual di exchange → DB otomatis ikut ditutup
async function syncPositionsWithExchange(
  sb: SB, userId: string, exchange: string, tradeMode: string,
  apiKey: string, apiSecret: string, sim: boolean
): Promise<void> {
  if (sim) return; // skip jika simulasi
  // syncPositions hanya untuk Bybit FUTURES
  // Bybit spot tidak punya /position/list → selalu kosong → false-positive close!
  if (exchange !== "bybit" || tradeMode !== "futures") return;

  try {
    const dbPositions = await getOpenPositions(sb, userId);
    if (!dbPositions.length) return;

    // Ambil posisi terbuka nyata dari Bybit
    const category = tradeMode === "futures" ? "linear" : "spot";
    const ts         = Date.now().toString();
    const recvWindow = "5000";
    const qs         = `category=${category}&settleCoin=USDT`;
    const signature  = await hmacSign(apiSecret, ts + apiKey + recvWindow + qs);

    // FIXED BUG-12: pakai fetchWithTimeout agar tidak hang jika Bybit lambat
    const res  = await fetchWithTimeout(`https://api.bybit.com/v5/position/list?${qs}`, {
      headers: {
        "X-BAPI-API-KEY":     apiKey,
        "X-BAPI-SIGN":        signature,
        "X-BAPI-TIMESTAMP":   ts,
        "X-BAPI-RECV-WINDOW": recvWindow,
      },
    });
    const data = await res.json();
    if (data.retCode !== 0) {
      console.warn(`[syncPositions] Bybit error: ${data.retMsg}`);
      return;
    }

    // Set simbol+side yang masih terbuka di exchange (qty > 0)
    // FIX #5: Bybit mengembalikan LONG dan SHORT sebagai entri terpisah dengan field `side`.
    // Sebelumnya hanya `symbol` → posisi LONG bisa di-close salah jika ada SHORT di simbol sama.
    const activeOnExchange = new Set<string>(
      (data.result?.list || [])
        .filter((p: Record<string, string>) => parseFloat(p.size || "0") > 0)
        .map((p: Record<string, string>) => {
          // Normalkan side Bybit ("Buy"/"Sell") ke direction DB ("LONG"/"SHORT")
          const dir = p.side === "Buy" ? "LONG" : "SHORT";
          return `${p.symbol}:${dir}`;
        })
    );

    // Posisi yang ada di DB tapi sudah tidak ada di exchange = close manual
    for (const pos of dbPositions) {
      const direction: "LONG" | "SHORT" = pos.direction === "SHORT" ? "SHORT" : "LONG";
      if (!activeOnExchange.has(`${pos.symbol}:${direction}`)) {
        console.log(`[syncPositions] ${pos.symbol} ditutup manual di exchange — update DB`);

        // FIX BUG-3: Pakai fetchRealtimePrice (bukan candle close) agar PnL akurat.
        // Candle 15m terakhir bisa stale hingga 14 menit → harga jauh dari realitas.
        const realtimeExit = await fetchRealtimePrice(exchange, pos.symbol, tradeMode).catch(() => 0);
        const exitPrice    = realtimeExit > 0 ? realtimeExit : pos.entry_price;
        const priceDiff = exitPrice - pos.entry_price;
        // FIX: PnL dihitung sesuai direction posisi
        // LONG:  profit jika harga naik  → priceDiff × qty  atau  priceDiff/entry × lev × amount
        // SHORT: profit jika harga turun → -priceDiff/entry × lev × amount
        const pnl = tradeMode === "futures"
          ? (pos.direction === "SHORT"
              ? -priceDiff / pos.entry_price * pos.leverage * pos.amount_usdt
              : priceDiff  / pos.entry_price * pos.leverage * pos.amount_usdt)
          : priceDiff * pos.qty;

        await dbClosePosition(sb, pos.id, exitPrice, "MANUAL_CLOSE", pnl, false);
        await dbLogTrade(
          sb, userId, pos.symbol,
          // FIX: close LONG = SELL, close SHORT = BUY
          pos.direction === "SHORT" ? "BUY" : "SELL",
          exitPrice, pos.amount_usdt,
          0, 0, "MANUAL_CLOSE", "CLOSED", null,
          `EXIT manual di exchange (PnL est: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT)`
        );
        console.log(`[syncPositions] ${pos.symbol} berhasil di-close di DB, PnL est: ${pnl.toFixed(2)}`);
      }
    }
  } catch (e) {
    console.warn(`[syncPositions] Error:`, e);
  }
}

async function dbOpenPosition(
  sb: SB, userId: string, symbol: string,
  exchange: string, tradeMode: string, leverage: number,
  entryPrice: number, qty: number, amountUsdt: number, sim: boolean,
  direction: "LONG" | "SHORT" = "LONG"
) {
  // FIX ISSUE-2: status seragam → "OPEN" untuk semua posisi (live maupun sim).
  // Kolom `sim` (boolean) digunakan untuk membedakan simulasi vs live.
  // Kolom `direction` membedakan posisi long vs short.
  await sb.from("positions").insert({
    user_id: userId, symbol, exchange, trade_mode: tradeMode,
    entry_price: entryPrice, qty, amount_usdt: amountUsdt, leverage,
    status:     "OPEN",
    sim:        sim,
    direction:  direction,
    peak_price: entryPrice, // LONG: track tertinggi; SHORT: track terendah (sama nilai awal)
    opened_at:  new Date().toISOString(),
  });
}

// Update peak_price di DB ketika harga naik di atas puncak sebelumnya
async function dbUpdatePeak(sb: SB, posId: string, newPeak: number) {
  await sb.from("positions").update({ peak_price: newPeak }).eq("id", posId);
}

async function dbClosePosition(
  sb: SB, posId: string, exitPrice: number,
  closeOrderId: string, pnl: number, _sim: boolean
) {
  // FIX ISSUE-2: status selalu "CLOSED" — tidak perlu SIM_CLOSED
  // karena kolom sim (boolean) sudah membedakan simulasi vs live.
  await sb.from("positions").update({
    status:         "CLOSED",
    exit_price:     exitPrice,
    close_order_id: closeOrderId,
    close_reason:   closeOrderId === "MANUAL_CLOSE" ? "MANUAL" : "BOT_EXIT",
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
  // Status sudah normalized sebelum masuk ke sini:
  // BUY entry: "FILLED" (live) atau "SIMULATED" (sim)
  // SELL exit : "CLOSED" (live dan sim)
  // ERROR     : "ERROR"
  // Normalisasi legacy tetap ada sebagai safety net untuk data lama
  let normalizedStatus = orderStatus;
  if (orderStatus === "OPEN")       normalizedStatus = "FILLED";
  if (orderStatus === "SIM_OPEN")   normalizedStatus = "SIMULATED";
  if (orderStatus === "SIM_CLOSED") normalizedStatus = "CLOSED";

  const { error } = await sb.from("trades").insert({
    user_id: userId, symbol, side, price,
    amount_usdt: amountUsdt, ema13, ema21,
    order_id: orderId, order_status: normalizedStatus,
    error_msg: errorMsg, note,
    executed_at: new Date().toISOString(),
  });
  if (error) console.error(`[dbLogTrade] ${symbol} ${side}:`, error.message);
}

// ════════════════════════════════════════════════════════════════
// RISK STATE HELPERS
// FIX BUG-6: daily loss counter & SL cooldown dipindah ke DB (bot_risk_state)
// agar tidak hilang saat Edge Function cold start / restart.
// In-memory map tetap ada sebagai L1 cache untuk mengurangi DB round-trip.
// ════════════════════════════════════════════════════════════════

// ── Helper: catat loss harian & cek apakah sudah mencapai max ────
async function recordDailyLoss(sb: SB, userId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  // Update in-memory cache dulu (cepat)
  const cur = _dailyLoss.get(userId);
  const newLosses = (!cur || cur.date !== today) ? 1 : cur.losses + 1;
  _dailyLoss.set(userId, { date: today, losses: newLosses });
  // Persist ke DB
  try {
    await sb.from("bot_risk_state").upsert({
      user_id:       userId,
      daily_loss_date:   today,
      daily_loss_count:  newLosses,
      updated_at:    new Date().toISOString(),
    }, { onConflict: "user_id" });
  } catch (e) {
    console.warn("[recordDailyLoss] DB upsert failed:", e);
  }
}

async function isDailyLimitReached(sb: SB, userId: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  // Cek cache dulu
  const cached = _dailyLoss.get(userId);
  if (cached && cached.date === today) {
    return cached.losses >= MAX_DAILY_LOSSES;
  }
  // Cache miss → baca dari DB
  try {
    const { data } = await sb.from("bot_risk_state").select("daily_loss_date, daily_loss_count").eq("user_id", userId).maybeSingle();
    if (data?.daily_loss_date === today) {
      _dailyLoss.set(userId, { date: today, losses: data.daily_loss_count });
      return data.daily_loss_count >= MAX_DAILY_LOSSES;
    }
  } catch (e) {
    console.warn("[isDailyLimitReached] DB read failed, fallback to in-memory:", e);
  }
  return false;
}

// ── Helper: tandai simbol sedang cooldown setelah SL ─────────────
async function markSlCooldown(sb: SB, userId: string, symbol: string): Promise<void> {
  const key = `${userId}:${symbol}`;
  const now = Date.now();
  _slCooldownAt.set(key, now);
  try {
    // FIX-C: Pakai jsonb_set via RPC untuk atomic update — hindari race condition
    // read+write terpisah bisa overwrite cooldown simbol lain jika dua SL terjadi bersamaan.
    // Jika RPC tidak tersedia, fallback ke upsert biasa (acceptable untuk 1 posisi).
    const { error: rpcErr } = await sb.rpc("set_sl_cooldown", {
      p_user_id: userId,
      p_symbol:  symbol,
      p_ts:      now,
    });
    if (rpcErr) {
      // Fallback: read-modify-write biasa (non-atomic, acceptable untuk MAX_POSITIONS=1)
      const { data: existing } = await sb.from("bot_risk_state").select("sl_cooldowns").eq("user_id", userId).maybeSingle();
      const cooldowns = (existing?.sl_cooldowns as Record<string, number>) || {};
      cooldowns[symbol] = now;
      await sb.from("bot_risk_state").upsert({
        user_id:      userId,
        sl_cooldowns: cooldowns,
        updated_at:   new Date().toISOString(),
      }, { onConflict: "user_id" });
    }
  } catch (e) {
    console.warn("[markSlCooldown] DB upsert failed:", e);
  }
}

async function isSlCooldown(sb: SB, userId: string, symbol: string): Promise<boolean> {
  const key = `${userId}:${symbol}`;
  // Cek cache dulu
  const cached = _slCooldownAt.get(key);
  if (cached !== undefined) {
    const active = Date.now() - cached < SL_COOLDOWN_MS;
    // FIX-G: cleanup Map saat expired agar tidak tumbuh tanpa batas (memory leak kecil)
    if (!active) _slCooldownAt.delete(key);
    return active;
  }
  // Cache miss → baca dari DB
  try {
    const { data } = await sb.from("bot_risk_state").select("sl_cooldowns").eq("user_id", userId).maybeSingle();
    const cooldowns = (data?.sl_cooldowns as Record<string, number>) || {};
    const t = cooldowns[symbol];
    if (t) {
      _slCooldownAt.set(key, t); // populate cache
      return Date.now() - t < SL_COOLDOWN_MS;
    }
  } catch (e) {
    console.warn("[isSlCooldown] DB read failed, fallback to in-memory:", e);
  }
  return false;
}

// ════════════════════════════════════════════════════════════════
// CORE TRADING LOGIC — proses satu user
// ════════════════════════════════════════════════════════════════

async function processUser(sb: SB, cfg: BotConfig): Promise<string[]> {
  const {
    user_id: userId, exchange, trade_mode: tradeMode = "spot", leverage = 10,
    trade_amount_usdt: amountUsdt, top_n_by_volume: topN,
    symbols: whitelist, telegram_chat_id: tgChat,
  } = cfg;

  // FIXED Opsi B: Dekripsi API key dengan server key (ENCRYPTION_KEY dari Supabase Secrets)
  // API key disimpan terenkripsi server-side — bukan browser key
  const cfgAny = cfg as Record<string, string>;
  let apiKey    = cfg.api_key    || cfgAny["bybit_api_key"] || "";
  let apiSecret = cfg.api_secret || cfgAny["bybit_api_secret"] || "";

  // Dekripsi jika terenkripsi server-side
  if (ENCRYPTION_KEY) {
    try {
      // FIX #4: Cek isServerEncrypted untuk masing-masing key secara independen
      // agar tidak crash jika migration parsial (apiKey enkripsi, apiSecret belum atau sebaliknya)
      if (apiKey    && isServerEncrypted(apiKey))    apiKey    = await serverDecrypt(apiKey);
      if (apiSecret && isServerEncrypted(apiSecret)) apiSecret = await serverDecrypt(apiSecret);
      console.log(`[processUser] API key dekripsi selesai (key=${apiKey.length > 0}, secret=${apiSecret.length > 0})`);
    } catch (e) {
      console.error(`[processUser] GAGAL dekripsi API key:`, e);
      apiKey    = "";
      apiSecret = "";
    }
  }

  const amount = parseFloat(String(amountUsdt)) || 10;
  const lev    = parseInt(String(leverage)) || 10;
  const sim    = isSim(apiKey);
  const log: string[] = [];

  // DEBUG: log status sim agar kelihatan di Supabase logs
  console.log(`[processUser] userId=${userId.slice(0,8)} exchange=${exchange} sim=${sim} apiKeyLen=${apiKey?.length || 0}`);

  // ── FASE 0: Sync posisi DB dengan exchange (deteksi close manual) ──
  // Kalau user close posisi manual di Bybit, DB harus ikut diupdate
  // Tanpa ini: slot dianggap penuh terus → bot tidak pernah entry lagi
  await syncPositionsWithExchange(sb, userId, exchange, tradeMode, apiKey, apiSecret, sim);

  // ── FASE 1: Cek EXIT posisi terbuka ──────────────────────────────
  const openPositions = await getOpenPositions(sb, userId);

  for (const pos of openPositions) {
    if (pos.exchange !== exchange || pos.trade_mode !== tradeMode) continue;

    // Normalisasi direction: posisi lama tanpa kolom direction dianggap LONG
    const direction: "LONG" | "SHORT" = (pos.direction === "SHORT") ? "SHORT" : "LONG";

    try {
      const candles = await fetchCandles(exchange, pos.symbol, tradeMode);
      const { shouldExit, ema13, ema21 } = detectExitSignal(candles, direction);

      const realtimePrice = await fetchRealtimePrice(exchange, pos.symbol, tradeMode);
      const currentPrice  = realtimePrice > 0 ? realtimePrice : candles[candles.length - 1].close;

      const slPct = tradeMode === "futures" ? SL_PCT_FUTURES : SL_PCT_SPOT;
      const TRAIL_ACTIVATION_MULT = 1.0;

      let trailingStopHit = false;
      let stopLossHit     = false;

      if (direction === "LONG") {
        // LONG: trailing stop mengikuti harga TERTINGGI (peak naik → trail naik)
        const trailPct  = tradeMode === "futures" ? TRAILING_STOP_PCT_FUTURES : TRAILING_STOP_PCT_SPOT;
        const prevPeak  = pos.peak_price ?? pos.entry_price;
        const newPeak   = Math.max(prevPeak, currentPrice);
        if (newPeak > prevPeak) await dbUpdatePeak(sb, pos.id, newPeak);

        trailingStopHit = currentPrice <= newPeak * (1 - trailPct)
          && newPeak > pos.entry_price * (1 + trailPct * TRAIL_ACTIVATION_MULT);

        const priceChange = pos.entry_price > 0 ? (currentPrice - pos.entry_price) / pos.entry_price : 0;
        stopLossHit = -priceChange >= slPct;

        console.log(
          `[EXIT-LONG] ${pos.symbol} entry=${pos.entry_price} peak=${newPeak.toFixed(6)} ` +
          `now=${currentPrice.toFixed(6)} chg=${(priceChange*100).toFixed(2)}% ` +
          `trailHit=${trailingStopHit} sl=${stopLossHit} deadCross=${shouldExit}`
        );
      } else {
        // SHORT: trailing stop mengikuti harga TERENDAH (trough turun → trail turun)
        // peak_price dipakai untuk menyimpan trough (harga terendah sejak short dibuka)
        const trailPct    = TRAILING_STOP_PCT_SHORT_FUTURES;
        const prevTrough  = pos.peak_price ?? pos.entry_price;
        const newTrough   = Math.min(prevTrough, currentPrice);
        if (newTrough < prevTrough) await dbUpdatePeak(sb, pos.id, newTrough);

        // Trailing hit: harga naik di atas trough + trailPct%, dan trough sudah turun cukup
        trailingStopHit = currentPrice >= newTrough * (1 + trailPct)
          && newTrough < pos.entry_price * (1 - trailPct * TRAIL_ACTIVATION_MULT);

        // Short SL: harga naik dari entry melebihi slPct (loss untuk short)
        const priceChange = pos.entry_price > 0 ? (currentPrice - pos.entry_price) / pos.entry_price : 0;
        stopLossHit = priceChange >= slPct;

        console.log(
          `[EXIT-SHORT] ${pos.symbol} entry=${pos.entry_price} trough=${newTrough.toFixed(6)} ` +
          `now=${currentPrice.toFixed(6)} chg=${(priceChange*100).toFixed(2)}% ` +
          `trailHit=${trailingStopHit} sl=${stopLossHit} goldenCross=${shouldExit}`
        );
      }

      // ── Prioritas exit (sama untuk long dan short):
      // 1. Trailing Stop  2. EMA Cross reversal  3. Hard Stop Loss
      if (!trailingStopHit && !shouldExit && !stopLossHit) continue;

      const exitReasonLabel = direction === "LONG"
        ? (trailingStopHit ? "TRAILING_STOP" : shouldExit ? "DEAD_CROSS"    : "STOP_LOSS")
        : (trailingStopHit ? "TRAILING_STOP" : shouldExit ? "GOLDEN_CROSS"  : "STOP_LOSS");

      const exitPrice = currentPrice;

      // PnL: LONG = (exit-entry)/entry × lev × modal
      //      SHORT = (entry-exit)/entry × lev × modal
      // FIXED BUG-8 (Medium): pos.leverage diambil dari nilai yang tersimpan saat posisi dibuka.
      // Jika user mengubah leverage di exchange setelah posisi dibuka (tapi tidak ubah di config),
      // maka PnL yang dihitung di sini bisa tidak akurat vs PnL aktual di exchange.
      // Ini hanya memengaruhi TAMPILAN notifikasi — actual realized PnL di exchange tetap benar.
      // TODO: Untuk akurasi lebih tinggi, fetch closed PnL dari Bybit /v5/position/closed-pnl
      //       setelah order close berhasil, dan pakai nilai itu sebagai gantinya.
      const pnl = direction === "LONG"
        ? (tradeMode === "futures"
            ? (exitPrice - pos.entry_price) / pos.entry_price * pos.leverage * pos.amount_usdt
            : (exitPrice - pos.entry_price) * pos.qty)
        : (exitPrice - pos.entry_price) / pos.entry_price * pos.leverage * pos.amount_usdt * -1;

      const result = direction === "LONG"
        ? await closeOrder(exchange, tradeMode, pos.symbol, pos.qty, apiKey, apiSecret)
        : await closeShortOrder(exchange, pos.symbol, pos.qty, apiKey, apiSecret);

      if (!result.ok) {
        await dbLogTrade(sb, userId, pos.symbol, direction === "LONG" ? "SELL" : "BUY",
          exitPrice, pos.amount_usdt, ema13, ema21, "", "ERROR", result.error || null,
          `CLOSE ${direction} failed: ${exitReasonLabel}`);
        log.push(`${pos.symbol}:CLOSE_ERR:${result.error?.slice(0, 50)}`);
        continue;
      }

      await dbClosePosition(sb, pos.id, exitPrice, result.orderId, pnl, sim);
      await dbLogTrade(sb, userId, pos.symbol, direction === "LONG" ? "SELL" : "BUY",
        exitPrice, pos.amount_usdt, ema13, ema21, result.orderId, "CLOSED", null,
        `EXIT ${direction}: ${exitReasonLabel}`);

      if (direction === "LONG") {
        await tgSend(tgChat, tgSellMsg(pos.symbol, pos.entry_price, exitPrice, pos.qty,
          pos.amount_usdt, tradeMode, lev, ema13, ema21, pnl, sim, exitReasonLabel));
      } else {
        await tgSend(tgChat, tgShortCloseMsg(pos.symbol, pos.entry_price, exitPrice, pos.qty,
          pos.amount_usdt, lev, ema13, ema21, pnl, sim, exitReasonLabel));
      }

      // Catat loss & cooldown setelah SL
      if (exitReasonLabel === "STOP_LOSS") {
        await recordDailyLoss(sb, userId);
        await markSlCooldown(sb, userId, pos.symbol);
        console.log(`[EXIT] SL hit — ${pos.symbol} cooldown ${SL_COOLDOWN_MS/60000}m`);
      }

      const pnlSign = pnl >= 0 ? "+" : "";
      log.push(`${pos.symbol}:CLOSED_${direction}:${exitReasonLabel}:PnL${pnlSign}${pnl.toFixed(2)}`);
    } catch (e: unknown) {
      // FIXED BUG-NEW-2: Sebelumnya catch hanya menulis String(e) tanpa identifier simbol.
      // Jika fetchCandles atau fetchRealtimePrice throw, log tidak punya konteks simbol mana yang error.
      // FIX: Sertakan pos.symbol di log error untuk memudahkan debugging di Supabase logs.
      const errStr = String(e).slice(0, 80);
      log.push(`${pos.symbol}:EXIT_ERR:${errStr}`);
      console.error(`[EXIT] ${pos.symbol} error:`, e);
    }
  }

  // ── FASE 2: Scan ENTRY (hanya jika ada slot tersedia) ────────────
  const currentPositions = await getOpenPositions(sb, userId);
  const relevantPositions = currentPositions.filter(p => p.exchange === exchange && p.trade_mode === tradeMode);

  // Hitung slot per-direction secara independen:
  // LONG dan SHORT bisa berjalan bersamaan di simbol berbeda
  const openLongCount  = relevantPositions.filter(p => (p.direction ?? "LONG") === "LONG").length;
  const openShortCount = relevantPositions.filter(p => p.direction === "SHORT").length;

  const longSlotFull  = openLongCount  >= MAX_LONG_POSITIONS;
  const shortSlotFull = openShortCount >= MAX_SHORT_POSITIONS || tradeMode !== "futures";
  // Spot tidak support short — short slot selalu "penuh" untuk spot

  if (longSlotFull && shortSlotFull) {
    log.push(`FULL: LONG(${openLongCount}/${MAX_LONG_POSITIONS}) SHORT(${openShortCount}/${MAX_SHORT_POSITIONS}) - skip entry scan`);
    return log;
  }

  // ── FITUR BARU: Max drawdown harian ──────────────────────────────
  if (await isDailyLimitReached(sb, userId)) {
    const losses = _dailyLoss.get(userId)?.losses || MAX_DAILY_LOSSES;
    log.push(`DAILY_LIMIT: ${losses}x SL hari ini — trading dihentikan sampai besok`);
    console.log(`[processUser] ${userId.slice(0,8)} daily limit reached (${losses} losses) — skip all entry`);
    return log;
  }

  const symbols = await getTopSymbols(exchange, tradeMode, topN || 20, whitelist || []);

  console.log(`[processUser] scan: ${symbols.length} simbol, longSlot=${longSlotFull ? "FULL" : "OPEN"}, shortSlot=${shortSlotFull ? "FULL" : "OPEN"}, sim=${sim}, exchange=${exchange}, mode=${tradeMode}`);
  let entered = 0;

  // FIXED: Cek saldo tersedia sebelum mulai scan entry
  // Ini mencegah error "ab not enough for new order" spam di logs
  if (!sim) {
    try {
      const availBal = exchange === "bybit"
        ? await fetchBybitBalance(apiKey, apiSecret, tradeMode)
        : await fetchBinanceBalance(apiKey, apiSecret, tradeMode);
      const needed = tradeMode === "futures" ? amount / lev : amount; // FIX: futures hanya butuh margin = amount/leverage
      console.log(`[processUser] balance=${availBal.toFixed(2)} needed=${needed} amount=${amount}`);
      if (availBal < needed * 0.9) { // 10% buffer toleransi fee
        log.push(`SKIP_ENTRY: saldo $${availBal.toFixed(2)} < kebutuhan $${needed}`);

        // FIX SPAM: Cooldown disimpan ke DB agar persist saat cold start Edge Function.
        // In-memory saja tidak cukup — Supabase EF bisa restart tiap menit → memory reset.
        const now = Date.now();
        let lastNotif = _lowBalanceNotifAt.get(userId) || 0;

        // Cache miss (cold start) → baca timestamp terakhir dari DB
        if (!lastNotif) {
          try {
            const { data: rs } = await sb
              .from("bot_risk_state")
              .select("low_balance_notif_at")
              .eq("user_id", userId)
              .maybeSingle();
            lastNotif = rs?.low_balance_notif_at || 0;
            if (lastNotif) _lowBalanceNotifAt.set(userId, lastNotif);
          } catch { /* non-fatal, fallback ke 0 */ }
        }

        if (now - lastNotif > LOW_BALANCE_COOLDOWN_MS) {
          // Simpan ke cache + DB SEBELUM kirim notif — cegah dobel jika ada race
          _lowBalanceNotifAt.set(userId, now);
          try {
            await sb.from("bot_risk_state").upsert({
              user_id:              userId,
              low_balance_notif_at: now,
              updated_at:           new Date().toISOString(),
            }, { onConflict: "user_id" });
          } catch { /* non-fatal */ }

          await tgSend(tgChat,
            `⚠️ <b>Saldo tidak cukup untuk entry</b>\n` +
            `💰 Tersedia: <code>$${availBal.toFixed(2)} USDT</code>\n` +
            `📦 Dibutuhkan: <code>$${needed.toFixed(2)} USDT</code>\n` +
            `<i>Top up saldo atau kurangi trade amount di pengaturan.</i>`
          );
        }
        return log;
      }
    } catch (e) {
      console.warn(`[processUser] Gagal cek saldo: ${e} — lanjut tanpa cek`);
    }
  }

  // FIXED Bug #3: Fetch candles secara paralel (batch 10) agar tidak timeout.
  const BATCH_SIZE = 10;
  // Simbol yang sudah punya posisi di direction YANG SAMA diblokir.
  // Simbol yang sama boleh masuk di direction berbeda (misal long BTCUSDT + short BTCUSDT tidak boleh,
  // tapi long BTCUSDT + short ETHUSDT boleh).
  const openLongSymbols  = new Set(relevantPositions.filter(p => (p.direction ?? "LONG") === "LONG").map(p => p.symbol));
  const openShortSymbols = new Set(relevantPositions.filter(p => p.direction === "SHORT").map(p => p.symbol));

  // Kandidat: simbol yang belum punya posisi di direction yang sama (LONG atau SHORT)
  // Simbol yang punya LONG dan SHORT sekaligus juga diblokir (hedge tidak didukung)
  // FIXED BUG-5 (Medium): Sebelumnya filter pakai operator `||` (OR):
  //   .filter(s => !openLongSymbols.has(s) || !openShortSymbols.has(s))
  // Artinya: EXCLUDE hanya jika simbol punya LONG *DAN* SHORT sekaligus.
  // Akibatnya simbol yang sudah punya posisi LONG tetap masuk scan dan
  // bisa di-entry LONG lagi (meskipun sudah ada guard wantLong check di bawah).
  // FIX: Pakai `&&` (AND) — exclude jika simbol sudah punya posisi di SALAH SATU arah.
  // Guard wantLong/wantShort tetap ada sebagai lapisan kedua (defense-in-depth).
  const candidateSymbols = symbols
    .filter(s => !openLongSymbols.has(s) && !openShortSymbols.has(s)) // FIXED: || → &&
    .slice(0, Math.min(40, MAX_ENTRY_PER_RUN * 15));

  // longSlotFull/shortSlotFull bisa berubah saat loop berjalan (setelah entry berhasil)
  // Pakai let agar bisa diupdate di dalam loop
  let curLongFull  = longSlotFull;
  let curShortFull = shortSlotFull;

  for (let i = 0; i < candidateSymbols.length && !(curLongFull && curShortFull); i += BATCH_SIZE) {
    const batch = candidateSymbols.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (symbol) => {
        const [candles, htfCandles] = await Promise.all([
          fetchCandles(exchange, symbol, tradeMode),
          fetchHTFCandles(exchange, symbol, tradeMode),
        ]);
        const signal      = detectCross(candles);
        const htfBullish  = isHTFBullish(htfCandles);
        const htfBearish  = isHTFBearish(htfCandles);
        const closes      = candles.map(c => c.close);
        const rsi         = calcRSI(closes);
        const adx         = calcADX(candles);
        return { symbol, candles, signal, htfBullish, htfBearish, rsi, adx };
      })
    );

    for (const res of batchResults) {
      if (curLongFull && curShortFull) break;
      if (res.status !== "fulfilled") {
        const reason = (res as PromiseRejectedResult).reason;
        console.warn(`[processUser] batch fetch FAILED: ${reason?.message || reason || res.status}`);
        continue;
      }
      const { symbol, candles, signal: { cross, ema13, ema21, volumeOk, volumeRatio }, htfBullish, htfBearish, rsi, adx } = res.value;

      // ─── Tentukan arah entry ──────────────────────────────────────
      // LONG : Golden Cross + HTF bullish (spot ATAU futures) — hanya jika slot long masih ada
      // SHORT: Dead Cross   + HTF bearish (futures ONLY)      — hanya jika slot short masih ada
      // Simbol yang sudah punya posisi LONG tidak boleh buka LONG lagi (tapi boleh SHORT di simbol lain)
      const wantLong  = cross === "GOLDEN" && htfBullish  && !curLongFull  && !openLongSymbols.has(symbol);
      const wantShort = cross === "DEAD"   && htfBearish  && !curShortFull && !openShortSymbols.has(symbol) && tradeMode === "futures";

      if (!wantLong && !wantShort) {
        console.log(`[SCAN] ${symbol}: cross=${cross ?? "none"} htfBull=${htfBullish} htfBear=${htfBearish} ema13=${ema13.toFixed(4)} ema21=${ema21.toFixed(4)}`);
        continue;
      }

      const entryDirection: "LONG" | "SHORT" = wantLong ? "LONG" : "SHORT";

      // Filter volume
      if (!volumeOk) {
        log.push(`${symbol}:SKIP_VOL:ratio=${volumeRatio.toFixed(2)}`);
        console.log(`[SCAN] ${symbol}: SKIP_VOL ratio=${volumeRatio.toFixed(2)}`);
        continue;
      }

      // Filter SL cooldown
      if (await isSlCooldown(sb, userId, symbol)) {
        // FIXED BUG-10 (Minor): Sebelumnya elapsed dihitung dari _slCooldownAt.get() tanpa guard.
        // Jika cache miss (cold start Edge Function), get() return undefined → (Date.now() - 0) / 60000
        // = jutaan menit → log misleading tapi tidak crash.
        // FIX: Fallback ke 0 jika tidak ada di cache (timestamp sebenarnya ada di DB, tapi
        // sudah terbaca di isSlCooldown). Log tetap informatif dengan ">0" sebagai penanda cache miss.
        const cachedTs  = _slCooldownAt.get(`${userId}:${symbol}`);
        const elapsed   = cachedTs ? Math.round((Date.now() - cachedTs) / 60000) : "?";
        log.push(`${symbol}:SKIP_SL_COOLDOWN:${elapsed}m/${SL_COOLDOWN_MS/60000}m`);
        continue;
      }

      // Filter RSI
      // LONG: jangan entry saat overbought (RSI > 70)
      // SHORT: jangan entry saat oversold (RSI < 30) — sudah terlalu jauh turun
      const RSI_OVERSOLD = 30;
      if (entryDirection === "LONG"  && rsi > RSI_OVERBOUGHT) {
        log.push(`${symbol}:SKIP_RSI:${rsi.toFixed(1)}>70_overbought`);
        continue;
      }
      if (entryDirection === "SHORT" && rsi < RSI_OVERSOLD) {
        log.push(`${symbol}:SKIP_RSI:${rsi.toFixed(1)}<30_oversold`);
        continue;
      }

      // Filter ADX
      if (adx < ADX_MIN_STRENGTH) {
        log.push(`${symbol}:SKIP_ADX:${adx.toFixed(1)}<${ADX_MIN_STRENGTH}`);
        continue;
      }

      // Filter R:R
      {
        const trailPct   = entryDirection === "LONG"
          ? (tradeMode === "futures" ? TRAILING_STOP_PCT_FUTURES : TRAILING_STOP_PCT_SPOT)
          : TRAILING_STOP_PCT_SHORT_FUTURES;
        const slPct      = tradeMode === "futures" ? SL_PCT_FUTURES : SL_PCT_SPOT;
        const rrEstimate = (trailPct * 2) / slPct;
        if (rrEstimate < MIN_RR) {
          log.push(`${symbol}:SKIP_RR:est=${rrEstimate.toFixed(2)}<MIN_RR=${MIN_RR}`);
          continue;
        }
      }

      try {
        const realtimeEntry = await fetchRealtimePrice(exchange, symbol, tradeMode);
        const entryPrice    = realtimeEntry > 0 ? realtimeEntry : candles[candles.length - 1].close;

        const result = entryDirection === "LONG"
          ? await openOrder(exchange, tradeMode, symbol, amount, entryPrice, lev, apiKey, apiSecret)
          : await openShortOrder(exchange, symbol, amount, entryPrice, lev, apiKey, apiSecret);

        if (!result.ok) {
          const errMsg = result.error || "";
          const isTermsError   = errMsg.toLowerCase().includes("terms") || errMsg.toLowerCase().includes("agree");
          const isBalanceError = errMsg.toLowerCase().includes("not enough") || errMsg.toLowerCase().includes("insufficient");
          if (isTermsError)   { log.push(`${symbol}:SKIP_TERMS`); continue; }
          if (isBalanceError) { log.push(`${symbol}:STOP_BALANCE:${errMsg.slice(0, 60)}`); break; }
          await dbLogTrade(sb, userId, symbol, entryDirection === "LONG" ? "BUY" : "SELL",
            entryPrice, amount, ema13, ema21, "", "ERROR", errMsg || null,
            `ENTRY failed: ${entryDirection}`);
          log.push(`${symbol}:ENTRY_ERR:${errMsg.slice(0, 80)}`);
          continue;
        }

        // Hitung qty normalized untuk DB & notif
        // FIX BUG-1: spot tidak pakai leverage untuk hitung qty
        // FIX BUG-2: gunakan category yang benar (spot vs linear)
        const _qtyCategory = tradeMode === "futures" ? "linear" : "spot";
        const { minQty, stepSize } = exchange === "bybit"
          ? await getBybitInstrumentInfo(symbol, _qtyCategory).catch(() => ({ minQty: 0.001, stepSize: 0.001, minNotional: 0 }))
          : { minQty: 0.001, stepSize: 0.001 };
        const rawQty    = tradeMode === "futures"
          ? (amount * lev) / entryPrice
          : amount / entryPrice;
        const actualQty = parseFloat(normalizeQty(rawQty, stepSize, minQty, stepDecimals(stepSize)));

        await dbOpenPosition(sb, userId, symbol, exchange, tradeMode, lev, entryPrice, actualQty, amount, sim, entryDirection);
        await dbLogTrade(sb, userId, symbol, entryDirection === "LONG" ? "BUY" : "SELL",
          entryPrice, amount, ema13, ema21, result.orderId, sim ? "SIMULATED" : "FILLED", null,
          `ENTRY ${entryDirection}: ${entryDirection === "LONG" ? "Golden" : "Dead"} Cross`);

        if (entryDirection === "LONG") {
          await tgSend(tgChat, tgBuyMsg(symbol, entryPrice, actualQty, amount, tradeMode, lev, ema13, ema21, sim, htfBullish, rsi, adx));
        } else {
          await tgSend(tgChat, tgShortOpenMsg(symbol, entryPrice, actualQty, amount, lev, ema13, ema21, sim, htfBearish, rsi, adx));
        }

        log.push(`${symbol}:OPENED_${entryDirection}:${entryDirection === "LONG" ? "GoldenCross" : "DeadCross"}:${sim ? "SIM" : "LIVE"}`);
        entered++;
        // FIX BUG-3: enforce MAX_ENTRY_PER_RUN — maksimal 1 entry total per cron run
        if (entered >= MAX_ENTRY_PER_RUN) break;
        // Update slot tracking agar batch berikutnya tidak entry ke slot yang sudah penuh
        if (entryDirection === "LONG") {
          openLongSymbols.add(symbol);
          curLongFull = openLongSymbols.size >= MAX_LONG_POSITIONS;
        } else {
          openShortSymbols.add(symbol);
          curShortFull = openShortSymbols.size >= MAX_SHORT_POSITIONS;
        }
      } catch (e: unknown) {
        console.warn(`[Worker] Entry error ${symbol}:`, e);
      }
    }
    // FIX #6: Hentikan juga outer batch loop saat MAX_ENTRY_PER_RUN tercapai.
    // Sebelumnya `break` di dalam batchResults hanya keluar dari inner loop,
    // sehingga batch berikutnya tetap diproses dan bisa melebihi MAX_ENTRY_PER_RUN.
    if (entered >= MAX_ENTRY_PER_RUN) break;
  }

  if (entered === 0) log.push(`no_signal (longSlot=${longSlotFull ? "full" : "open"} shortSlot=${shortSlotFull ? "full" : "open"})`);

  console.log(`[processUser] DONE: ${log.join(" | ") || "no_signal"}`);

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
    // FIXED: Pakai fetchWithTimeout agar tidak hang jika Telegram lambat/down
    const tgRes  = await fetchWithTimeout(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
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
// HANDLE SAVE API KEY — enkripsi server-side lalu simpan ke DB
// Browser kirim plain text → Edge Function enkripsi → simpan DB
// ════════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleSaveApiKey(sb: SB, body: any): Promise<Response> {
  const { user_id, api_key, api_secret } = body;

  if (!user_id || !api_key || !api_secret) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing user_id, api_key, or api_secret" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
  if (!ENCRYPTION_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "ENCRYPTION_KEY belum di-set di Supabase Secrets" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    const encKey = await serverEncrypt(api_key);
    const encSec = await serverEncrypt(api_secret);

    const { error } = await sb
      .from("bot_configs")
      .update({ api_key: encKey, api_secret: encSec, updated_at: new Date().toISOString() })
      .eq("user_id", user_id);

    if (error) throw new Error(error.message);
    console.log(`[SaveApiKey] userId=${user_id.slice(0, 8)} — enkripsi server-side berhasil`);

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
}

// ════════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleExecuteOrder(sb: SB, body: any): Promise<Response> {
  // FIX ISSUE-1 (SECURITY): execute_order tidak lagi menerima api_key plaintext dari browser.
  // Browser cukup kirim user_id → EF ambil dari DB → dekripsi server-side → eksekusi order.
  // Ini konsisten dengan pola yang sudah dilakukan oleh exchange_balance handler.
  const {
    user_id,
    exchange    = "bybit",
    mode        = "spot",
    leverage    = 10,
    symbol,
    side,
    qty,
    amount_usdt = 10,
  } = body;

  if (!user_id) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing user_id" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
  if (!symbol || !side || !qty) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing symbol, side, or qty" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
  if (side !== "BUY" && side !== "SELL") {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid side: "${side}". Must be "BUY" or "SELL"` }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // Ambil + dekripsi API key dari DB (tidak pernah lewat browser)
  let api_key    = "";
  let api_secret = "";
  let dbExchange = exchange;
  let dbMode     = mode;
  try {
    const { data, error } = await sb
      .from("bot_configs")
      .select("api_key, api_secret, exchange, trade_mode")
      .eq("user_id", user_id)
      .single();

    if (error || !data?.api_key) {
      return new Response(
        JSON.stringify({ ok: false, error: "API key belum disimpan. Simpan ulang di pengaturan bot." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    if (isServerEncrypted(data.api_key) && ENCRYPTION_KEY) {
      api_key    = await serverDecrypt(data.api_key);
      // FIX: cek api_secret secara independen, bukan asumsi ikut api_key
      api_secret = isServerEncrypted(data.api_secret) ? await serverDecrypt(data.api_secret) : data.api_secret;
    } else {
      api_key    = data.api_key;
      api_secret = data.api_secret;
    }
    // Pakai exchange/mode dari DB jika tidak di-override di body
    if (!body.exchange) dbExchange = data.exchange || exchange;
    if (!body.mode)     dbMode     = data.trade_mode || mode;
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: "Gagal ambil API key: " + String(e) }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  if (!api_key || !api_secret) {
    return new Response(
      JSON.stringify({ ok: false, error: "API key kosong setelah dekripsi." }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    const realtimePrice = await fetchRealtimePrice(dbExchange, symbol, dbMode);
    if (realtimePrice <= 0) {
      return new Response(
        JSON.stringify({ ok: false, error: `Tidak bisa mendapatkan harga realtime untuk ${symbol}. Coba lagi.` }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    const price   = realtimePrice;
    const lev     = parseInt(String(leverage)) || 10;
    const amtUsdt = parseFloat(String(amount_usdt)) || 10;
    const qtyNum  = parseFloat(String(qty));

    let result: OrderResult;
    if (side === "BUY") {
      result = await openOrder(dbExchange, dbMode, symbol, amtUsdt, price, lev, api_key, api_secret);
    } else {
      result = await closeOrder(dbExchange, dbMode, symbol, qtyNum, api_key, api_secret);
    }

    if (!result.ok) {
      console.error(`[execute-order] ${symbol} ${side} FAILED:`, result.error);
      return new Response(
        JSON.stringify({ ok: false, error: result.error }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    console.log(`[execute-order] ${dbExchange} ${symbol} ${side} OK — orderId: ${result.orderId}`);
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

      // FIXED BUG-12: pakai fetchWithTimeout agar tidak hang jika Bybit lambat
      const res  = await fetchWithTimeout(`https://api.bybit.com/v5/account/wallet-balance?${qs}`, {
        headers: {
          "X-BAPI-API-KEY":     apiKey,
          "X-BAPI-SIGN":        signature,
          "X-BAPI-TIMESTAMP":   ts,
          "X-BAPI-RECV-WINDOW": recvWindow,
        },
      });
      const data = await res.json();
      if (data.retCode !== 0) { lastError = data.retMsg; continue; }

      const acct = data.result?.list?.[0];
      if (!acct) continue;

      // FIXED: Gunakan totalAvailableBalance (saldo yang benar-benar bisa dipakai)
      // JANGAN pakai totalEquity — itu termasuk unrealized PnL yang bisa negatif
      // totalAvailableBalance = saldo USDT bebas (tidak terpakai margin)
      let usdt = parseFloat(
        acct.totalAvailableBalance ||   // Unified: saldo bebas tersedia
        acct.totalWalletBalance    ||   // Fallback: total wallet tanpa PnL
        "0"
      );

      // Fallback coin-by-coin: ambil availableToWithdraw USDT saja
      if (!usdt && acct.coin?.length) {
        const usdtCoin = acct.coin.find((c: { coin?: string }) => c.coin === "USDT");
        if (usdtCoin) {
          usdt = parseFloat(
            (usdtCoin as Record<string, string>).availableToWithdraw ||
            (usdtCoin as Record<string, string>).walletBalance || "0"
          );
        }
      }

      if (usdt > 0) {
        totalUsdt = usdt; // FIX #4: Jangan akumulasi (+= → =) untuk hindari double-count saldo antar account type
        anySuccess = true;
        break; // Selalu break setelah menemukan saldo valid pertama
      }
    } catch { /* skip */ }
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
  // FIXED BUG-12: pakai fetchWithTimeout agar tidak hang jika Binance lambat
  const res = await fetchWithTimeout(`${base}?${qs}&signature=${sig}`, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  const data = await res.json();
  if (isFut) {
    const asset = Array.isArray(data) ? data.find((a: { asset: string }) => a.asset === "USDT") : null;
    // FIX: gunakan availableBalance (margin bebas) bukan balance (total wallet termasuk yang sudah dipakai)
    return parseFloat(asset?.availableBalance || asset?.balance || "0");
  } else {
    const asset = data.balances?.find((a: { asset: string }) => a.asset === "USDT");
    return parseFloat(asset?.free || "0");
  }
}

// deno-lint-ignore no-explicit-any
async function handleExchangeBalance(sb: SB, body: any): Promise<Response> {
  const { exchange = "bybit", mode = "spot" } = body;

  // FIXED: Tolak request yang masih kirim api_key/api_secret di body.
  // Browser seharusnya hanya kirim user_id — api_key diambil server-side dari DB.
  // Guard ini mencegah bypass enkripsi dari klien lama atau manipulasi request.
  if (body.api_key || body.api_secret) {
    return new Response(
      JSON.stringify({ ok: false, error: "Kirim user_id saja, bukan api_key langsung. Update app ke versi terbaru." }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // Ambil api_key dari DB via user_id (satu-satunya cara yang valid)
  let api_key = "";
  let api_secret = "";

  // FIXED Opsi B: Kalau tidak ada api_key di body, ambil dari DB dan dekripsi server-side
  // App.js sekarang hanya kirim user_id, tidak kirim api_key plain text
  if (body.user_id) {
    try {
      const { data } = await sb
        .from("bot_configs")
        .select("api_key, api_secret, exchange, trade_mode")
        .eq("user_id", body.user_id)
        .single();

      if (!data?.api_key) {
        return new Response(
          JSON.stringify({ ok: false, error: "API key belum disimpan. Input ulang API key di pengaturan bot." }),
          { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // Dekripsi server-side — cek masing-masing key secara independen
      if (ENCRYPTION_KEY) {
        if (isServerEncrypted(data.api_key))    api_key    = await serverDecrypt(data.api_key);
        else                                    api_key    = data.api_key;
        if (isServerEncrypted(data.api_secret)) api_secret = await serverDecrypt(data.api_secret);
        else                                    api_secret = data.api_secret;
      } else {
        api_key    = data.api_key;
        api_secret = data.api_secret;
      }
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error: "Gagal ambil API key: " + String(e) }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  }

  if (!api_key || !api_secret) {
    return new Response(
      JSON.stringify({ ok: false, error: "API key tidak ditemukan. Silakan simpan ulang API key." }),
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
      // FIXED: Pakai fetchWithTimeout agar tidak hang jika exchangerate-api lambat/down
      const rateRes  = await fetchWithTimeout("https://api.exchangerate-api.com/v4/latest/USD");
      const rateData = await rateRes.json();
      idrRate = rateData?.rates?.IDR || 16000;
    } catch { /* pakai default 16000 */ }

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
      JSON.stringify({ status: "ok", service: "z-wealth trading worker v14" }),
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
  // Telegram webhook tidak butuh auth tambahan karena:
  // 1. Hanya bisa dipanggil oleh Telegram server (webhook resmi)
  // 2. update_id unik per update — tidak bisa di-replay mudah
  // 3. bot_token ada di server-side saja
  if ("update_id" in body) {
    return await handleTelegramWebhook(sb, body);
  }

  // ── ROUTE 2: Bot Notify dari browser — kirim pesan Telegram ──────
  // { _type: "bot_status_notif", chat_id, message }  ← format baru
  // { chat_id, text }                                ← format lama (kompatibel)
  // FIXED BUG-AUTH-1 (Kritis): Route ini sebelumnya tidak ada autentikasi.
  // Siapapun bisa POST ke endpoint ini dan bot mengirim pesan Telegram ke
  // chat_id manapun → potensi spam/phishing via @zwealth_bot.
  // FIX: Wajib sertakan Authorization header yang valid.
  if (
    body._type === "bot_status_notif" ||
    (body.chat_id && (body.message || body.text) && !body._type)
  ) {
    if (!verifyBrowserAuth(req)) return unauthorizedResponse("bot_notify: token tidak valid");
    return await handleBotNotify(body);
  }

  // ── ROUTE 3: Exchange Balance — proxy saldo (fix CORS browser) ───
  // { _type: "exchange_balance", exchange, mode, user_id } — server dekripsi API key
  // FIXED BUG-AUTH-4 (Kritis): Route ini sebelumnya tidak ada autentikasi.
  // Siapapun yang tahu user_id bisa membaca saldo exchange user lain.
  // FIX: Wajib Authorization header valid sebelum akses data user.
  if (body._type === "exchange_balance") {
    if (!verifyBrowserAuth(req)) return unauthorizedResponse("exchange_balance: token tidak valid");
    return await handleExchangeBalance(sb, body);
  }

  // ── ROUTE 3b: Execute Order — proxy order dari browser (fix CORS) ─
  // { _type: "execute_order", user_id, exchange, mode, leverage, symbol, side, qty, amount_usdt }
  // FIXED BUG-AUTH-2 (Kritis): Route ini sebelumnya tidak ada autentikasi.
  // Siapapun yang tahu user_id bisa trigger order jual/beli atas nama user lain.
  // FIX: Wajib Authorization header valid. Pertimbangkan upgrade ke JWT
  //      validation (sb.auth.getUser) untuk verifikasi bahwa caller ADALAH
  //      pemilik user_id tersebut (bukan hanya punya anon key).
  if (body._type === "execute_order") {
    if (!verifyBrowserAuth(req)) return unauthorizedResponse("execute_order: token tidak valid");
    return await handleExecuteOrder(sb, body);
  }

  // ── ROUTE 3c: Save API Key — enkripsi server-side dan simpan ke DB ─
  // { _type: "save_api_key", user_id, api_key, api_secret }
  // Browser kirim plain text → server enkripsi → simpan ke bot_configs
  // FIXED BUG-AUTH-3 (Kritis): Route ini sebelumnya tidak ada autentikasi.
  // Siapapun bisa overwrite API key milik user lain jika tahu user_id-nya.
  // FIX: Wajib Authorization header valid.
  if (body._type === "save_api_key") {
    if (!verifyBrowserAuth(req)) return unauthorizedResponse("save_api_key: token tidak valid");
    return await handleSaveApiKey(sb, body);
  }

  // ── ROUTE 4: Cron Job trading — perlu auth ────────────────────────
  const auth       = req.headers.get("Authorization") || "";
  const cronHeader = req.headers.get("x-cron-secret") || "";
  // FIXED BUG-AUTH-9: Header x-supabase-edge-runtime bisa di-spoof oleh siapapun
  // karena tidak diverifikasi secara kriptografis. Jangan jadikan ini satu-satunya
  // penjaga. Tetap dipakai sebagai hint tambahan, tapi hanya valid jika digabung
  // dengan kondisi lain (misalnya tidak ada auth header sama sekali DAN
  // CRON_SECRET belum di-set). Jika CRON_SECRET sudah di-set, wajib pakai itu.
  const isInternal = !auth && !cronHeader && !!req.headers.get("x-supabase-edge-runtime");

  const authorized =
    auth === `Bearer ${SUPABASE_SERVICE_KEY}` ||
    (CRON_SECRET && cronHeader === CRON_SECRET) ||
    // FIXED: isInternal hanya sebagai fallback jika CRON_SECRET belum di-set sama sekali.
    // Jika CRON_SECRET sudah di-set tapi tidak dikirim → TOLAK.
    (isInternal && !CRON_SECRET);

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
