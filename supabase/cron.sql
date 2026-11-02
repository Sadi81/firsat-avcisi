-- Kurulumdan sonra Supabase SQL Editor'da BİR KEZ çalıştırın (projeye özel adres içerdiği için migration değil).
-- <PROJECT_REF> değerini kendi projenizinkiyle değiştirin.
-- firsat_cron_secret, 20261102000001_app_secrets.sql migration'ı tarafından Vault'ta üretilir.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Her dakika kaynakları tara (tur başına 3 liste + en fazla 6 ürün sayfası)
select cron.schedule(
  'firsat-collect',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/collect',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'firsat_cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Durdurmak için: select cron.unschedule('firsat-collect');

-- Telegram botunu webhook'a bağlamak (TELEGRAM_BOT_TOKEN girildikten sonra, bir kez):
-- select net.http_post(
--   url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/telegram-webhook?setup=1',
--   headers := jsonb_build_object('content-type', 'application/json',
--     'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'firsat_cron_secret')),
--   body    := '{}'::jsonb);
-- Sonuç: select status_code, content from net._http_response order by id desc limit 1;
