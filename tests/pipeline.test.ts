import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidRaw, normalizeManual, processDeal } from "../supabase/functions/_shared/pipeline.ts";
import { memoryStore, recordingNotifier } from "./helpers.ts";
import { formatMessage } from "../supabase/functions/_shared/telegram.ts";
import { scoreDeal } from "../supabase/functions/_shared/scoring.ts";
import type { RawDeal } from "../supabase/functions/_shared/types.ts";

const item = (price: number, extra: Partial<RawDeal> = {}): RawDeal => ({
  source: "test",
  productKey: "amazon:B0TEST0001",
  title: "Makita DHP485Z 18V Darbeli Matkap",
  price,
  sellerIsAmazon: true,
  rating: 4.7,
  reviewCount: 900,
  ...extra,
});

test("rutin fiyatlar geçmişi besler, fırsat geçmişe göre puanlanır ve bildirilir", async () => {
  const m = memoryStore();
  const n = recordingNotifier();
  for (const p of [5200, 5000, 5100]) {
    const o = await processDeal(item(p, { isRegularPrice: true }), m.store, n.notifier, undefined, m.now);
    assert.equal(o.result, null);
  }
  const o = await processDeal(item(1000), m.store, n.notifier, undefined, m.now);
  assert.equal(o.result!.referenceKind, "history");
  assert.equal(o.result!.referencePrice, 5100);
  assert.equal(o.notified, true);
  assert.deepEqual(n.sent, [1]);
});

test("aynı fırsat 6 saat içinde tekrar bildirilmez; %3+ daha ucuzsa veya süre dolunca bildirilir", async () => {
  const m = memoryStore();
  const n = recordingNotifier();
  for (const p of [5000, 5000, 5000]) {
    await processDeal(item(p, { isRegularPrice: true }), m.store, n.notifier, undefined, m.now);
  }
  assert.equal((await processDeal(item(1000), m.store, n.notifier, undefined, m.now)).notified, true);
  m.advance(1);
  assert.equal((await processDeal(item(990), m.store, n.notifier, undefined, m.now)).notified, false);
  m.advance(1);
  assert.equal((await processDeal(item(900), m.store, n.notifier, undefined, m.now)).notified, true);
  m.advance(7);
  assert.equal((await processDeal(item(900), m.store, n.notifier, undefined, m.now)).notified, true);
  assert.equal(n.sent.length, 3);
});

test("eşik altındaki ve şüpheli fırsatlar bildirilmez ama kaydedilir", async () => {
  const m = memoryStore();
  const n = recordingNotifier();
  const weak = await processDeal(item(4500, { listPrice: 5000 }), m.store, n.notifier, undefined, m.now);
  const scam = await processDeal(
    item(300, { productKey: "amazon:B0TEST0002", listPrice: 6000, sellerIsAmazon: false }),
    m.store, n.notifier, undefined, m.now,
  );
  assert.equal(weak.notified, false);
  assert.equal(scam.result!.verdict, "şüpheli");
  assert.equal(scam.notified, false);
  assert.equal(m.deals.length, 2);
  assert.equal(n.sent.length, 0);
});

test("geçersiz ham kayıtlar reddedilir", () => {
  assert.equal(isValidRaw(item(100)), true);
  assert.equal(isValidRaw({ ...item(100), productKey: "kisa" }), false);
  assert.equal(isValidRaw({ ...item(100), price: 0 }), false);
  assert.equal(isValidRaw({ ...item(100), title: "" }), false);
});

test("Telegram mesajı HTML kaçışı yapar ve özet içerir", () => {
  const d = item(1000, { title: "Kablo <USB-C> & şarj" });
  const msg = formatMessage(d, scoreDeal(d, { regularSamples: 5, medianRegular90d: 5000, minEver: null }));
  assert.ok(msg.includes("Kablo &lt;USB-C&gt; &amp; şarj"));
  assert.ok(msg.includes("/100"));
  assert.ok(msg.includes("amazon:B0TEST0001"));
});

test("elle giriş: asin verilirse ürün anahtarı amazon:<ASIN> olur", () => {
  const n = normalizeManual({ asin: "B09RN7DYGP", title: "x", price: 10 });
  assert.equal(isValidRaw(n), true);
  assert.equal((n as { productKey: string }).productKey, "amazon:B09RN7DYGP");
  assert.equal((n as { source: string }).source, "manual");
  assert.equal(isValidRaw(normalizeManual({ asin: "yanlis", title: "x", price: 10 })), false);
});
