-- FDS V2.2: keep metadata and originals on supplier_documents; use the existing worker queue.
-- The old 9-argument create RPC is retained for existing AI/archive callers.
-- Legacy catalogs may have no metadata; new metadata uploads are validated in the RPC.
alter table public.supplier_documents drop constraint if exists supplier_documents_catalog_meta_chk;
alter table public.supplier_documents add constraint supplier_documents_catalog_meta_chk check (
  parent_document_id is not null or document_year is null or (
    document_year between 1990 and 2100 and (
      doc_type <> 'catalog' or (
        length(btrim(coalesce(series, ''))) > 0 and cardinality(product_categories) > 0
      )
    )
  )
);

create or replace function public.force_supplier_catalog_pending()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.processing_status := case when new.doc_type = 'certificate' then 'not_applicable' else 'pending' end;
  if new.parent_document_id is not null then
    select d.document_year, d.series, d.product_categories, d.version_label, d.description
    into new.document_year, new.series, new.product_categories, new.version_label, new.description
    from public.supplier_documents d where d.id = new.parent_document_id;
  end if;
  return new;
end;
$$;

-- Preserve older direct-upload clients while pointing their jobs at the real worker.
create or replace function public.enqueue_supplier_catalog_job()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.doc_type in ('catalog', 'price_list') and new.parent_document_id is null
    and new.source = 'upload' then
    perform public.fds_supplier_document_enqueue_parse(new.id);
  end if;
  return new;
end;
$$;

create or replace function public.fds_supplier_document_enqueue_parse(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.supplier_documents%rowtype;
  v_job_id uuid;
  v_staff uuid := public.bwf_current_staff_id();
  v_child uuid;
  v_edge_max bigint := 62914560;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform public.bwf_assert_role(array['admin', 'uploader']);
  end if;

  select * into v_doc from public.supplier_documents where id = p_document_id for update;
  if v_doc.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;

  if v_doc.doc_type = 'certificate' then
    raise exception 'certificate_not_parseable' using errcode = '22023';
  end if;

  if v_doc.parent_document_id is null and exists (
    select 1 from public.supplier_documents c where c.parent_document_id = v_doc.id
  ) then
    for v_child in
      select c.id from public.supplier_documents c
      where c.parent_document_id = v_doc.id
      order by c.part_index
    loop
      perform public.fds_supplier_document_enqueue_parse(v_child);
    end loop;
    update public.supplier_documents
    set status = 'parsing', error_message = null, modified_date = now()
    where id = v_doc.id;
    return jsonb_build_object('documentId', v_doc.id, 'jobId', null, 'alreadyQueued', false, 'split', true);
  end if;

  if v_doc.parent_document_id is null and coalesce(v_doc.file_size, 0) > v_edge_max then
    update public.processing_jobs
    set status = 'cancelled',
        error = 'redirected_to_split',
        finished_at = now(),
        updated_at = now()
    where document_id = v_doc.id
      and job_type = 'parse_pdf'
      and status in ('queued', 'running');

    select j.id into v_job_id
    from public.processing_jobs j
    where j.document_id = v_doc.id
      and j.job_type = 'needs_split'
      and j.status in ('queued', 'running')
    limit 1;

    if v_job_id is null then
      insert into public.processing_jobs (job_type, payload, document_id, creator_staff_id)
      values (
        'needs_split',
        jsonb_build_object('document_id', v_doc.id, 'storage_path', v_doc.storage_path, 'reason', 'over_edge_limit'),
        v_doc.id,
        v_staff
      )
      returning id into v_job_id;
    end if;

    update public.supplier_documents
    set status = 'parsing', error_message = null, modified_date = now()
    where id = v_doc.id;

    return jsonb_build_object('documentId', v_doc.id, 'jobId', v_job_id, 'alreadyQueued', false, 'needsSplit', true);
  end if;

  select j.id into v_job_id
  from public.processing_jobs j
  where j.document_id = p_document_id
    and j.job_type = 'parse_pdf'
    and j.status in ('queued', 'running')
  limit 1;

  if v_job_id is not null then
    return jsonb_build_object('documentId', p_document_id, 'jobId', v_job_id, 'alreadyQueued', true);
  end if;

  insert into public.processing_jobs (job_type, payload, document_id, creator_staff_id)
  values (
    'parse_pdf',
    jsonb_build_object('document_id', p_document_id, 'storage_path', v_doc.storage_path),
    p_document_id,
    v_staff
  )
  returning id into v_job_id;

  update public.supplier_documents
  set status = 'parsing',
      error_message = null,
      editor_staff_id = coalesce(v_staff, editor_staff_id),
      modified_date = now()
  where id = p_document_id;

  return jsonb_build_object('documentId', p_document_id, 'jobId', v_job_id, 'alreadyQueued', false);
end;
$$;

create or replace function public.fds_supplier_document_create(
  p_storage_path text,
  p_factory_id text,
  p_factory_name text,
  p_title text,
  p_doc_type text,
  p_currency text,
  p_content_hash text,
  p_source text,
  p_enqueue boolean,
  p_metadata jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := btrim(coalesce(p_storage_path, ''));
  v_size bigint;
  v_doc_id uuid;
  v_staff uuid := public.bwf_current_staff_id();
  v_enqueue jsonb;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

  if v_path = '' then
    raise exception 'storage_path_required' using errcode = '22023';
  end if;

  if p_doc_type not in ('quote', 'catalog', 'price_list', 'certificate') then
    raise exception 'document_type_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_factory_id), '') is null or nullif(btrim(p_factory_name), '') is null then
    raise exception 'manufacturer_required' using errcode = '22023';
  end if;
  if coalesce((p_metadata->>'document_year')::int between 1990 and 2100, false) is not true then
    raise exception 'document_year_required' using errcode = '22023';
  end if;
  if p_doc_type = 'catalog' and (
    nullif(btrim(p_metadata->>'series'), '') is null
    or jsonb_typeof(p_metadata->'product_categories') is distinct from 'array'
    or jsonb_array_length(p_metadata->'product_categories') = 0
  ) then
    raise exception 'catalog_metadata_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_factory_id || ':' || p_doc_type || ':' || coalesce(p_content_hash, v_path), 0));

  -- Same object path (path is derived from factory + content hash) = same upload.
  select id into v_doc_id from public.supplier_documents where storage_path = v_path
    or (factory_id = p_factory_id and doc_type = p_doc_type
        and content_hash = nullif(btrim(p_content_hash), '') and parent_document_id is null)
  limit 1;
  if v_doc_id is not null then
    return jsonb_build_object('documentId', v_doc_id, 'jobId', null, 'duplicate', true);
  end if;

  select (o.metadata ->> 'size')::bigint into v_size
  from storage.objects o
  where o.bucket_id = 'supplier-documents' and o.name = v_path;
  if not found then
    raise exception 'storage_object_missing' using errcode = 'P0002';
  end if;

  insert into public.supplier_documents (
    factory_id, factory_name, doc_type, title, storage_path, file_size, content_hash,
    currency, source, status, creator_staff_id, editor_staff_id,
    document_year, series, product_categories, version_label, description
  ) values (
    nullif(btrim(coalesce(p_factory_id, '')), ''),
    btrim(coalesce(p_factory_name, '')),
    p_doc_type,
    nullif(left(btrim(coalesce(p_title, '')), 300), ''),
    v_path,
    v_size,
    nullif(btrim(coalesce(p_content_hash, '')), ''),
    nullif(upper(left(btrim(coalesce(p_currency, '')), 10)), ''),
    case when p_source = 'ai_processor' then 'ai_processor' else 'upload' end,
    'uploaded',
    v_staff,
    v_staff,
    (p_metadata->>'document_year')::int,
    nullif(btrim(p_metadata->>'series'), ''),
    array(select distinct btrim(value) from jsonb_array_elements_text(coalesce(p_metadata->'product_categories', '[]'::jsonb)) where btrim(value) <> ''),
    nullif(btrim(p_metadata->>'version_label'), ''),
    nullif(btrim(p_metadata->>'description'), '')
  )
  returning id into v_doc_id;

  if coalesce(p_enqueue, true) and p_doc_type <> 'certificate' then
    v_enqueue := public.fds_supplier_document_enqueue_parse(v_doc_id);
    return jsonb_build_object('documentId', v_doc_id, 'jobId', v_enqueue ->> 'jobId', 'duplicate', false);
  end if;

  return jsonb_build_object('documentId', v_doc_id, 'jobId', null, 'duplicate', false);
end;
$$;
revoke all on function public.fds_supplier_document_create(text, text, text, text, text, text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.fds_supplier_document_create(text, text, text, text, text, text, text, text, boolean, jsonb) to authenticated;

-- UI status is a projection of existing document + job state, including split children.
create or replace function public.fds_refresh_document_processing_status(p_document_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.supplier_documents d set processing_status = case
    when d.doc_type = 'certificate' then 'not_applicable'
    when exists(select 1 from public.processing_jobs j left join public.supplier_documents c on c.id = j.document_id
      where (j.document_id = d.id or c.parent_document_id = d.id) and j.status = 'running') then 'processing'
    when exists(select 1 from public.processing_jobs j left join public.supplier_documents c on c.id = j.document_id
      where (j.document_id = d.id or c.parent_document_id = d.id) and j.status = 'queued') then 'pending'
    when d.status = 'ready' then 'completed'
    when d.status = 'review' then 'review_required'
    when d.status = 'failed' then 'failed'
    else 'pending' end
  where d.id = p_document_id;
end;
$$;
create or replace function public.fds_document_processing_status_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_parent uuid;
begin
  if tg_table_name = 'processing_jobs' then v_id := new.document_id;
  else v_id := new.id; end if;
  perform public.fds_refresh_document_processing_status(v_id);
  select parent_document_id into v_parent from public.supplier_documents where id = v_id;
  if v_parent is not null then perform public.fds_refresh_document_processing_status(v_parent); end if;
  return new;
end;
$$;
create trigger trg_fds_document_processing_status after update of status on public.supplier_documents
  for each row execute function public.fds_document_processing_status_changed();
create trigger trg_fds_job_document_processing_status after insert or update of status on public.processing_jobs
  for each row execute function public.fds_document_processing_status_changed();
revoke all on function public.fds_refresh_document_processing_status(uuid) from public, anon, authenticated;
revoke all on function public.fds_document_processing_status_changed() from public, anon, authenticated;

-- Stop the counting-only scheduler; fds-process-jobs already targets this environment.
do $$ begin
  perform cron.unschedule('supplier-catalog-parse-hourly');
exception when others then null; end $$;

-- Move only pending legacy uploads without an active/finished real job. Retain the old job history.
do $$ declare d record;
  v_role text := current_setting('request.jwt.claim.role', true);
  v_claims text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  for d in select id from public.supplier_documents s
    where s.doc_type in ('catalog', 'price_list') and s.parent_document_id is null
      and s.processing_status = 'pending' and s.status = 'uploaded'
      and not exists(select 1 from public.processing_jobs j where j.document_id = s.id)
  loop perform public.fds_supplier_document_enqueue_parse(d.id); end loop;
  for d in select id from public.supplier_documents loop
    perform public.fds_refresh_document_processing_status(d.id);
  end loop;
  perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end $$;

-- Originals can contain internal prices; keep the established admin/uploader boundary.
drop policy if exists supplier_documents_select_staff on public.supplier_documents;
drop policy if exists supplier_document_jobs_select_staff on public.supplier_document_jobs;
drop policy if exists supplier_documents_objects_select_staff on storage.objects;
create policy supplier_document_jobs_select_staff on public.supplier_document_jobs for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']));

-- Compatibility for older upload pages. The new page writes through the create RPC.
drop policy if exists supplier_documents_insert_catalog on public.supplier_documents;
create policy supplier_documents_insert_catalog on public.supplier_documents for insert to authenticated
  with check (public.bwf_has_role(array['admin', 'uploader'])
    and doc_type in ('catalog', 'price_list', 'certificate') and parent_document_id is null);
notify pgrst, 'reload schema';
