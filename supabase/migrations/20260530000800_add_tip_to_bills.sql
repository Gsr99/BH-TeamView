-- Add tip_amount column to bills table
alter table public.bills
  add column if not exists tip_amount numeric(10, 2) not null default 0;
