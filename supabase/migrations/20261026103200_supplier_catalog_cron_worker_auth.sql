-- Reuse the existing worker authentication contract; no service JWT required.
do $$
declare j record;
begin
  if not exists (select 1 from vault.decrypted_secrets where name='fds_worker_secret' and length(decrypted_secret)>0) then
    raise exception 'Missing fds_worker_secret';
  end if;
  for j in select jobid,command from cron.job where jobname='supplier-catalog-parse-hourly' loop
    perform cron.alter_job(j.jobid, command := replace(replace(replace(j.command, '''Authorization'', ''Bearer '' ||', '''x-worker-secret'', '), '''supplier_catalog_service_role_key''', '''fds_worker_secret'''), '''service_role_key''', '''fds_worker_secret'''));
  end loop;
end;
$$;
