-- 產品頁生成 SKP 已是全域排隊、一台 Worker 一次一單。
-- 狀態多回前面還有幾單、在線 Worker 數、按最近完成時間估的輪候分鐘。

create or replace function public.fds_product_skp_job_json(p_job public.processing_jobs)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ahead int := 0;
  v_workers int := 0;
  v_samples int := 0;
  v_avg numeric;
  v_eta int;
  v_assumed boolean := false;
begin
  if p_job.id is null then
    return jsonb_build_object('status', 'none');
  end if;

  if p_job.status = 'queued' and p_job.job_type in ('generate_skp', 'preview_skp') then
    select count(*)::int into v_ahead
    from public.processing_jobs c
    where c.id <> p_job.id
      and c.job_type in ('generate_skp', 'preview_skp')
      and c.attempts < c.max_attempts
      and (
        (c.status = 'running' and c.heartbeat_at >= now() - interval '10 minutes')
        or (
          c.status = 'queued'
          and c.run_after <= now()
          and (c.run_after, c.created_at, c.id) < (p_job.run_after, p_job.created_at, p_job.id)
        )
      );

    select count(*)::int into v_workers
    from public.fds_skp_workers w
    join public.fds_skp_devices d on d.id = w.device_id
    where w.ready
      and w.checked_at > now() - interval '90 seconds'
      and d.status = 'active'
      and d.expires_at > now()
      and public.fds_skp_device_has_codex(d.checks);

    select count(*)::int, percentile_cont(0.5) within group (order by mins)
      into v_samples, v_avg
    from (
      select extract(epoch from (finished_at - started_at)) / 60.0 as mins
      from public.processing_jobs
      where job_type = 'generate_skp'
        and payload ->> 'mode' = 'codex_v1'
        and status = 'succeeded'
        and started_at is not null
        and finished_at > started_at
        and finished_at - started_at between interval '3 minutes' and interval '3 hours'
      order by finished_at desc
      limit 8
    ) samples;

    if v_samples < 2 then
      v_avg := 30;
      v_assumed := true;
    end if;
    if v_workers > 0 then
      v_eta := ceil(v_ahead::numeric / v_workers * v_avg)::int;
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'status', p_job.status,
    'job_id', p_job.id,
    'request_id', p_job.payload ->> 'request_id',
    'stage', p_job.result ->> 'stage',
    'stage_detail', p_job.result ->> 'stage_detail',
    'stage_at', p_job.result ->> 'stage_at',
    'progress', p_job.progress,
    'attempts', p_job.attempts,
    'max_attempts', p_job.max_attempts,
    'error', p_job.error,
    'replace', jsonb_array_length(coalesce(p_job.payload -> 'replace_model_ids', '[]'::jsonb)) > 0,
    'reference_count', jsonb_array_length(coalesce(p_job.payload #> '{snapshot,references}', '[]'::jsonb)),
    'models', p_job.result -> 'models',
    'created_at', p_job.created_at,
    'started_at', p_job.started_at,
    'finished_at', p_job.finished_at,
    'queue_ahead', case when p_job.status = 'queued' and p_job.job_type in ('generate_skp', 'preview_skp') then v_ahead end,
    'queue_workers', case when p_job.status = 'queued' and p_job.job_type in ('generate_skp', 'preview_skp') then v_workers end,
    'queue_eta_minutes', v_eta,
    'queue_eta_assumed', case when v_eta is not null and v_assumed then true end
  ));
end;
$$;

revoke all on function public.fds_product_skp_job_json(public.processing_jobs) from public, anon, authenticated;
