-- FDS-23：Asana 廠家同步改為每 30 分鐘一次（原本每日 02:41 一次）。
-- 同步內容不變：先把 PMS factories.asana_link 對回 link（source='pms'），
-- 再逐個 task 讀 Description／Comment（每次 10 個，last_synced_at 最舊優先）。
-- UI 不再提供「從 PMS 讀取綁定」，綁定只靠這支 cron 自動補上。

do $cron$
declare
  v_host text;
  v_asana text;
begin
  select substring(command from $re$https://[a-z0-9]+\.supabase\.co$re$)
    into v_host
  from cron.job
  where jobname = 'fds-process-jobs'
  limit 1;

  if v_host is null or v_host = '' then
    select substring(command from $re$https://[a-z0-9]+\.supabase\.co$re$)
      into v_host
    from cron.job
    where jobname = 'fds-pms-category-demand'
    limit 1;
  end if;

  if v_host is null or v_host = '' then
    v_host := 'https://riaubhtruisbwdlwjzur.supabase.co';
  end if;

  v_asana := format($job$
    select net.http_post(
      url := %L || '/functions/v1/sync-asana-factories',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret' limit 1)
      ),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 5000
    )
    where exists (
      select 1 from public.fds_asana_factory_link l where l.enabled
    );
  $job$, v_host);

  perform cron.unschedule(jobid) from cron.job where jobname = 'fds-sync-asana-factories';
  perform cron.schedule('fds-sync-asana-factories', '*/30 * * * *', v_asana);
end
$cron$;

notify pgrst, 'reload schema';
