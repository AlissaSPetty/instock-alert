create table public.msrp_prices (
  id uuid primary key default gen_random_uuid(),
  source_site text not null,
  source_url text not null,
  product_name text not null,
  normalized_name text not null,
  price numeric(12,2) not null check (price > 0),
  currency text not null default 'USD',
  product_url text,
  image_url text,
  scraped_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_site, normalized_name)
);

create index msrp_prices_name_idx on public.msrp_prices (normalized_name);
create index msrp_prices_source_scraped_idx on public.msrp_prices (source_site, scraped_at desc);

alter table public.msrp_prices enable row level security;

create policy "approved users read msrp prices"
  on public.msrp_prices for select
  using (public.is_pricechecker_approved());
