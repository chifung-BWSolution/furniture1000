-- FDS-07：圖冊頁縮圖的夜間補畫。
--
-- 夜間解析（process-jobs 的 parse_pdf）會在抽字那一批順便畫好同一批頁的縮圖；
-- 這支 cron 只負責「舊圖冊／解析時漏掉的頁」，每次畫一批（function 內上限 16 頁）。
-- 只在上海時間 23:00–09:00 跑（UTC 15:00–翌日 01:00），跟夜間解析同一個時段。
--
-- Function host 沿用這個資料庫現有的 cron（正式庫與 FDS2.0 分支各自叫自己的 function），
-- 不要寫死 project ref。

do $cron$
declare
  v_host text;
  v_command text;
begin
  select substring(command from $re$https://[a-z0-9]+\.supabase\.co$re$)
    into v_host
  from cron.job
  where jobname in ('fds-process-jobs', 'fds-catalog-thumbs')
  limit 1;

  if v_host is null or v_host = '' then
    v_host := 'https://riaubhtruisbwdlwjzur.supabase.co';
  end if;

  perform cron.unschedule('fds-catalog-thumbs')
  from cron.job
  where jobname = 'fds-catalog-thumbs';

  v_command := format($job$
    select net.http_post(
      url := %L || '/functions/v1/catalog-thumbs',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret' limit 1)
      ),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$, v_host);

  perform cron.schedule('fds-catalog-thumbs', '*/2 15-23,0-1 * * *', v_command);
end
$cron$;
