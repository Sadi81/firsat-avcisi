-- Uygulama sırları Vault'ta üretilir ve veritabanından hiç çıkmaz:
--   firsat_cron_secret    → pg_cron'un collect çağrısı (x-cron-secret başlığı)
--   firsat_webhook_secret → Telegram webhook doğrulaması (X-Telegram-Bot-Api-Secret-Token)
-- Edge Function'lar bunları yalnızca service role ile, aşağıdaki iki fonksiyon üzerinden kullanır.

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'firsat_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'firsat_cron_secret');
  end if;
  if not exists (select 1 from vault.secrets where name = 'firsat_webhook_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'firsat_webhook_secret');
  end if;
end $$;

-- Gelen değer doğru mu? (sır dışarı verilmez)
create or replace function public.check_app_secret(p_name text, p_value text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_name in ('firsat_cron_secret', 'firsat_webhook_secret')
     and exists (
       select 1 from vault.decrypted_secrets
       where name = p_name and decrypted_secret = p_value
     );
$$;

-- Yalnızca webhook sırrı okunabilir: Telegram'a setWebhook ile bildirmek için gerekli.
create or replace function public.get_webhook_secret()
returns text
language sql stable security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'firsat_webhook_secret';
$$;

revoke execute on function public.check_app_secret(text, text) from public, anon, authenticated;
revoke execute on function public.get_webhook_secret() from public, anon, authenticated;
grant execute on function public.check_app_secret(text, text) to service_role;
grant execute on function public.get_webhook_secret() to service_role;
grant execute on function public.price_history(text) to service_role;
