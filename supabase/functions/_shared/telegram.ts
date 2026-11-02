// Telegram bildirimi. HTML parse mode kullanılır (kaçış kuralları Markdown'dan basit).

import type { RawDeal, ScoreResult } from "./types.ts";
import type { Notifier } from "./pipeline.ts";

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const tl = (x: number) => `${Math.round(x).toLocaleString("tr-TR")} TL`;

const VERDICT_ICON: Record<string, string> = {
  "kaçırma": "🔥",
  "iyi": "👍",
  "zayıf": "😐",
  "şüpheli": "⚠️",
};

const isHttps = (u: string | null | undefined): u is string => !!u && u.startsWith("https://");

/** Satın alma linki: kaynağın verdiği link > ASIN'den Amazon linki > kaynak sayfası. */
export function buyUrl(deal: RawDeal): string | null {
  if (isHttps(deal.url)) return deal.url;
  if (deal.asin) return `https://www.amazon.com.tr/dp/${deal.asin}`;
  return isHttps(deal.sourceUrl) ? deal.sourceUrl : null;
}

interface FormatOptions {
  titleMax?: number;
  maxReasons?: number;
}

export function formatMessage(deal: RawDeal, r: ScoreResult, opts: FormatOptions = {}): string {
  const { titleMax = 180, maxReasons = Infinity } = opts;
  const lines = [
    `${VERDICT_ICON[r.verdict] ?? ""} <b>${r.score}/100 · ${r.verdict.toUpperCase()}</b>`,
    `<b>${esc(deal.title.slice(0, titleMax))}</b>`,
    r.referencePrice && r.savingTry > 0
      ? `💰 <s>${tl(r.referencePrice)}</s> → <b>${tl(deal.price)}</b> (−%${Math.round(r.realDiscountPct)}, ${tl(r.savingTry)} kazanç)`
      : `💰 <b>${tl(deal.price)}</b>`,
  ];
  if (deal.sourceStats) {
    const s = deal.sourceStats;
    lines.push(`📈 Tüm zamanlar: en düşük ${tl(s.min)} · ort. ${tl(s.avg)} · en yüksek ${tl(s.max)}`);
  }
  const reasons = r.reasons.slice(0, maxReasons);
  if (reasons.length) lines.push("", ...reasons.map((x) => `• ${esc(x)}`));
  if (r.flags.length) {
    lines.push("", ...r.flags.map((x) => `⚠️ ${esc(x)}`));
  }
  lines.push("", `<i>Kaynak: ${esc(deal.source)} · ${esc(deal.productKey)}</i>`);
  return lines.join("\n");
}

/** Telegram'ın saydığı uzunluk: HTML etiketleri hariç, varlıklar tek karakter. */
export function visibleLength(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt);/g, "x").length;
}

/** Fotoğraf altı yazısı Telegram'da en fazla 1024 karakter: sığana kadar ayrıntıyı azalt. */
export const CAPTION_LIMIT = 1024;
export function fitCaption(deal: RawDeal, r: ScoreResult, limit = CAPTION_LIMIT): string {
  const variants: FormatOptions[] = [
    {},
    { maxReasons: 3 },
    { maxReasons: 0 },
    { maxReasons: 0, titleMax: 90 },
  ];
  for (const v of variants) {
    const text = formatMessage(deal, r, v);
    if (visibleLength(text) <= limit) return text;
  }
  // Son çare: uyarılar bile sığmıyorsa yalnızca başlık + fiyat.
  return formatMessage({ ...deal, sourceStats: null }, { ...r, reasons: [], flags: r.flags.slice(0, 2) }, {
    maxReasons: 0,
    titleMax: 90,
  });
}

export function telegramNotifier(token: string, chatId: string): Notifier {
  return {
    async send(dealId, deal, result) {
      const links: { text: string; url: string }[] = [];
      const buy = buyUrl(deal);
      if (buy) links.push({ text: "🛒 Amazon'da aç", url: buy });
      if (isHttps(deal.sourceUrl) && deal.sourceUrl !== buy) {
        links.push({ text: "📊 Fiyat geçmişi", url: deal.sourceUrl });
      }
      const reply_markup = {
        inline_keyboard: [
          links,
          [
            { text: "✅ Aldım", callback_data: `bought:${dealId}` },
            { text: "❌ Geç", callback_data: `skipped:${dealId}` },
          ],
        ].filter((row) => row.length),
      };
      const call = (method: string, body: Record<string, unknown>) =>
        fetch(`https://api.telegram.org/bot${token}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", reply_markup, ...body }),
        });

      // Fotoğraf varsa fotoğraflı gönder; Telegram resmi alamazsa düz metne düş (fırsat kaçmasın).
      if (isHttps(deal.imageUrl)) {
        const res = await call("sendPhoto", { photo: deal.imageUrl, caption: fitCaption(deal, result) });
        if (res.ok) return true;
        console.warn(`sendPhoto başarısız (${res.status}), metinle gönderiliyor: ${await res.text()}`);
      }
      const res = await call("sendMessage", {
        text: formatMessage(deal, result),
        link_preview_options: { is_disabled: true },
      });
      if (!res.ok) throw new Error(`Telegram sendMessage ${res.status}: ${await res.text()}`);
      return true;
    },
  };
}

/** Telegram henüz ayarlı değilken: tarama ve puanlama sürer, hiçbir şey "bildirildi" sayılmaz. */
export const disabledNotifier: Notifier = {
  send() {
    return Promise.resolve(false);
  },
};

/** TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID varsa gerçek bildirimci, yoksa devre dışı. */
export function notifierFromEnv(get: (name: string) => string | undefined): Notifier {
  const token = get("TELEGRAM_BOT_TOKEN"), chatId = get("TELEGRAM_CHAT_ID");
  return token && chatId ? telegramNotifier(token, chatId) : disabledNotifier;
}
