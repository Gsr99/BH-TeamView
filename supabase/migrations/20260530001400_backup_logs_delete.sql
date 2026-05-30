-- Grant delete on backup_logs to authenticated users (RLS below restricts to admin only)
grant delete on table public.backup_logs to authenticated;

-- Admins can delete backup log entries
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'backup_logs'
      and policyname = 'backup_logs_delete_admin'
  ) then
    create policy backup_logs_delete_admin
      on public.backup_logs
      for delete
      to authenticated
      using (public.current_user_is_admin());
  end if;
end $$;
