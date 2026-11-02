// Store arayüzünün Supabase (Postgres) uygulaması. Yalnızca Edge Function içinde kullanılır.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import type { Store } from "./pipeline.ts";

export function createSupabaseClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik");
  return createClient(url, key, { auth: { persistSession: false } });
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export function supabaseStore(db: SupabaseClient): Store {
  return {
    async upsertProduct(d, category) {
      const row: Record<string, unknown> = {
        product_key: d.productKey,
        title: d.title,
        category,
        updated_at: new Date().toISOString(),
      };
      // Kaynakta olmayan alanlar mevcut değerleri ezmesin.
      const optional: [string, unknown][] = [
        ["asin", d.asin], ["brand", d.brand], ["rating", d.rating],
        ["review_count", d.reviewCount], ["buy_url", d.url], ["source_url", d.sourceUrl],
        ["image_url", d.imageUrl],
      ];
      for (const [k, v] of optional) if (v != null) row[k] = v;
      check(await db.from("products").upsert(row, { onConflict: "product_key" }), "upsertProduct");
    },

    async hasObservation(productKey, source, observedAt) {
      const { count, error } = await db.from("price_observations")
        .select("id", { count: "exact", head: true })
        .eq("product_key", productKey).eq("source", source).eq("observed_at", observedAt);
      if (error) throw new Error(`hasObservation: ${error.message}`);
      return (count ?? 0) > 0;
    },

    async getHistory(productKey) {
      const rows = check(
        await db.rpc("price_history", { p_key: productKey }),
        "price_history",
      ) as { regular_samples: number; median_regular_90d: string | null; min_ever: string | null }[];
      const r = rows?.[0];
      return {
        regularSamples: r?.regular_samples ?? 0,
        medianRegular90d: r?.median_regular_90d != null ? Number(r.median_regular_90d) : null,
        minEver: r?.min_ever != null ? Number(r.min_ever) : null,
      };
    },

    async insertObservation(d) {
      const row = check(
        await db.from("price_observations").insert({
          product_key: d.productKey,
          price: d.price,
          list_price: d.listPrice ?? null,
          source_discount_pct: d.sourceDiscountPct ?? null,
          stats_min: d.sourceStats?.min ?? null,
          stats_avg: d.sourceStats?.avg ?? null,
          stats_max: d.sourceStats?.max ?? null,
          seller_name: d.sellerName ?? null,
          seller_is_amazon: d.sellerIsAmazon ?? null,
          is_regular: d.isRegularPrice ?? false,
          source: d.source,
          observed_at: d.observedAt ?? new Date().toISOString(),
        }).select("id").single(),
        "insertObservation",
      ) as { id: number };
      return row.id;
    },

    async insertDeal(productKey, observationId, price, r) {
      const row = check(
        await db.from("deals").insert({
          product_key: productKey,
          observation_id: observationId,
          price,
          reference_price: r.referencePrice,
          reference_kind: r.referenceKind,
          real_discount_pct: r.realDiscountPct,
          saving_try: r.savingTry,
          score: r.score,
          verdict: r.verdict,
          category: r.category,
          flags: r.flags,
          reasons: r.reasons,
        }).select("id").single(),
        "insertDeal",
      ) as { id: number };
      return row.id;
    },

    async lastNotified(productKey) {
      const rows = check(
        await db.from("deals").select("price, notified_at")
          .eq("product_key", productKey).not("notified_at", "is", null)
          .order("notified_at", { ascending: false }).limit(1),
        "lastNotified",
      ) as { price: string; notified_at: string }[];
      return rows.length ? { price: Number(rows[0].price), notifiedAt: rows[0].notified_at } : null;
    },

    async markNotified(dealId) {
      check(
        await db.from("deals").update({ notified_at: new Date().toISOString() }).eq("id", dealId),
        "markNotified",
      );
    },
  };
}
