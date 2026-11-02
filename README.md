# Fırsat Avcısı

Amazon.com.tr fırsatlarını Yaniyo'dan toplar, **gerçekten fırsat olup olmadığını** fiyat geçmişine
göre puanlar ve iyi olanları butonlu bir Telegram mesajıyla telefonunuza gönderir. Satın almayı siz yaparsınız.
Otomatik satın alma bilerek yok: Amazon'un kullanım koşullarına aykırı ve hesabınızın kapatılmasına yol açabilir.

```
Yaniyo liste sayfaları (2 dk'da bir)          ← elle POST da olur
  → yeni + odak kategori (elektronik / alet / batarya) mi?
  → umut verici ise ürün sayfası: üstü çizili fiyat + tüm zamanlar en düşük/ortalama/en yüksek
  → puanlama (0-100)
  → eşik üstüyse Telegram: [🛒 Amazon'da aç] [📊 Fiyat geçmişi] [✅ Aldım] [❌ Geç]
```

## "Gerçekten fırsat mı?" nasıl karar veriliyor

Amazon'un ve Yaniyo'nun gösterdiği indirim yüzdesi üstü çizili fiyata göre hesaplanır ve bu fiyat sıklıkla
şişirilmiştir. İlk canlı denemede Yaniyo'nun %58–72 dediği üç üründe gerçek indirim %52, %24 ve **%0** çıktı.
Bu yüzden indirim **referans fiyata** göre yeniden hesaplanır:

| Referans (öncelik sırasıyla) | Güven |
|---|---|
| Kendi rutin fiyat geçmişimizin 90 günlük medyanı (en az 3 örnek) | 1.0 |
| Yaniyo'nun tüm zamanlar ortalaması | 0.9 |
| Üstü çizili fiyat | 0.6 |

| Ölçüt | Puan |
|---|---|
| Gerçek indirim: %30 altı 0, %85+ tam puan (× güven) | 0–45 |
| TL kazanç, logaritmik: 200 TL → 0, 5.000 TL+ → 20 (× güven) | 0–20 |
| Satıcı Amazon (bilgi varsa) | 0–15 |
| Ürün puanı ve yorum sayısı (bilgi varsa) | −10…+10 |
| Odak kategori | 0–10 |
| Tüm zamanların en düşüğü +8, son N ayın en düşüğü +N (en fazla 6) | 0–8 |

**Uyarılar:** görünen ve gerçek indirim arasında 20 puandan fazla fark varsa "üstü çizili fiyat yanıltıcı";
gerçek indirim %70 ve üstündeyse "olası fiyat hatası"; üçüncü taraf satıcıda %80 ve üstü indirim varsa
"şüpheli" (bildirilmez); satıcı bilgisi yoksa "Amazon sayfasında kontrol et".

Sonuç: **≥70 kaçırma · ≥55 iyi · altı zayıf**. Bildirim eşiği 60'tır (`NOTIFY_THRESHOLD`).
Aynı ürün 6 saat içinde tekrar bildirilmez; fiyatı en az %3 daha düşerse yine bildirilir.

## Yaniyo ile ilgili sınırlar

Yaniyo'nun kullanım koşulları, sitedeki listelerin izinsiz kopyalanmasını ve işlenmesini yasaklıyor.
Bu araç kişisel kullanım içindir ve şu sınırlarla çalışır (`supabase/functions/_shared/sources/yaniyo.ts`):

- Yalnızca herkese açık sayfalar okunur: liste sayfalarındaki `__NEXT_DATA__` ve ürün sayfasının görünen metni.
  İç API'ye ve şifrelenmiş alanlara dokunulmaz, captcha aşılmaz.
- Düşük frekans: 2 dakikada bir 3 liste sayfası ve tur başına en fazla 6 ürün sayfası, istekler arasında 1,5 sn beklenir.
- Bot kendini `FirsatAvcisi/0.1` olarak tanıtır, tarayıcı taklidi yapmaz.
- 403/429/503 veya captcha görülürse tur durur, zorlamaz.
- Satın alma linki Yaniyo'nun kendi yönlendirmesidir (`/go/<kod>`). Bot bu linki çağırmaz, tıklayan sizsiniz.
- İzin talebi taslağı: [`docs/yaniyo-izin-epostasi.md`](docs/yaniyo-izin-epostasi.md)

## Durum

- [x] Veritabanı şeması, puanlama, tekrar bildirim engeli, Telegram bildirimi ve karar butonları
- [x] Yaniyo adaptörü (canlı sitede denendi)
- [x] Testler (31, Node ve Deno), tip kontrolü
- [ ] Supabase'e kurulum ve gerçek Telegram ile uçtan uca deneme
- [ ] Yaniyo'dan izin yanıtı
- [ ] Rutin fiyat takipçisi (izleme listesindeki ürünlerin düzenli fiyatı)
- [ ] Yeniden satış için başka pazar yerleriyle fiyat karşılaştırması
- [ ] "Aldım / Geç" kararlarına göre ağırlıkların ayarlanması

## Kurulum

1. **Telegram botu**: @BotFather'a `/newbot` yazın ve token'ı alın. Bota bir mesaj atın, sonra
   `https://api.telegram.org/bot<TOKEN>/getUpdates` adresinden `chat.id` değerini alın.
2. **Supabase projesi** oluşturun, ardından:
   ```bash
   supabase link --project-ref <PROJECT_REF>
   supabase db push
   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
     CRON_SECRET=$(openssl rand -hex 24) TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24)
   supabase functions deploy collect
   supabase functions deploy telegram-webhook
   ```
3. **Butonlar için webhook**:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-webhook \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```
4. **Zamanlayıcı**: `supabase/cron.sql` içindeki yer tutucuları doldurup SQL Editor'da çalıştırın.

### Elle fırsat göndermek (test veya başka kaynak)

```bash
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/collect \
  -H "x-cron-secret: <CRON_SECRET>" -H "content-type: application/json" \
  -d '{"asin":"B0XXXXXXXX","title":"Makita 18V 5.0Ah Batarya","price":900,"listPrice":3500,"sellerIsAmazon":true}'
```

Rutin fiyat örneği eklemek için kayda `"isRegularPrice": true` ekleyin.

## Geliştirme

```bash
npm install
npm test           # node --test
npm run typecheck
```

`supabase/functions/_shared/` altındaki modüller (`supabase-store.ts` hariç) saftır ve hem Node hem Deno'da
çalışır. `supabase-store.ts` ile fonksiyon giriş noktaları Deno'ya özeldir.
