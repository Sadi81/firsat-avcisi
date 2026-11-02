// collect: pg_cron her dakika çağırır.
//   GET/POST (gövdesiz)   → etkin kaynakları tara, yeni fırsatları işle
//   POST [RawDeal, ...]   → dışarıdan gelen gözlemleri işle (elle giriş, başka tarayıcılar)
// Kimlik doğrulama: x-cron-secret başlığı = CRON_SECRET

import { isValidRaw, processDeal, type ProcessOutcome } from "../_shared/pipeline.ts";
import { SOURCES } from "../_shared/sources/index.ts";
import { createSupabaseClient, supabaseStore } from "../_shared/supabase-store.ts";
import { telegramNotifier } from "../_shared/telegram.ts";
import { DEFAULT_CONFIG, type RawDeal } from "../_shared/types.ts";

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} ortam değişkeni eksik`);
  return v;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

Deno.serve(async (req) => {
  if (!timingSafeEqual(req.headers.get("x-cron-secret") ?? "", env("CRON_SECRET"))) {
    return json({ error: "yetkisiz" }, 401);
  }

  const cfg = {
    ...DEFAULT_CONFIG,
    notifyThreshold: Number(Deno.env.get("NOTIFY_THRESHOLD") ?? DEFAULT_CONFIG.notifyThreshold),
  };
  const store = supabaseStore(createSupabaseClient());
  const notifier = telegramNotifier(env("TELEGRAM_BOT_TOKEN"), env("TELEGRAM_CHAT_ID"));

  // Ham gözlemleri topla
  const incoming: RawDeal[] = [];
  const errors: string[] = [];
  // pg_cron (pg_net) her zaman bir gövde gönderir; "{}" = kaynakları tara.
  const body = req.method === "POST" ? (await req.text()).trim() : "";
  if (body && body !== "{}") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json({ error: "geçersiz JSON" }, 400);
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const d of list) {
      const raw: unknown = typeof d === "object" && d !== null ? { source: "manual", ...d } : d;
      if (isValidRaw(raw)) incoming.push(raw);
      else errors.push(`geçersiz kayıt: ${JSON.stringify(d).slice(0, 200)}`);
    }
  } else {
    for (const src of SOURCES.filter((s) => s.enabled)) {
      try {
        for (const raw of await src.fetchDeals()) {
          if (isValidRaw(raw)) incoming.push(raw);
          else errors.push(`${src.name}: geçersiz kayıt ${JSON.stringify(raw).slice(0, 200)}`);
        }
      } catch (e) {
        errors.push(`${src.name}: ${(e as Error).message}`);
      }
    }
  }

  // Sırayla işle (aynı ASIN'in iki kaydı yarışmasın)
  const outcomes: ProcessOutcome[] = [];
  for (const raw of incoming) {
    try {
      outcomes.push(await processDeal(raw, store, notifier, cfg));
    } catch (e) {
      errors.push(`${raw.asin}: ${(e as Error).message}`);
    }
  }

  if (errors.length) console.error(errors);
  return json({
    processed: outcomes.length,
    notified: outcomes.filter((o) => o.notified).length,
    deals: outcomes.filter((o) => o.result).map((o) => ({
      asin: o.asin,
      score: o.result!.score,
      verdict: o.result!.verdict,
      notified: o.notified,
    })),
    errors,
  }, errors.length && !outcomes.length ? 500 : 200);
});
