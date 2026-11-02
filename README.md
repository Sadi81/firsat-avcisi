# Fırsat Avcısı

Amazon.com.tr fırsatlarını (ilk kaynak: Yaniyo) toplar, **gerçekten fırsat olup olmadığını** puanlar
ve iyi olanları butonlu bir Telegram mesajıyla telefonunuza gönderir. Satın almayı siz yaparsınız.
Otomatik satın alma bilerek yok: Amazon'un kullanım koşullarına aykırı ve hesabınızın kapatılmasına yol açabilir.

```
Kaynak (Yaniyo, elle POST, ileride kendi tarayıcımız)
  → collect (Supabase Edge Function, pg_cron ile her dakika)
  → ürün + fiyat gözlemi kaydı (Postgres)
  → puanlama (0-100)
  → eşik üstüyse Telegram: [🛒 Amazon'da aç] [✅ Aldım] [❌ Geç]
```

## "Gerçekten fırsat mı?" nasıl karar veriliyor

| Ölçüt | Puan | Not |
|---|---|---|
| Gerçek indirim | 0–45 | Amazon'un üstü çizili fiyatına değil, **kendi fiyat geçmişimizin 90 günlük medyanına** göre. %30 altı 0, %85+ tam puan |
| TL kazanç | 0–20 | Logaritmik: 200 TL → 0, 5.000 TL+ → 20. 50 TL'lik üründe %80 ≠ 5.000 TL'lik üründe %80 |
| Satıcı | −5…+15 | Amazon +15, üçüncü taraf 0, bilinmiyor −5 |
| Ürün kalitesi | −10…+10 | Puan ≥4.3 ve ≥10 yorum → +10; <3.5 → −10 |
| Kategori | 0–10 | elektronik / alet / batarya |
| Tüm zamanların en düşüğü | +5 | |

**Uyarılar (bayraklar):**
- *Referans yalnızca üstü çizili fiyat* → indirim puanı ×0.6 (şişirilmiş olabilir)
- *Üstü çizili fiyat gerçek fiyatın 1.5 katından fazla* → Amazon'daki % yanıltıcı
- *Üçüncü taraf satıcıda %80+ indirim* → −20 ve "şüpheli" (bildirilmez)
- *Amazon satıcı + geçmişe göre %70+* → olası fiyat hatası: hızlı al, Amazon iptal edebilir

Sonuç: **≥75 kaçırma · ≥55 iyi · altı zayıf**. Varsayılan bildirim eşiği 60 (`NOTIFY_THRESHOLD`).
Aynı ürün 6 saat içinde tekrar bildirilmez; fiyatı en az %3 daha düşerse bildirilir.

> ⚠️ Puanlamanın kalitesi **rutin fiyat geçmişine** bağlıdır. Yalnızca fırsat anlarındaki fiyatları
> kaydedersek "normal fiyat" da fırsat fiyatı gibi görünür. Bu yüzden gözlemler `isRegularPrice`
> ile ayrılır ve referans yalnızca rutinlerden hesaplanır. Yaniyo geçmiş fiyat sunuyorsa oradan,
> sunmuyorsa ileride kendi takipçimizden beslenecek.

## Durum

- [x] Veritabanı şeması, puanlama, tekrar bildirim engeli, Telegram bildirimi + karar butonları
- [x] Testler (Node ve Deno), tip kontrolü
- [ ] **Yaniyo adaptörü** (`supabase/functions/_shared/sources/yaniyo.ts`): site henüz incelenemedi
- [ ] Rutin fiyat takipçisi (izleme listesindeki ürünlerin düzenli fiyatı)
- [ ] Yeniden satış için başka pazar yerleriyle (Hepsiburada, Trendyol, sahibinden) fiyat karşılaştırması
- [ ] "Aldım / Geç" kararlarına göre ağırlıkların ayarlanması

## Kurulum

1. **Telegram botu**: @BotFather → `/newbot` → token. Bota bir mesaj atın, sonra
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
  -d '{"asin":"B0XXXXXXXX","title":"Makita 18V 5.0Ah Batarya","price":900,"listPrice":3500,"sellerIsAmazon":true,"rating":4.7,"reviewCount":1200}'
```

Rutin fiyat örneği eklemek için kayda `"isRegularPrice": true` ekleyin.

## Geliştirme

```bash
npm install
npm test           # node --test
npm run typecheck
```

`supabase/functions/_shared/` altındaki `types`, `scoring`, `pipeline` ve `telegram` modülleri saftır
ve hem Node hem Deno'da çalışır. `supabase-store.ts` ile fonksiyon giriş noktaları Deno'ya özeldir.
