// ══════════════════════════════════════════════════════════════════
// Z-WEALTH · TELEGRAM WEBHOOK — Supabase Edge Function
// Menangani pesan masuk dari @zwealth_bot
// Deploy: supabase functions deploy telegram-webhook
// Setup:  Set webhook ke: https://<project>.supabase.co/functions/v1/telegram-webhook
// ══════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_BOT_TOKEN         = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_SECRET_TOKEN      = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";

async function sendMessage(chatId: number | string, text: string, parseMode = "HTML"): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });
}

Deno.serve(async (req) => {
  // Verifikasi secret token dari Telegram
  if (TG_SECRET_TOKEN) {
    const headerSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (headerSecret !== TG_SECRET_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const message = body.message as Record<string, unknown> | undefined;
  if (!message) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const chatId   = (message.chat as Record<string, unknown>)?.id as number;
  const text     = (message.text as string) || "";
  const from     = message.from as Record<string, unknown>;
  const firstName = (from?.first_name as string) || "Kamu";

  // ── Handle /start [link_code] ────────────────────────────────────
  if (text.startsWith("/start")) {
    const parts    = text.trim().split(/\s+/);
    const linkCode = parts[1] || "";

    if (!linkCode) {
      // /start tanpa kode — mungkin user buka bot langsung
      await sendMessage(chatId,
        `👋 Halo <b>${firstName}</b>!\n\n` +
        `Ini adalah bot notifikasi <b>z-wealth</b> 📊\n\n` +
        `Untuk menghubungkan akun kamu:\n` +
        `1️⃣ Buka z-wealth di browser\n` +
        `2️⃣ Masuk ke menu <b>Trading Bot</b>\n` +
        `3️⃣ Tekan tombol <b>"Hubungkan ke @zwealth_bot"</b>\n\n` +
        `Bot akan otomatis mengenali akunmu 🔐`
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Ada link_code — lookup di pending_tg_links
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: pending, error: pendingErr } = await supabase
      .from("pending_tg_links")
      .select("user_id, expires_at")
      .eq("link_code", linkCode)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (pendingErr || !pending) {
      await sendMessage(chatId,
        `❌ <b>Link tidak valid atau sudah kadaluarsa.</b>\n\n` +
        `Silakan buka z-wealth dan buat link baru dengan menekan tombol "Hubungkan Telegram" lagi.\n` +
        `Link berlaku selama <b>10 menit</b>.`
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    const userId = pending.user_id as string;

    // Update bot_configs dengan telegram_chat_id
    const { error: updateErr } = await supabase
      .from("bot_configs")
      .update({
        telegram_chat_id: String(chatId),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateErr) {
      console.error("[TgWebhook] Failed to update bot_configs:", updateErr);
      await sendMessage(chatId,
        `⚠️ Gagal menghubungkan. Coba lagi dari z-wealth ya.`
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Hapus link sementara
    await supabase
      .from("pending_tg_links")
      .delete()
      .eq("link_code", linkCode);

    // Konfirmasi sukses
    await sendMessage(chatId,
      `✅ <b>Berhasil terhubung!</b>\n\n` +
      `Halo <b>${firstName}</b>! 🎉\n\n` +
      `Sekarang kamu akan menerima notifikasi setiap bot z-wealth melakukan trade:\n` +
      `🟢 <b>BUY</b> signal\n` +
      `🔴 <b>SELL</b> signal\n` +
      `📊 Info EMA 13/21\n\n` +
      `Bot siap bekerja 24/7 di server 🚀`
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // ── Handle /status ────────────────────────────────────────────────
  if (text === "/status") {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: cfg } = await supabase
      .from("bot_configs")
      .select("is_active, exchange, trade_amount_usdt")
      .eq("telegram_chat_id", String(chatId))
      .maybeSingle();

    if (!cfg) {
      await sendMessage(chatId, `❓ Akun belum terhubung. Buka z-wealth dan hubungkan Telegram dulu.`);
    } else {
      const statusEmoji = cfg.is_active ? "🟢 AKTIF" : "🔴 NONAKTIF";
      await sendMessage(chatId,
        `📊 <b>Status Bot z-wealth</b>\n\n` +
        `Status: <b>${statusEmoji}</b>\n` +
        `Exchange: <b>${cfg.exchange?.toUpperCase()}</b>\n` +
        `Trade Size: <b>$${cfg.trade_amount_usdt} USDT</b>`
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // ── Handle /stop ──────────────────────────────────────────────────
  if (text === "/stop") {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await supabase
      .from("bot_configs")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("telegram_chat_id", String(chatId));
    await sendMessage(chatId, `🔴 Bot dihentikan. Buka z-wealth untuk mengaktifkan kembali.`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // ── Default ───────────────────────────────────────────────────────
  await sendMessage(chatId,
    `🤖 Perintah yang tersedia:\n` +
    `/status — Cek status bot\n` +
    `/stop — Hentikan bot`
  );

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
