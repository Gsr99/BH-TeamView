-- Add created_by column if it doesn't already exist
alter table public.manager_cash_sessions
  add column if not exists created_by uuid references auth.users(id) on delete cascade;

-- Populate created_by from common alternative column names if they exist
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'manager_cash_sessions'
      and column_name  = 'manager_id'
  ) then
    update public.manager_cash_sessions
    set created_by = manager_id
    where created_by is null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'manager_cash_sessions'
      and column_name  = 'user_id'
  ) then
    update public.manager_cash_sessions
    set created_by = user_id
    where created_by is null;
  end if;
end $$;

-- Grant full CRUD to authenticated users (RLS below handles per-row access)
grant select, insert, update, delete on table public.manager_cash_sessions to authenticated;

-- Managers can read and write their own sessions
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'manager_cash_sessions'
      and policyname = 'cash_sessions_own'
  ) then
    create policy cash_sessions_own
      on public.manager_cash_sessions
      for all
      to authenticated
      using (auth.uid() = created_by)
      with check (auth.uid() = created_by);
  end if;

  -- Admins can read and write all sessions
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'manager_cash_sessions'
      and policyname = 'cash_sessions_admin'
  ) then
    create policy cash_sessions_admin
      on public.manager_cash_sessions
      for all
      to authenticated
      using (public.current_user_is_admin())
      with check (public.current_user_is_admin());
  end if;
end $$;
