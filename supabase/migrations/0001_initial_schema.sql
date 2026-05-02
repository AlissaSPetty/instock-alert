create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  phone text,
  notification_preference text not null default 'email',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.scrape_targets (
  id uuid primary key default gen_random_uuid(),
  canonical_url text not null,
  website_host text not null,
  website_name text not null,
  website_slug text not null,
  item_name text not null,
  item_slug text not null,
  request_pattern jsonb not null default '{}'::jsonb,
  generated_folder_path text,
  minimum_refresh_seconds integer not null default 3600,
  next_check_at timestamptz,
  last_checked_at timestamptz,
  last_known_in_stock boolean,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_host, item_slug, canonical_url)
);

create table public.tracked_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references public.scrape_targets(id) on delete cascade,
  refresh_interval text not null check (
    refresh_interval in ('15s', '1min', '5min', '15min', '30min', '1hour', '2hours', '5hours', '24hours')
  ),
  refresh_seconds integer not null check (refresh_seconds > 0),
  email text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, target_id)
);

create table public.stock_checks (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.scrape_targets(id) on delete cascade,
  checked_at timestamptz not null default now(),
  in_stock boolean,
  status_code integer,
  response_summary jsonb not null default '{}'::jsonb,
  error text
);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tracked_item_id uuid not null references public.tracked_items(id) on delete cascade,
  target_id uuid not null references public.scrape_targets(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'log')),
  destination text,
  message text not null,
  status text not null default 'logged',
  created_at timestamptz not null default now()
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index scrape_targets_due_idx
  on public.scrape_targets (next_check_at)
  where next_check_at is not null;

create index scrape_targets_host_idx on public.scrape_targets (website_host);
create index tracked_items_user_idx on public.tracked_items (user_id, is_active);
create index tracked_items_target_active_idx on public.tracked_items (target_id, is_active);
create index stock_checks_target_checked_idx on public.stock_checks (target_id, checked_at desc);
create index notification_events_user_idx on public.notification_events (user_id, created_at desc);
create index usage_events_user_idx on public.usage_events (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.scrape_targets enable row level security;
alter table public.tracked_items enable row level security;
alter table public.stock_checks enable row level security;
alter table public.notification_events enable row level security;
alter table public.usage_events enable row level security;

create function public.is_pricechecker_approved()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'pricechecker_approved';
$$;

create policy "approved users read own profile"
  on public.profiles for select
  using (auth.uid() = id and public.is_pricechecker_approved());

create policy "users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "approved users update own profile"
  on public.profiles for update
  using (auth.uid() = id and public.is_pricechecker_approved())
  with check (auth.uid() = id and public.is_pricechecker_approved());

create policy "approved users read subscribed targets"
  on public.scrape_targets for select
  using (
    public.is_pricechecker_approved()
    and exists (
      select 1
      from public.tracked_items ti
      where ti.target_id = scrape_targets.id
        and ti.user_id = auth.uid()
    )
  );

create policy "approved users manage own tracked items"
  on public.tracked_items for all
  using (user_id = auth.uid() and public.is_pricechecker_approved())
  with check (user_id = auth.uid() and public.is_pricechecker_approved());

create policy "approved users read own stock checks"
  on public.stock_checks for select
  using (
    public.is_pricechecker_approved()
    and exists (
      select 1
      from public.tracked_items ti
      where ti.target_id = stock_checks.target_id
        and ti.user_id = auth.uid()
    )
  );

create policy "approved users read own notification events"
  on public.notification_events for select
  using (user_id = auth.uid() and public.is_pricechecker_approved());

create policy "approved users read own usage events"
  on public.usage_events for select
  using (user_id = auth.uid() and public.is_pricechecker_approved());
