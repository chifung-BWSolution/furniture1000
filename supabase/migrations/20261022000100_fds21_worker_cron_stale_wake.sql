-- T-1002: the edge worker must be woken for a stale running job even after
-- the last attempt. Claim then marks that job failed (worker_timeout).
-- The previous schedule on production required attempts < max_attempts for
-- every row, so a job killed on its final attempt never called claim again
-- and the document stayed in parsing.
--
-- Keep the function host already stored on this database. Production and the
-- FDS2.0 branch each call their own supabase-functions-process-jobs.

do $cron$
declare
  v_host text;
  v_command text;
begin
  select substring(command from $re$https://[a-z0-9]+\.supabase\.co$re$)
    into v_host
  from cron.job
  where jobname = 'fds-process-jobs'
  limit 1;

  if v_host is null or v_host = '' then
    v_host := 'https://riaubhtruisbwdlwjzur.supabase.co';
  end if;

  perform cron.unschedule('fds-process-jobs')
  from cron.job
  where jobname = 'fds-process-jobs';

  v_command := format($job$
    select net.http_post(
      url := %L || '/functions/v1/supabase-functions-process-jobs',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret' limit 1)
      ),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 5000
    )
    where exists (
      select 1 from public.processing_jobs
      where (status = 'queued' and run_after <= now() and attempts < max_attempts)
         or (status = 'running' and heartbeat_at < now() - interval '10 minutes')
    );
  $job$, v_host);

  perform cron.schedule('fds-process-jobs', '* * * * *', v_command);
end
$cron$;

notify pgrst, 'reload schema';
