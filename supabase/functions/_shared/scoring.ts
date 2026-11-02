// Fırsat puanlama: "gerçekten fırsat mı?" sorusunun cevabı burada.
// Saf fonksiyonlar; veritabanı veya ağ erişimi yok.

import type {
  Category,
  Config,
  PriceHistory,
  RawDeal,
  ReferenceKind,
  ScoreResult,
  Verdict,
} from "./types.ts";
import { DEFAULT_CONFIG } from "./types.ts";

// Sıra önemli:
//  1) Alet TÜRÜ kelimeleri önce: "Akülü Vidalama", "Şarjlı Tornavida (Li-ion)" alettir.
//  2) Sonra batarya: "Makita 18V 5.0Ah Batarya" alet türü içermez → batarya.
//  3) Marka adları en sonda yedek: yalnız başına marka ürünü alete çevirir.
// Kısa/belirsiz kelimeler için kelime sınırlı regex kullanılır ("ram" ≠ "program").
const CATEGORY_PATTERNS: [Category, RegExp[]][] = [
  ["alet", [
    /matkap/, /vidalama/, /taşlama/, /tornavida/, /testere/, /kompresör/, /lehim/,
    /multimetre/, /pense/, /anahtar takımı/, /lokma/, /el aleti/, /hırdavat/, /kırıcı/,
    /delici/, /zımpara/, /dekupaj/, /yapı market/, /somun sıkma/, /darbeli/,
  ]],
  ["batarya", [
    /batarya/, /akü/, /power ?bank/, /şarj(lı| edilebilir) pil/, /lityum/, /li-?ion/,
    /lifepo4/, /(^|[^\p{L}])pil([^\p{L}]|$)/u, /\b(18650|21700)\b/, /\d+([.,]\d+)? ?ah\b/,
  ]],
  ["elektronik", [
    /kulaklık/, /telefon/, /tablet/, /laptop/, /dizüstü/, /bilgisayar/, /monitör/,
    /\b(ssd|hdd|nvme|usb|tv|ram|ddr[45])\b/, /harddisk/, /şarj/, /kamera/, /hoparlör/,
    /akıllı saat/, /mouse/, /klavye/, /televizyon/, /router/, /modem/, /ekran kartı/,
    /işlemci/, /elektronik/, /bluetooth/, /kindle/, /playstation/, /xbox/, /ağ cihazı/,
  ]],
  ["alet", [
    /makita/, /dewalt/, /milwaukee/, /bosch professional/, /metabo/, /ryobi/, /einhell/,
    /stanley/, /black\+decker/, /worx/,
  ]],
];

// "Matkap (Akü Dahil Değildir)" gibi ifadeler ürünü bataryaya çevirmesin.
const NOT_INCLUDED = /\(?\s*(akü|batarya|pil)[^()]*dahil değil(dir)?\s*\)?/g;

function matchCategory(text: string): Category | null {
  for (const [cat, patterns] of CATEGORY_PATTERNS) {
    if (patterns.some((re) => re.test(text))) return cat;
  }
  return null;
}

/** Önce kaynağın kategorisi (daha güvenilir), sonra başlık. */
export function categorize(rawCategory: string | null | undefined, title: string): Category {
  const cat = (rawCategory ?? "").toLocaleLowerCase("tr-TR");
  const t = title.toLocaleLowerCase("tr-TR").replace(NOT_INCLUDED, " ");
  return (cat && matchCategory(cat)) || matchCategory(t) || "diger";
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const tl = (x: number) => `${Math.round(x).toLocaleString("tr-TR")} TL`;

const CONFIDENCE: Record<ReferenceKind, number> = {
  history: 1, // kendi rutin fiyat geçmişimiz
  source_avg: 0.9, // kaynağın tüm zamanlar ortalaması (fırsat dönemlerini de içerir, temkinli)
  list: 0.6, // üstü çizili fiyat, sıklıkla şişirilmiş
  none: 0,
};

/** Referans fiyat: kendi geçmişimiz > kaynağın tüm zamanlar ortalaması > üstü çizili fiyat. */
function pickReference(
  deal: RawDeal,
  history: PriceHistory,
  cfg: Config,
): { ref: number | null; kind: ReferenceKind } {
  if (history.regularSamples >= cfg.minRegularSamples && history.medianRegular90d) {
    return { ref: history.medianRegular90d, kind: "history" };
  }
  if (deal.sourceStats?.avg) {
    return { ref: deal.sourceStats.avg, kind: "source_avg" };
  }
  if (deal.listPrice && deal.listPrice > deal.price) {
    return { ref: deal.listPrice, kind: "list" };
  }
  return { ref: null, kind: "none" };
}

export function scoreDeal(
  deal: RawDeal,
  history: PriceHistory,
  cfg: Config = DEFAULT_CONFIG,
): ScoreResult {
  const flags: string[] = [];
  const reasons: string[] = [];
  const category = categorize(deal.category, deal.title);
  const { ref, kind } = pickReference(deal, history, cfg);

  const discount = ref ? Math.max(0, ((ref - deal.price) / ref) * 100) : 0;
  const saving = ref ? Math.max(0, ref - deal.price) : 0;
  const confidence = CONFIDENCE[kind];

  let score = 0;

  // 1) Gerçek indirim (0-45): %30 altı puan getirmez, %85+ tam puan.
  score += clamp((discount - 30) / (85 - 30), 0, 1) * 45 * confidence;
  if (kind === "history") {
    reasons.push(`Son 90 gün medyanı ${tl(ref!)} → gerçek indirim %${Math.round(discount)}`);
  } else if (kind === "source_avg") {
    reasons.push(`Tüm zamanlar ortalaması ${tl(ref!)} → gerçek indirim %${Math.round(discount)}`);
  } else if (kind === "list") {
    reasons.push(`Üstü çizili fiyat ${tl(ref!)} → indirim %${Math.round(discount)} (güven düşük)`);
    flags.push("Referans yalnızca üstü çizili fiyat; şişirilmiş olabilir, fiyat geçmişi yok");
  } else {
    flags.push("Referans fiyat yok; indirim doğrulanamadı");
  }

  // Görünen indirim ile gerçek indirim çok farklıysa açıkça söyle.
  const claimed = deal.sourceDiscountPct ??
    (deal.listPrice && deal.listPrice > deal.price
      ? ((deal.listPrice - deal.price) / deal.listPrice) * 100
      : null);
  if (claimed != null && kind !== "list" && kind !== "none" && claimed - discount >= 20) {
    flags.push(
      `Görünen indirim %${Math.round(claimed)}, gerçek indirim %${Math.round(discount)}: üstü çizili fiyat yanıltıcı`,
    );
  }

  // 2) Mutlak TL kazanç (0-20), logaritmik: 200 TL → 0, 5.000 TL+ → 20.
  if (saving > 200) {
    score += Math.min(20, (20 * Math.log(saving / 200)) / Math.log(5000 / 200)) * confidence;
  }
  if (saving > 0) reasons.push(`Kazanç ${tl(saving)}`);

  // 3) Satıcı (0..+15)
  if (deal.sellerIsAmazon === true) {
    score += 15;
    reasons.push("Satıcı Amazon");
  } else if (deal.sellerIsAmazon === false) {
    reasons.push(`Üçüncü taraf satıcı${deal.sellerName ? `: ${deal.sellerName}` : ""}`);
  }

  // 4) Ürün kalitesi (-10..+10)
  const r = deal.rating, n = deal.reviewCount;
  if (r != null && n != null) {
    if (n < 10) {
      reasons.push(`Az yorum (${n})`);
    } else if (r < 3.5) {
      score -= 10;
      flags.push(`Düşük puan: ${r}`);
    } else {
      score += r >= 4.3 ? 10 : r >= 4.0 ? 6 : 2;
      reasons.push(`Puan ${r} (${n} yorum)`);
    }
  }

  // 5) Kategori (0-10)
  if (cfg.focusCategories.includes(category)) {
    score += 10;
    reasons.push(`Kategori: ${category}`);
  }

  // 6) Dip fiyat sinyalleri (en fazla +8)
  const ownLow = history.minEver != null && deal.price < history.minEver;
  const sourceLow = deal.isAllTimeLow === true ||
    (deal.sourceStats != null && deal.price <= deal.sourceStats.min);
  if (ownLow || sourceLow) {
    score += 8;
    reasons.push("Tüm zamanların en düşük fiyatı");
  } else if ((deal.lowestInMonths ?? 0) >= 3) {
    score += Math.min(6, deal.lowestInMonths!);
    reasons.push(`Son ${deal.lowestInMonths} ayın en düşük fiyatı`);
  }

  // Risk bayrakları
  let suspicious = false;
  if (deal.sellerIsAmazon === false && discount >= 80) {
    score -= 20;
    suspicious = true;
    flags.push("Üçüncü taraf satıcıda aşırı indirim: satıcı puanını ve kuruluş tarihini kontrol et");
  }
  if (discount >= 70 && (kind === "history" || kind === "source_avg")) {
    flags.push(
      deal.sellerIsAmazon === true
        ? "Olası fiyat hatası: hızlı al, Amazon siparişi iptal edebilir"
        : "Olası fiyat hatası; Amazon sayfasında satıcının Amazon olduğunu kontrol et",
    );
  }
  if (deal.sellerIsAmazon == null && kind !== "none") {
    flags.push("Satıcı bilgisi yok: Amazon sayfasında kontrol et");
  }

  score = Math.round(clamp(score, 0, 100));
  const verdict: Verdict = suspicious
    ? "şüpheli"
    : score >= cfg.verdictGreat
    ? "kaçırma"
    : score >= cfg.verdictGood
    ? "iyi"
    : "zayıf";

  return {
    score,
    verdict,
    category,
    referencePrice: ref,
    referenceKind: kind,
    realDiscountPct: round1(discount),
    savingTry: Math.round(saving),
    flags,
    reasons,
  };
}
