create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and coalesce(is_active, true)
  );
$$;

grant execute on function public.current_user_is_admin() to authenticated;
grant execute on function public.current_user_is_admin() to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_select_self_or_admin'
  ) then
    create policy profiles_select_self_or_admin
    on public.profiles
    for select
    to authenticated
    using (id = auth.uid() or public.current_user_is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_insert_self_or_admin'
  ) then
    create policy profiles_insert_self_or_admin
    on public.profiles
    for insert
    to authenticated
    with check (id = auth.uid() or public.current_user_is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_update_self_or_admin'
  ) then
    create policy profiles_update_self_or_admin
    on public.profiles
    for update
    to authenticated
    using (id = auth.uid() or public.current_user_is_admin())
    with check (id = auth.uid() or public.current_user_is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_logs'
      and policyname = 'audit_logs_select_admin'
  ) then
    create policy audit_logs_select_admin
    on public.audit_logs
    for select
    to authenticated
    using (public.current_user_is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_logs'
      and policyname = 'audit_logs_insert_authenticated'
  ) then
    create policy audit_logs_insert_authenticated
    on public.audit_logs
    for insert
    to authenticated
    with check (auth.role() = 'authenticated');
  end if;
end $$;
