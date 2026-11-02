// Test yardımcıları: bellekte çalışan sahte depo ve bildirim kaydedici.

import type { Notifier, Store } from "../supabase/functions/_shared/pipeline.ts";

/** price_history SQL fonksiyonunun ve unique(product_key, source, observed_at) kısıtının taklidi. */
export function memoryStore() {
  const obs: { key: string; source: string; observedAt: string; price: number; regular: boolean }[] = [];
  const deals: { id: number; key: string; price: number; notifiedAt: string | null }[] = [];
  let clock = new Date("2026-11-02T10:00:00Z");
  const store: Store = {
    async upsertProduct() {},
    async hasObservation(key, source, observedAt) {
      return obs.some((o) => o.key === key && o.source === source && o.observedAt === observedAt);
    },
    async getHistory(key) {
      const mine = obs.filter((o) => o.key === key);
      const reg = mine.filter((o) => o.regular).map((o) => o.price).sort((a, b) => a - b);
      const mid = reg.length / 2;
      return {
        regularSamples: reg.length,
        medianRegular90d: reg.length
          ? (reg.length % 2 ? reg[Math.floor(mid)] : (reg[mid - 1] + reg[mid]) / 2)
          : null,
        minEver: mine.length ? Math.min(...mine.map((o) => o.price)) : null,
      };
    },
    async insertObservation(d) {
      const observedAt = d.observedAt ?? `${clock.toISOString()}#${obs.length}`;
      if (obs.some((o) => o.key === d.productKey && o.source === d.source && o.observedAt === observedAt)) {
        throw new Error("duplicate key value violates unique constraint");
      }
      obs.push({ key: d.productKey, source: d.source, observedAt, price: d.price, regular: !!d.isRegularPrice });
      return obs.length;
    },
    async insertDeal(key, _obsId, price) {
      deals.push({ id: deals.length + 1, key, price, notifiedAt: null });
      return deals.length;
    },
    async lastNotified(key) {
      const n = deals.filter((d) => d.key === key && d.notifiedAt).at(-1);
      return n ? { price: n.price, notifiedAt: n.notifiedAt! } : null;
    },
    async markNotified(id) {
      deals[id - 1].notifiedAt = clock.toISOString();
    },
  };
  return {
    store,
    obs,
    deals,
    advance(hours: number) {
      clock = new Date(clock.getTime() + hours * 36e5);
    },
    get now() {
      return clock;
    },
  };
}

export function recordingNotifier() {
  const sent: number[] = [];
  const notifier: Notifier = { async send(id) { sent.push(id); return true; } };
  return { notifier, sent };
}
