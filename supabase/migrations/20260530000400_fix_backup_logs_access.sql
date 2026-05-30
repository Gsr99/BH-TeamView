create table if not exists public.backup_logs (
  id uuid primary key default gen_random_uuid(),
  backup_type text not null,
  created_by uuid,
  note text,
  created_at timestamptz not null default now()
);

alter table public.backup_logs
  add column if not exists backup_type text,
  add column if not exists created_by uuid,
  add column if not exists note text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'backup_logs'
      and column_name = 'backed_up_by'
  ) then
    update public.backup_logs
    set created_by = backed_up_by
    where created_by is null
      and backed_up_by is not null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'backup_logs_created_by_fkey'
      and conrelid = 'public.backup_logs'::regclass
  ) then
    alter table public.backup_logs
      add constraint backup_logs_created_by_fkey
      foreign key (created_by)
      references public.profiles(id)
      on delete set null;
  end if;
end $$;

grant select, insert on table public.backup_logs to authenticated;
grant all privileges on table public.backup_logs to service_role;

alter table public.backup_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'backup_logs'
      and policyname = 'backup_logs_select_admin'
  ) then
    create policy backup_logs_select_admin
    on public.backup_logs
    for select
    to authenticated
    using (public.current_user_is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'backup_logs'
      and policyname = 'backup_logs_insert_admin'
  ) then
    create policy backup_logs_insert_admin
    on public.backup_logs
    for insert
    to authenticated
    with check (public.current_user_is_admin());
  end if;
end $$;
