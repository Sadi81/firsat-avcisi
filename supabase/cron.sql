-- Kurulumdan sonra Supabase SQL Editor'da BİR KEZ çalıştırın (gizli bilgi içerdiği için migration değil).
-- <PROJECT_REF> ve <CRON_SECRET> değerlerini kendinizinkilerle değiştirin.
-- CRON_SECRET, Edge Function secret'ı olarak verdiğinizle aynı olmalı.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<CRON_SECRET>', 'firsat_cron_secret');

-- 2 dakikada bir kaynakları tara (Yaniyo'ya düşük yük: tur başına 3 liste + en fazla 6 ürün sayfası)
select cron.schedule(
  'firsat-collect',
  '*/2 * * * *',
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
