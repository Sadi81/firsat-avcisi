// collect: pg_cron birkaç dakikada bir çağırır.
//   POST "{}" veya gövdesiz  → etkin kaynakları tara, yeni fırsatları işle
//   POST [RawDeal, ...]      → dışarıdan gelen gözlemleri işle (elle giriş; {asin:"B0..."} yeterli)
// Kimlik doğrulama: x-cron-secret başlığı = CRON_SECRET

import { collectFromSource, type CollectReport } from "../_shared/collector.ts";
import { isValidRaw, normalizeManual, processDeal, type ProcessOutcome } from "../_shared/pipeline.ts";
import { SOURCES } from "../_shared/sources/index.ts";
import { SourceBlockedError } from "../_shared/sources/yaniyo.ts";
import { createSupabaseClient, supabaseStore } from "../_shared/supabase-store.ts";
import { telegramNotifier } from "../_shared/telegram.ts";
import { DEFAULT_CONFIG } from "../_shared/types.ts";

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

const summarize = (o: ProcessOutcome[]) =>
  o.filter((x) => x.result).map((x) => ({
    productKey: x.productKey,
    score: x.result!.score,
    verdict: x.result!.verdict,
    notified: x.notified,
  }));

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

  // pg_cron (pg_net) her zaman bir gövde gönderir; "{}" = kaynakları tara.
  const body = req.method === "POST" ? (await req.text()).trim() : "";

  if (body && body !== "{}") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json({ error: "geçersiz JSON" }, 400);
    }
    const outcomes: ProcessOutcome[] = [];
    const errors: string[] = [];
    for (const d of Array.isArray(parsed) ? parsed : [parsed]) {
      const raw = normalizeManual(d);
      if (!isValidRaw(raw)) {
        errors.push(`geçersiz kayıt: ${JSON.stringify(d).slice(0, 200)}`);
        continue;
      }
      try {
        outcomes.push(await processDeal(raw, store, notifier, cfg));
      } catch (e) {
        errors.push(`${raw.productKey}: ${(e as Error).message}`);
      }
    }
    return json({ processed: outcomes.length, deals: summarize(outcomes), errors });
  }

  const reports: CollectReport[] = [];
  for (const src of SOURCES.filter((s) => s.enabled)) {
    reports.push(
      await collectFromSource(src, store, notifier, cfg, undefined, (e) => e instanceof SourceBlockedError),
    );
  }
  const errors = reports.flatMap((r) => r.errors);
  if (errors.length) console.error(errors);
  return json(reports.map((r) => ({ ...r, outcomes: summarize(r.outcomes) })));
});
