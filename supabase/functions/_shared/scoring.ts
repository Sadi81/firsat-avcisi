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

// Sıra önemli: "18V batarya" hem alet hem batarya kelimesi içerebilir, batarya önce.
// Kısa/belirsiz kelimeler için kelime sınırlı regex kullanılır ("ram" ≠ "program").
const CATEGORY_PATTERNS: [Category, RegExp[]][] = [
  ["batarya", [
    /batarya/, /akü/, /power ?bank/, /şarj(lı| edilebilir) pil/, /lityum/, /li-?ion/,
    /lifepo4/, /(^|[^\p{L}])pil([^\p{L}]|$)/u, /\b(18650|21700)\b/, /\d+([.,]\d+)? ?ah\b/,
  ]],
  ["alet", [
    /matkap/, /vidalama/, /taşlama/, /tornavida/, /testere/, /kompresör/, /lehim/,
    /multimetre/, /pense/, /anahtar takımı/, /lokma/, /el aleti/, /hırdavat/, /kırıcı/,
    /delici/, /zımpara/, /dekupaj/, /makita/, /dewalt/, /milwaukee/, /bosch professional/,
    /metabo/, /ryobi/, /einhell/, /stanley/, /black\+decker/,
  ]],
  ["elektronik", [
    /kulaklık/, /telefon/, /tablet/, /laptop/, /dizüstü/, /bilgisayar/, /monitör/,
    /\b(ssd|hdd|nvme|usb|tv|ram|ddr[45])\b/, /harddisk/, /şarj/, /kamera/, /hoparlör/,
    /akıllı saat/, /mouse/, /klavye/, /televizyon/, /router/, /modem/, /ekran kartı/,
    /işlemci/, /elektronik/, /bluetooth/, /kindle/, /playstation/, /xbox/,
  ]],
];

export function categorize(rawCategory: string | null | undefined, title: string): Category {
  const text = `${rawCategory ?? ""} ${title}`.toLocaleLowerCase("tr-TR");
  for (const [cat, patterns] of CATEGORY_PATTERNS) {
    if (patterns.some((re) => re.test(text))) return cat;
  }
  return "diger";
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const tl = (x: number) => `${Math.round(x).toLocaleString("tr-TR")} TL`;

/** Referans fiyatı seç: önce kendi fiyat geçmişimiz, yoksa Amazon'un üstü çizili fiyatı. */
function pickReference(
  deal: RawDeal,
  history: PriceHistory,
  cfg: Config,
): { ref: number | null; kind: ReferenceKind } {
  if (history.regularSamples >= cfg.minRegularSamples && history.medianRegular90d) {
    return { ref: history.medianRegular90d, kind: "history" };
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
  // Üstü çizili fiyat sıklıkla şişirilmiş olduğu için ona daha az güveniyoruz.
  const confidence = kind === "history" ? 1 : 0.6;

  let score = 0;

  // 1) Gerçek indirim (0-45): %30 altı puan getirmez, %85+ tam puan.
  const discountPts = clamp((discount - 30) / (85 - 30), 0, 1) * 45 * confidence;
  score += discountPts;
  if (kind === "history") {
    reasons.push(`Son 90 gün medyanı ${tl(ref!)} → gerçek indirim %${Math.round(discount)}`);
  } else if (kind === "list") {
    reasons.push(`Üstü çizili fiyat ${tl(ref!)} → indirim %${Math.round(discount)} (güven düşük)`);
    flags.push("Referans Amazon'un üstü çizili fiyatı; şişirilmiş olabilir, fiyat geçmişi yok");
  } else {
    flags.push("Referans fiyat yok; indirim doğrulanamadı");
  }

  // Elimizde hem geçmiş hem üstü çizili fiyat varsa, şişirmeyi yakala.
  if (
    deal.listPrice && history.medianRegular90d &&
    history.regularSamples >= cfg.minRegularSamples &&
    deal.listPrice > history.medianRegular90d * 1.5
  ) {
    flags.push(
      `Üstü çizili fiyat (${tl(deal.listPrice)}) gerçek fiyatın çok üstünde; Amazon'daki % yanıltıcı`,
    );
  }

  // 2) Mutlak TL kazanç (0-20), logaritmik: 200 TL → 0, 5.000 TL+ → 20.
  if (saving > 200) {
    score += Math.min(20, (20 * Math.log(saving / 200)) / Math.log(5000 / 200)) * confidence;
  }
  if (saving > 0) reasons.push(`Kazanç ${tl(saving)}`);

  // 3) Satıcı (-5..+15)
  if (deal.sellerIsAmazon === true) {
    score += 15;
    reasons.push("Satıcı Amazon");
  } else if (deal.sellerIsAmazon === false) {
    reasons.push(`Üçüncü taraf satıcı${deal.sellerName ? `: ${deal.sellerName}` : ""}`);
  } else {
    score -= 5;
    flags.push("Satıcı bilinmiyor");
  }

  // 4) Ürün kalitesi (-10..+10)
  const r = deal.rating, n = deal.reviewCount;
  if (r == null || n == null) {
    reasons.push("Yorum bilgisi yok");
  } else if (n < 10) {
    reasons.push(`Az yorum (${n})`);
  } else if (r >= 4.3) {
    score += 10;
    reasons.push(`Puan ${r} (${n} yorum)`);
  } else if (r >= 4.0) {
    score += 6;
    reasons.push(`Puan ${r} (${n} yorum)`);
  } else if (r < 3.5) {
    score -= 10;
    flags.push(`Düşük puan: ${r}`);
  } else {
    score += 2;
  }

  // 5) Kategori (0-10)
  if (cfg.focusCategories.includes(category)) {
    score += 10;
    reasons.push(`Kategori: ${category}`);
  }

  // 6) Tüm zamanların en düşüğü (+5)
  if (history.minEver != null && deal.price < history.minEver) {
    score += 5;
    reasons.push(`Gördüğümüz en düşük fiyat (önceki: ${tl(history.minEver)})`);
  }

  // Risk bayrakları
  let suspicious = false;
  if (deal.sellerIsAmazon === false && discount >= 80) {
    score -= 20;
    suspicious = true;
    flags.push("Üçüncü taraf satıcıda aşırı indirim: satıcı puanını ve kuruluş tarihini kontrol et");
  }
  if (deal.sellerIsAmazon === true && discount >= 70 && kind === "history") {
    flags.push("Olası fiyat hatası: hızlı al, Amazon siparişi iptal edebilir");
  }

  score = Math.round(clamp(score, 0, 100));
  const verdict: Verdict = suspicious
    ? "şüpheli"
    : score >= 75
    ? "kaçırma"
    : score >= 55
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
