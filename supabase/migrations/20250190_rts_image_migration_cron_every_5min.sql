-- Reschedule ready_to_shopify image migration cron to every 5 minutes.
-- Keeps the existing net.http_post command (with project anon key) intact.

do $$
declare
  existing_command text;
begin
  select command
    into existing_command
  from cron.job
  where command ilike '%migrate-rts-images%'
  order by jobid desc
  limit 1;

  if existing_command is null then
    raise notice 'migrate-rts-images cron command not found; create it manually with project anon key';
    return;
  end if;

  perform cron.unschedule(jobname)
  from cron.job
  where jobname in (
    'migrate-rts-images-hourly',
    'migrate-rts-images-every-10min',
    'migrate-rts-images-every-5min'
  );

  perform cron.schedule(
    'migrate-rts-images-every-5min',
    '*/5 * * * *',
    existing_command
  );
end $$;
