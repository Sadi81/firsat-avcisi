// Yaniyo adaptörü.
//
// Kurallar (bilinçli sınırlar):
//  - Yalnızca herkese açık sayfalar okunur (Next.js'in sayfaya gömdüğü __NEXT_DATA__ ve görünen metin).
//    İç API'ye, şifrelenmiş alanlara veya captcha arkasındaki hiçbir şeye dokunulmaz.
//  - Düşük frekans: birkaç liste sayfası + yalnızca yeni ve umut verici ürünler için ürün sayfası,
//    istekler arasında bekleme.
//  - Engel belirtisi (403/429/503, captcha sayfası) görülürse o çalıştırma durur; zorlanmaz.
//  - Satın alma linki Yaniyo'nun kendi yönlendirmesi (/go/<kod>): biz çağırmayız, siz tıklarsınız.

import type { RawDeal, SourceStats } from "../types.ts";
import type { DealSource } from "./index.ts";

export const YANIYO_BASE = "https://yaniyo.com";
const USER_AGENT = "FirsatAvcisi/0.1 (kisisel kullanim; dusuk frekans)";

export class SourceBlockedError extends Error {}

// ---------- Saf ayrıştırıcılar (testlerde örnek HTML ile denenir) ----------

interface YaniyoListItem {
  shortId: string;
  name: string;
  image?: string;
  currentPrice: number;
  currentDiscount?: number;
  priceList?: { price: number; date: string }[];
  updatedDate?: string;
  isStock?: boolean;
  catalogs?: { name?: string; slug?: string }[];
  discountStatus?: { months?: number; allTime?: boolean };
  brandInfo?: { name?: string } | null;
}

function nextData(html: string): unknown {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** "9.592,15" → 9592.15, "11780" → 11780, "2.410" → 2410 */
export function parseTrPrice(s: string): number | null {
  const cleaned = s.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return cleaned && Number.isFinite(n) && n > 0 ? n : null;
}

function isListItem(x: unknown): x is YaniyoListItem {
  const o = x as YaniyoListItem;
  return typeof o === "object" && o !== null &&
    typeof o.shortId === "string" && /^[A-Z0-9]{6,20}$/.test(o.shortId) &&
    typeof o.name === "string" && typeof o.currentPrice === "number";
}

/** Liste sayfası (ör. /tum-firsatlar?rate=50) → ürün kayıtları. Sayfa beklenen yapıda değilse null. */
export function parseListPage(html: string): YaniyoListItem[] | null {
  const d = nextData(html) as { props?: { pageProps?: Record<string, unknown> } } | null;
  const pp = d?.props?.pageProps;
  if (!pp) return null;
  const found: YaniyoListItem[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      if (v.length && isListItem(v[0])) found.push(...v.filter(isListItem));
      else v.forEach(visit);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(visit);
    }
  };
  // Kategori sayfası: initialProducts; ana sayfa: content[].content.products
  visit(pp.initialProducts ?? pp.content ?? pp);
  return found;
}

export function listItemToRawDeal(it: YaniyoListItem): RawDeal {
  const d = it.currentDiscount ?? null;
  const catText = (it.catalogs ?? [])
    .map((c) => `${c.name ?? ""} ${(c.slug ?? "").replace(/-firsatlari$/, "").replace(/-/g, " ")}`)
    .join(" ")
    .trim();
  return {
    source: "yaniyo",
    productKey: `yaniyo:${it.shortId}`,
    title: it.name,
    url: `${YANIYO_BASE}/go/${it.shortId}`,
    sourceUrl: `${YANIYO_BASE}/urun/en-ucuz-urun-${it.shortId}`,
    imageUrl: it.image ?? null,
    price: it.currentPrice,
    // Liste yalnızca yüzde veriyor; kesin üstü çizili fiyat ürün sayfasından gelir.
    listPrice: d != null && d > 0 && d < 100
      ? Math.round((it.currentPrice / (1 - d / 100)) * 100) / 100
      : null,
    sourceDiscountPct: d,
    lowestInMonths: it.discountStatus?.months ?? null,
    isAllTimeLow: it.discountStatus?.allTime ?? null,
    inStock: it.isStock ?? null,
    category: catText || null,
    brand: it.brandInfo?.name ?? null,
    observedAt: it.updatedDate ?? null,
  };
}

export interface ProductPageInfo {
  price: number | null;
  listPrice: number | null;
  stats: SourceStats | null;
}

/** Ürün sayfasının GÖRÜNEN metninden fiyatlar ve tüm zamanlar istatistikleri. */
export function parseProductPage(html: string): ProductPageInfo {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, "|")
    .replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/\s*\|[\s|]*/g, "|");
  const P = "([\\d.]+(?:,\\d{1,2})?) TL";

  let price: number | null = null, listPrice: number | null = null;
  const pair = text.match(new RegExp(`\\|${P}\\|${P}\\|Kazanç`));
  if (pair) {
    listPrice = parseTrPrice(pair[1]);
    price = parseTrPrice(pair[2]);
  } else {
    const single = text.match(new RegExp(`\\|${P}\\|(?:Kazanç|Site\\|)`));
    if (single) price = parseTrPrice(single[1]);
  }

  let stats: SourceStats | null = null;
  const s = text.match(new RegExp(`En Düşük\\|${P}\\|Ortalama\\|${P}\\|En Yüksek\\|${P}`));
  if (s) {
    const [min, avg, max] = [parseTrPrice(s[1]), parseTrPrice(s[2]), parseTrPrice(s[3])];
    if (min && avg && max && min <= avg && avg <= max) stats = { min, avg, max };
  }
  return { price, listPrice, stats };
}

// ---------- Ağ katmanı ----------

export interface YaniyoOptions {
  listPaths: string[];
  delayMs: number;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_YANIYO_OPTIONS: YaniyoOptions = {
  listPaths: [
    "/tum-firsatlar?rate=50&month=0&stock=true",
    "/elektronik?rate=35&month=0&stock=true",
    "/yapi-market?rate=35&month=0&stock=true",
  ],
  delayMs: 1500,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getPage(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, {
    headers: { "user-agent": USER_AGENT, "accept": "text/html", "accept-language": "tr-TR" },
    redirect: "follow",
  });
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    throw new SourceBlockedError(`Yaniyo ${res.status} döndü (engel/limit); bu tur durduruldu`);
  }
  if (!res.ok) throw new Error(`Yaniyo ${res.status}: ${url}`);
  const html = await res.text();
  if (/challenges\.cloudflare\.com|cf-chl-|Just a moment\.\.\./i.test(html) && !html.includes("__NEXT_DATA__")) {
    throw new SourceBlockedError("Yaniyo captcha/doğrulama sayfası gösterdi; bu tur durduruldu");
  }
  return html;
}

export function createYaniyoSource(opts: YaniyoOptions = DEFAULT_YANIYO_OPTIONS): DealSource {
  const f = opts.fetchImpl ?? fetch;
  return {
    name: "yaniyo",
    enabled: true,

    async fetchDeals() {
      const seen = new Map<string, RawDeal>();
      for (const [i, path] of opts.listPaths.entries()) {
        if (i > 0) await sleep(opts.delayMs);
        const items = parseListPage(await getPage(YANIYO_BASE + path, f));
        if (items === null) throw new Error(`Yaniyo sayfa yapısı değişmiş olabilir: ${path}`);
        for (const it of items) {
          const raw = listItemToRawDeal(it);
          if (raw.inStock !== false) seen.set(raw.productKey, raw);
        }
      }
      return [...seen.values()];
    },

    async enrich(deal) {
      if (!deal.sourceUrl) return deal;
      await sleep(opts.delayMs);
      const info = parseProductPage(await getPage(deal.sourceUrl, f));
      return {
        ...deal,
        listPrice: info.listPrice ?? deal.listPrice,
        sourceStats: info.stats ?? deal.sourceStats ?? null,
      };
    },
  };
}

export const yaniyoSource = createYaniyoSource();
