-- The manager_cash_sessions table uses manager_id (not null) as its user column.
-- created_by was added in a previous migration so the app code can use a consistent column name.
-- This trigger keeps manager_id in sync with created_by automatically on every insert/update.

create or replace function public.sync_cash_session_manager_id()
returns trigger
language plpgsql
as $$
begin
  -- whenever created_by is set, mirror it into manager_id
  if new.created_by is not null then
    new.manager_id := new.created_by;
  end if;

  -- whenever manager_id is set but created_by is still null, mirror back
  if new.manager_id is not null and new.created_by is null then
    new.created_by := new.manager_id;
  end if;

  return new;
end;
$$;

drop trigger if exists cash_session_sync_manager_id on public.manager_cash_sessions;

create trigger cash_session_sync_manager_id
  before insert or update on public.manager_cash_sessions
  for each row
  execute function public.sync_cash_session_manager_id();

-- Also backfill created_by for any existing rows
update public.manager_cash_sessions
set created_by = manager_id
where created_by is null and manager_id is not null;
