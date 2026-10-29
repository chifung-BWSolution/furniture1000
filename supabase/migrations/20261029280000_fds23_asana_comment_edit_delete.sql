-- FDS-12：Asana 留言編輯／刪除（只限 FDS 建立的留言；Asana 原有留言保持只讀）。
-- 編輯＝刪除舊 story 再以新內容 POST（Asana stories API 不支援 update），
-- 刪除＝DELETE story 後移除本地列；兩者都經 worker（可重試、記錯誤）。

alter table public.fds_asana_factory_comment
  add column if not exists update_pending boolean not null default false,
  add column if not exists delete_pending boolean not null default false,
  add column if not exists deleted_at timestamptz;

create or replace function public.fds_asana_factory_comment_edit(p_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := left(btrim(coalesce(p_body, '')), 2000);
  v_row public.fds_asana_factory_comment;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;
  select * into v_row from public.fds_asana_factory_comment where id = p_id and source = 'fds' and deleted_at is null;
  if v_row.id is null then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if v_row.created_by is distinct from auth.uid() and not public.bwf_has_role(array['admin', 'uploader']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  update public.fds_asana_factory_comment
     set body = v_body,
         body_hash = md5(v_body),
         update_pending = (asana_gid is not null),
         push_error = null
   where id = p_id;
end;
$$;

revoke all on function public.fds_asana_factory_comment_edit(uuid, text) from public, anon;
grant execute on function public.fds_asana_factory_comment_edit(uuid, text) to authenticated;

create or replace function public.fds_asana_factory_comment_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.fds_asana_factory_comment;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  select * into v_row from public.fds_asana_factory_comment where id = p_id and source = 'fds' and deleted_at is null;
  if v_row.id is null then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if v_row.created_by is distinct from auth.uid() and not public.bwf_has_role(array['admin', 'uploader']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  if v_row.asana_gid is null then
    delete from public.fds_asana_factory_comment where id = p_id;
  else
    update public.fds_asana_factory_comment
       set delete_pending = true,
           deleted_at = now(),
           push_error = null
     where id = p_id;
  end if;
end;
$$;

revoke all on function public.fds_asana_factory_comment_delete(uuid) from public, anon;
grant execute on function public.fds_asana_factory_comment_delete(uuid) to authenticated;

create or replace function public.fds_asana_comment_pending_sync(p_link_id uuid, p_limit integer default 10)
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
  select coalesce(jsonb_agg(to_jsonb(payload)), '[]'::jsonb) into v_rows
  from (
    select id, asana_gid, body, update_pending, delete_pending, push_attempts
      from public.fds_asana_factory_comment
     where link_id = p_link_id
       and source = 'fds'
       and (update_pending or delete_pending)
       and push_attempts < 8
     order by fetched_at asc
     limit greatest(1, least(coalesce(p_limit, 10), 50))
  ) payload;
  return v_rows;
end;
$$;

revoke all on function public.fds_asana_comment_pending_sync(uuid, integer) from public, anon, authenticated;
grant execute on function public.fds_asana_comment_pending_sync(uuid, integer) to service_role;

create or replace function public.fds_asana_comment_mark_updated(p_id uuid, p_gid text)
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
         update_pending = false,
         pushed_at = now(),
         push_error = null
   where id = p_id;
end;
$$;

revoke all on function public.fds_asana_comment_mark_updated(uuid, text) from public, anon, authenticated;
grant execute on function public.fds_asana_comment_mark_updated(uuid, text) to service_role;

create or replace function public.fds_asana_comment_mark_deleted(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  delete from public.fds_asana_factory_comment where id = p_id;
end;
$$;

revoke all on function public.fds_asana_comment_mark_deleted(uuid) from public, anon, authenticated;
grant execute on function public.fds_asana_comment_mark_deleted(uuid) to service_role;

create or replace function public.fds_asana_comment_mark_sync_failed(p_id uuid, p_error text)
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
     set push_error = left(coalesce(p_error, 'sync_failed'), 500),
         push_attempts = push_attempts + 1
   where id = p_id;
end;
$$;

revoke all on function public.fds_asana_comment_mark_sync_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.fds_asana_comment_mark_sync_failed(uuid, text) to service_role;

notify pgrst, 'reload schema';
