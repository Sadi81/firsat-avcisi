import { test } from "node:test";
import assert from "node:assert/strict";
import { collectFromSource } from "../supabase/functions/_shared/collector.ts";
import type { DealSource } from "../supabase/functions/_shared/sources/index.ts";
import { DEFAULT_CONFIG, type RawDeal } from "../supabase/functions/_shared/types.ts";
import { memoryStore, recordingNotifier } from "./helpers.ts";

class Blocked extends Error {}

const raw = (id: string, over: Partial<RawDeal> = {}): RawDeal => ({
  source: "fake",
  productKey: `fake:${id}`,
  title: "Makita DHP485Z 18V Darbeli Matkap",
  price: 1500,
  sourceDiscountPct: 70,
  observedAt: "2026-11-02T09:00:00.000Z",
  ...over,
});

function fakeSource(items: RawDeal[], enrichFails?: (d: RawDeal) => Error | null) {
  const enriched: string[] = [];
  const src: DealSource = {
    name: "fake",
    enabled: true,
    async fetchDeals() { return items.map((x) => ({ ...x })); },
    async enrich(d) {
      const err = enrichFails?.(d);
      if (err) throw err;
      enriched.push(d.productKey);
      return { ...d, sourceStats: { min: 1500, avg: 5200, max: 6100 } };
    },
  };
  return { src, enriched };
}

test("odak dışı kategori atlanır, umut verici olan zenginleştirilip bildirilir", async () => {
  const m = memoryStore();
  const n = recordingNotifier();
  const { src, enriched } = fakeSource([raw("AAAA1"), raw("BBBB2", { title: "Çocuk masal kitabı" })]);
  const rep = await collectFromSource(src, m.store, n.notifier, DEFAULT_CONFIG);
  assert.equal(rep.skippedCategory, 1);
  assert.deepEqual(enriched, ["fake:AAAA1"]);
  assert.equal(rep.outcomes[0].result!.referenceKind, "source_avg");
  assert.equal(n.sent.length, 1);
});

test("aynı kaynak güncellemesi ikinci turda tekrar işlenmez", async () => {
  const m = memoryStore();
  const n = recordingNotifier();
  const { src, enriched } = fakeSource([raw("AAAA1")]);
  await collectFromSource(src, m.store, n.notifier, DEFAULT_CONFIG);
  const rep2 = await collectFromSource(src, m.store, n.notifier, DEFAULT_CONFIG);
  assert.equal(rep2.skippedSeen, 1);
  assert.equal(enriched.length, 1, "ürün sayfası ikinci kez açılmaz");
  assert.equal(n.sent.length, 1);
});

test("zenginleştirme bütçesi: fazlası kaydedilmeden sonraki tura kalır, en yüksek indirim önce", async () => {
  const m = memoryStore();
  const n = recordingNotifier();
  const items = [raw("LOW01", { sourceDiscountPct: 45 }), raw("HIGH1", { sourceDiscountPct: 90 }), raw("MID01", { sourceDiscountPct: 60 })];
  const { src, enriched } = fakeSource(items);
  const opts = { maxEnrichPerRun: 2, minClaimedDiscount: 40 };
  const rep = await collectFromSource(src, m.store, n.notifier, DEFAULT_CONFIG, opts);
  assert.deepEqual(enriched, ["fake:HIGH1", "fake:MID01"]);
  assert.equal(rep.deferred, 1);
  const rep2 = await collectFromSource(src, m.store, n.notifier, DEFAULT_CONFIG, opts);
  assert.equal(rep2.skippedSeen, 2);
  assert.deepEqual(enriched.at(-1), "fake:LOW01");
});

test("engel hatası turu durdurur; diğer hatalar yalnızca o kaydı etkiler", async () => {
  const m = memoryStore();
  const n = recordingNotifier();
  const { src } = fakeSource(
    [raw("AAAA1", { sourceDiscountPct: 90 }), raw("BBBB2", { sourceDiscountPct: 80 }), raw("CCCC3", { sourceDiscountPct: 70 })],
    (d) => d.productKey === "fake:AAAA1" ? new Error("ayrıştırma hatası") : d.productKey === "fake:BBBB2" ? new Blocked("403") : null,
  );
  const rep = await collectFromSource(src, m.store, n.notifier, DEFAULT_CONFIG, undefined, (e) => e instanceof Blocked);
  assert.equal(rep.blocked, true);
  assert.equal(rep.errors.length, 2);
  assert.equal(rep.outcomes.length, 0, "CCCC3'e geçilmedi");
});

test("liste çekilemezse rapor hata ve engel bilgisini taşır", async () => {
  const m = memoryStore();
  const n = recordingNotifier();
  const src: DealSource = { name: "fake", enabled: true, async fetchDeals() { throw new Blocked("429"); } };
  const rep = await collectFromSource(src, m.store, n.notifier, DEFAULT_CONFIG, undefined, (e) => e instanceof Blocked);
  assert.equal(rep.blocked, true);
  assert.equal(rep.fetched, 0);
});
