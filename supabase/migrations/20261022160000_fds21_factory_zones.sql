-- 廠家分區。廠家主檔仍在 PMS factories，這裡只記 factory_id。
-- 不是設計專案的 project_zones。

create table if not exists public.factory_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_zones_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists factory_zones_name_lower_uidx
  on public.factory_zones (lower(btrim(name)));

create table if not exists public.factory_zone_members (
  zone_id uuid not null references public.factory_zones (id) on delete cascade,
  factory_id text not null,
  factory_name text not null default '',
  created_at timestamptz not null default now(),
  primary key (zone_id, factory_id),
  constraint factory_zone_members_factory_id_not_blank check (btrim(factory_id) <> '')
);

create index if not exists factory_zone_members_factory_idx
  on public.factory_zone_members (factory_id);

alter table public.factory_zones enable row level security;
alter table public.factory_zone_members enable row level security;

revoke all on table public.factory_zones from public, anon, authenticated;
revoke all on table public.factory_zone_members from public, anon, authenticated;

grant select, insert, update, delete on table public.factory_zones to authenticated;
grant select, insert, update, delete on table public.factory_zone_members to authenticated;

drop policy if exists "factory_zones_select" on public.factory_zones;
create policy "factory_zones_select"
  on public.factory_zones for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer', 'staff']));

drop policy if exists "factory_zones_write" on public.factory_zones;
create policy "factory_zones_write"
  on public.factory_zones for all to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']))
  with check (public.bwf_has_role(array['admin', 'uploader']));

drop policy if exists "factory_zone_members_select" on public.factory_zone_members;
create policy "factory_zone_members_select"
  on public.factory_zone_members for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer', 'staff']));

drop policy if exists "factory_zone_members_write" on public.factory_zone_members;
create policy "factory_zone_members_write"
  on public.factory_zone_members for all to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']))
  with check (public.bwf_has_role(array['admin', 'uploader']));
