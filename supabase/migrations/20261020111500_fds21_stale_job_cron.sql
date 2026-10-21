-- cron 要連「重試已用完、但卡在 running」的任务一起喚醒。
--
-- 問題：原本 cron 只在 attempts < max_attempts 時才叫 worker，
-- 而「最後一次執行被 CPU／執行時間限制終止」的清理只寫在 fds_processing_jobs_claim 裡。
-- 當唯一的任務在最後一次被殺掉，cron 永遠不再呼叫 claim，
-- 文件就一直停在 parsing，也無法重新排隊。
--
-- 修正：stale running（heartbeat 超過 10 分鐘）不論 attempts 幾次都喚醒 worker，
-- 由 claim 決定是重試（attempts < max_attempts）還是標記 failed（耗盡重試）。

do $$
begin
  perform cron.unschedule('fds-process-jobs')
  from cron.job where jobname = 'fds-process-jobs';
end $$;

select cron.schedule(
  'fds-process-jobs',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://riaubhtruisbwdlwjzur.supabase.co/functions/v1/supabase-functions-process-jobs',
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
  $job$
);

notify pgrst, 'reload schema';
