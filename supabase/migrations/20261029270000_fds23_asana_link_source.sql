-- FDS-12：Asana 綁定來源。PMS factories.asana_link 優先寫入（source='pms'），
-- 管理員手動綁定標為 source='manual'（PMS 有值時 worker 會以 PMS 為準）。
alter table public.fds_asana_factory_link
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'pms'));

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

  insert into public.fds_asana_factory_link (factory_id, factory_name, asana_task_gid, asana_project_gid, source, created_by)
  values (p_factory_id, left(v_name, 200), v_task, v_project, 'manual', auth.uid())
  on conflict (factory_id) do update
    set factory_name = excluded.factory_name,
        asana_task_gid = excluded.asana_task_gid,
        asana_project_gid = excluded.asana_project_gid,
        source = 'manual',
        enabled = true,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.fds_asana_factory_link_set(uuid, text, text, text) from public, anon;
grant execute on function public.fds_asana_factory_link_set(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
