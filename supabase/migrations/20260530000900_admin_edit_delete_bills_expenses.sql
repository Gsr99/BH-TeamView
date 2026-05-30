-- Grant update and delete on bills and expenses to authenticated users
-- (RLS policies below restrict these to admins only)
grant update, delete on table public.bills to authenticated;
grant update, delete on table public.expenses to authenticated;

-- Bills: admins can update any bill
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'bills'
      and policyname = 'bills_update_admin'
  ) then
    create policy bills_update_admin
    on public.bills
    for update
    to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
  end if;

  -- Bills: admins can soft-delete any bill
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'bills'
      and policyname = 'bills_delete_admin'
  ) then
    create policy bills_delete_admin
    on public.bills
    for delete
    to authenticated
    using (public.current_user_is_admin());
  end if;

  -- Expenses: admins can update any expense
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'expenses'
      and policyname = 'expenses_update_admin'
  ) then
    create policy expenses_update_admin
    on public.expenses
    for update
    to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
  end if;

  -- Expenses: admins can delete any expense
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'expenses'
      and policyname = 'expenses_delete_admin'
  ) then
    create policy expenses_delete_admin
    on public.expenses
    for delete
    to authenticated
    using (public.current_user_is_admin());
  end if;
end $$;
