alter table public.scrape_targets
  add column image_url text;

update public.tracked_items
set
  refresh_interval = '5min',
  refresh_seconds = 300,
  updated_at = now()
where refresh_interval in ('15s', '1min');

update public.scrape_targets
set
  minimum_refresh_seconds = greatest(minimum_refresh_seconds, 300),
  updated_at = now()
where minimum_refresh_seconds < 300;

alter table public.tracked_items
  drop constraint tracked_items_refresh_interval_check;

alter table public.tracked_items
  add constraint tracked_items_refresh_interval_check
  check (refresh_interval in ('5min', '15min', '30min', '1hour', '2hours', '5hours', '24hours'));
