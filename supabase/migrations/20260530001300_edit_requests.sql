create table if not exists public.edit_requests (
  id               uuid primary key default gen_random_uuid(),
  request_type     text not null check (request_type in ('bill', 'expense')),
  record_id        uuid not null,
  action           text not null check (action in ('edit', 'delete')),
  reason           text,
  record_manager_id uuid not null references auth.users(id), -- owner of the record
  requested_by     uuid not null references auth.users(id),  -- admin making the request
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'rejected', 'completed')),
  reviewed_by      uuid references auth.users(id),
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);

alter table public.edit_requests enable row level security;

-- Admins can insert and see their own requests
create policy edit_requests_admin_insert on public.edit_requests
  for insert to authenticated
  with check (public.current_user_is_admin());

create policy edit_requests_admin_select on public.edit_requests
  for select to authenticated
  using (
    public.current_user_is_admin()
    or auth.uid() = record_manager_id
  );

-- Managers can update (approve/reject) requests for their records
create policy edit_requests_manager_update on public.edit_requests
  for update to authenticated
  using (auth.uid() = record_manager_id)
  with check (auth.uid() = record_manager_id);

grant select, insert, update on public.edit_requests to authenticated;
