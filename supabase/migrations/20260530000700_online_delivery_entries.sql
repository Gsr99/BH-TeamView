-- Online delivery entries table
-- One row per platform per manager per day
create table if not exists public.online_delivery_entries (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null references auth.users(id) on delete cascade,
  entry_date    date not null,
  platform      text not null check (platform in ('lieferando', 'uber_eats', 'wolt', 'bh_online')),
  total_sales   numeric(10, 2) not null default 0,
  cash_amount   numeric(10, 2) not null default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One entry per platform per manager per day
  unique (created_by, entry_date, platform)
);

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists online_delivery_entries_updated_at on public.online_delivery_entries;
create trigger online_delivery_entries_updated_at
  before update on public.online_delivery_entries
  for each row execute function public.set_updated_at();

-- RLS
alter table public.online_delivery_entries enable row level security;

-- Managers can read/write their own entries
create policy "managers_own_entries"
  on public.online_delivery_entries
  for all
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- Admins can read all entries
create policy "admins_read_all_entries"
  on public.online_delivery_entries
  for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Grant table access
grant select, insert, update, delete on public.online_delivery_entries to authenticated;
