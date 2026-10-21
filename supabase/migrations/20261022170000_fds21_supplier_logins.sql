-- 廠家登入。供應商主檔仍在 PMS factories，這裡只記登入電郵與 factory_id。
-- platform_user_profiles.role 增加 supplier。上載仍走既有審核佇列，不另建產品表。

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'platform_user_profiles'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%'
  loop
    execute format('alter table public.platform_user_profiles drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.platform_user_profiles
  add constraint platform_user_profiles_role_check
  check (role in ('admin', 'uploader', 'pm', 'designer', 'client', 'supplier'));

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'platform_user_profiles'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%source%'
  loop
    execute format('alter table public.platform_user_profiles drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.platform_user_profiles
  add constraint platform_user_profiles_source_check
  check (source in ('pms', 'client', 'supplier'));

create table if not exists public.supplier_logins (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  factory_id text not null,
  factory_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_logins_email_not_blank check (btrim(email) <> ''),
  constraint supplier_logins_factory_not_blank check (btrim(factory_id) <> ''),
  constraint supplier_logins_email_key unique (email)
);

alter table public.supplier_logins enable row level security;
revoke all on table public.supplier_logins from public, anon, authenticated;
grant select, update on table public.supplier_logins to authenticated;

drop policy if exists "supplier_logins_select" on public.supplier_logins;
create policy "supplier_logins_select"
  on public.supplier_logins for select to authenticated
  using (
    public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer', 'staff'])
    or (
      public.bwf_has_role(array['supplier'])
      and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "supplier_logins_update" on public.supplier_logins;
create policy "supplier_logins_update"
  on public.supplier_logins for update to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']))
  with check (public.bwf_has_role(array['admin', 'uploader']));

create or replace function public.fds_supplier_review_documents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_factory text;
  v_supplier boolean := public.bwf_has_role(array['supplier']);
begin
  if public.bwf_has_role(array['admin', 'uploader']) then
    return coalesce((
      select jsonb_agg(row_to_json(d) order by d.created_at desc)
      from (
        select s.id, s.title, s.status, s.factory_id, s.factory_name, s.doc_type, s.created_at, s.error_message
        from public.supplier_documents s
        order by s.created_at desc
        limit 80
      ) d
    ), '[]'::jsonb);
  end if;

  if not v_supplier then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select l.factory_id into v_factory
  from public.supplier_logins l
  where l.active is true
    and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;

  if v_factory is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(d) order by d.created_at desc)
    from (
      select s.id, s.title, s.status, s.factory_id, s.factory_name, s.doc_type, s.created_at, s.error_message
      from public.supplier_documents s
      where s.factory_id = v_factory
      order by s.created_at desc
      limit 80
    ) d
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fds_supplier_review_documents() from public, anon;
grant execute on function public.fds_supplier_review_documents() to authenticated;
