-- Ensure full CRUD grants for authenticated users on bills and expenses
-- (RLS policies control what each role can actually do)
grant select, insert, update, delete on table public.bills to authenticated;
grant select, insert, update, delete on table public.expenses to authenticated;

-- Drop and recreate admin update/delete policies to ensure they are correct
-- (safe to drop since we're recreating them immediately)

-- Bills admin policies
drop policy if exists bills_update_admin on public.bills;
drop policy if exists bills_delete_admin on public.bills;

create policy bills_update_admin
on public.bills
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

create policy bills_delete_admin
on public.bills
for delete
to authenticated
using (public.current_user_is_admin());

-- Expenses admin policies
drop policy if exists expenses_update_admin on public.expenses;
drop policy if exists expenses_delete_admin on public.expenses;

create policy expenses_update_admin
on public.expenses
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

create policy expenses_delete_admin
on public.expenses
for delete
to authenticated
using (public.current_user_is_admin());
