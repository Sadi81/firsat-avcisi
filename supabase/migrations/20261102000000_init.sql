-- Fırsat Avcısı: başlangıç şeması

create table public.products (
  -- Kaynak bazında benzersiz anahtar: 'yaniyo:NHA8N8RSNTG', 'amazon:B09RN7DYGP'
  product_key   text primary key check (product_key ~ '^[a-z]+:[A-Za-z0-9_-]{4,40}$'),
  asin          text check (asin is null or asin ~ '^[A-Z0-9]{10}$'),
  title         text not null,
  brand         text,
  category      text not null default 'diger',
  rating        numeric(2,1),
  review_count  integer,
  buy_url       text,
  source_url    text,
  image_url     text,
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.price_observations (
  id                  bigint generated always as identity primary key,
  product_key         text not null references public.products(product_key) on delete cascade,
  price               numeric(12,2) not null check (price > 0),
  list_price          numeric(12,2),
  source_discount_pct numeric(5,2),
  stats_min           numeric(12,2), -- kaynağın tüm zamanlar istatistikleri
  stats_avg           numeric(12,2),
  stats_max           numeric(12,2),
  seller_name         text,
  seller_is_amazon    boolean,
  -- true: rutin fiyat örneği; false: fırsat bildirimi. Kendi referansımız yalnızca rutinlerden hesaplanır.
  is_regular          boolean not null default false,
  source              text not null,
  observed_at         timestamptz not null default now(),
  -- Aynı kaynak güncellemesi iki kez işlenmesin
  unique (product_key, source, observed_at)
);
create index price_observations_key_time on public.price_observations (product_key, observed_at desc);

create table public.deals (
  id                bigint generated always as identity primary key,
  product_key       text not null references public.products(product_key) on delete cascade,
  observation_id    bigint not null references public.price_observations(id) on delete cascade,
  price             numeric(12,2) not null,
  reference_price   numeric(12,2),
  reference_kind    text not null check (reference_kind in ('history','source_avg','list','none')),
  real_discount_pct numeric(5,1) not null,
  saving_try        integer not null,
  score             integer not null check (score between 0 and 100),
  verdict           text not null,
  category          text not null,
  flags             text[] not null default '{}',
  reasons           text[] not null default '{}',
  created_at        timestamptz not null default now(),
  notified_at       timestamptz,
  -- Telegram butonlarından: puanlamayı ileride kararlarınıza göre ayarlamak için
  decision          text check (decision in ('bought','skipped')),
  decided_at        timestamptz
);
create index deals_key_notified on public.deals (product_key, notified_at desc) where notified_at is not null;
create index deals_created on public.deals (created_at desc);

-- Puanlama için kendi fiyat geçmişimizin özeti (yeni gözlem eklenmeden önce çağrılır).
create or replace function public.price_history(p_key text)
returns table (regular_samples integer, median_regular_90d numeric, min_ever numeric)
language sql stable
set search_path = public
as $$
  select
    count(*) filter (where is_regular and observed_at > now() - interval '90 days')::integer,
    (percentile_cont(0.5) within group (order by price)
       filter (where is_regular and observed_at > now() - interval '90 days'))::numeric,
    min(price)
  from public.price_observations
  where product_key = p_key;
$$;

-- Yalnızca service role (Edge Function) erişsin: RLS açık, politika yok.
alter table public.products           enable row level security;
alter table public.price_observations enable row level security;
alter table public.deals              enable row level security;
revoke execute on function public.price_history(text) from public, anon, authenticated;
