-- FDS-12（第一版，唯讀）Asana 廠家同步。
-- 來源：Asana 專案「BWFS 辦公室傢俬廠 Office Furniture Listing」(1155109275123381)，一個 task＝一個廠家。
-- FDS 廠家鍵＝factory_id（supplier_prices／supplier_documents 既有），名稱只作顯示。
-- 本版只把 Asana Description／Comment 讀進 FDS；**不**向 Asana 寫任何留言。

create table if not exists public.fds_asana_factory_link (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null unique,
  factory_name text not null,
  asana_project_gid text not null default '1155109275123381',
  asana_task_gid text not null unique,
  remote_description text not null default '',
  remote_modified_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fds_asana_factory_link_name_len check (char_length(factory_name) between 1 and 200),
  constraint fds_asana_factory_link_task_len check (char_length(asana_task_gid) between 1 and 40)
);

create table if not exists public.fds_asana_factory_comment (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.fds_asana_factory_link (id) on delete cascade,
  asana_gid text not null,
  author_name text,
  body text not null default '',
  body_hash text not null,
  created_at_remote timestamptz,
  fetched_at timestamptz not null default now(),
  unique (link_id, asana_gid)
);

create index if not exists fds_asana_factory_comment_link_idx
  on public.fds_asana_factory_comment (link_id, created_at_remote desc nulls last);

alter table public.fds_asana_factory_link enable row level security;
alter table public.fds_asana_factory_comment enable row level security;

revoke all on table public.fds_asana_factory_link from public, anon, authenticated;
revoke all on table public.fds_asana_factory_comment from public, anon, authenticated;
grant select on table public.fds_asana_factory_link to authenticated;
grant select on table public.fds_asana_factory_comment to authenticated;

drop policy if exists "fds_asana_factory_link_select_staff" on public.fds_asana_factory_link;
create policy "fds_asana_factory_link_select_staff"
  on public.fds_asana_factory_link for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']));

drop policy if exists "fds_asana_factory_comment_select_staff" on public.fds_asana_factory_comment;
create policy "fds_asana_factory_comment_select_staff"
  on public.fds_asana_factory_comment for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']));

create or replace function public.fds_asana_factory_link_set(
  p_factory_id uuid,
  p_factory_name text,
  p_task_gid text,
  p_project_gid text default '1155109275123381'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_factory_name, ''));
  v_task text := btrim(coalesce(p_task_gid, ''));
  v_project text := coalesce(nullif(btrim(coalesce(p_project_gid, '')), ''), '1155109275123381');
  v_id uuid;
begin
  if not public.bwf_has_role(array['admin', 'uploader']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_factory_id is null or v_name = '' or v_task = '' then
    raise exception 'invalid_link' using errcode = '22023';
  end if;

  insert into public.fds_asana_factory_link (factory_id, factory_name, asana_task_gid, asana_project_gid, created_by)
  values (p_factory_id, left(v_name, 200), v_task, v_project, auth.uid())
  on conflict (factory_id) do update
    set factory_name = excluded.factory_name,
        asana_task_gid = excluded.asana_task_gid,
        asana_project_gid = excluded.asana_project_gid,
        enabled = true,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.fds_asana_factory_link_set(uuid, text, text, text) from public, anon;
grant execute on function public.fds_asana_factory_link_set(uuid, text, text, text) to authenticated;

create or replace function public.fds_asana_factory_link_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.bwf_has_role(array['admin', 'uploader']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  delete from public.fds_asana_factory_link where id = p_id;
end;
$$;

revoke all on function public.fds_asana_factory_link_remove(uuid) from public, anon;
grant execute on function public.fds_asana_factory_link_remove(uuid) to authenticated;

create or replace function public.fds_asana_factory_link_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(payload) order by payload.factory_name)
    from (
      select
        l.id,
        l.factory_id,
        l.factory_name,
        l.asana_project_gid,
        l.asana_task_gid,
        l.remote_modified_at,
        l.last_synced_at,
        l.last_error,
        l.enabled,
        left(l.remote_description, 500) as remote_description_preview,
        (select count(*)::int from public.fds_asana_factory_comment c where c.link_id = l.id) as comment_count
      from public.fds_asana_factory_link l
    ) payload
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fds_asana_factory_link_list() from public, anon;
grant execute on function public.fds_asana_factory_link_list() to authenticated;

-- Worker 用：Asana 為主，Description 非空時覆寫；Comment 只追加（同 gid 不重複）。
create or replace function public.fds_asana_factory_apply(
  p_link_id uuid,
  p_description text,
  p_modified_at timestamptz,
  p_comments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remote text := btrim(coalesce(p_description, ''));
  v_inserted integer := 0;
  v_comment jsonb;
  v_gid text;
begin
  if auth.role() is distinct from 'service_role'
     and not public.bwf_has_role(array['admin', 'uploader']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_link_id is null then
    raise exception 'invalid_link' using errcode = '22023';
  end if;

  update public.fds_asana_factory_link
     set remote_description = case when v_remote <> '' then v_remote else remote_description end,
         remote_modified_at = coalesce(p_modified_at, remote_modified_at),
         last_synced_at = now(),
         last_error = null,
         updated_at = now()
   where id = p_link_id;

  if not found then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;

  if p_comments is not null and jsonb_typeof(p_comments) = 'array' then
    for v_comment in select value from jsonb_array_elements(p_comments)
    loop
      v_gid := left(btrim(coalesce(v_comment->>'gid', '')), 40);
      if v_gid = '' then
        continue;
      end if;
      insert into public.fds_asana_factory_comment (link_id, asana_gid, author_name, body, body_hash, created_at_remote)
      values (
        p_link_id,
        v_gid,
        left(btrim(coalesce(v_comment->>'author', '')), 120),
        left(coalesce(v_comment->>'body', ''), 4000),
        md5(coalesce(v_comment->>'body', '')),
        nullif(v_comment->>'created_at', '')::timestamptz
      )
      on conflict (link_id, asana_gid) do nothing;
      if found then
        v_inserted := v_inserted + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('inserted_comments', v_inserted);
end;
$$;

revoke all on function public.fds_asana_factory_apply(uuid, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.fds_asana_factory_apply(uuid, text, timestamptz, jsonb) to service_role;

create or replace function public.fds_asana_factory_mark_error(p_link_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role'
     and not public.bwf_has_role(array['admin', 'uploader']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  update public.fds_asana_factory_link
     set last_error = left(coalesce(p_error, 'unknown'), 500),
         updated_at = now()
   where id = p_link_id;
end;
$$;

revoke all on function public.fds_asana_factory_mark_error(uuid, text) from public, anon, authenticated;
grant execute on function public.fds_asana_factory_mark_error(uuid, text) to service_role;

notify pgrst, 'reload schema';
