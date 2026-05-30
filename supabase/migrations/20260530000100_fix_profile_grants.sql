grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update on table public.profiles to authenticated;
grant all privileges on table public.profiles to service_role;

grant select, insert on table public.audit_logs to authenticated;
grant all privileges on table public.audit_logs to service_role;

grant select on table public.bills to authenticated, service_role;
grant select on table public.expenses to authenticated, service_role;
grant select on table public.manager_cash_sessions to authenticated, service_role;

alter default privileges in schema public grant all privileges on tables to service_role;
