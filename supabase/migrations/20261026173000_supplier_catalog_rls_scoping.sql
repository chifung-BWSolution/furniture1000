-- Tighten designer/PM access to catalog documents only (table, jobs, storage).
-- Replaces over-broad policies from 20261026054535. Admin/uploader policies unchanged.

-- Legacy catalog / price_list roots may lack new metadata columns; backfill so CHECK
-- constraints remain valid on databases that already had rows before catalog uploads.
update public.supplier_documents d
set
  document_year = coalesce(
    d.document_year,
    greatest(1990, least(2100, extract(year from d.created_at)::integer))
  ),
  series = coalesce(
    nullif(btrim(d.series), ''),
    nullif(btrim(d.title), ''),
    'legacy'
  ),
  product_categories = case
    when cardinality(d.product_categories) > 0 then d.product_categories
    when d.doc_type = 'catalog' then array['未分類']::text[]
    else d.product_categories
  end
where d.parent_document_id is null
  and d.doc_type in ('catalog', 'price_list')
  and (
    d.document_year is null
    or d.document_year not between 1990 and 2100
    or (
      d.doc_type = 'catalog'
      and (
        length(btrim(coalesce(d.series, ''))) = 0
        or cardinality(d.product_categories) = 0
      )
    )
  );

drop policy if exists supplier_documents_select_staff on public.supplier_documents;
drop policy if exists supplier_documents_select_designer_pm_catalog on public.supplier_documents;

create policy supplier_documents_select_designer_pm_catalog
  on public.supplier_documents
  for select
  to authenticated
  using (
    public.bwf_has_role(array['designer', 'pm'])
    and doc_type = 'catalog'
  );

drop policy if exists supplier_document_jobs_select_staff on public.supplier_document_jobs;
drop policy if exists supplier_document_jobs_select_designer_pm_catalog on public.supplier_document_jobs;

create policy supplier_document_jobs_select_designer_pm_catalog
  on public.supplier_document_jobs
  for select
  to authenticated
  using (
    public.bwf_has_role(array['designer', 'pm'])
    and exists (
      select 1
      from public.supplier_documents d
      where d.id = document_id
        and d.doc_type = 'catalog'
    )
  );

drop policy if exists supplier_documents_objects_select_staff on storage.objects;
drop policy if exists supplier_documents_objects_select_designer_pm_catalog on storage.objects;

create policy supplier_documents_objects_select_designer_pm_catalog
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'supplier-documents'
    and public.bwf_has_role(array['designer', 'pm'])
    and exists (
      select 1
      from public.supplier_documents d
      where d.storage_path = name
        and d.doc_type = 'catalog'
    )
  );

-- Hourly catalog worker: call this project's functions host (preview/branch safe).
do $cron$
declare
  v_host text;
  v_command text;
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
    where jobname = 'supplier-catalog-parse-hourly'
    limit 1;
  end if;

  if v_host is null or v_host = '' then
    v_host := 'https://riaubhtruisbwdlwjzur.supabase.co';
  end if;

  begin
    perform cron.unschedule('supplier-catalog-parse-hourly');
  exception when others then
    null;
  end;

  v_command := format($job$
    select net.http_post(
      url := %L || '/functions/v1/supabase-functions-process-supplier-catalogs',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'service_role_key'
          limit 1
        )
      ),
      body := '{}'::jsonb
    ) as request_id;
  $job$, v_host);

  perform cron.schedule('supplier-catalog-parse-hourly', '0 * * * *', v_command);
end
$cron$;

notify pgrst, 'reload schema';
