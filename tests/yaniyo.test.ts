import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createYaniyoSource,
  listItemToRawDeal,
  parseListPage,
  parseProductPage,
  parseTrPrice,
  SourceBlockedError,
} from "../supabase/functions/_shared/sources/yaniyo.ts";

// Elle yazılmış, sitenin yapısını taklit eden sentetik sayfalar.
const item = (over: Record<string, unknown> = {}) => ({
  shortId: "TESTA1B2C3D",
  name: "Örnek 18V Darbeli Matkap (Akü Dahil Değildir)",
  image: "https://m.media-amazon.com/images/I/test.jpg",
  client: "amazon.com.tr",
  currentPrice: 1500,
  currentDiscount: 60,
  priceList: [{ price: 3750, date: "2026-10-30T10:00:00.000Z" }, { price: 1500, date: "2026-11-02T09:00:00.000Z" }],
  updatedDate: "2026-11-02T09:00:00.000Z",
  isStock: true,
  catalogs: [{ name: "Matkap", slug: "matkap-firsatlari" }],
  discountStatus: { months: 4, allTime: false },
  brandInfo: { name: "Örnek" },
  ...over,
});
const page = (pageProps: unknown) =>
  `<html><body><div id="__next">...</div><script id="__NEXT_DATA__" type="application/json">${
    JSON.stringify({ props: { pageProps }, page: "/[...slug]" })
  }</script></body></html>`;

const productHtml = (prices: string) => `<html><body>
<h1 class="x">Örnek Matkap</h1><div class="a"><span class="line-through">Ürün fiyatı geçerli olacaktır.</span></div>
${prices}
<div><span>Site</span><span>Amazon.com.tr</span></div><a href="/go/TESTA1B2C3D">Amazon&#x27;a Git</a>
<div><button><span class="s">En Düşük</span><span class="v">1.250,50 TL</span></button>
<button><span class="s">Ortalama</span><span class="v">3.400 TL</span></button>
<button><span class="s">En Yüksek</span><span class="v">4.999,99 TL</span></button></div>
<script>var x = "|9,00 TL|1,00 TL|Kazanç";</script></body></html>`;

test("Türkçe fiyat ayrıştırma", () => {
  assert.equal(parseTrPrice("9.592,15"), 9592.15);
  assert.equal(parseTrPrice("2.410"), 2410);
  assert.equal(parseTrPrice("11780"), 11780);
  assert.equal(parseTrPrice("38,5 TL"), 38.5);
  assert.equal(parseTrPrice(""), null);
});

test("kategori liste sayfası (initialProducts) ve ana sayfa (content[].content.products)", () => {
  const cat = parseListPage(page({ page: "category", initialProducts: [item(), item({ shortId: "TESTB" })] }));
  assert.equal(cat?.length, 1, "geçersiz shortId elenir");
  const home = parseListPage(page({ content: [{ id: 0, content: { products: [item()], brands: [] } }] }));
  assert.equal(home?.length, 1);
  assert.equal(parseListPage("<html>captcha</html>"), null);
});

test("liste kaydı RawDeal'e çevrilir", () => {
  const r = listItemToRawDeal(parseListPage(page({ initialProducts: [item()] }))![0]);
  assert.equal(r.productKey, "yaniyo:TESTA1B2C3D");
  assert.equal(r.url, "https://yaniyo.com/go/TESTA1B2C3D");
  assert.equal(r.sourceUrl, "https://yaniyo.com/urun/en-ucuz-urun-TESTA1B2C3D");
  assert.equal(r.listPrice, 3750);
  assert.equal(r.sourceDiscountPct, 60);
  assert.equal(r.lowestInMonths, 4);
  assert.equal(r.category, "Matkap matkap");
  assert.equal(r.observedAt, "2026-11-02T09:00:00.000Z");
});

test("ürün sayfası: üstü çizili + güncel fiyat ve tüm zamanlar istatistikleri (script içi yok sayılır)", () => {
  const info = parseProductPage(productHtml(
    `<div><span>3.750 TL</span><span>1.500,00 TL</span></div><span class="b"><span aria-hidden="true"></span>Kazanç: <!-- -->2.250 TL</span>`,
  ));
  assert.deepEqual(info, { price: 1500, listPrice: 3750, stats: { min: 1250.5, avg: 3400, max: 4999.99 } });
});

test("ürün sayfası: indirim yoksa yalnızca güncel fiyat", () => {
  const info = parseProductPage(productHtml(`<div><span>1.500,00 TL</span></div>`));
  assert.equal(info.listPrice, null);
  assert.equal(info.price, 1500);
  assert.ok(info.stats);
});

function fakeFetch(routes: Record<string, { status?: number; body: string }>) {
  const calls: { url: string; ua: string | null }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ua: new Headers(init?.headers).get("user-agent") });
    const path = url.replace("https://yaniyo.com", "");
    const r = routes[path] ?? { status: 404, body: "yok" };
    return new Response(r.body, { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}

test("kaynak: listeleri birleştirir, stokta olmayanı atar, kendini dürüstçe tanıtır", async () => {
  const { f, calls } = fakeFetch({
    "/a": { body: page({ initialProducts: [item(), item({ shortId: "OUTOFSTOCK1", isStock: false })] }) },
    "/b": { body: page({ initialProducts: [item({ currentPrice: 1400 })] }) },
  });
  const src = createYaniyoSource({ listPaths: ["/a", "/b"], delayMs: 0, fetchImpl: f });
  const deals = await src.fetchDeals();
  assert.equal(deals.length, 1);
  assert.equal(deals[0].price, 1400, "aynı ürün tek kayıt, son görülen");
  assert.ok(calls.every((c) => c.ua?.startsWith("FirsatAvcisi/")));
});

test("kaynak: 403/429 veya captcha sayfası → SourceBlockedError", async () => {
  for (const r of [{ status: 403, body: "" }, { status: 429, body: "" },
    { body: "<html><title>Just a moment...</title><script src='https://challenges.cloudflare.com/x'></script></html>" }]) {
    const { f } = fakeFetch({ "/a": r });
    const src = createYaniyoSource({ listPaths: ["/a"], delayMs: 0, fetchImpl: f });
    await assert.rejects(src.fetchDeals(), SourceBlockedError);
  }
});

test("kaynak: ürün sayfasıyla zenginleştirme", async () => {
  const { f } = fakeFetch({
    "/urun/en-ucuz-urun-TESTA1B2C3D": {
      body: productHtml(`<div><span>3.800 TL</span><span>1.500 TL</span></div><span>Kazanç: 2.300 TL</span>`),
    },
  });
  const src = createYaniyoSource({ listPaths: [], delayMs: 0, fetchImpl: f });
  const raw = listItemToRawDeal(parseListPage(page({ initialProducts: [item()] }))![0]);
  const e = await src.enrich!(raw);
  assert.equal(e.listPrice, 3800);
  assert.deepEqual(e.sourceStats, { min: 1250.5, avg: 3400, max: 4999.99 });
});
