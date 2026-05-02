alter table public.tracked_items
  add column msrp_price numeric(12,2),
  add constraint tracked_items_msrp_price_positive
    check (msrp_price is null or msrp_price > 0);

alter table public.stock_checks
  add column price numeric(12,2),
  add column currency text;

alter table public.scrape_targets
  add column last_known_price numeric(12,2),
  add column last_known_currency text;
