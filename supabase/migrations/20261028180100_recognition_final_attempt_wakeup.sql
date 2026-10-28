-- Existing installations may already have the recognition cron. Preserve its
-- environment-specific host and secret while waking abandoned final attempts.
do $$
declare
  v_command text;
begin
  select command into v_command from cron.job where jobname = 'fds-furniture-recognition';
  if v_command is not null then
    v_command := replace(v_command,
      'status = ''running'' and heartbeat_at < now() - interval ''2 minutes'' and attempts < max_attempts',
      'status = ''running'' and heartbeat_at < now() - interval ''2 minutes''');
    perform cron.schedule('fds-furniture-recognition', '* * * * *', v_command);
  end if;
end;
$$;
