-- FDS V2.2: original uploads only enqueue; document workers run overnight.
-- Existing RPC signature, permissions, checkpoint payload and cron remain compatible.
create or replace function public.fds_document_parse_window_open(
  p_at timestamptz default now()
) returns boolean
language sql stable set search_path = ''
as $$
  select (p_at at time zone 'Asia/Shanghai')::time >= time '23:00'
      or (p_at at time zone 'Asia/Shanghai')::time < time '09:00';
$$;
revoke all on function public.fds_document_parse_window_open(timestamptz) from public, anon, authenticated;
grant execute on function public.fds_document_parse_window_open(timestamptz) to service_role;

create or replace function public.fds_processing_jobs_claim(
  p_job_types text[],
  p_limit int default 1,
  p_worker text default null,
  p_max_running int default 3,
  p_stale_after interval default interval '10 minutes'
) returns setof public.processing_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slots int;
begin
  -- Keep unrelated model jobs available during business hours.
  if not public.fds_document_parse_window_open() then
    p_job_types := array(select t from unnest(p_job_types) t
      where t not in ('parse_pdf', 'needs_split'));
  end if;
  -- Jobs whose worker died after the last allowed attempt: stop retrying.
  with dead as (
    update public.processing_jobs
    set status = 'failed',
        error = coalesce(error, 'worker_timeout'),
        error_log = error_log || jsonb_build_array(jsonb_build_object(
          'at', now(), 'attempt', attempts, 'error', 'worker_timeout')),
        finished_at = now(),
        updated_at = now()
    where status = 'running'
      and job_type = any (p_job_types)
      and heartbeat_at < now() - p_stale_after
      and attempts >= max_attempts
    returning document_id
  )
  update public.supplier_documents d
  set status = 'failed', error_message = 'worker_timeout', modified_date = now()
  from dead
  where d.id = dead.document_id;

  select greatest(0, p_max_running - count(*))::int into v_slots
  from public.processing_jobs
  where status = 'running'
    and job_type = any (p_job_types)
    and heartbeat_at >= now() - p_stale_after;

  return query
  with claimed as (
    update public.processing_jobs j
    set status = 'running',
        attempts = j.attempts + 1,
        started_at = coalesce(j.started_at, now()),
        heartbeat_at = now(),
        worker = p_worker,
        error = null,
        updated_at = now()
    where j.id in (
      select c.id
      from public.processing_jobs c
      where c.job_type = any (p_job_types)
        and c.attempts < c.max_attempts
        and (
          (c.status = 'queued' and c.run_after <= now())
          or (c.status = 'running' and c.heartbeat_at < now() - p_stale_after)
        )
      order by c.run_after, c.created_at
      limit least(greatest(coalesce(p_limit, 1), 0), v_slots)
      for update skip locked
    )
    returning j.*
  )
  select * from claimed;
end;
$$;

notify pgrst, 'reload schema';

-- Return a boundary-crossing batch without counting a failed attempt.
-- NULL state preserves an uninitialized payload; never seed an empty checkpoint.
create or replace function public.fds_document_parse_pause(p_job_id uuid, p_state jsonb default null)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update public.processing_jobs
  set status = 'queued',
      payload = case when p_state is null then payload else payload || jsonb_build_object('state', p_state) end,
      attempts = greatest(attempts - 1, 0),
      run_after = ((date_trunc('day', now() at time zone 'Asia/Shanghai') + interval '23 hours') at time zone 'Asia/Shanghai'),
      heartbeat_at = now(), updated_at = now()
  where id = p_job_id and job_type = 'parse_pdf' and status = 'running';
  return found;
end;
$$;
revoke all on function public.fds_document_parse_pause(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fds_document_parse_pause(uuid, jsonb) to service_role;
notify pgrst, 'reload schema';
