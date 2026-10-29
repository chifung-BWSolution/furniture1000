-- 舊的 service role SKP Worker 經通用 claim 領取 generate_skp；codex_v1 只能由回報 codex_v1 能力的裝置經 fds_skp_device_claim 領取。
-- 其餘行為與原函式相同。

create or replace function public.fds_processing_jobs_claim(
  p_job_types text[],
  p_limit integer default 1,
  p_worker text default null,
  p_max_running integer default 3,
  p_stale_after interval default '00:10:00'::interval
) returns setof public.processing_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slots int;
begin
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
        and not (c.job_type = 'generate_skp' and c.payload ->> 'mode' = 'codex_v1')
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
