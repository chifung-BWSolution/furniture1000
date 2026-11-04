-- FDS-23：`fds_asana_factory_link_list` 要回傳 source，
-- 否則前端永遠當成「手動」（PMS 自動同步的 link 也顯示手動）。
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
        l.source,
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

notify pgrst, 'reload schema';
