-- Restore the shared night window and existing worker-secret cron contract.
create or replace function public.fds_document_parse_window_open(p_at timestamptz default now())
returns boolean language sql stable set search_path = '' as $$
  select (p_at at time zone 'Asia/Shanghai')::time >= time '23:00'
      or (p_at at time zone 'Asia/Shanghai')::time < time '09:00';
$$;
revoke all on function public.fds_document_parse_window_open(timestamptz) from public, anon, authenticated;
grant execute on function public.fds_document_parse_window_open(timestamptz) to service_role;

do $$
declare j record; v_command text;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'fds_worker_secret' and length(decrypted_secret) > 0) then
    raise exception 'Missing fds_worker_secret';
  end if;
  select jobid, command into j from cron.job where jobname = 'supplier-catalog-parse-hourly';
  if j.jobid is null then raise exception 'Missing supplier-catalog-parse-hourly cron'; end if;
  v_command := replace(replace(replace(j.command, '''Authorization'', ''Bearer '' ||', '''x-worker-secret'', '), '''supplier_catalog_service_role_key''', '''fds_worker_secret'''), '''service_role_key''', '''fds_worker_secret''');
  if position('''x-worker-secret''' in v_command) = 0 or position('''fds_worker_secret''' in v_command) = 0 then
    raise exception 'Unrecognized catalog cron authentication';
  end if;
  perform cron.alter_job(j.jobid, command := v_command);
end;
$$;
notify pgrst, 'reload schema';
