-- FDS-12：Asana 留言雙向同步（FDS → Asana 追加）。
-- 本地留言存 source='fds'、asana_gid 為空；worker 推送成功後寫回 gid，重試不會重複。
-- 由 Asana 拉回的留言維持 source='asana'。只追加，不改 Asana 既有留言。

alter table public.fds_asana_factory_comment
  add column if not exists source text not null default 'asana'
    check (source in ('asana', 'fds')),
  add column if not exists created_by uuid,
  add column if not exists pushed_at timestamptz,
  add column if not exists push_error text,
  add column if not exists push_attempts integer not null default 0;

create index if not exists fds_asana_factory_comment_pending_push_idx
  on public.fds_asana_factory_comment (link_id, fetched_at)
  where source = 'fds' and asana_gid is null;

create or replace function public.fds_asana_factory_comment_add(p_link_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := left(btrim(coalesce(p_body, '')), 2000);
  v_name text;
  v_id uuid;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_link_id is null or v_body = '' then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;
  if not exists (select 1 from public.fds_asana_factory_link where id = p_link_id) then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;

  select nullif(btrim(display_name), '') into v_name
    from public.platform_user_profiles
   where auth_user_id = auth.uid()
   limit 1;

  insert into public.fds_asana_factory_comment (
    link_id, asana_gid, author_name, body, body_hash, source, created_by
  )
  values (
    p_link_id, null, coalesce(v_name, 'FDS 職員'), v_body, md5(v_body), 'fds', auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.fds_asana_factory_comment_add(uuid, text) from public, anon;
grant execute on function public.fds_asana_factory_comment_add(uuid, text) to authenticated;

create or replace function public.fds_asana_factory_comment_list(p_link_id uuid, p_limit integer default 50)
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
    select jsonb_agg(to_jsonb(payload) order by payload.created_at_remote desc nulls last, payload.fetched_at desc)
    from (
      select id, source, author_name, body, asana_gid, pushed_at, push_error,
             created_at_remote, fetched_at
        from public.fds_asana_factory_comment
       where link_id = p_link_id
       order by coalesce(created_at_remote, fetched_at) desc
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) payload
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fds_asana_factory_comment_list(uuid, integer) from public, anon;
grant execute on function public.fds_asana_factory_comment_list(uuid, integer) to authenticated;

create or replace function public.fds_asana_comment_pending_push(p_link_id uuid, p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  with pending as (
    select id
      from public.fds_asana_factory_comment
     where link_id = p_link_id
       and source = 'fds'
       and asana_gid is null
       and push_attempts < 5
     order by fetched_at asc
     limit greatest(1, least(coalesce(p_limit, 10), 50))
       for update skip locked
  ), bumped as (
    update public.fds_asana_factory_comment c
       set push_attempts = c.push_attempts + 1,
           push_error = null
      from pending
     where c.id = pending.id
    returning c.id, c.body
  )
  select coalesce(jsonb_agg(to_jsonb(bumped)), '[]'::jsonb) into v_rows from bumped;

  return v_rows;
end;
$$;

revoke all on function public.fds_asana_comment_pending_push(uuid, integer) from public, anon, authenticated;
grant execute on function public.fds_asana_comment_pending_push(uuid, integer) to service_role;

create or replace function public.fds_asana_comment_mark_pushed(p_id uuid, p_gid text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  update public.fds_asana_factory_comment
     set asana_gid = nullif(btrim(coalesce(p_gid, '')), ''),
         pushed_at = now(),
         push_error = null
   where id = p_id;
end;
$$;

revoke all on function public.fds_asana_comment_mark_pushed(uuid, text) from public, anon, authenticated;
grant execute on function public.fds_asana_comment_mark_pushed(uuid, text) to service_role;

create or replace function public.fds_asana_comment_mark_push_failed(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  update public.fds_asana_factory_comment
     set push_error = left(coalesce(p_error, 'push_failed'), 500)
   where id = p_id;
end;
$$;

revoke all on function public.fds_asana_comment_mark_push_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.fds_asana_comment_mark_push_failed(uuid, text) to service_role;

notify pgrst, 'reload schema';
