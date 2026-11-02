// Fırsat kaynakları. Her kaynak RawDeal listesi döndürür; geri kalan her şey ortak.
// Yeni kaynak eklemek = bu arayüzü uygulayan bir dosya + aşağıdaki listeye ekleme.

import type { RawDeal } from "../types.ts";
import { yaniyoSource } from "./yaniyo.ts";

export interface DealSource {
  name: string;
  enabled: boolean;
  /** Hızlı tarama: liste sayfalarından ham kayıtlar */
  fetchDeals(): Promise<RawDeal[]>;
  /** İsteğe bağlı: yalnızca yeni ve umut verici kayıtlar için ayrıntı (ürün sayfası) */
  enrich?(deal: RawDeal): Promise<RawDeal>;
}

export const SOURCES: DealSource[] = [yaniyoSource];
