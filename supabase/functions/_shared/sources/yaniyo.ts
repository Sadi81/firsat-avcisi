// Yaniyo adaptörü — HENÜZ YAZILMADI.
//
// Sitenin veriyi nasıl sunduğu (HTML liste, iç JSON API, RSS, uygulama API'si)
// incelenemedi: geliştirme ortamının ağ politikası yaniyo.com'u engelliyor.
// Erişim açılınca yapılacak:
//   1. Fırsat listesinin geldiği isteği bul (tercihen JSON uç noktası).
//   2. Her kaydı RawDeal'e çevir: asin, title, price, listPrice, satıcı, puan, kategori.
//   3. Yaniyo fiyat geçmişi sunuyorsa, rutin fiyatları isRegularPrice: true ile ekle
//      (gerçek indirim hesabının kalitesi buna bağlı).
//   4. enabled: true yap.

import type { DealSource } from "./index.ts";

export const yaniyoSource: DealSource = {
  name: "yaniyo",
  enabled: false,
  fetchDeals() {
    return Promise.reject(new Error("Yaniyo adaptörü henüz yazılmadı"));
  },
};
