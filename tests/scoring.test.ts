import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize, scoreDeal } from "../supabase/functions/_shared/scoring.ts";
import type { PriceHistory, RawDeal } from "../supabase/functions/_shared/types.ts";

const noHistory: PriceHistory = { regularSamples: 0, medianRegular90d: null, minEver: null };
const base: RawDeal = {
  source: "test",
  asin: "B000000001",
  title: "Bosch Professional GSR 18V-55 Akülü Vidalama Matkap",
  price: 1200,
  sellerIsAmazon: true,
  rating: 4.6,
  reviewCount: 320,
};

test("kategori: batarya aletten önce gelir, kelime sınırları doğru", () => {
  assert.equal(categorize(null, "Makita BL1850B 18V 5.0Ah Batarya"), "batarya");
  assert.equal(categorize(null, "Einhell 18V 4,0 Ah akü"), "batarya");
  assert.equal(categorize(null, "Duracell AA Pil 8'li"), "batarya");
  assert.equal(categorize(null, "Bosch Professional GSR 18V matkap"), "alet");
  assert.equal(categorize(null, "Samsung 990 PRO 1TB SSD"), "elektronik");
  assert.equal(categorize(null, "Kingston 16GB DDR4 RAM"), "elektronik");
  assert.equal(categorize(null, "Programlama kitabı"), "diger");
  assert.equal(categorize(null, "Sabah kahvaltı seti"), "diger");
  assert.equal(categorize(null, "Kapı paspası"), "diger");
});

test("geçmişe göre gerçek %80 indirim, satıcı Amazon → kaçırma + fiyat hatası uyarısı", () => {
  const r = scoreDeal(base, { regularSamples: 8, medianRegular90d: 6000, minEver: 4800 });
  assert.equal(r.referenceKind, "history");
  assert.equal(r.realDiscountPct, 80);
  assert.equal(r.savingTry, 4800);
  assert.equal(r.verdict, "kaçırma");
  assert.ok(r.score >= 85, `score=${r.score}`);
  assert.ok(r.flags.some((f) => f.includes("fiyat hatası")));
  assert.ok(r.reasons.some((x) => x.includes("en düşük")));
});

test("şişirilmiş üstü çizili fiyat yakalanır: Amazon %75 der, gerçek indirim %17", () => {
  const r = scoreDeal(
    { ...base, price: 2500, listPrice: 10000 },
    { regularSamples: 5, medianRegular90d: 3000, minEver: 2400 },
  );
  assert.equal(r.referenceKind, "history");
  assert.ok(r.realDiscountPct < 20);
  assert.ok(r.flags.some((f) => f.includes("yanıltıcı")));
  assert.equal(r.verdict, "zayıf");
});

test("geçmiş yoksa üstü çizili fiyat kullanılır ama güven düşük", () => {
  const withHistory = scoreDeal(base, { regularSamples: 5, medianRegular90d: 6000, minEver: null });
  const listOnly = scoreDeal({ ...base, listPrice: 6000 }, noHistory);
  assert.equal(listOnly.referenceKind, "list");
  assert.equal(listOnly.realDiscountPct, withHistory.realDiscountPct);
  assert.ok(listOnly.score < withHistory.score);
  assert.ok(listOnly.flags.some((f) => f.includes("şişirilmiş olabilir")));
});

test("üçüncü taraf satıcıda %90 indirim → şüpheli", () => {
  const r = scoreDeal(
    { ...base, price: 500, listPrice: 5000, sellerIsAmazon: false, sellerName: "XYZ Ticaret" },
    noHistory,
  );
  assert.equal(r.verdict, "şüpheli");
});

test("referans fiyat yoksa indirim 0 ve uyarı", () => {
  const r = scoreDeal({ ...base, listPrice: null }, noHistory);
  assert.equal(r.referenceKind, "none");
  assert.equal(r.realDiscountPct, 0);
  assert.ok(r.flags.some((f) => f.includes("Referans fiyat yok")));
  assert.equal(r.verdict, "zayıf");
});

test("küçük TL kazanç büyükten az puan alır (aynı yüzde)", () => {
  const h = (m: number): PriceHistory => ({ regularSamples: 5, medianRegular90d: m, minEver: null });
  const cheap = scoreDeal({ ...base, price: 40 }, h(200));
  const pricey = scoreDeal({ ...base, price: 2000 }, h(10000));
  assert.equal(cheap.realDiscountPct, pricey.realDiscountPct);
  assert.ok(pricey.score > cheap.score);
});

test("puan her zaman 0-100 arasında", () => {
  const r = scoreDeal(
    { ...base, title: "Kapı paspası", sellerIsAmazon: null, rating: 2.1, reviewCount: 50 },
    noHistory,
  );
  assert.ok(r.score >= 0 && r.score <= 100);
});
