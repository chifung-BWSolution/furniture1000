-- Keep the original boolean preflight contract for existing clients.
alter table public.fds_skp_workers add column if not exists checks jsonb;

create or replace function public.fds_skp_preflight(p_details boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_worker public.fds_skp_workers%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  select * into v_worker from public.fds_skp_workers
  where checked_at > now() - interval '90 seconds'
  order by ready desc, checked_at desc limit 1;
  return jsonb_build_object(
    'ready', coalesce(v_worker.ready, false),
    'connected', v_worker.worker_id is not null,
    'checks', v_worker.checks
  );
end;
$$;
revoke all on function public.fds_skp_preflight(boolean) from public, anon;
grant execute on function public.fds_skp_preflight(boolean) to authenticated;
