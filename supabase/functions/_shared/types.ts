// Ortak tipler. Hem Deno (Supabase Edge) hem Node (testler) ile çalışır.

export type Category = "elektronik" | "alet" | "batarya" | "diger";

/** Herhangi bir kaynaktan (Yaniyo, elle giriş, kendi tarayıcımız) gelen ham fırsat/fiyat gözlemi. */
export interface RawDeal {
  source: string; // "yaniyo", "manual", ...
  asin: string;
  title: string;
  url?: string | null;
  price: number; // TL, şu anki fiyat
  listPrice?: number | null; // Amazon'un üstü çizili fiyatı
  sellerName?: string | null;
  sellerIsAmazon?: boolean | null;
  rating?: number | null; // 0-5
  reviewCount?: number | null;
  category?: string | null; // kaynaktaki ham kategori metni
  brand?: string | null;
  observedAt?: string | null; // ISO tarih
  /**
   * true: rutin fiyat örneği (fırsat bildirimi değil). Referans fiyat yalnızca
   * bunlardan hesaplanır; aksi halde geçmiş fırsat fiyatlarıyla dolup yanıltır.
   */
  isRegularPrice?: boolean;
}

export interface PriceHistory {
  /** Son 90 gündeki rutin (fırsat olmayan) fiyat örneği sayısı */
  regularSamples: number;
  /** Son 90 günün rutin fiyat medyanı */
  medianRegular90d: number | null;
  /** Bu gözlemden önceki tüm gözlemler içindeki en düşük fiyat */
  minEver: number | null;
}

export type ReferenceKind = "history" | "list" | "none";
export type Verdict = "kaçırma" | "iyi" | "zayıf" | "şüpheli";

export interface ScoreResult {
  score: number; // 0-100
  verdict: Verdict;
  category: Category;
  referencePrice: number | null;
  referenceKind: ReferenceKind;
  realDiscountPct: number; // referansa göre gerçek indirim
  savingTry: number; // TL kazanç
  flags: string[]; // uyarılar
  reasons: string[]; // puanın gerekçeleri
}

export interface Config {
  focusCategories: Category[];
  minRegularSamples: number;
  notifyThreshold: number;
  renotifyHours: number;
}

export const DEFAULT_CONFIG: Config = {
  focusCategories: ["elektronik", "alet", "batarya"],
  minRegularSamples: 3,
  notifyThreshold: 60,
  renotifyHours: 6,
};
