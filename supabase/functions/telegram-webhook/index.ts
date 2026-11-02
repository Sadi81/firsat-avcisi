// telegram-webhook
//
//  POST (Telegram'dan)  X-Telegram-Bot-Api-Secret-Token = Vault'taki firsat_webhook_secret
//    • "Aldım / Geç" butonları → deals.decision
//    • /start veya /id mesajı  → sohbet kimliğini yanıtlar (TELEGRAM_CHAT_ID'yi bulmak için)
//
//  POST ?setup=1 [&force=1]  x-cron-secret = Vault'taki firsat_cron_secret
//    • Botu bu fonksiyona bağlar (setWebhook). Bot başka bir adrese bağlıysa, force=1
//      verilmedikçe DOKUNMAZ: bir botun tek webhook'u olabilir, mevcut kullanımı bozmayalım.

import { checkAppSecret, createSupabaseClient, getWebhookSecret } from "../_shared/supabase-store.ts";

const DECISION_LABEL: Record<string, string> = { bought: "✅ Aldım", skipped: "❌ Geçtim" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

async function tg(token: string, method: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`Telegram ${method}: ${res.status} ${data.description ?? ""}`);
  }
  return data.result;
}

Deno.serve(async (req) => {
  const db = createSupabaseClient();
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const url = new URL(req.url);

  // ---- Kurulum ----
  if (url.searchParams.get("setup") === "1") {
    if (!await checkAppSecret(db, "firsat_cron_secret", req.headers.get("x-cron-secret"))) {
      return json({ error: "yetkisiz" }, 401);
    }
    if (!token) return json({ error: "TELEGRAM_BOT_TOKEN ayarlı değil" }, 400);
    const self = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-webhook`;
    const info = await tg(token, "getWebhookInfo", {});
    if (info.url && info.url !== self && url.searchParams.get("force") !== "1") {
      return json({
        status: "çakışma",
        message: "Bot zaten başka bir adrese bağlı; mevcut kullanımı bozmamak için değiştirilmedi.",
        current_host: new URL(info.url).host,
      }, 409);
    }
    await tg(token, "setWebhook", {
      url: self,
      secret_token: await getWebhookSecret(db),
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
    const me = await tg(token, "getMe", {});
    return json({ status: "bağlandı", bot: `@${me.username}`, previous_host: info.url ? new URL(info.url).host : null });
  }

  // ---- Telegram güncellemeleri ----
  if (!await checkAppSecret(db, "firsat_webhook_secret", req.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response("yetkisiz", { status: 401 });
  }
  if (!token) return new Response("ok");
  const allowedChat = Deno.env.get("TELEGRAM_CHAT_ID");
  const update = await req.json().catch(() => null);

  const msg = update?.message;
  if (msg?.chat?.id && typeof msg.text === "string" && /^\/(start|id)\b/.test(msg.text)) {
    const id = String(msg.chat.id);
    const text = allowedChat === id
      ? "✅ Fırsat Avcısı bu sohbete bildirim gönderiyor."
      : `Sohbet kimliğiniz: <code>${id}</code>\n\nBunu Supabase'de TELEGRAM_CHAT_ID olarak kaydedin.`;
    await tg(token, "sendMessage", { chat_id: id, text, parse_mode: "HTML" });
    return new Response("ok");
  }

  const cb = update?.callback_query;
  if (!cb?.data) return new Response("ok");
  // Yalnızca kendi sohbetimizden gelen butonlar
  if (!allowedChat || String(cb.message?.chat?.id) !== allowedChat) return new Response("ok");

  const m = /^(bought|skipped):(\d+)$/.exec(cb.data);
  let answer = "Anlaşılamadı";
  if (m) {
    const { error } = await db.from("deals")
      .update({ decision: m[1], decided_at: new Date().toISOString() })
      .eq("id", Number(m[2]));
    answer = error ? `Hata: ${error.message}` : `${DECISION_LABEL[m[1]]} kaydedildi`;
  }
  await tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: answer });
  return new Response("ok");
});
