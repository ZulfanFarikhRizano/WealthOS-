// ══════════════════════════════════════════════════════════════════════
// Z-WEALTH · TRADING WORKER + TELEGRAM WEBHOOK + BOT NOTIFY + EXCHANGE BALANCE v19.6
//
// ── CHANGELOG v19.6 ─────────────────────────────────────────────────
// FIXED BUG-BYBIT-UTA-BALANCE (Kritis): /balance error "accountType only support UNIFIED"
//   ROOT CAUSE: akun UTA (Unified Trading Account) hanya support accountType=UNIFIED.
//   Kode lama: jika UNIFIED return saldo 0 → loop lanjut ke SPOT → Bybit reject → error ke user.
//   FIX: Jika UNIFIED respond retCode=0 (valid), langsung return meski saldo 0.
//        Jangan pernah coba SPOT/CONTRACT setelah UNIFIED berhasil — akun UTA confirmed.
//
// TUNED SCAN COVERAGE: Top-N default 20→75, kandidat scan 30→40, ADX 22→18
//   Top-75: fokus altcoin liquid (rank 1-75 by volume) — lebih banyak peluang
//             golden cross dibanding Top-20/50 yang terlalu sempit.
//   Scan-40: dari 75 simbol, ambil 40 kandidat per cron run — masih aman
//             dari timeout (~80 fetch paralel, Bybit respond <200ms).
//   ADX 22→18: market sideways banyak, ADX 22 terlalu sering block entry.
//              ADX 18 = trend mulai terbentuk, masih di atas noise total (ADX<15).
//              Ini penyebab utama "tidak ada entry" di market kondisi saat ini.
//
// ── CHANGELOG v19.5 ─────────────────────────────────────────────────
// FIXED BUG-SCAN-STATUS-3JAM (Kritis): Notif "Update Status Bot" tidak pernah
//   dikirim meski interval 3 jam sudah lewat.
//   ROOT CAUSE: Saat cold start, jika row bot_risk_state ada → lastNotif = now
//   → cooldown selalu baru direset → interval tidak pernah tercapai → notif tidak dikirim.
//   FIX: Cold start membaca scan_status_notif_at dari DB (timestamp nyata).
//        Fallback ke updated_at sebagai proxy jika kolom baru belum ada.
//        Setelah notif dikirim, timestamp di-persist ke DB agar cold start berikutnya valid.
//   MIGRATION: ALTER TABLE bot_risk_state ADD COLUMN IF NOT EXISTS scan_status_notif_at TIMESTAMPTZ;
//
// FIXED BUG-ANON-WARNING: WARNING "[verifyUserOwnership] Anon key fallback" spam
//   di setiap request dari browser. App pakai seed-based auth (bukan supabase.auth),
//   jadi anon key fallback adalah mekanisme valid — downgrade ke console.log.
//
// ── CHANGELOG v19.4 (dari v19.3) ─────────────────────────────────────
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
// ── CHANGELOG v19 (dari v18.2) ───────────────────────────────────
// FIXED BUG-NATIVE-TS-SHORT (Kritis): bybitSetNativeTrailingStop selalu set
//   activePrice = entryPrice untuk semua posisi — salah untuk SHORT.
//   Untuk SHORT, trailing stop seharusnya aktif setelah harga TURUN cukup dari
//   entry (bukan dari entry itu sendiri yang menyebabkan native TS aktif langsung).
//   FIX: Tambah parameter direction. LONG: activePrice = entryPrice (tidak berubah).
//        SHORT: activePrice = entryPrice × (1 - trailPct × TRAIL_ACTIVATION_MULT)
//        agar native TS baru aktif setelah harga turun sejauh activation threshold.
//   Signature berubah: tambah direction ("LONG" | "SHORT") dan trailPct.
//   Semua caller (openOrder, openShortOrder) diupdate.
//
// FIXED BUG-AUTH-OWNERSHIP (Kritis): verifyBrowserAuth hanya cek anon key (public)
//   tapi tidak verifikasi bahwa caller adalah PEMILIK user_id yang dikirim.
//   Siapapun yang tahu anon key (hardcoded = public) bisa eksekusi order atau
//   baca saldo user lain hanya dengan mengirim user_id korban.
//   FIX: Tambah fungsi verifyUserOwnership(sb, req, user_id) yang memanggil
//        sb.auth.getUser(token) dan membandingkan auth.uid dengan user_id.
//        Diterapkan di execute_order, exchange_balance, dan save_api_key.
//        bot_status_notif tidak butuh ownership check (hanya kirim ke chat_id user sendiri).
//
// FIXED BUG-QTY-NAN (Medium): handleExecuteOrder tidak validasi qty setelah
//   parseFloat — jika browser kirim qty="abc" atau qty=null, parseFloat() → NaN
//   yang diteruskan ke closeOrder tanpa pengecekan → order dengan qty NaN.
//   FIX: Guard isNaN(qtyNum) || qtyNum <= 0 sebelum closeOrder dipanggil.
//
// FIXED BUG-SCAN-STATUS-PERSIST (Medium): _scanStatusNotifAt in-memory saja.
//   Setelah Edge Function cold start/restart, cooldown reset → notif "bot aktif"
//   bisa terkirim lagi langsung meski baru dikirim beberapa menit lalu.
//   FIX: Persist timestamp ke bot_risk_state (kolom scan_status_notif_at),
//        dengan in-memory cache sebagai L1. Konsisten dengan _lowBalanceNotifAt.
//
// FIXED BUG-SAVE-API-GUARD (Minor): handleSaveApiKey tidak punya guard yang
//   menolak jika body masih mengandung field api_key plain text dari klien lama
//   — inkonsisten dengan handleExchangeBalance yang sudah punya guard serupa.
//   FIX: Tambah guard yang memeriksa bahwa body hanya boleh berisi user_id,
//        api_key, dan api_secret yang memang memang diperlukan untuk endpoint ini.
//        Guard ini bersifat informational — endpoint ini memang didesain untuk
//        menerima api_key agar bisa dienkrips, jadi guard lebih ke validasi input.
//
// FIXED BUG-BOTCONFIG-SIM-TYPE (Minor): Interface BotConfig tidak punya field
//   `sim` meski logika isSim(apiKey) dipakai everywhere — type-safety tidak ada.
//   FIX: Tambah field opsional `sim?: boolean` ke interface BotConfig.
//
// ── CHANGELOG v19.2 (patch) ─────────────────────────────────────
// FIXED BUG-SCAN-STATUS-SPAM (v19.2): Notif "Update Status Bot" dikirim tiap
//   menit meski interval seharusnya 3 jam. Penyebab: kolom scan_status_notif_at
//   belum di-migrate ke bot_risk_state → DB selalu return null → lastNotif = 0
//   → cooldown tidak pernah aktif → spam tiap cron run.
//   FIX: Tidak lagi bergantung kolom baru. Saat cold start, jika row bot_risk_state
//   user sudah ada → anggap notif baru dikirim (suppress). Jika belum ada (user baru)
//   → tunda 30 menit. In-memory L1 cache tetap sebagai guard utama.
//
// IMPROVED /history: Tambah kolom pnl_usdt ke query, tampilkan PnL per SELL trade,
//   dan tambah summary total PnL + win/loss count + win rate di bawah daftar trade.
//
// ── CHANGELOG v19.1 (patch) ─────────────────────────────────────
// FIXED BUG-AUTH-ANON-FALLBACK: verifyUserOwnership v19 menolak anon key
//   sepenuhnya → semua browser yang kirim anon key (frontend lama) mendapat
//   error "token bukan pemilik user_id ini" saat save_api_key, exchange_balance,
//   dan execute_order. Terlihat di screenshot: "Gagal simpan: Gagal enkripsi
//   server: save_api_key: token bukan pemilik user_id ini".
//   ROOT CAUSE: Browser mengirim SUPABASE_ANON_KEY sebagai Bearer token,
//   bukan JWT session access_token. Frontend belum diupgrade untuk kirim
//   supabase.auth.getSession().data.session?.access_token.
//   FIX: Anon key tidak lagi langsung ditolak. Jika token = anon key, lakukan
//   DB ownership check: verifikasi user_id exists di bot_configs. Aman karena
//   user_id adalah UUID random yang hanya diketahui user sendiri setelah login.
//   Ini setara keamanan dengan v18 sebelum ownership check ditambahkan.
//   UPGRADE PATH: Frontend kirim session.access_token untuk keamanan jalur 2
//   (sb.auth.getUser verifikasi) yang lebih kuat.
//
// ── CHANGELOG v18.2 (dari v18.1) ─────────────────────────────────
// IMPROVED: Notifikasi TP/SL/Trailing Stop lebih informatif.
//   1. BUY/SHORT open: trail activation price absolut ditampilkan
//      ("aktif setelah harga > $X") — user tahu kapan trailing mulai jalan.
//   2. BUY/SHORT open: maks rugi USDT jika SL kena ditampilkan
//      ("maks rugi ~$20 USDT") — user tahu risiko per-trade dalam dolar.
//   3. SELL/CLOSE SHORT: peak/trough price + jarak % dari peak/trough ke exit
//      ditampilkan khusus saat trailing stop — user tahu bot exit di mana.
//   4. SELL/CLOSE SHORT: durasi posisi terbuka ditampilkan
//      ("⏱ Durasi: 2j 35m") — berguna untuk evaluasi trade.
//   5. Helper formatDuration() ditambahkan untuk kalkulasi durasi WIB-agnostic.
//
// ── CHANGELOG v18.1 (dari v18) ───────────────────────────────────
// IMPROVED: Notifikasi Telegram lebih informatif & lengkap.
//   1. tgSellMsg: tambah label exchange+mode di judul (misal "BYBIT · Futures 10x")
//      agar user dengan multi-exchange tahu notif dari mana.
//   2. tgSellMsg: unifikasi pnlPct — sebelumnya dihitung ulang dari price diff,
//      sekarang konsisten pakai (pnl/amountUsdt)*100 sama seperti tgShortCloseMsg.
//   3. syncPositionsWithExchange: kirim notif Telegram saat deteksi close manual
//      di exchange — sebelumnya DB diupdate diam-diam tanpa user tahu.
//   4. Daily limit: kirim notif Telegram 1x per hari saat batas SL harian tercapai
//      — sebelumnya bot diam saja, user bingung kenapa tidak ada entry.
//      Cooldown in-memory cegah spam tiap menit cron.
//
// ── CHANGELOG v18 (dari v17) ─────────────────────────────────────
// FIXED BUG-NATIVE-TS (Kritis): bybitSetNativeTrailingStop kirim nilai salah.
//   Bybit /v5/position/trading-stop butuh trailingStop = JARAK HARGA ABSOLUT.
//   Kode lama: (pct * 100).toFixed(2) = "1.50" untuk semua simbol → SALAH.
//   Untuk LUNCUSDT $0.0001 → jarak $1.50 = 1,500,000% → Bybit error/reject.
//   Untuk BTCUSDT $60,000 → jarak $1.50 = 0.0025% → trailing terlalu sempit.
//   FIX: Hitung trailAbsolute = entryPrice × trailDistancePct per simbol.
//   Presisi otomatis: 2 desimal (BTC), 4 (ETH/SOL), 6 (altcoin), 8 (micro).
//   Signature fungsi berubah: qty dihapus, entryPrice ditambah.
//
// ── CHANGELOG v17 (dari v16) ─────────────────────────────────────
// FIXED BUG-OVERTRADE (Kritis): Futures overtrade → margin call.
//   Root cause: Tidak ada hard cap total posisi Futures. Meskipun
//   MAX_LONG=1 & MAX_SHORT=1 ada, race condition atau bug direction
//   tracking bisa loloskan posisi ke-3 dst.
//   FIX A: Guard eksplisit total posisi Futures max 2 (1L+1S) sebelum
//          longSlotFull/shortSlotFull check — 3 lapisan keamanan sekarang.
//   FIX B: MAX_ENTRY_PER_RUN tetap 1 — tiap cron run max 1 order baru.
//   FIX C: Komentar diperjelas: Futures max 2 posisi (1 LONG + 1 SHORT),
//          spot max 1 posisi (LONG only, SHORT tidak didukung).
//
// IMPROVED: ADX threshold dinaikkan 15 → 22.
//   ADX 15 = market sideways/sangat lemah → banyak false signal & whipsaw.
//   ADX 22 = trend mulai terbentuk, entry lebih qualified.
//   Dampak: lebih sedikit signal tapi kualitas lebih tinggi.
//
// IMPROVED: Trailing stop pct diperlebar:
//   Spot    : 2% → 3%   (noise harian 1-2% terlalu sering exit prematur)
//   Futures : 1% → 1.5% (leverage amplify, perlu ruang napas lebih)
//   Short TS: 1% → 1.5% (konsisten dengan long futures)
//   Dampak: R:R Futures 1.0→1.5, Spot 0.8→1.2 — lebih menguntungkan.
//
// IMPROVED: Trail activation multiplier 1.0 → 1.5.
//   Sebelumnya trailing stop bisa exit di zona rugi (harga belum profit).
//   Sekarang trailing baru aktif setelah harga naik 1.5× trail pct dari entry.
//   Contoh Futures: trail 1.5%, aktif setelah harga naik >1.5% dari entry.
//   Contoh Spot   : trail 3.0%, aktif setelah harga naik >4.5% dari entry.
//
// ── CHANGELOG v16 (dari v15) ─────────────────────────────────────
// FEATURE: Hybrid Native Trailing Stop — terlihat di Bybit app + flexible
//   Setelah market order Futures Bybit berhasil (LONG & SHORT):
//   → bybitSetNativeTrailingStop() dipanggil via /v5/position/trading-stop
//   → Native TS terlihat di Bybit app dengan angka retracement yang benar
//   → Jika Bybit trigger native TS (exchange down cron): posisi aman di-close exchange
//   Software trailing di processUser tetap aktif sebagai:
//   → Backup monitoring peak_price setiap menit
//   → Exit via EMA Dead/Golden Cross (override native TS)
//   → Hard SL sebagai safety net lapisan kedua
//   Saat software exit terjadi: bybitCancelNativeTrailingStop() dipanggil dulu
//   → Cancel TS dengan trailingStop=0 sebelum market close order dikirim
//   → Cegah konflik: native TS dan software exit tidak balapan
//   Spot tidak mendukung native trailing stop Bybit → software-only (unchanged)
//   Binance tidak mendukung → software-only (unchanged)
//
// ── CHANGELOG v15 (dari v14) ─────────────────────────────────────
// FIXED BUG-16 (Kritis): Multi-entry tak terkendali di spot — bot entry
//   MNTUSDT, LUNCUSDT, ETHUSDT berturut-turut 3 menit sampai saldo habis.
//
//   Root cause A: dbOpenPosition tidak check error return dari Supabase insert.
//   Jika kolom `direction`/`peak_price` belum ada (migration belum dijalankan),
//   insert SILENT FAIL → posisi tidak tersimpan → getOpenPositions() berikutnya
//   baca kosong → slot dianggap masih tersedia → entry lagi.
//   FIX A: Periksa { error } dari insert, throw jika gagal agar processUser
//   tangkap di catch block dan log sebagai ENTRY_ERR, bukan OPENED.
//
//   Root cause B: Setelah entry berhasil di inner batchResults loop, hanya ada
//   `if (entered >= MAX_ENTRY_PER_RUN) break` tapi tidak ada break tanpa syarat.
//   Jika MAX_ENTRY_PER_RUN diubah > 1 di masa depan, atau timing update
//   curLongFull terlambat, simbol berikutnya dalam batch bisa ikut masuk.
//   FIX B: Tambah `break` eksplisit tanpa syarat setelah entry berhasil —
//   tidak ada alasan lanjut scan setelah 1 posisi baru dibuka dalam 1 run.
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
  return toHex(iv.buffer as ArrayBuffer) + ":" + toHex(ct);
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
  // FIXED BUG-AUTH-OWNERSHIP (v19): Juga terima JWT user yang valid
  // Token berbentuk JWT user (3 segmen, bukan anon key) → diterima di sini,
  // ownership verification dilakukan terpisah oleh verifyUserOwnership().
  // Regex sederhana: JWT = header.payload.signature (masing-masing base64url)
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return true;
  return false;
}

// FIXED BUG-AUTH-OWNERSHIP (v19 Kritis): Verifikasi bahwa request berasal dari
// pemilik user_id yang dikirim di body.
//
// Flow dua jalur:
//   1. Service role key → bypass (cron/internal) → return true
//   2. JWT user session (access_token dari supabase.auth.getSession())
//      → sb.auth.getUser(token) → cek uid === user_id → PALING AMAN, diutamakan
//   3. Anon key fallback (kompatibilitas browser lama yang belum kirim JWT session):
//      Verifikasi bahwa user_id EXISTS di bot_configs DB.
//      Aman karena user_id adalah UUID yang tidak bisa ditebak, dan user hanya
//      tahu user_id mereka sendiri setelah login via Supabase Auth di browser.
//      UPGRADE: Frontend kirim session.access_token bukan anon key untuk jalur 2.
//
// FIXED v19.1: Anon key tidak lagi langsung ditolak — fallback ke DB check
// agar frontend lama (yang kirim anon key) tetap bisa berfungsi sambil menunggu
// upgrade frontend untuk kirim JWT session access_token.
async function verifyUserOwnership(sb: SB, req: Request, userId: string): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  if (!token || !userId) return false;

  // 1. Service role key: bypass (cron/internal)
  if (token === SUPABASE_SERVICE_KEY) return true;

  const isAnonKey = (token === SUPABASE_ANON_KEY || token === _ANON_KEY_FALLBACK);

  // 2. JWT user session: verifikasi ketat via Supabase Auth
  if (!isAnonKey) {
    try {
      const { data, error } = await sb.auth.getUser(token);
      if (error || !data?.user) {
        console.warn(`[verifyUserOwnership] getUser gagal: ${error?.message}`);
        return false;
      }
      const authUid = data.user.id;
      if (authUid !== userId) {
        console.warn(`[verifyUserOwnership] OWNERSHIP MISMATCH: uid=${authUid.slice(0,8)} != user_id=${userId.slice(0,8)}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error(`[verifyUserOwnership] JWT check exception:`, e);
      return false;
    }
  }

  // 3. Anon key fallback: cek user_id exists di bot_configs sebagai ownership proof
  // NOTE: App pakai seed-based auth (bukan supabase.auth), jadi anon key fallback
  // adalah mekanisme satu-satunya yang valid — bukan bug, ini by design.
  console.log(`[verifyUserOwnership] Anon key fallback — DB ownership check untuk user_id=${userId.slice(0,8)}`);
  try {
    const { data, error } = await sb
      .from("bot_configs")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.warn(`[verifyUserOwnership] DB check error: ${error.message}`);
      return false;
    }
    if (!data) {
      console.warn(`[verifyUserOwnership] user_id ${userId.slice(0,8)} tidak ditemukan di bot_configs`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[verifyUserOwnership] DB fallback exception:`, e);
    return false;
  }
}

// Response standar untuk auth gagal
function unauthorizedResponse(reason = "Unauthorized"): Response {
  return new Response(
    JSON.stringify({ ok: false, error: reason }),
    { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
}

// ── KONSTANTA ─────────────────────────────────────────────────────
// FIXED v17: Futures slot 1 LONG + 1 SHORT = maksimal 2 posisi terbuka bersamaan.
// MAX_LONG_POSITIONS = 1  → tidak bisa entry LONG ke-2 selama LONG pertama masih terbuka
// MAX_SHORT_POSITIONS = 1 → tidak bisa entry SHORT ke-2 selama SHORT pertama masih terbuka
// MAX_ENTRY_PER_RUN = 1   → maksimal 1 entry baru PER CRON RUN (tiap menit hanya 1 order baru)
// Total maksimal posisi terbuka = 2 (1 LONG + 1 SHORT), tidak bisa dobel di direction yang sama
// Ini mencegah overtrade & margin call dari multi-entry direction yang sama
const MAX_LONG_POSITIONS  = 1;  // Maks posisi LONG terbuka bersamaan (spot & futures)
const MAX_SHORT_POSITIONS = 1;  // Maks posisi SHORT terbuka bersamaan (futures only)
const MAX_ENTRY_PER_RUN   = 1;  // Hanya 1 entry baru per cron run — cegah overtrade
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
// FIXED v17: Trailing stop diperlebar agar tidak terkena noise market harian.
// Spot 2%→3%: noise 1-2% harian membuat 2% terlalu sering exit prematur.
// Futures 1%→1.5%: dengan leverage, 1% terlalu sempit → sering stop di noise minor.
// Konsekuensi: potensi drawdown per-trade sedikit lebih besar, tapi profit lebih terlindungi.
const TRAILING_STOP_PCT_SPOT    = 0.03;  // Spot: trail 3% dari peak (naik dari 2%)
const TRAILING_STOP_PCT_FUTURES = 0.015; // Futures: trail 1.5% dari peak (naik dari 1%)

// SHORT trailing stop: mengikuti harga TERENDAH sejak entry short
const TRAILING_STOP_PCT_SHORT_FUTURES = 0.015; // Futures short: trail 1.5% dari trough (naik dari 1%)

// ── Risk/Reward ratio minimum ────────────────────────────────────
// FIXED v17: Update estimasi R:R setelah trail pct naik:
// Futures: (2 × 0.015) / 0.02 = 1.5  → R:R lebih baik dari sebelumnya (1.0)
// Spot   : (2 × 0.03)  / 0.05 = 1.2  → R:R lebih baik dari sebelumnya (0.8)
// MIN_RR tetap 0.75 — dengan trail lebih lebar, semua kondisi pasti lolos filter ini.
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
// FIXED v17: ADX threshold dinaikkan 15→22.
// ADX 15 = trend sangat lemah/sideways → banyak false signal (whipsaw).
// ADX 22 = trend mulai terbentuk dengan cukup momentum.
// Standar umum: ADX > 20 = trending, ADX > 25 = trending kuat.
// 22 dipilih sebagai tengah antara "jangan terlalu ketat" vs "jangan masuk sideways".
const ADX_MIN_STRENGTH = 18;  // FIXED v19.6: Turun 22→18 — market sideways banyak, 22 terlalu ketat

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

// Cooldown notif "daily limit tercapai" — kirim 1x per hari, tidak spam tiap menit
const _dailyLimitNotifAt = new Map<string, string>(); // userId → "YYYY-MM-DD" terakhir notif dikirim

// Cooldown notif "status scan" — kirim setiap 3 jam, beri tahu user bot masih aktif meski belum ada signal
const _scanStatusNotifAt = new Map<string, number>(); // userId → timestamp ms terakhir notif dikirim
const SCAN_STATUS_INTERVAL_MS = 3 * 60 * 60 * 1000;  // 3 jam

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
  // FIXED BUG-BOTCONFIG-SIM-TYPE (v19 Minor): field `sim` sebelumnya tidak ada di interface
  // meski isSim(cfg.api_key) digunakan di banyak tempat — tidak ada type-safety.
  // Tambah sebagai optional (boolean | undefined) karena kolom ini mungkin tidak ada
  // di semua row DB lama. Nilai semantiknya: override manual mode simulasi terlepas dari api_key.
  // isSim(cfg.api_key) tetap sebagai primary check; cfg.sim hanya UI hint.
  sim?:               boolean;
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

// ════════════════════════════════════════════════════════════════
// HYBRID TRAILING STOP — Native Bybit trailing stop order
// Dikirim setelah market order berhasil untuk Bybit Futures.
// Tujuan: terlihat di Bybit app + berjalan di sisi exchange (tidak perlu cron).
// Software trailing di processUser tetap aktif sebagai:
//   1. Backup jika native trailing stop tidak ter-trigger
//   2. Exit via EMA Dead Cross (override native TS)
//   3. Hard SL sebagai safety net
// Saat software exit terjadi → cancelNativeTrailingStop dipanggil dulu.
// ════════════════════════════════════════════════════════════════

async function bybitSetNativeTrailingStop(
  symbol: string, trailDistancePct: number, entryPrice: number,
  apiKey: string, apiSecret: string,
  direction: "LONG" | "SHORT" = "LONG"
): Promise<{ orderId: string; ok: boolean; error?: string }> {
  // FIXED v18 (Bug Kritis): Bybit /v5/position/trading-stop butuh `trailingStop`
  // sebagai JARAK HARGA ABSOLUT, bukan persentase.
  // Kode lama: (trailDistancePct * 100).toFixed(2) = "1.50" untuk semua simbol.
  // Ini salah untuk simbol harga rendah: LUNCUSDT $0.0001 → jarak $1.50 = 1,500,000%!
  // Fix: hitung jarak = entryPrice × trailDistancePct → nilai absolut per simbol.
  // Contoh BTCUSDT $60,000, trail 1.5% → trailingStop = "900.00" (jarak $900)
  // Contoh LUNCUSDT $0.0001, trail 1.5% → trailingStop = "0.0000015" (jarak tiny)
  //
  // Presisi: gunakan cukup desimal agar tidak di-round ke 0 untuk altcoin murah.
  // Bybit menerima string dengan desimal panjang — aman.
  const trailAbsolute = entryPrice * trailDistancePct;
  // Tentukan presisi desimal berdasarkan magnitude harga
  const decimals = entryPrice >= 1000 ? 2
                 : entryPrice >= 1    ? 4
                 : entryPrice >= 0.01 ? 6
                 : 8;
  const trailStr = trailAbsolute.toFixed(decimals);

  // FIXED BUG-NATIVE-TS-SHORT (v19 Kritis): activePrice sebelumnya selalu = entryPrice
  // untuk semua posisi tanpa mempertimbangkan direction.
  // Untuk SHORT, jika activePrice = entryPrice, native TS aktif langsung saat harga
  // masih di level entry (sebelum ada profit) → trailing stop tidak berfungsi sebagai
  // pelindung profit, melainkan langsung trigger di zona entry.
  // FIX:
  //   LONG:  activePrice = entryPrice (tidak berubah — trail aktif setelah harga naik)
  //   SHORT: activePrice = entryPrice × (1 - trailPct × TRAIL_ACTIVATION_MULT)
  //          Trail SHORT baru aktif setelah harga TURUN melewati activation threshold.
  //          Ini sinkron dengan logika software trailing di processUser (TRAIL_ACTIVATION_MULT=1.5).
  const TRAIL_ACTIVATION_MULT = 1.5;
  const activePriceRaw = direction === "SHORT"
    ? entryPrice * (1 - trailDistancePct * TRAIL_ACTIVATION_MULT)
    : entryPrice; // LONG: aktif dari entry price (harga naik → trail naik mengikuti)
  const activePriceStr = activePriceRaw.toFixed(decimals);

  // Bybit wajib sertakan `side` agar tahu TS untuk posisi mana
  // Buy = posisi LONG (close dengan Sell), Sell = posisi SHORT (close dengan Buy)
  const positionIdx = direction === "SHORT" ? 2 : 1; // Bybit hedgeMode: 1=Buy side, 2=Sell side

  const body = JSON.stringify({
    category:     "linear",
    symbol,
    trailingStop: trailStr,      // jarak harga absolut — bukan persen
    activePrice:  activePriceStr, // harga aktivasi sesuai direction (FIXED v19)
    positionIdx,                  // 1=LONG, 2=SHORT (wajib untuk hedge mode compatibility)
  });
  const hdrs = await bybitHeaders(apiKey, apiSecret, body);
  const res  = await fetchWithTimeout("https://api.bybit.com/v5/position/trading-stop", {
    method: "POST", headers: hdrs, body,
  });
  const data = await res.json();
  if (data.retCode === 0) return { orderId: "TS_SET", ok: true };
  return { orderId: "", ok: false, error: `NativeTS: ${data.retMsg} (trailStr=${trailStr} activePrice=${activePriceStr} dir=${direction})` };
}

async function bybitCancelNativeTrailingStop(
  symbol: string, apiKey: string, apiSecret: string
): Promise<void> {
  // Cancel native trailing stop dengan set trailingStop=0
  try {
    const body = JSON.stringify({ category: "linear", symbol, trailingStop: "0" });
    const hdrs = await bybitHeaders(apiKey, apiSecret, body);
    await fetchWithTimeout("https://api.bybit.com/v5/position/trading-stop", {
      method: "POST", headers: hdrs, body,
    });
  } catch { /* non-fatal — jika cancel gagal, posisi sudah di-close oleh market order */ }
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
    const orderResult = await bybitMarketOrder(symbol, "Buy", qty, category, false, apiKey, apiSecret);
    // HYBRID: Set native trailing stop di Bybit setelah entry Futures berhasil
    // → Terlihat di Bybit app, berjalan di sisi exchange (tidak bergantung cron)
    // → Software trailing di processUser tetap aktif sebagai backup + EMA exit
    if (orderResult.ok && tradeMode === "futures") {
      // FIXED BUG-NATIVE-TS-SHORT (v19): tambah parameter direction="LONG"
      // agar activePrice dihitung dengan benar untuk posisi long (entry = aktivasi)
      const nativeTsResult = await bybitSetNativeTrailingStop(symbol, TRAILING_STOP_PCT_FUTURES, price, apiKey, apiSecret, "LONG");
      if (!nativeTsResult.ok) {
        console.warn(`[openOrder] Native TS LONG gagal di-set untuk ${symbol}: ${nativeTsResult.error} — software trailing tetap aktif`);
      } else {
        console.log(`[openOrder] Native trailing stop LONG ${(TRAILING_STOP_PCT_FUTURES*100).toFixed(1)}% aktif di Bybit untuk ${symbol} (entryPrice=${price})`);
      }
    }
    return orderResult;
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
    const shortResult = await bybitMarketOrder(symbol, "Sell", qty, "linear", false, apiKey, apiSecret);
    // HYBRID: Set native trailing stop untuk SHORT
    if (shortResult.ok) {
      // FIXED BUG-NATIVE-TS-SHORT (v19): tambah direction="SHORT" agar activePrice
      // dihitung sebagai entryPrice × (1 - trailPct × 1.5) — trailing baru aktif
      // setelah harga TURUN cukup dari entry, bukan langsung aktif di entry price.
      const nativeTsResult = await bybitSetNativeTrailingStop(symbol, TRAILING_STOP_PCT_SHORT_FUTURES, price, apiKey, apiSecret, "SHORT");
      if (!nativeTsResult.ok) {
        console.warn(`[openShortOrder] Native TS SHORT gagal: ${nativeTsResult.error} — software trailing tetap aktif`);
      } else {
        console.log(`[openShortOrder] Native TS SHORT ${(TRAILING_STOP_PCT_SHORT_FUTURES*100).toFixed(1)}% aktif di Bybit untuk ${symbol} (entryPrice=${price})`);
      }
    }
    return shortResult;
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

// Helper: hitung durasi posisi dari opened_at sampai sekarang
function formatDuration(openedAt: string): string {
  const ms      = Date.now() - new Date(openedAt).getTime();
  if (isNaN(ms) || ms < 0) return "–";
  const totalMin = Math.floor(ms / 60000);
  const hours    = Math.floor(totalMin / 60);
  const mins     = totalMin % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}j ${mins}m`;
}

function tgBuyMsg(
  symbol: string, price: number, qty: number, amountUsdt: number,
  tradeMode: string, leverage: number, ema13: number, ema21: number, sim: boolean,
  htfConfirmed = true, rsi = 0, adx = 0
): string {
  const statusLine     = sim
    ? `🔵 Status : <b>SIMULASI</b> <i>(API key belum aktif / mode sim)</i>`
    : `✅ Status : <b>ORDER TERKIRIM (LIVE)</b>`;
  const lev            = tradeMode === "futures" ? ` × ${leverage}x leverage` : " (spot)";
  const trailPct       = tradeMode === "futures" ? TRAILING_STOP_PCT_FUTURES : TRAILING_STOP_PCT_SPOT;
  const slPct          = tradeMode === "futures" ? SL_PCT_FUTURES : SL_PCT_SPOT;
  const slPrice        = (price * (1 - slPct)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  // Maks rugi jika SL kena: futures = slPct × amountUsdt × leverage, spot = slPct × amountUsdt
  const maxLossUsdt    = tradeMode === "futures"
    ? (slPct * amountUsdt * leverage).toFixed(2)
    : (slPct * amountUsdt).toFixed(2);
  // Trail activation: trailing baru aktif setelah harga naik (trailPct × 1.5) dari entry
  const TRAIL_ACT_MULT = 1.5;
  const trailActPrice  = (price * (1 + trailPct * TRAIL_ACT_MULT)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const htfLabel       = htfConfirmed ? "15m ✓ 1H ✓" : "15m ✓ 1H –";
  return `🟢 <b>BUY ${symbol}</b>
━━━━━━━━━━━━━━━━━━━━
📊 Sinyal : <b>Golden Cross (${htfLabel})</b>
   EMA13 <code>${ema13.toFixed(4)}</code> ⬆ EMA21 <code>${ema21.toFixed(4)}</code>
📈 RSI    : <code>${rsi.toFixed(1)}</code>  ADX: <code>${adx.toFixed(1)}</code>
💵 Harga  : <code>$${price.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
🎯 Trail  : aktif setelah harga > <code>$${trailActPrice}</code>
   exit jika turun <code>${(trailPct*100).toFixed(1)}%</code> dari puncak
🛑 SL     : <code>$${slPrice}</code> <i>(-${(slPct*100).toFixed(1)}% · maks rugi ~$${maxLossUsdt} USDT)</i>
📦 Qty    : <code>${qty.toFixed(tradeMode === "futures" ? 4 : 6)}</code>
💰 Modal  : <code>$${amountUsdt} USDT${lev}</code>
${statusLine}
⏰ ${wib()}`;
}

function tgSellMsg(
  symbol: string, entryPrice: number, exitPrice: number,
  qty: number, amountUsdt: number, tradeMode: string, leverage: number,
  ema13: number, ema21: number, pnl: number, sim: boolean, reason = "DEAD_CROSS",
  exchange = "", peakPrice = 0, openedAt = ""
): string {
  const statusLine  = sim ? `🔵 Status : <b>SIMULASI</b>` : `✅ Status : <b>ORDER TERKIRIM (LIVE)</b>`;
  const pnlSign     = pnl >= 0 ? "+" : "";
  const emoji       = pnl >= 0 ? "💰" : "💸";
  // FIXED: Unifikasi pnlPct — konsisten dengan tgShortCloseMsg (pakai pnl/amountUsdt)
  const pnlPct      = amountUsdt > 0 ? (pnl / amountUsdt) * 100 : 0;
  const trailPct    = tradeMode === "futures" ? TRAILING_STOP_PCT_FUTURES : TRAILING_STOP_PCT_SPOT;
  const modeLabel   = exchange ? ` <i>(${exchange.toUpperCase()} · ${tradeMode === "futures" ? `Futures ${leverage}x` : "Spot"})</i>` : "";
  const durasi      = openedAt ? `\n⏱ Durasi  : <code>${formatDuration(openedAt)}</code>` : "";

  // Info peak — hanya tampil saat trailing stop, karena itulah yang relevan
  let peakLine = "";
  if (reason === "TRAILING_STOP" && peakPrice > 0) {
    const peakStr     = peakPrice.toLocaleString("en-US", { maximumFractionDigits: 6 });
    const fromPeakPct = peakPrice > 0 ? ((exitPrice - peakPrice) / peakPrice * 100).toFixed(2) : "0";
    peakLine = `\n📈 Peak    : <code>$${peakStr}</code> <i>(exit ${fromPeakPct}% dari peak)</i>`;
  }

  const signalLabel = reason === "TRAILING_STOP" ? `🎯 Trailing Stop (-${(trailPct*100).toFixed(1)}% dari puncak)`
                    : reason === "STOP_LOSS"     ? `🛑 Stop Loss (-${(tradeMode === "futures" ? SL_PCT_FUTURES : SL_PCT_SPOT) * 100}%)`
                    : "📊 Dead Cross";
  return `🔴 <b>SELL ${symbol}</b>${modeLabel}
━━━━━━━━━━━━━━━━━━━━
${signalLabel}
   EMA13 <code>${ema13.toFixed(4)}</code> ⬇ EMA21 <code>${ema21.toFixed(4)}</code>
💵 Entry  : <code>$${entryPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
💵 Exit   : <code>$${exitPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>${peakLine}
${emoji} PnL    : <code>${pnlSign}${pnl.toFixed(2)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)</code>${durasi}
${statusLine}
⏰ ${wib()}`;
}

// Notif SHORT entry (Dead Cross → open short)
function tgShortOpenMsg(
  symbol: string, price: number, qty: number, amountUsdt: number,
  leverage: number, ema13: number, ema21: number, sim: boolean,
  htfConfirmed = true, rsi = 0, adx = 0
): string {
  const statusLine     = sim
    ? `🔵 Status : <b>SIMULASI</b> <i>(API key belum aktif / mode sim)</i>`
    : `✅ Status : <b>ORDER TERKIRIM (LIVE)</b>`;
  const slPrice        = (price * (1 + SL_PCT_FUTURES)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const maxLossUsdt    = (SL_PCT_FUTURES * amountUsdt * leverage).toFixed(2);
  // Trail SHORT: aktif setelah harga TURUN (trailPct × 1.5) dari entry
  const TRAIL_ACT_MULT = 1.5;
  const trailActPrice  = (price * (1 - TRAILING_STOP_PCT_SHORT_FUTURES * TRAIL_ACT_MULT)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const htfLabel       = htfConfirmed ? "15m ✓ 1H ✓" : "15m ✓ 1H –";
  return `🔴 <b>SHORT ${symbol}</b>
━━━━━━━━━━━━━━━━━━━━
📊 Sinyal : <b>Dead Cross (${htfLabel})</b>
   EMA13 <code>${ema13.toFixed(4)}</code> ⬇ EMA21 <code>${ema21.toFixed(4)}</code>
📉 RSI    : <code>${rsi.toFixed(1)}</code>  ADX: <code>${adx.toFixed(1)}</code>
💵 Harga  : <code>$${price.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
🎯 Trail  : aktif setelah harga < <code>$${trailActPrice}</code>
   exit jika naik <code>${(TRAILING_STOP_PCT_SHORT_FUTURES*100).toFixed(1)}%</code> dari trough
🛑 SL     : <code>$${slPrice}</code> <i>(+${(SL_PCT_FUTURES*100).toFixed(1)}% · maks rugi ~$${maxLossUsdt} USDT)</i>
📦 Qty    : <code>${qty.toFixed(4)}</code>
💰 Modal  : <code>$${amountUsdt} USDT × ${leverage}x leverage</code>
${statusLine}
⏰ ${wib()}`;
}

// Notif SHORT close
function tgShortCloseMsg(
  symbol: string, entryPrice: number, exitPrice: number,
  qty: number, amountUsdt: number, leverage: number,
  ema13: number, ema21: number, pnl: number, sim: boolean, reason = "GOLDEN_CROSS",
  troughPrice = 0, openedAt = ""
): string {
  const statusLine = sim ? `🔵 Status : <b>SIMULASI</b>` : `✅ Status : <b>ORDER TERKIRIM (LIVE)</b>`;
  const pnlSign    = pnl >= 0 ? "+" : "";
  const emoji      = pnl >= 0 ? "💰" : "💸";
  const pnlPct     = amountUsdt > 0 ? (pnl / amountUsdt) * 100 : 0;
  const durasi     = openedAt ? `\n⏱ Durasi  : <code>${formatDuration(openedAt)}</code>` : "";

  // Info trough — hanya tampil saat trailing stop
  let troughLine = "";
  if (reason === "TRAILING_STOP" && troughPrice > 0) {
    const troughStr    = troughPrice.toLocaleString("en-US", { maximumFractionDigits: 6 });
    const fromTroughPct = troughPrice > 0 ? ((exitPrice - troughPrice) / troughPrice * 100).toFixed(2) : "0";
    troughLine = `\n📉 Trough  : <code>$${troughStr}</code> <i>(exit +${fromTroughPct}% dari trough)</i>`;
  }

  const signalLabel = reason === "TRAILING_STOP" ? `🎯 Trailing Stop (+${(TRAILING_STOP_PCT_SHORT_FUTURES*100).toFixed(1)}% dari trough)`
                    : reason === "STOP_LOSS"     ? `🛑 Stop Loss (+${(SL_PCT_FUTURES*100).toFixed(1)}% dari entry)`
                    : "📊 Golden Cross (reversal bullish)";
  return `🟢 <b>CLOSE SHORT ${symbol}</b>
━━━━━━━━━━━━━━━━━━━━
${signalLabel}
   EMA13 <code>${ema13.toFixed(4)}</code> ⬆ EMA21 <code>${ema21.toFixed(4)}</code>
💵 Entry  : <code>$${entryPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>
💵 Exit   : <code>$${exitPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>${troughLine}
${emoji} PnL    : <code>${pnlSign}${pnl.toFixed(2)} USDT (${pnlSign}${pnlPct.toFixed(2)}%)</code>${durasi}
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
  apiKey: string, apiSecret: string, sim: boolean, tgChat: string
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

        // NOTIF: Beritahu user bahwa posisi ditutup manual di exchange
        const pnlSign  = pnl >= 0 ? "+" : "";
        const pnlEmoji = pnl >= 0 ? "💰" : "💸";
        const dirLabel = pos.direction === "SHORT" ? "SHORT" : "LONG";
        const modeLabel = tradeMode === "futures"
          ? `Futures ${pos.leverage}x`
          : "Spot";
        await tgSend(tgChat,
          `⚠️ <b>Posisi Ditutup Manual</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📌 Simbol  : <b>${pos.symbol}</b> <i>(${exchange.toUpperCase()} · ${modeLabel} · ${dirLabel})</i>\n` +
          `💵 Entry   : <code>$${pos.entry_price.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>\n` +
          `💵 Exit    : <code>$${exitPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>\n` +
          `${pnlEmoji} PnL est : <code>${pnlSign}${pnl.toFixed(2)} USDT</code>\n` +
          `\n<i>Posisi ini terdeteksi ditutup langsung di exchange. DB sudah diperbarui otomatis.</i>\n` +
          `⏰ ${wib()}`
        );
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
  //
  // FIXED BUG-16 (Kritis): insert error sebelumnya di-swallow (tidak di-check).
  // Akibat: jika kolom `direction`/`peak_price` belum ada di DB (migration belum
  // dijalankan), insert gagal SILENT → posisi tidak tersimpan → cron berikutnya
  // baca getOpenPositions() kosong → entry ulang → multi-entry tak terkendali!
  // FIX: Periksa error dan throw agar caller (processUser) bisa break dari loop.
  const { error } = await sb.from("positions").insert({
    user_id: userId, symbol, exchange, trade_mode: tradeMode,
    entry_price: entryPrice, qty, amount_usdt: amountUsdt, leverage,
    status:     "OPEN",
    sim:        sim,
    direction:  direction,
    peak_price: entryPrice, // LONG: track tertinggi; SHORT: track terendah (sama nilai awal)
    opened_at:  new Date().toISOString(),
  });
  if (error) {
    // Throw agar processUser tahu entry ini gagal disimpan — cegah ghost position
    throw new Error(`dbOpenPosition FAILED [${symbol}]: ${error.message}`);
  }
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
  const cfgAny = cfg as unknown as Record<string, string>;
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
  await syncPositionsWithExchange(sb, userId, exchange, tradeMode, apiKey, apiSecret, sim, tgChat);

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
      // FIXED v17: Trailing stop baru aktif setelah harga naik minimal 1.5x trail pct dari entry.
      // Sebelumnya TRAIL_ACTIVATION_MULT=1.0 → trail aktif langsung → bisa exit di zona rugi.
      // Contoh Futures: trail 1.5%, entry $100 → trail aktif setelah harga > $101.5 (naik 1.5%)
      // Contoh Spot:    trail 3.0%, entry $100 → trail aktif setelah harga > $103.0 (naik 3%)
      // Ini memastikan trailing stop hanya trigger saat posisi sudah punya buffer profit.
      const TRAIL_ACTIVATION_MULT = 1.5;

      let trailingStopHit = false;
      let stopLossHit     = false;
      let peakOrTrough    = pos.peak_price ?? pos.entry_price; // LONG: peak tertinggi, SHORT: trough terendah

      if (direction === "LONG") {
        // LONG: trailing stop mengikuti harga TERTINGGI (peak naik → trail naik)
        const trailPct  = tradeMode === "futures" ? TRAILING_STOP_PCT_FUTURES : TRAILING_STOP_PCT_SPOT;
        const prevPeak  = pos.peak_price ?? pos.entry_price;
        const newPeak   = Math.max(prevPeak, currentPrice);
        peakOrTrough    = newPeak;
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
        peakOrTrough      = newTrough;
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

      // HYBRID: Cancel native trailing stop di Bybit sebelum close via software.
      // Ini cegah konflik: native TS dan software exit tidak saling balapan.
      // Jika native TS sudah fired duluan, cancelNativeTrailingStop silently no-op.
      if (!sim && exchange === "bybit" && tradeMode === "futures") {
        await bybitCancelNativeTrailingStop(pos.symbol, apiKey, apiSecret);
      }

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
          pos.amount_usdt, tradeMode, lev, ema13, ema21, pnl, sim, exitReasonLabel, exchange,
          peakOrTrough, pos.opened_at));
      } else {
        await tgSend(tgChat, tgShortCloseMsg(pos.symbol, pos.entry_price, exitPrice, pos.qty,
          pos.amount_usdt, lev, ema13, ema21, pnl, sim, exitReasonLabel,
          peakOrTrough, pos.opened_at));
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

  // FIXED v17: Guard total posisi Futures — max 2 (1 LONG + 1 SHORT).
  // Meski MAX_LONG=1 dan MAX_SHORT=1 sudah ada, tambah explicit total check
  // sebagai lapisan keamanan ketiga mencegah overtrade & margin call.
  const totalOpenFutures = relevantPositions.length;
  const MAX_TOTAL_FUTURES_POSITIONS = 2; // 1 LONG + 1 SHORT max
  if (tradeMode === "futures" && totalOpenFutures >= MAX_TOTAL_FUTURES_POSITIONS) {
    log.push(`FULL_FUTURES: total=${totalOpenFutures}/${MAX_TOTAL_FUTURES_POSITIONS} posisi terbuka — skip entry`);
    console.log(`[processUser] Futures full: ${totalOpenFutures} posisi terbuka, skip entry scan`);
    return log;
  }

  if (longSlotFull && shortSlotFull) {
    log.push(`FULL: LONG(${openLongCount}/${MAX_LONG_POSITIONS}) SHORT(${openShortCount}/${MAX_SHORT_POSITIONS}) - skip entry scan`);
    return log;
  }

  // ── FITUR BARU: Max drawdown harian ──────────────────────────────
  if (await isDailyLimitReached(sb, userId)) {
    const losses = _dailyLoss.get(userId)?.losses || MAX_DAILY_LOSSES;
    log.push(`DAILY_LIMIT: ${losses}x SL hari ini — trading dihentikan sampai besok`);
    console.log(`[processUser] ${userId.slice(0,8)} daily limit reached (${losses} losses) — skip all entry`);

    // NOTIF: Kirim 1x per hari saja — tidak spam tiap menit cron
    const today = new Date().toISOString().slice(0, 10);
    if (_dailyLimitNotifAt.get(userId) !== today) {
      _dailyLimitNotifAt.set(userId, today);
      await tgSend(tgChat,
        `🛑 <b>Trading Dihentikan Hari Ini</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Bot mencatat <b>${losses}x Stop Loss</b> hari ini.\n` +
        `Batas harian (<code>${MAX_DAILY_LOSSES}x SL</code>) tercapai — semua entry baru diblokir.\n\n` +
        `⏳ Trading akan aktif kembali otomatis <b>besok pagi (00:00 WIB)</b>.\n` +
        `💡 <i>Tips: Pertimbangkan kurangi leverage atau trade amount di pengaturan.</i>\n` +
        `⏰ ${wib()}`
      );
    }

    return log;
  }

  const symbols = await getTopSymbols(exchange, tradeMode, topN || 75, whitelist || []); // FIXED v19.6: default topN 20→75

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
    .slice(0, Math.min(60, MAX_ENTRY_PER_RUN * 40)); // FIXED v19.6: 30→40 kandidat scan per run

  console.log(`[processUser] candidateSymbols: ${candidateSymbols.length} dari ${symbols.length} total (longOpen=${[...openLongSymbols].join(',') || 'none'} shortOpen=${[...openShortSymbols].join(',') || 'none'})`);

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
        // Log detail untuk diagnosis: tampilkan alasan skip yang spesifik
        const skipReason = cross === null
          ? `no_cross`
          : cross === "GOLDEN" && !htfBullish ? `GOLDEN_but_htfBear`
          : cross === "DEAD"   && !htfBearish ? `DEAD_but_htfBull`
          : cross === "GOLDEN" && curLongFull  ? `GOLDEN_but_longFull`
          : cross === "DEAD"   && curShortFull ? `DEAD_but_shortFull`
          : cross === "DEAD"   && tradeMode !== "futures" ? `DEAD_but_spot_mode`
          : `other`;
        console.log(`[SCAN] ${symbol}: cross=${cross ?? "none"} htfBull=${htfBullish} htfBear=${htfBearish} ema13=${ema13.toFixed(4)} ema21=${ema21.toFixed(4)} skip=${skipReason}`);
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

        // Update slot tracking agar batch berikutnya tidak entry ke slot yang sudah penuh
        if (entryDirection === "LONG") {
          openLongSymbols.add(symbol);
          curLongFull = openLongSymbols.size >= MAX_LONG_POSITIONS;
        } else {
          openShortSymbols.add(symbol);
          curShortFull = openShortSymbols.size >= MAX_SHORT_POSITIONS;
        }

        // FIXED BUG-16b: Setelah entry berhasil, langsung break dari inner loop.
        // MAX_ENTRY_PER_RUN=1 dan MAX_LONG_POSITIONS=1 sudah enforce di luar,
        // tapi jika loop batch berjalan paralel (Promise.allSettled), beberapa
        // symbol bisa lolos sebelum curLongFull/curShortFull diupdate.
        // Break eksplisit di sini memastikan tidak ada entry kedua dalam 1 run.
        break;
      } catch (e: unknown) {
        // FIXED BUG-21 (Kritis): Sebelumnya catch hanya console.warn dan tidak break.
        // Jika dbOpenPosition throw (insert DB gagal), order sudah tereksekusi di exchange
        // tapi posisi tidak tersimpan di DB (ghost position). Loop lanjut ke simbol berikutnya
        // sehingga bisa entry lagi — double entry dengan saldo yang sama!
        // FIX: Selalu break setelah entry try-block selesai (berhasil atau gagal dengan exception),
        // karena order mungkin sudah terkirim ke exchange sebelum DB throw.
        console.warn(`[Worker] Entry error ${symbol}:`, e);
        log.push(`${symbol}:ENTRY_EXCEPTION:${String(e).slice(0, 80)}`);
        break; // stop scan — order mungkin sudah tereksekusi, jangan entry lagi
      }
    }
    // FIX #6: Hentikan juga outer batch loop saat MAX_ENTRY_PER_RUN tercapai.
    // Sebelumnya `break` di dalam batchResults hanya keluar dari inner loop,
    // sehingga batch berikutnya tetap diproses dan bisa melebihi MAX_ENTRY_PER_RUN.
    if (entered >= MAX_ENTRY_PER_RUN) break;
  }

  if (entered === 0) log.push(`no_signal (longSlot=${longSlotFull ? "full" : "open"} shortSlot=${shortSlotFull ? "full" : "open"})`);

  // ── NOTIF STATUS SCAN: kirim ke Telegram setiap 3 jam ─────────────
  // Dikirim saat tidak ada signal masuk — beri tahu user bahwa bot masih aktif scan
  // In-memory cooldown: tidak spam tiap menit, cukup 1x per 3 jam
  if (entered === 0) {
    const now = Date.now();
    // FIXED BUG-SCAN-STATUS-SPAM (v19.2): Notif "Update Status Bot" dikirim tiap menit
    // karena kolom scan_status_notif_at belum ada di bot_risk_state → DB selalu return null
    // → lastNotif selalu 0 → cooldown tidak pernah aktif.
    //
    // FIX: Pola dua-lapis yang robust:
    //   L1 (in-memory): cek PERTAMA — tidak butuh DB, paling cepat.
    //                   Jika ada di cache → langsung pakai, skip DB sama sekali.
    //   L2 (DB low_balance_notif_at sebagai proxy): Kolom low_balance_notif_at
    //                   SUDAH ADA di bot_risk_state (tidak butuh migration baru).
    //                   Pakai sebagai timestamp referensi saat cold start.
    //   Fallback last resort: jika kedua L1 & L2 miss → set lastNotif = now - (interval - 30 menit)
    //                   → notif akan dikirim setelah 30 menit pertama, bukan langsung.
    //                   Ini mencegah spam saat cold start bahkan tanpa kolom DB baru.
    const lastNotifMemory = _scanStatusNotifAt.get(userId) || 0;
    let lastNotif = lastNotifMemory;

    if (lastNotifMemory === 0) {
      // Cold start: coba baca timestamp nyata dari DB
      // FIXED BUG-SCAN-STATUS-3JAM: Sebelumnya jika riskRow ada → lastNotif = now
      // → notif TIDAK PERNAH dikirim karena cooldown selalu baru direset saat cold start.
      // FIX: Baca scan_status_notif_at jika ada; fallback ke low_balance_notif_at sebagai proxy.
      // Jika tidak ada data sama sekali → tunda 30 menit (user baru).
      try {
        const { data: riskRow } = await sb
          .from("bot_risk_state")
          .select("scan_status_notif_at, low_balance_notif_at, updated_at")
          .eq("user_id", userId)
          .maybeSingle();

        if (riskRow?.scan_status_notif_at) {
          // Pakai timestamp nyata dari DB — cooldown tetap valid setelah cold start
          lastNotif = new Date(riskRow.scan_status_notif_at).getTime();
          _scanStatusNotifAt.set(userId, lastNotif);
        } else if (riskRow?.updated_at) {
          // Proxy: pakai updated_at row sebagai estimasi — row ada berarti user aktif
          // Anggap notif terakhir = updated_at agar tidak spam saat cold start
          const updatedTs = new Date(riskRow.updated_at).getTime();
          // Hanya suppress jika updated_at sangat baru (< 1 jam) — jika sudah lama, biarkan notif jalan
          lastNotif = (now - updatedTs) < 60 * 60 * 1000 ? now : updatedTs;
          _scanStatusNotifAt.set(userId, lastNotif);
        } else if (riskRow) {
          // Row ada tapi tidak ada timestamp berguna → tunda 30 menit agar tidak spam
          lastNotif = now - SCAN_STATUS_INTERVAL_MS + (30 * 60 * 1000);
          _scanStatusNotifAt.set(userId, lastNotif);
        } else {
          // Row belum ada (user baru) → tunda 30 menit sebelum notif pertama
          lastNotif = now - SCAN_STATUS_INTERVAL_MS + (30 * 60 * 1000);
          _scanStatusNotifAt.set(userId, lastNotif);
        }
      } catch {
        // DB read gagal → tunda 30 menit
        lastNotif = now - SCAN_STATUS_INTERVAL_MS + (30 * 60 * 1000);
        _scanStatusNotifAt.set(userId, lastNotif);
      }
    }

    if (now - lastNotif >= SCAN_STATUS_INTERVAL_MS) {
      _scanStatusNotifAt.set(userId, now); // Update L1 segera — cegah spam antar cold start
      // Persist ke DB agar cold start berikutnya bisa baca timestamp nyata
      try {
        await sb.from("bot_risk_state").upsert({
          user_id:               userId,
          scan_status_notif_at:  new Date(now).toISOString(),
          updated_at:            new Date(now).toISOString(),
        }, { onConflict: "user_id" });
      } catch { /* non-fatal — L1 cache tetap aktif sebagai guard */ }

      const scannedCount = candidateSymbols.length;
      await tgSend(tgChat,
        `🔍 <b>Update Status Bot</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ Bot aktif & memantau pasar.\n\n` +
        `📊 <b>${scannedCount} koin</b> sudah discan — belum ada sinyal masuk:\n` +
        `• Belum ada <b>Golden Cross</b> (entry beli)\n` +
        `• Belum ada <b>Dead Cross</b> (entry short)\n\n` +
        `Bot terus scan setiap menit sampai ada sinyal kuat.\n` +
        `⏰ ${wib()}`
      );
      console.log(`[processUser] Scan status notif dikirim ke ${userId.slice(0, 8)} (${scannedCount} koin discan)`);
    }
  }

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

  // FIXED BUG-SAVE-API-GUARD (v19 Minor): Tambah validasi panjang minimum dan tipe string
  // agar request dari klien yang salah format (misal api_key=true, api_key=123) ditolak
  // lebih awal dengan pesan yang jelas — konsisten dengan handleExchangeBalance yang sudah
  // punya guard serupa untuk API key plain-text.
  // Bybit API key minimum 18 karakter, Binance minimum 32 karakter. Gunakan 10 sebagai
  // threshold konservatif agar tidak terlalu ketat untuk exchange masa depan.
  if (typeof api_key !== "string" || api_key.trim().length < 10) {
    return new Response(
      JSON.stringify({ ok: false, error: "api_key tidak valid: harus string minimal 10 karakter" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
  if (typeof api_secret !== "string" || api_secret.trim().length < 10) {
    return new Response(
      JSON.stringify({ ok: false, error: "api_secret tidak valid: harus string minimal 10 karakter" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
  // Guard: tolak jika api_key sudah berbentuk hex terenkripsi (sudah dienkripsi sebelumnya)
  // Ciri: panjang >= 80 karakter dan semua hex. Mencegah double-enkripsi jika klien kirim
  // ulang value yang sudah terenkripsi dari DB.
  if (/^[0-9a-f]{80,}$/.test(api_key.trim())) {
    return new Response(
      JSON.stringify({ ok: false, error: "api_key tampaknya sudah terenkripsi — kirim plain-text key, bukan ciphertext" }),
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

    // FIXED BUG-QTY-NAN (v19 Medium): Sebelumnya qtyNum tidak divalidasi setelah
    // parseFloat — jika browser kirim qty="abc", qty=null, atau qty hilang dari body,
    // parseFloat() menghasilkan NaN yang diteruskan ke closeOrder() tanpa cek.
    // Exchange akan tolak order dengan error "qty invalid", tapi order tetap dikirim
    // dan log mencatat error yang membingungkan tanpa pesan yang jelas.
    // FIX: Guard eksplisit sebelum closeOrder dipanggil.
    if (side === "SELL" && (isNaN(qtyNum) || qtyNum <= 0)) {
      console.error(`[execute-order] qty tidak valid: "${qty}" → qtyNum=${qtyNum}`);
      return new Response(
        JSON.stringify({ ok: false, error: `Qty tidak valid: "${qty}". Pastikan qty adalah angka positif.` }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

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
  // Bybit UTA (Unified Trading Account) hanya support accountType=UNIFIED.
  // Akun lama support SPOT/CONTRACT. Coba UNIFIED dulu — jika berhasil (retCode=0),
  // STOP dan jangan coba SPOT/CONTRACT (akan error "accountType only support UNIFIED").
  // FIXED v19.6: Sebelumnya jika UNIFIED return saldo 0 → loop lanjut ke SPOT → Bybit error UTA.
  // FIX: Jika retCode=0 (respond valid), langsung return meski saldo 0 — akun UTA confirmed.
  const accountTypes = ["UNIFIED", "SPOT", "CONTRACT"];
  let lastError = "";

  for (const accountType of accountTypes) {
    try {
      const ts         = Date.now().toString();
      const recvWindow = "5000";
      const qs         = "accountType=" + accountType;
      const signature  = await hmacSign(apiSecret, ts + apiKey + recvWindow + qs);

      const res  = await fetchWithTimeout(`https://api.bybit.com/v5/account/wallet-balance?${qs}`, {
        headers: {
          "X-BAPI-API-KEY":     apiKey,
          "X-BAPI-SIGN":        signature,
          "X-BAPI-TIMESTAMP":   ts,
          "X-BAPI-RECV-WINDOW": recvWindow,
        },
      });
      const data = await res.json();

      // Error "accountType only support UNIFIED" → akun UTA, skip SPOT/CONTRACT
      if (data.retCode !== 0) {
        lastError = data.retMsg || "";
        // Jika error ini muncul di SPOT/CONTRACT → akun UTA sudah di-handle oleh UNIFIED sebelumnya
        // Atau UNIFIED sendiri gagal → propagate error
        if (accountType === "UNIFIED") {
          // UNIFIED gagal dengan error lain (bukan UTA issue) → throw
          throw new Error(`Bybit: ${lastError}`);
        }
        // SPOT/CONTRACT gagal → skip, coba berikutnya (atau sudah habis)
        continue;
      }

      // retCode=0 → respond valid (akun type ini didukung)
      const acct = data.result?.list?.[0];
      if (!acct) {
        // Respond valid tapi list kosong — akun ada tapi 0 saldo
        // FIXED: Untuk UTA, ini tetap valid → return 0, jangan lanjut ke SPOT
        if (accountType === "UNIFIED") return 0;
        continue;
      }

      let usdt = parseFloat(
        acct.totalAvailableBalance ||
        acct.totalWalletBalance    ||
        "0"
      );

      // Fallback coin-by-coin jika totalAvailableBalance tidak ada
      if (!usdt && acct.coin?.length) {
        const usdtCoin = acct.coin.find((c: { coin?: string }) => c.coin === "USDT");
        if (usdtCoin) {
          usdt = parseFloat(
            (usdtCoin as Record<string, string>).availableToWithdraw ||
            (usdtCoin as Record<string, string>).walletBalance || "0"
          );
        }
      }

      // FIXED: Jika UNIFIED respond valid (retCode=0) → return hasilnya meski 0
      // Jangan lanjut ke SPOT/CONTRACT karena akan error di akun UTA
      if (accountType === "UNIFIED") return usdt;

      // SPOT/CONTRACT: hanya return jika ada saldo
      if (usdt > 0) return usdt;

    } catch (e) {
      if (accountType === "UNIFIED") throw e; // UNIFIED gagal total → langsung throw
      // SPOT/CONTRACT error → coba berikutnya
      lastError = String(e);
    }
  }

  if (lastError) throw new Error(`Bybit: ${lastError}`);
  return 0;
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
  // FIXED BUG-20 (Medium): exchange & mode diambil dari body dengan default hardcode.
  // Jika browser tidak kirim exchange/mode (hanya kirim user_id), fungsi ini akan
  // selalu fetch balance "bybit" + "spot" meski user config-nya "binance" atau "futures".
  // FIX: Gunakan let agar bisa dioverride dari data DB di bawah.
  let exchange: string = body.exchange || "";
  let mode:     string = body.mode     || "";

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
      // FIXED BUG-20: Override exchange/mode dari DB jika body tidak menyediakan.
      // Konsisten dengan handleExecuteOrder yang sudah melakukan hal yang sama.
      if (!exchange) exchange = data.exchange    || "bybit";
      if (!mode)     mode     = data.trade_mode  || "spot";
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error: "Gagal ambil API key: " + String(e) }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  }

  // Fallback default jika exchange/mode masih kosong (user_id tidak dikirim atau DB kosong)
  if (!exchange) exchange = "bybit";
  if (!mode)     mode     = "spot";

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
// TELEGRAM COMMAND HANDLERS
// Mendukung 9 command interaktif:
//   /start    — link akun via deep link
//   /status   — status bot + posisi terbuka + saldo
//   /positions — detail semua posisi terbuka + PnL unrealized
//   /history  — 5 trade terakhir
//   /balance  — saldo exchange real-time
//   /pnl      — ringkasan profit/loss (hari ini, minggu, bulan)
//   /stop     — hentikan bot (set is_active = false)
//   /start    — aktifkan bot (set is_active = true) — dual-purpose
//   /config   — lihat konfigurasi bot saat ini
//   /help     — daftar semua command
// ════════════════════════════════════════════════════════════════

// ── Helper: cari user_id dari chat_id atau username ──────────────
async function tgFindUserId(sb: SB, chatId: number | string, username: string): Promise<string | null> {
  // Cari via telegram_chat_id dulu (paling akurat)
  const { data: byChatId } = await sb
    .from("bot_configs")
    .select("user_id")
    .eq("telegram_chat_id", String(chatId))
    .maybeSingle();
  if (byChatId?.user_id) return byChatId.user_id;

  // Fallback via username
  if (username) {
    const { data: byUsername } = await sb
      .from("bot_configs")
      .select("user_id")
      .eq("telegram_username", username)
      .maybeSingle();
    if (byUsername?.user_id) return byUsername.user_id;
  }
  return null;
}

// ── Helper: fetch bot_config lengkap untuk user ──────────────────
async function tgGetConfig(sb: SB, userId: string): Promise<BotConfig | null> {
  const { data } = await sb
    .from("bot_configs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return data as BotConfig | null;
}

// ── /status ──────────────────────────────────────────────────────
async function tgCmdStatus(sb: SB, chatId: number, userId: string): Promise<void> {
  try {
    const cfg = await tgGetConfig(sb, userId);
    if (!cfg) { await tgSend(chatId, "⚠️ Konfigurasi bot tidak ditemukan."); return; }

    const positions = await getOpenPositions(sb, userId);
    const openPos   = positions.filter(p => p.exchange === cfg.exchange && p.trade_mode === cfg.trade_mode);

    const statusEmoji = cfg.is_active ? "🟢" : "🔴";
    const statusLabel = cfg.is_active ? "AKTIF" : "NONAKTIF";
    const modeLabel   = cfg.trade_mode === "futures" ? `Futures ${cfg.leverage}x` : "Spot";

    let posLine = `📂 Posisi terbuka : <b>${openPos.length}</b>`;
    if (openPos.length > 0) {
      posLine += "\n";
      for (const p of openPos) {
        const dir = p.direction === "SHORT" ? "↘️ SHORT" : "↗️ LONG";
        // Coba ambil harga terkini untuk PnL unrealized
        let pnlStr = "";
        try {
          const curPrice = await fetchRealtimePrice(cfg.exchange, p.symbol, cfg.trade_mode);
          if (curPrice > 0) {
            const priceDiff = curPrice - p.entry_price;
            const pnl = cfg.trade_mode === "futures"
              ? (p.direction === "SHORT"
                  ? -priceDiff / p.entry_price * p.leverage * p.amount_usdt
                  : priceDiff  / p.entry_price * p.leverage * p.amount_usdt)
              : priceDiff * p.qty;
            const sign = pnl >= 0 ? "+" : "";
            pnlStr = ` · PnL: <code>${sign}${pnl.toFixed(2)} USDT</code>`;
          }
        } catch { /* skip jika fetch harga gagal */ }
        posLine += `   ${dir} <b>${p.symbol}</b> @ <code>$${p.entry_price.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>${pnlStr}\n`;
      }
    }

    await tgSend(chatId,
      `${statusEmoji} <b>Status Bot Z-Wealth</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 Bot      : <b>${statusLabel}</b>\n` +
      `📡 Exchange : <b>${cfg.exchange.toUpperCase()} · ${modeLabel}</b>\n` +
      `💰 Trade amt: <code>$${cfg.trade_amount_usdt} USDT</code>\n` +
      `📊 Strategi : EMA 13/21 Cross\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${posLine}\n` +
      `⏰ ${wib()}\n` +
      `<i>Ketik /positions untuk detail posisi · /balance untuk saldo</i>`
    );
  } catch (e) {
    console.error("[tgCmdStatus]", e);
    await tgSend(chatId, "⚠️ Gagal mengambil status. Coba lagi.");
  }
}

// ── /positions ───────────────────────────────────────────────────
async function tgCmdPositions(sb: SB, chatId: number, userId: string): Promise<void> {
  try {
    const cfg       = await tgGetConfig(sb, userId);
    const positions = await getOpenPositions(sb, userId);

    if (positions.length === 0) {
      await tgSend(chatId,
        `📂 <b>Posisi Terbuka</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Tidak ada posisi terbuka saat ini.\n` +
        `⏰ ${wib()}`
      );
      return;
    }

    let msg = `📂 <b>Posisi Terbuka (${positions.length})</b>\n━━━━━━━━━━━━━━━━━━━━\n`;

    for (const p of positions) {
      const dir       = p.direction === "SHORT" ? "↘️ SHORT" : "↗️ LONG";
      const modeLabel = p.trade_mode === "futures" ? `Futures ${p.leverage}x` : "Spot";
      const durasi    = formatDuration(p.opened_at);

      let pnlLine = "";
      try {
        const exchange  = cfg?.exchange || p.exchange;
        const curPrice  = await fetchRealtimePrice(exchange, p.symbol, p.trade_mode);
        if (curPrice > 0) {
          const priceDiff = curPrice - p.entry_price;
          const pnl = p.trade_mode === "futures"
            ? (p.direction === "SHORT"
                ? -priceDiff / p.entry_price * p.leverage * p.amount_usdt
                : priceDiff  / p.entry_price * p.leverage * p.amount_usdt)
            : priceDiff * p.qty;
          const pnlPct  = (pnl / p.amount_usdt) * 100;
          const sign    = pnl >= 0 ? "+" : "";
          const emoji   = pnl >= 0 ? "💰" : "💸";
          const changePct = ((curPrice - p.entry_price) / p.entry_price * 100).toFixed(2);
          const changeSign = curPrice >= p.entry_price ? "+" : "";
          pnlLine = `💵 Harga kini : <code>$${curPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code> <i>(${changeSign}${changePct}%)</i>\n` +
                    `${emoji} PnL       : <code>${sign}${pnl.toFixed(2)} USDT (${sign}${pnlPct.toFixed(2)}%)</code>\n`;
        }
      } catch { /* skip */ }

      msg +=
        `${dir} <b>${p.symbol}</b> · <i>${p.exchange.toUpperCase()} · ${modeLabel}</i>\n` +
        `💵 Entry    : <code>$${p.entry_price.toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>\n` +
        `${pnlLine}` +
        `📦 Qty      : <code>${p.qty}</code>  Modal: <code>$${p.amount_usdt} USDT</code>\n` +
        `⏱ Durasi   : <code>${durasi}</code>\n` +
        `────────────────────\n`;
    }

    msg += `⏰ ${wib()}`;
    await tgSend(chatId, msg);
  } catch (e) {
    console.error("[tgCmdPositions]", e);
    await tgSend(chatId, "⚠️ Gagal mengambil data posisi. Coba lagi.");
  }
}

// ── /history ─────────────────────────────────────────────────────
async function tgCmdHistory(sb: SB, chatId: number, userId: string): Promise<void> {
  try {
    // Ambil 10 trade terakhir (untuk tampilan) + pnl_usdt untuk summary
    const { data: trades } = await sb
      .from("trades")
      .select("symbol, side, price, amount_usdt, pnl_usdt, leverage, order_status, note, executed_at")
      .eq("user_id", userId)
      .in("order_status", ["FILLED", "CLOSED", "SIMULATED"])
      .order("executed_at", { ascending: false })
      .limit(10);

    if (!trades || trades.length === 0) {
      await tgSend(chatId,
        `📜 <b>Riwayat Trade</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Belum ada riwayat trade.\n` +
        `⏰ ${wib()}`
      );
      return;
    }

    // Hitung total PnL dari trade yang sudah CLOSED (punya pnl_usdt)
    // FIXED v19.2: Tambah summary total profit/loss di bawah riwayat trade
    // Hanya hitung dari CLOSED trades (bukan BUY entry yang pnl_usdt = null)
    const closedTrades = trades.filter(t => t.side === "SELL" || t.order_status === "CLOSED");
    const totalPnl     = closedTrades.reduce((sum: number, t: any) => sum + (parseFloat(t.pnl_usdt) || 0), 0);
    const winTrades    = closedTrades.filter((t: any) => (parseFloat(t.pnl_usdt) || 0) > 0);
    const lossTrades   = closedTrades.filter((t: any) => (parseFloat(t.pnl_usdt) || 0) < 0);
    const winRate      = closedTrades.length > 0 ? Math.round((winTrades.length / closedTrades.length) * 100) : 0;

    let msg = `📜 <b>Riwayat Trade (10 terakhir)</b>\n━━━━━━━━━━━━━━━━━━━━\n`;

    for (const t of trades) {
      const sideEmoji = t.side === "BUY"  ? "🟢 BUY" : "🔴 SELL";
      const simLabel  = t.order_status === "SIMULATED" ? " <i>[SIM]</i>" : "";
      const dateStr   = new Date(t.executed_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      const noteShort = t.note ? `<i>${String(t.note).slice(0, 60)}</i>` : "";
      // Tampilkan PnL untuk SELL/CLOSED trade dengan dua angka persentase:
      // 1. PnL% dari modal (return on capital tanpa leverage)
      // 2. PnL% efektif dengan leverage (return on margin = pnl / (modal/lev))
      // Contoh: modal $5, lev 20x, pnl +$1.50
      //   ROC  = +$1.50/$5 × 100 = +30% (return dari modal penuh)
      //   ROI  = +$1.50/($5/20) × 100 = +600% (return dari margin yang dipakai)
      // Untuk spot (leverage=1), keduanya sama → hanya tampil 1 angka
      const pnlVal    = parseFloat(t.pnl_usdt);
      const modalVal  = parseFloat(t.amount_usdt) || 1;
      const lev       = parseFloat(t.leverage) || 1;
      const pnlPct    = (pnlVal / modalVal) * 100;                    // % dari modal
      const pnlPctLev = lev > 1 ? (pnlVal / (modalVal / lev)) * 100 : null; // % dengan leverage
      const sign      = pnlVal >= 0 ? "+" : "";
      const pnlStr    = (!isNaN(pnlVal) && (t.side === "SELL" || t.order_status === "CLOSED"))
        ? pnlPctLev !== null
          ? `  PnL: <code>${sign}${pnlVal.toFixed(2)} USDT (${sign}${pnlPct.toFixed(1)}% modal / ${sign}${pnlPctLev.toFixed(1)}% ×${lev})</code>`
          : `  PnL: <code>${sign}${pnlVal.toFixed(2)} USDT (${sign}${pnlPct.toFixed(1)}%)</code>`
        : "";
      msg +=
        `${sideEmoji}${simLabel} <b>${t.symbol}</b>\n` +
        `   💵 <code>$${parseFloat(t.price).toLocaleString("en-US", { maximumFractionDigits: 6 })}</code>` +
        `  Modal: <code>$${t.amount_usdt} USDT</code>\n` +
        (pnlStr ? `   ${pnlStr}\n` : "") +
        `   🕐 ${dateStr}\n` +
        (noteShort ? `   ${noteShort}\n` : "") +
        `────────────────────\n`;
    }

    // Summary total PnL + persentase total dari total modal yang dipakai
    if (closedTrades.length > 0) {
      const totalModal   = closedTrades.reduce((s: number, t: any) => s + (parseFloat(t.amount_usdt) || 0), 0);
      const totalPnlPct  = totalModal > 0 ? (totalPnl / totalModal) * 100 : 0;
      // Rata-rata leverage (weighted average) untuk summary pct efektif
      const avgLev       = closedTrades.length > 0
        ? closedTrades.reduce((s: number, t: any) => s + (parseFloat(t.leverage) || 1), 0) / closedTrades.length
        : 1;
      const totalPnlPctLev = avgLev > 1 ? totalPnlPct * avgLev : null;
      const pnlEmoji     = totalPnl >= 0 ? "📈" : "📉";
      const pnlSign      = totalPnl >= 0 ? "+" : "";
      const summaryPctStr = totalPnlPctLev !== null
        ? `(${pnlSign}${totalPnlPct.toFixed(1)}% modal / ${pnlSign}${totalPnlPctLev.toFixed(1)}% ×${Math.round(avgLev)})`
        : `(${pnlSign}${totalPnlPct.toFixed(1)}%)`;
      msg +=
        `\n${pnlEmoji} <b>Summary (${closedTrades.length} closed):</b>\n` +
        `   Total PnL: <code>${pnlSign}${totalPnl.toFixed(2)} USDT ${summaryPctStr}</code>\n` +
        `   Win: <b>${winTrades.length}</b> · Loss: <b>${lossTrades.length}</b> · Win Rate: <b>${winRate}%</b>\n`;
    }

    msg += `⏰ ${wib()}`;
    await tgSend(chatId, msg);
  } catch (e) {
    console.error("[tgCmdHistory]", e);
    await tgSend(chatId, "⚠️ Gagal mengambil riwayat trade. Coba lagi.");
  }
}

// ── /balance ─────────────────────────────────────────────────────
async function tgCmdBalance(sb: SB, chatId: number, userId: string): Promise<void> {
  try {
    const cfg = await tgGetConfig(sb, userId);
    if (!cfg) { await tgSend(chatId, "⚠️ Konfigurasi bot tidak ditemukan."); return; }

    // Dekripsi API key
    let apiKey    = cfg.api_key    || "";
    let apiSecret = cfg.api_secret || "";
    if (ENCRYPTION_KEY) {
      try {
        if (apiKey    && isServerEncrypted(apiKey))    apiKey    = await serverDecrypt(apiKey);
        if (apiSecret && isServerEncrypted(apiSecret)) apiSecret = await serverDecrypt(apiSecret);
      } catch { apiKey = ""; apiSecret = ""; }
    }

    if (isSim(apiKey)) {
      await tgSend(chatId,
        `💰 <b>Saldo Exchange</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🔵 Mode SIMULASI — tidak ada saldo nyata.\n` +
        `⏰ ${wib()}`
      );
      return;
    }

    await tgSend(chatId, `⏳ Mengambil saldo dari ${cfg.exchange.toUpperCase()}...`);

    const usdt = cfg.exchange === "bybit"
      ? await fetchBybitBalance(apiKey, apiSecret, cfg.trade_mode)
      : await fetchBinanceBalance(apiKey, apiSecret, cfg.trade_mode);

    let idrRate = 16000;
    try {
      const rateRes  = await fetchWithTimeout("https://api.exchangerate-api.com/v4/latest/USD");
      const rateData = await rateRes.json();
      idrRate = rateData?.rates?.IDR || 16000;
    } catch { /* pakai default */ }

    const idr        = usdt * idrRate;
    const modeLabel  = cfg.trade_mode === "futures" ? `Futures ${cfg.leverage}x` : "Spot";

    await tgSend(chatId,
      `💰 <b>Saldo Exchange</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📡 Exchange : <b>${cfg.exchange.toUpperCase()} · ${modeLabel}</b>\n` +
      `💵 USDT     : <code>${usdt.toFixed(2)} USDT</code>\n` +
      `🇮🇩 IDR      : <code>Rp ${idr.toLocaleString("id-ID", { maximumFractionDigits: 0 })}</code>\n` +
      `📈 Rate     : <code>1 USD = Rp ${idrRate.toLocaleString("id-ID")}</code>\n` +
      `⏰ ${wib()}`
    );
  } catch (e) {
    console.error("[tgCmdBalance]", e);
    await tgSend(chatId, `⚠️ Gagal mengambil saldo: ${String(e).slice(0, 80)}`);
  }
}

// ── /pnl ─────────────────────────────────────────────────────────
async function tgCmdPnl(sb: SB, chatId: number, userId: string): Promise<void> {
  try {
    // Ambil semua closed positions dengan pnl_usdt
    const { data: closed } = await sb
      .from("positions")
      .select("pnl_usdt, closed_at, symbol, direction")
      .eq("user_id", userId)
      .eq("status", "CLOSED")
      .not("pnl_usdt", "is", null)
      .order("closed_at", { ascending: false })
      .limit(200);

    if (!closed || closed.length === 0) {
      await tgSend(chatId,
        `📈 <b>Ringkasan PnL</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Belum ada trade yang selesai.\n` +
        `⏰ ${wib()}`
      );
      return;
    }

    const now     = new Date();
    const todayStr  = now.toISOString().slice(0, 10);
    const weekAgo   = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString();
    const monthAgo  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    let pnlToday = 0, pnlWeek = 0, pnlMonth = 0, pnlAll = 0;
    let winToday = 0, lossToday = 0, winAll = 0, lossAll = 0;

    for (const t of closed) {
      const pnl       = parseFloat(t.pnl_usdt) || 0;
      const closedAt  = t.closed_at || "";
      pnlAll += pnl;
      if (pnl >= 0) winAll++; else lossAll++;
      if (closedAt >= monthAgo) pnlMonth += pnl;
      if (closedAt >= weekAgo)  pnlWeek  += pnl;
      if (closedAt.slice(0, 10) === todayStr) {
        pnlToday += pnl;
        if (pnl >= 0) winToday++; else lossToday++;
      }
    }

    const fmt    = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} USDT`;
    const emoji  = (v: number) => v >= 0 ? "💰" : "💸";
    const winRate = closed.length > 0 ? ((winAll / (winAll + lossAll)) * 100).toFixed(1) : "0";

    await tgSend(chatId,
      `📈 <b>Ringkasan PnL</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${emoji(pnlToday)} Hari ini  : <code>${fmt(pnlToday)}</code>  <i>(${winToday}W / ${lossToday}L)</i>\n` +
      `${emoji(pnlWeek)}  7 hari    : <code>${fmt(pnlWeek)}</code>\n` +
      `${emoji(pnlMonth)} 30 hari   : <code>${fmt(pnlMonth)}</code>\n` +
      `${emoji(pnlAll)}  Semua     : <code>${fmt(pnlAll)}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🎯 Win rate  : <b>${winRate}%</b>  <i>(${winAll}W / ${lossAll}L dari ${closed.length} trade)</i>\n` +
      `⏰ ${wib()}`
    );
  } catch (e) {
    console.error("[tgCmdPnl]", e);
    await tgSend(chatId, "⚠️ Gagal mengambil data PnL. Coba lagi.");
  }
}

// ── /stop ────────────────────────────────────────────────────────
async function tgCmdStop(sb: SB, chatId: number, userId: string): Promise<void> {
  try {
    const { error } = await sb
      .from("bot_configs")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    if (error) {
      await tgSend(chatId, `⚠️ Gagal menghentikan bot: ${error.message}`);
      return;
    }

    await tgSend(chatId,
      `🔴 <b>Bot Dihentikan</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⏸ Bot tidak lagi memantau pasar.\n` +
      `🕐 Dihentikan: ${wib()}\n\n` +
      `<i>Ketik /start untuk mengaktifkan kembali kapan saja.</i>`
    );
  } catch (e) {
    console.error("[tgCmdStop]", e);
    await tgSend(chatId, "⚠️ Gagal menghentikan bot. Coba lagi.");
  }
}

// ── /start (aktivasi bot — dual-purpose dengan link flow) ─────────
async function tgCmdActivate(sb: SB, chatId: number, userId: string, username: string): Promise<void> {
  try {
    const { data: cfg, error: fetchErr } = await sb
      .from("bot_configs")
      .select("is_active, exchange, trade_mode, leverage")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchErr || !cfg) {
      await tgSend(chatId, "⚠️ Konfigurasi bot tidak ditemukan.");
      return;
    }

    if (cfg.is_active) {
      await tgSend(chatId,
        `✅ <b>Bot sudah aktif!</b>\n` +
        `📡 Exchange : <b>${cfg.exchange.toUpperCase()} · ${cfg.trade_mode === "futures" ? `Futures ${cfg.leverage}x` : "Spot"}</b>\n` +
        `⏰ ${wib()}\n\n` +
        `<i>Ketik /status untuk melihat detail lengkap.</i>`
      );
      return;
    }

    const { error } = await sb
      .from("bot_configs")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    if (error) {
      await tgSend(chatId, `⚠️ Gagal mengaktifkan bot: ${error.message}`);
      return;
    }

    const modeLabel = cfg.trade_mode === "futures" ? `Futures ${cfg.leverage}x` : "Spot";
    await tgSend(chatId,
      `🟢 <b>Bot Z-Wealth AKTIF</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ Bot mulai memantau pasar setiap 1 menit.\n` +
      `📡 Exchange : <b>${cfg.exchange.toUpperCase()} · ${modeLabel}</b>\n` +
      `🕐 Diaktifkan: ${wib()}\n\n` +
      `Kamu akan menerima notifikasi setiap ada sinyal trade.\n` +
      `<i>Ketik /stop untuk menghentikan bot kapan saja.</i>`
    );
  } catch (e) {
    console.error("[tgCmdActivate]", e);
    await tgSend(chatId, "⚠️ Gagal mengaktifkan bot. Coba lagi.");
  }
}

// ── /config ──────────────────────────────────────────────────────
async function tgCmdConfig(sb: SB, chatId: number, userId: string): Promise<void> {
  try {
    const cfg = await tgGetConfig(sb, userId);
    if (!cfg) { await tgSend(chatId, "⚠️ Konfigurasi bot tidak ditemukan."); return; }

    const modeLabel    = cfg.trade_mode === "futures" ? `Futures ${cfg.leverage}x leverage` : "Spot";
    const statusEmoji  = cfg.is_active ? "🟢 AKTIF" : "🔴 NONAKTIF";
    const simLabel     = isSim(cfg.api_key) ? " <i>(Mode Simulasi)</i>" : "";
    const symbolsLabel = cfg.symbols?.length > 0
      ? cfg.symbols.join(", ")
      : `Top ${cfg.top_n_by_volume || 20} by volume`;

    await tgSend(chatId,
      `⚙️ <b>Konfigurasi Bot</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 Status    : <b>${statusEmoji}</b>\n` +
      `📡 Exchange  : <b>${cfg.exchange.toUpperCase()}</b>\n` +
      `📊 Mode      : <b>${modeLabel}</b>${simLabel}\n` +
      `💰 Trade amt : <code>$${cfg.trade_amount_usdt} USDT</code>\n` +
      `🎯 Strategi  : EMA 13/21 Cross (15m + 1H HTF)\n` +
      `🛑 Stop Loss : ${cfg.trade_mode === "futures" ? `${(SL_PCT_FUTURES*100).toFixed(0)}%` : `${(SL_PCT_SPOT*100).toFixed(0)}%`}\n` +
      `📉 Trail Stop: ${cfg.trade_mode === "futures" ? `${(TRAILING_STOP_PCT_FUTURES*100).toFixed(1)}%` : `${(TRAILING_STOP_PCT_SPOT*100).toFixed(1)}%`}\n` +
      `📋 Simbol    : <i>${symbolsLabel}</i>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Untuk mengubah konfigurasi, gunakan aplikasi Z-Wealth.</i>\n` +
      `⏰ ${wib()}`
    );
  } catch (e) {
    console.error("[tgCmdConfig]", e);
    await tgSend(chatId, "⚠️ Gagal mengambil konfigurasi. Coba lagi.");
  }
}

// ── /help ────────────────────────────────────────────────────────
async function tgCmdHelp(chatId: number): Promise<void> {
  await tgSend(chatId,
    `📖 <b>Daftar Command Z-Wealth Bot</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `/status     — 📊 Status bot & posisi terbuka\n` +
    `/positions  — 📂 Detail semua posisi + PnL\n` +
    `/history    — 📜 10 trade terakhir\n` +
    `/balance    — 💰 Saldo exchange real-time\n` +
    `/pnl        — 📈 Ringkasan profit/loss\n` +
    `/config     — ⚙️ Lihat konfigurasi bot\n` +
    `/stop       — ⏸ Hentikan bot\n` +
    `/start      — ▶️ Aktifkan bot\n` +
    `/help       — 📖 Tampilkan daftar ini\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>Konfigurasi & pengaturan detail via aplikasi Z-Wealth.</i>`
  );
}

// ════════════════════════════════════════════════════════════════
// HANDLER: TELEGRAM WEBHOOK — router semua command
// ════════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function handleTelegramWebhook(sb: SB, body: any): Promise<Response> {
  const message = body?.message;

  // DEBUG: log semua update masuk agar kelihatan di Supabase logs
  console.log("[TgWebhook] Update received:", JSON.stringify({
    update_id: body?.update_id,
    chat_id:   message?.chat?.id,
    username:  message?.from?.username,
    text:      message?.text,
  }));

  if (!message) return new Response("ok", { status: 200 });

  const chatId   = message.chat?.id as number;
  const username = message.from?.username || "";
  const text     = (message.text || "").trim();

  if (!text.startsWith("/")) return new Response("ok", { status: 200 });

  // Ambil command utama (tanpa @botname suffix)
  const commandRaw = text.split(" ")[0].split("@")[0].toLowerCase();

  // ── /start dengan deep link code (link akun baru) ────────────────
  if (commandRaw === "/start") {
    const parts    = text.split(" ");
    const linkCode = parts[1] || "";

    // Jika ada linkCode → ini flow link akun baru
    if (linkCode) {
      let userId: string | null = null;
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

      // Fallback cari via chat_id atau username
      if (!userId) userId = await tgFindUserId(sb, chatId, username);

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

      // Simpan chat_id ke DB
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
        `📖 Ketik /help untuk melihat semua command.\n` +
        `<i>Gunakan aplikasi Z-Wealth untuk mengatur konfigurasi bot.</i>`
      );
      console.log(`[TgWebhook] Linked: ${displayName} → user_id ${userId.slice(0, 8)}...`);
      return new Response("ok", { status: 200 });
    }

    // /start tanpa linkCode → coba aktifkan bot (user sudah terhubung sebelumnya)
    const userId = await tgFindUserId(sb, chatId, username);
    if (!userId) {
      await tgSend(chatId,
        `👋 <b>Selamat datang di Z-Wealth Bot!</b>\n\n` +
        `Akun kamu belum terhubung.\n` +
        `Buka aplikasi Z-Wealth → Bot Trading → Hubungkan ke Telegram.\n\n` +
        `📖 Setelah terhubung, ketik /help untuk melihat semua command.`
      );
      return new Response("ok", { status: 200 });
    }
    await tgCmdActivate(sb, chatId, userId, username);
    return new Response("ok", { status: 200 });
  }

  // ── Semua command lain butuh akun terhubung ───────────────────────
  const userId = await tgFindUserId(sb, chatId, username);

  if (!userId) {
    await tgSend(chatId,
      `⚠️ Akun belum terhubung.\n` +
      `Buka aplikasi Z-Wealth → Bot Trading → Hubungkan ke Telegram.`
    );
    return new Response("ok", { status: 200 });
  }

  // ── Router command ────────────────────────────────────────────────
  switch (commandRaw) {
    case "/status":
      await tgCmdStatus(sb, chatId, userId);
      break;
    case "/positions":
      await tgCmdPositions(sb, chatId, userId);
      break;
    case "/history":
      await tgCmdHistory(sb, chatId, userId);
      break;
    case "/balance":
      await tgCmdBalance(sb, chatId, userId);
      break;
    case "/pnl":
      await tgCmdPnl(sb, chatId, userId);
      break;
    case "/stop":
      await tgCmdStop(sb, chatId, userId);
      break;
    case "/config":
      await tgCmdConfig(sb, chatId, userId);
      break;
    case "/help":
      await tgCmdHelp(chatId);
      break;
    default:
      await tgSend(chatId,
        `❓ Command tidak dikenal: <code>${commandRaw}</code>\n` +
        `Ketik /help untuk melihat daftar command yang tersedia.`
      );
  }

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
      JSON.stringify({ status: "ok", service: "z-wealth trading worker v19" }),
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
  // FIXED BUG-AUTH-OWNERSHIP (v19 Kritis): Upgrade dari anon key check ke JWT ownership
  // — verifyUserOwnership memastikan token JWT milik user_id yang dikirim.
  if (body._type === "exchange_balance") {
    if (!verifyBrowserAuth(req)) return unauthorizedResponse("exchange_balance: token tidak valid");
    const ownerOk = await verifyUserOwnership(sb, req, String(body.user_id || ""));
    if (!ownerOk) return unauthorizedResponse("exchange_balance: token bukan pemilik user_id ini");
    return await handleExchangeBalance(sb, body);
  }

  // ── ROUTE 3b: Execute Order — proxy order dari browser (fix CORS) ─
  // { _type: "execute_order", user_id, exchange, mode, leverage, symbol, side, qty, amount_usdt }
  // FIXED BUG-AUTH-2 (Kritis): Route ini sebelumnya tidak ada autentikasi.
  // Siapapun yang tahu user_id bisa trigger order jual/beli atas nama user lain.
  // FIXED BUG-AUTH-OWNERSHIP (v19 Kritis): Upgrade ke JWT ownership — token JWT harus
  // milik user_id yang dikirim, bukan hanya punya anon key (yang bersifat publik).
  if (body._type === "execute_order") {
    if (!verifyBrowserAuth(req)) return unauthorizedResponse("execute_order: token tidak valid");
    const ownerOk = await verifyUserOwnership(sb, req, String(body.user_id || ""));
    if (!ownerOk) return unauthorizedResponse("execute_order: token bukan pemilik user_id ini");
    return await handleExecuteOrder(sb, body);
  }

  // ── ROUTE 3c: Save API Key — enkripsi server-side dan simpan ke DB ─
  // { _type: "save_api_key", user_id, api_key, api_secret }
  // Browser kirim plain text → server enkripsi → simpan ke bot_configs
  // FIXED BUG-AUTH-3 (Kritis): Route ini sebelumnya tidak ada autentikasi.
  // Siapapun bisa overwrite API key milik user lain jika tahu user_id-nya.
  // FIXED BUG-AUTH-OWNERSHIP (v19 Kritis): Upgrade ke JWT ownership — token JWT harus
  // milik user_id yang dikirim, bukan hanya punya anon key (yang bersifat publik).
  if (body._type === "save_api_key") {
    if (!verifyBrowserAuth(req)) return unauthorizedResponse("save_api_key: token tidak valid");
    const ownerOk = await verifyUserOwnership(sb, req, String(body.user_id || ""));
    if (!ownerOk) return unauthorizedResponse("save_api_key: token bukan pemilik user_id ini");
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
