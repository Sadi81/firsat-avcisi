// telegram-webhook: "Aldım / Geç" butonlarını kaydeder.
// Telegram'a webhook kurulurken verilen secret_token, X-Telegram-Bot-Api-Secret-Token başlığında gelir.

import { createSupabaseClient } from "../_shared/supabase-store.ts";

const DECISION_LABEL: Record<string, string> = { bought: "✅ Aldım", skipped: "❌ Geçtim" };

Deno.serve(async (req) => {
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("yetkisiz", { status: 401 });
  }
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const allowedChat = Deno.env.get("TELEGRAM_CHAT_ID");

  const update = await req.json().catch(() => null);
  const cb = update?.callback_query;
  if (!cb?.data) return new Response("ok");

  // Yalnızca kendi sohbetimizden gelen butonlar
  if (allowedChat && String(cb.message?.chat?.id) !== allowedChat) return new Response("ok");

  const m = /^(bought|skipped):(\d+)$/.exec(cb.data);
  let answer = "Anlaşılamadı";
  if (m) {
    const db = createSupabaseClient();
    const { error } = await db.from("deals")
      .update({ decision: m[1], decided_at: new Date().toISOString() })
      .eq("id", Number(m[2]));
    answer = error ? `Hata: ${error.message}` : `${DECISION_LABEL[m[1]]} kaydedildi`;
  }

  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: cb.id, text: answer }),
  });
  return new Response("ok");
});
