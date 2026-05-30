alter table public.backup_logs
  add column if not exists backed_up_by uuid,
  add column if not exists created_by uuid;

update public.backup_logs
set created_by = backed_up_by
where created_by is null
  and backed_up_by is not null;

update public.backup_logs
set backed_up_by = created_by
where backed_up_by is null
  and created_by is not null;

alter table public.backup_logs
  alter column backed_up_by drop not null;
