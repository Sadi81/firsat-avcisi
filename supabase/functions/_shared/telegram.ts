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

export function amazonUrl(deal: RawDeal): string {
  return deal.url && deal.url.startsWith("https://")
    ? deal.url
    : `https://www.amazon.com.tr/dp/${deal.asin}`;
}

export function formatMessage(deal: RawDeal, r: ScoreResult): string {
  const lines = [
    `${VERDICT_ICON[r.verdict] ?? ""} <b>${r.score}/100 · ${r.verdict.toUpperCase()}</b>`,
    `<b>${esc(deal.title.slice(0, 180))}</b>`,
    r.referencePrice
      ? `💰 <s>${tl(r.referencePrice)}</s> → <b>${tl(deal.price)}</b> (−%${Math.round(r.realDiscountPct)}, ${tl(r.savingTry)} kazanç)`
      : `💰 <b>${tl(deal.price)}</b>`,
    "",
    ...r.reasons.map((x) => `• ${esc(x)}`),
  ];
  if (r.flags.length) {
    lines.push("", ...r.flags.map((x) => `⚠️ ${esc(x)}`));
  }
  lines.push("", `<i>Kaynak: ${esc(deal.source)} · ${deal.asin}</i>`);
  return lines.join("\n");
}

export function telegramNotifier(token: string, chatId: string): Notifier {
  return {
    async send(dealId, deal, result) {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: formatMessage(deal, result),
          parse_mode: "HTML",
          disable_web_page_preview: false,
          reply_markup: {
            inline_keyboard: [
              [{ text: "🛒 Amazon'da aç", url: amazonUrl(deal) }],
              [
                { text: "✅ Aldım", callback_data: `bought:${dealId}` },
                { text: "❌ Geç", callback_data: `skipped:${dealId}` },
              ],
            ],
          },
        }),
      });
      if (!res.ok) throw new Error(`Telegram sendMessage ${res.status}: ${await res.text()}`);
    },
  };
}
