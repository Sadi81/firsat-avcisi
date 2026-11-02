// Bir kaynağı tarar: yeni kayıtları ayıklar, umut verici olanları ayrıntılandırır
// (ürün sayfası, tur başına sınırlı), sonra pipeline'a verir.

import { isValidRaw, processDeal, type Notifier, type ProcessOutcome, type Store } from "./pipeline.ts";
import { categorize } from "./scoring.ts";
import type { DealSource } from "./sources/index.ts";
import type { Config, RawDeal } from "./types.ts";

export interface CollectOptions {
  /** Tur başına en fazla kaç ürün sayfası açılsın */
  maxEnrichPerRun: number;
  /** Ayrıntıya değer bulmak için kaynağın iddia ettiği en düşük indirim */
  minClaimedDiscount: number;
}

export const DEFAULT_COLLECT_OPTIONS: CollectOptions = {
  maxEnrichPerRun: 6,
  minClaimedDiscount: 40,
};

export interface CollectReport {
  source: string;
  fetched: number;
  skippedSeen: number;
  skippedCategory: number;
  deferred: number; // bütçe dolduğu için sonraki tura kalan
  enriched: number;
  outcomes: ProcessOutcome[];
  errors: string[];
  blocked: boolean;
}

export function worthEnriching(d: RawDeal, opts: CollectOptions): boolean {
  return d.inStock !== false && (
    (d.sourceDiscountPct ?? 0) >= opts.minClaimedDiscount ||
    d.isAllTimeLow === true ||
    (d.lowestInMonths ?? 0) >= 3
  );
}

export async function collectFromSource(
  source: DealSource,
  store: Store,
  notifier: Notifier,
  cfg: Config,
  opts: CollectOptions = DEFAULT_COLLECT_OPTIONS,
  isBlockedError: (e: unknown) => boolean = () => false,
): Promise<CollectReport> {
  const rep: CollectReport = {
    source: source.name, fetched: 0, skippedSeen: 0, skippedCategory: 0,
    deferred: 0, enriched: 0, outcomes: [], errors: [], blocked: false,
  };

  let raws: RawDeal[];
  try {
    raws = await source.fetchDeals();
  } catch (e) {
    rep.blocked = isBlockedError(e);
    rep.errors.push(`${source.name}: ${(e as Error).message}`);
    return rep;
  }
  rep.fetched = raws.length;

  // Önce en çok indirim iddia edenler: bütçe sınırlıysa iyi adaylar önce ayrıntılansın.
  raws.sort((a, b) => (b.sourceDiscountPct ?? 0) - (a.sourceDiscountPct ?? 0));

  for (let raw of raws) {
    if (!isValidRaw(raw)) {
      rep.errors.push(`${source.name}: geçersiz kayıt ${JSON.stringify(raw).slice(0, 200)}`);
      continue;
    }
    if (!cfg.focusCategories.includes(categorize(raw.category, raw.title))) {
      rep.skippedCategory++;
      continue;
    }
    try {
      if (raw.observedAt && await store.hasObservation(raw.productKey, raw.source, raw.observedAt)) {
        rep.skippedSeen++;
        continue;
      }
      if (source.enrich && worthEnriching(raw, opts)) {
        if (rep.enriched >= opts.maxEnrichPerRun) {
          rep.deferred++; // kaydetmiyoruz; sonraki turda yine "yeni" görünecek
          continue;
        }
        rep.enriched++;
        raw = await source.enrich(raw);
      }
      rep.outcomes.push(await processDeal(raw, store, notifier, cfg));
    } catch (e) {
      if (isBlockedError(e)) {
        rep.blocked = true;
        rep.errors.push(`${source.name}: ${(e as Error).message}`);
        break; // engel varsa zorlamıyoruz
      }
      rep.errors.push(`${raw.productKey}: ${(e as Error).message}`);
    }
  }
  return rep;
}
