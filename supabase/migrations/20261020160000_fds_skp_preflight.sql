create table public.fds_skp_workers (
 worker_id text primary key,
 ready boolean not null,
 checked_at timestamptz not null default now()
);
alter table public.fds_skp_workers enable row level security;
revoke all on public.fds_skp_workers from public, anon, authenticated;
grant all on public.fds_skp_workers to service_role;
create function public.fds_skp_preflight() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
 return exists (select 1 from public.fds_skp_workers where ready and checked_at > now() - interval '90 seconds');
end;
$$;
revoke all on function public.fds_skp_preflight() from public, anon;
grant execute on function public.fds_skp_preflight() to authenticated;
create or replace function public.fds_request_skp(p_furniture_model_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.furniture_models%rowtype;
  v_status jsonb;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  select * into v_model from public.furniture_models f
  where f.id = p_furniture_model_id
    and (f.created_by = auth.uid() or public.bwf_has_role(array['admin', 'uploader']))
  for update;
  if v_model.id is null then
    raise exception 'model_not_found' using errcode = 'P0002';
  end if;

  v_status := public.fds_skp_status_for(p_furniture_model_id);
  if v_status ->> 'status' in ('ready', 'queued', 'running') then
    return v_status;
  end if;

  if not exists (select 1 from public.fds_skp_workers where ready and checked_at > now() - interval '90 seconds') then
    raise exception 'skp_worker_unavailable';
  end if;

  insert into public.processing_jobs (job_type, payload, creator_staff_id)
  values (
    'generate_skp',
    jsonb_build_object('furniture_model_id', p_furniture_model_id, 'kind', v_model.kind),
    public.bwf_current_staff_id()
  );

  return public.fds_skp_status_for(p_furniture_model_id);
end;
$$;


