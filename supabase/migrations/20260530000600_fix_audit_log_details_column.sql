alter table public.audit_logs
  add column if not exists details text,
  add column if not exists record_id uuid,
  add column if not exists old_values jsonb,
  add column if not exists new_values jsonb,
  add column if not exists performed_by uuid;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_logs'
      and column_name = 'user_id'
  ) then
    update public.audit_logs
    set performed_by = user_id
    where performed_by is null
      and user_id is not null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'audit_logs_performed_by_fkey'
      and conrelid = 'public.audit_logs'::regclass
  ) then
    alter table public.audit_logs
      add constraint audit_logs_performed_by_fkey
      foreign key (performed_by)
      references public.profiles(id)
      on delete set null;
  end if;
end $$;

notify pgrst, 'reload schema';
