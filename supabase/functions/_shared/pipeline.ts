// Tek bir ham gözlemi işler: ürünü kaydet → geçmişi oku → gözlemi ekle → puanla →
// fırsatı kaydet → gerekiyorsa bildir. Depolama ve bildirim arayüzle verilir (test edilebilir).

import { categorize, scoreDeal } from "./scoring.ts";
import type { Config, PriceHistory, RawDeal, ScoreResult } from "./types.ts";
import { DEFAULT_CONFIG } from "./types.ts";

export interface Store {
  upsertProduct(deal: RawDeal, category: string): Promise<void>;
  /** Aynı ürün için aynı kaynak zamanında gözlem zaten var mı? (tekrar işlemeyi önler) */
  hasObservation(productKey: string, source: string, observedAt: string): Promise<boolean>;
  /** Yeni gözlem eklenmeden ÖNCE çağrılır, böylece minEver bu fiyatı içermez. */
  getHistory(productKey: string): Promise<PriceHistory>;
  insertObservation(deal: RawDeal): Promise<number>;
  insertDeal(
    productKey: string,
    observationId: number,
    price: number,
    result: ScoreResult,
  ): Promise<number>;
  lastNotified(productKey: string): Promise<{ price: number; notifiedAt: string } | null>;
  markNotified(dealId: number): Promise<void>;
}

export interface Notifier {
  /** true: gerçekten iletildi. false: iletilemedi (ör. Telegram henüz ayarlı değil) → "bildirildi" sayılmaz. */
  send(dealId: number, deal: RawDeal, result: ScoreResult): Promise<boolean>;
}

export interface ProcessOutcome {
  productKey: string;
  dealId: number | null;
  result: ScoreResult | null;
  notified: boolean;
}

export function shouldNotify(
  price: number,
  result: ScoreResult,
  last: { price: number; notifiedAt: string } | null,
  cfg: Config,
  now: Date,
): boolean {
  if (result.verdict === "şüpheli" || result.score < cfg.notifyThreshold) return false;
  if (!last) return true;
  const hoursSince = (now.getTime() - new Date(last.notifiedAt).getTime()) / 36e5;
  if (hoursSince >= cfg.renotifyHours) return true;
  // Aynı ürün kısa sürede tekrar düştüyse, en az %3 daha ucuzsa yine haber ver.
  return price < last.price * 0.97;
}

/** Kaynaklardan gelen veriye güvenilmez: zorunlu alanları çalışma anında doğrula. */
export function isValidRaw(x: unknown): x is RawDeal {
  if (typeof x !== "object" || x === null) return false;
  const d = x as Partial<RawDeal>;
  return typeof d.productKey === "string" && /^[a-z]+:[A-Za-z0-9_-]{4,40}$/.test(d.productKey) &&
    typeof d.title === "string" && d.title.length > 0 &&
    typeof d.price === "number" && Number.isFinite(d.price) && d.price > 0 &&
    typeof d.source === "string" && d.source.length > 0;
}

/**
 * Elle girilen kayıtlar için kolaylık: { asin: "B0..." } → productKey "amazon:B0...".
 * Doğrulamadan önce çağrılır.
 */
export function normalizeManual(x: unknown): unknown {
  if (typeof x !== "object" || x === null) return x;
  const d: Record<string, unknown> = { source: "manual", ...(x as Record<string, unknown>) };
  if (!d.productKey && typeof d.asin === "string" && /^[A-Z0-9]{10}$/.test(d.asin)) {
    d.productKey = `amazon:${d.asin}`;
  }
  return d;
}

export async function processDeal(
  deal: RawDeal,
  store: Store,
  notifier: Notifier,
  cfg: Config = DEFAULT_CONFIG,
  now: Date = new Date(),
): Promise<ProcessOutcome> {
  await store.upsertProduct(deal, categorize(deal.category, deal.title));
  const history = await store.getHistory(deal.productKey);
  const observationId = await store.insertObservation(deal);

  // Rutin fiyat örnekleri yalnızca geçmişi besler, puanlanmaz.
  if (deal.isRegularPrice) {
    return { productKey: deal.productKey, dealId: null, result: null, notified: false };
  }

  const result = scoreDeal(deal, history, cfg);
  const dealId = await store.insertDeal(deal.productKey, observationId, deal.price, result);

  const last = await store.lastNotified(deal.productKey);
  let notified = false;
  if (shouldNotify(deal.price, result, last, cfg, now) && await notifier.send(dealId, deal, result)) {
    await store.markNotified(dealId);
    notified = true;
  }
  return { productKey: deal.productKey, dealId, result, notified };
}
