import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTION_LIMIT,
  fitCaption,
  formatMessage,
  telegramNotifier,
  visibleLength,
} from "../supabase/functions/_shared/telegram.ts";
import { scoreDeal } from "../supabase/functions/_shared/scoring.ts";
import type { RawDeal } from "../supabase/functions/_shared/types.ts";

const deal: RawDeal = {
  source: "yaniyo",
  productKey: "yaniyo:TESTA1B2C3D",
  title: "Makita DHP485Z 18V Darbeli Matkap",
  url: "https://yaniyo.com/go/TESTA1B2C3D",
  sourceUrl: "https://yaniyo.com/urun/en-ucuz-urun-TESTA1B2C3D",
  imageUrl: "https://m.media-amazon.com/images/I/test._AC_UL720_.jpg",
  price: 1500,
  sourceDiscountPct: 70,
  sourceStats: { min: 1500, avg: 5200, max: 6100 },
};
const noHistory = { regularSamples: 0, medianRegular90d: null, minEver: null };

test("görünen uzunluk: etiketler sayılmaz, &amp; tek karakter", () => {
  assert.equal(visibleLength("<b>a &amp; b</b>"), 5);
});

test("normal mesaj fotoğraf altına olduğu gibi sığar", () => {
  const r = scoreDeal(deal, noHistory);
  assert.equal(fitCaption(deal, r), formatMessage(deal, r));
});

test("çok uzun mesaj 1024 karaktere sığacak şekilde kısaltılır, skor ve fiyat korunur", () => {
  const r = scoreDeal({ ...deal, title: "Ç".repeat(300) }, noHistory);
  const long = { ...r, reasons: Array.from({ length: 30 }, (_, i) => `Gerekçe ${i} `.repeat(4)) };
  assert.ok(visibleLength(formatMessage(deal, long)) > CAPTION_LIMIT);
  const cap = fitCaption({ ...deal, title: "Ç".repeat(300) }, long);
  assert.ok(visibleLength(cap) <= CAPTION_LIMIT, `uzunluk=${visibleLength(cap)}`);
  assert.ok(cap.includes(`${r.score}/100`));
  assert.ok(cap.includes("1.500 TL"));
});

function mockFetch(responses: { status: number; body?: string }[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    const r = responses[calls.length - 1] ?? { status: 200 };
    return new Response(r.body ?? "{}", { status: r.status });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("fotoğraf varsa sendPhoto ile gönderilir, butonlar eklenir", async () => {
  const m = mockFetch([{ status: 200 }]);
  try {
    const ok = await telegramNotifier("TOKEN", "42").send(7, deal, scoreDeal(deal, noHistory));
    assert.equal(ok, true);
    assert.equal(m.calls.length, 1);
    assert.ok(m.calls[0].url.endsWith("/sendPhoto"));
    assert.equal(m.calls[0].body.photo, deal.imageUrl);
    assert.equal(m.calls[0].body.chat_id, "42");
    assert.match(JSON.stringify(m.calls[0].body.reply_markup), /bought:7/);
  } finally {
    m.restore();
  }
});

test("Telegram fotoğrafı alamazsa düz metinle gönderilir (fırsat kaçmaz)", async () => {
  const m = mockFetch([{ status: 400, body: '{"description":"wrong file identifier"}' }, { status: 200 }]);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const ok = await telegramNotifier("TOKEN", "42").send(7, deal, scoreDeal(deal, noHistory));
    assert.equal(ok, true);
    assert.deepEqual(m.calls.map((c) => c.url.split("/").at(-1)), ["sendPhoto", "sendMessage"]);
    assert.ok(typeof m.calls[1].body.text === "string");
  } finally {
    console.warn = warn;
    m.restore();
  }
});

test("fotoğraf yoksa doğrudan sendMessage", async () => {
  const m = mockFetch([{ status: 200 }]);
  try {
    await telegramNotifier("TOKEN", "42").send(1, { ...deal, imageUrl: null }, scoreDeal(deal, noHistory));
    assert.ok(m.calls[0].url.endsWith("/sendMessage"));
  } finally {
    m.restore();
  }
});
