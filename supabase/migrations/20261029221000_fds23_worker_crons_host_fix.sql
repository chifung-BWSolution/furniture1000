-- 修正 20261029220000_fds23_worker_crons.sql 的 host 偵測：
-- 原本 `limit 1` 可能選到本庫裡指向 Production 的舊 cron（例如 migrate-rts-images-daily-backlog），
-- 令分支的 cron 打去 Production。改為以本庫既有的 `fds-process-jobs` 為主，
-- 其次是 `fds-pms-category-demand`，兩者都是「本環境自己的函式 host」。

do $cron$
declare
  v_host text;
  v_send text;
  v_notify text;
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

  v_send := format($job$
    select net.http_post(
      url := %L || '/functions/v1/send-quote-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret' limit 1)
      ),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 5000
    )
    where exists (
      select 1 from public.bwf_quote_email_message m
      where m.status = 'queued' and m.scheduled_for <= now() and m.attempts < 3
    )
    or exists (
      select 1 from public.bwf_quote_email_settings s
      where s.auto_follow_up
        and s.status = 'auto_follow_up_active'
        and s.first_viewed_at is null
        and s.next_follow_up_at is not null
        and s.next_follow_up_at <= now()
    );
  $job$, v_host);

  v_notify := format($job$
    select net.http_post(
      url := %L || '/functions/v1/notify-customer-quote-request',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret' limit 1)
      ),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 5000
    )
    where exists (
      select 1 from public.bwf_quote_customer_request r
      where r.pm_notified_at is null
        and r.pm_notify_attempts < 5
        and (r.last_notify_attempt_at is null or r.last_notify_attempt_at < now() - interval '5 minutes')
    );
  $job$, v_host);

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

  perform cron.unschedule('fds-send-quote-email') from cron.job where jobname = 'fds-send-quote-email';
  perform cron.unschedule('fds-notify-customer-request') from cron.job where jobname = 'fds-notify-customer-request';
  perform cron.unschedule('fds-sync-asana-factories') from cron.job where jobname = 'fds-sync-asana-factories';

  perform cron.schedule('fds-send-quote-email', '*/15 * * * *', v_send);
  perform cron.schedule('fds-notify-customer-request', '*/10 * * * *', v_notify);
  perform cron.schedule('fds-sync-asana-factories', '41 2 * * *', v_asana);
end
$cron$;

notify pgrst, 'reload schema';
