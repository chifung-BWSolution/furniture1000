-- A6: Cron is backlog-only — new writes upload to Storage at save time.
-- Reschedule migrate-rts-images from every 5 minutes to once daily (03:00 UTC).

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
    raise notice 'migrate-rts-images cron command not found; skip reschedule';
    return;
  end if;

  perform cron.unschedule(jobname)
  from cron.job
  where jobname in (
    'migrate-rts-images-hourly',
    'migrate-rts-images-every-10min',
    'migrate-rts-images-every-5min',
    'migrate-rts-images-daily-backlog'
  );

  perform cron.schedule(
    'migrate-rts-images-daily-backlog',
    '0 3 * * *',
    existing_command
  );
end $$;
