alter table public.msrp_prices
  add column release_date timestamptz,
  add column type text;

create index msrp_prices_type_idx on public.msrp_prices (type);
