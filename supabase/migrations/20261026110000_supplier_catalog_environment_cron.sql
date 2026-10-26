-- Reuse each environment's established worker URL and Vault authentication.
do $$
declare
  project_ref text;
begin
  select substring(command from 'https://([a-z]{20})[.]supabase[.]co')
    into project_ref from cron.job where jobname = 'fds-process-jobs';
  if project_ref is null then
    raise exception 'Cannot resolve local project from fds-process-jobs';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'fds_worker_secret' and length(decrypted_secret) > 0) then
    raise exception 'Missing fds_worker_secret';
  end if;
  perform cron.schedule('supplier-catalog-parse-hourly', '0 * * * *', format(
    $job$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret' limit 1)),
      body := '{}'::jsonb
    ) as request_id;$job$,
    'https://' || project_ref || '.supabase.co/functions/v1/supabase-functions-process-supplier-catalogs'
  ));
  -- Remove the unused credential from the initial diagnostic attempt.
  delete from vault.secrets where name = 'supplier_catalog_service_role_key';
end;
$$;
