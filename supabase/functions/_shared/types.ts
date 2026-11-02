// Ortak tipler. Hem Deno (Supabase Edge) hem Node (testler) ile çalışır.

export type Category = "elektronik" | "alet" | "batarya" | "diger";

/** Kaynağın kendi tuttuğu (tüm zamanlar) fiyat istatistikleri, ör. Yaniyo ürün sayfası. */
export interface SourceStats {
  min: number;
  avg: number;
  max: number;
}

/** Herhangi bir kaynaktan (Yaniyo, elle giriş, ileride başkaları) gelen ham fırsat/fiyat gözlemi. */
export interface RawDeal {
  source: string; // "yaniyo", "manual", ...
  /** Kaynak bazında benzersiz ürün anahtarı: "yaniyo:NHA8N8RSNTG", "amazon:B09RN7DYGP" */
  productKey: string;
  asin?: string | null;
  title: string;
  /** Satın alma linki (Amazon veya kaynağın yönlendirme linki) */
  url?: string | null;
  /** Kaynaktaki ürün sayfası */
  sourceUrl?: string | null;
  imageUrl?: string | null;
  price: number; // TL, şu anki fiyat
  listPrice?: number | null; // üstü çizili fiyat
  /** Kaynağın kendi iddia ettiği indirim yüzdesi (gösterim için) */
  sourceDiscountPct?: number | null;
  sourceStats?: SourceStats | null;
  /** Kaynağa göre "son N ayın en düşük fiyatı" (0 = değil) */
  lowestInMonths?: number | null;
  /** Kaynağa göre tüm zamanların en düşüğü */
  isAllTimeLow?: boolean | null;
  inStock?: boolean | null;
  sellerName?: string | null;
  sellerIsAmazon?: boolean | null;
  rating?: number | null; // 0-5
  reviewCount?: number | null;
  category?: string | null; // kaynaktaki ham kategori metni
  brand?: string | null;
  observedAt?: string | null; // ISO tarih (kaynağın fiyat güncelleme zamanı)
  /**
   * true: rutin fiyat örneği (fırsat bildirimi değil). Kendi referans fiyatımız yalnızca
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

export type ReferenceKind = "history" | "source_avg" | "list" | "none";
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
  verdictGreat: number; // bu puan ve üstü "kaçırma"
  verdictGood: number; // bu puan ve üstü "iyi"
}

export const DEFAULT_CONFIG: Config = {
  focusCategories: ["elektronik", "alet", "batarya"],
  minRegularSamples: 3,
  notifyThreshold: 60,
  renotifyHours: 6,
  verdictGreat: 70,
  verdictGood: 55,
};
