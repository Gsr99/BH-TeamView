insert into public.profiles (
  id,
  full_name,
  email,
  role,
  is_active,
  updated_at
)
select
  'df32045b-97f5-4897-9472-ebaae7decc7e'::uuid,
  'Admin',
  email,
  'admin',
  true,
  now()
from auth.users
where id = 'df32045b-97f5-4897-9472-ebaae7decc7e'::uuid
on conflict (id) do update
set
  full_name = 'Admin',
  email = coalesce(public.profiles.email, excluded.email),
  role = 'admin',
  is_active = true,
  updated_at = now();
