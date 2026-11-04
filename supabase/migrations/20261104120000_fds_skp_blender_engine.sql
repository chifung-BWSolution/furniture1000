-- Reuse the existing job, lease, artifact publication and PMS contracts.
create or replace function public.fds_skp_device_has_codex(p_checks jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (coalesce(p_checks -> 'capabilities', '[]'::jsonb) ? 'codex_v1'
      and coalesce(p_checks ->> 'codex_ready', '') = 'true')
    or (coalesce(p_checks -> 'capabilities', '[]'::jsonb) ? 'jzxz_v1'
      and coalesce(p_checks ->> 'jzxz_ready', '') = 'true')
    or (coalesce(p_checks -> 'capabilities', '[]'::jsonb) ? 'blender_v1'
      and coalesce(p_checks ->> 'blender_ready', '') = 'true');
$$;

-- The environment dialog must also discover all three engines, including unready devices.
create or replace function public.fds_skp_preflight(p_details boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker public.fds_skp_workers%rowtype;
  v_codex public.fds_skp_workers%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  select w.* into v_worker
  from public.fds_skp_workers w
  left join public.fds_skp_devices d on d.id = w.device_id
  where w.checked_at > now() - interval '90 seconds'
    and (
      w.device_id is null
      or (
        d.status = 'active'
        and d.expires_at > now()
        and public.fds_skp_user_can_authorize(d.approved_by, d.approved_email)
      )
    )
  order by w.ready desc, w.checked_at desc
  limit 1;

  select w.* into v_codex
  from public.fds_skp_workers w
  join public.fds_skp_devices d on d.id = w.device_id
  where w.checked_at > now() - interval '90 seconds'
    and d.status = 'active'
    and d.expires_at > now()
    and public.fds_skp_user_can_authorize(d.approved_by, d.approved_email)
    and coalesce(d.checks -> 'capabilities', '[]'::jsonb) ?| array['codex_v1', 'jzxz_v1', 'blender_v1']
  order by public.fds_skp_device_has_codex(d.checks) desc, w.checked_at desc
  limit 1;

  return jsonb_build_object(
    'ready', coalesce(v_worker.ready, false),
    'connected', v_worker.worker_id is not null,
    'checks', v_worker.checks,
    'codex_entry', coalesce((select f.enabled from public.fds_runtime_flags f where f.key = 'skp_codex_entry'), false),
    'codex_ready', coalesce(v_codex.ready, false) and public.fds_skp_device_has_codex(v_codex.checks),
    'codex_connected', v_codex.worker_id is not null,
    'codex_checks', v_codex.checks
  );
end;
$$;
