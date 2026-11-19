-- PMS compliance files live under PMS `suppliers`, while FDS supplier logins
-- point at PMS `factories`. Bind the PMS supplier explicitly instead of relying
-- on a display-name match (which fails for 向氏 because it is only a factory).
alter table public.supplier_logins add column if not exists supplier_id uuid;

create or replace function public.fds_supplier_pms_supplier()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.supplier_id
  from public.supplier_logins l
  where l.active is true
    and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;
revoke all on function public.fds_supplier_pms_supplier() from public, anon;
grant execute on function public.fds_supplier_pms_supplier() to authenticated;

notify pgrst, 'reload schema';
