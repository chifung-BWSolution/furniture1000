-- FDS Supplier RFQ 第一期甲（PRD §6.2）：供應商只能上載自己廠的文件。
-- 1) 由 supplier_logins（active + JWT email）解析 factory_id，不信前端。
-- 2) supplier 的 storage path 必須落在自己廠的資料夾（沿用 <factory>/<sha256>.pdf）。
-- 3) supplier 只可 enqueue 自己廠的文件；admin／uploader 行為不變。
-- 4) Storage insert / select 只加自己廠路徑；不開 allow-all。

create or replace function public.fds_supplier_factory_folder()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select l.factory_id
  from public.supplier_logins l
  where l.active is true
    and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;
revoke all on function public.fds_supplier_factory_folder() from public, anon;
grant execute on function public.fds_supplier_factory_folder() to authenticated;

-- Raw factory_id and the sanitised folder segment used by src/lib/supplierDocuments.ts.
create or replace function public.fds_supplier_storage_segments()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with f as (select public.fds_supplier_factory_folder() as id)
  select array_remove(array[
    (select id from f),
    nullif(
      left(
        trim(both '_' from regexp_replace(btrim(coalesce((select id from f), '')), '[^A-Za-z0-9_-]+', '_', 'g')),
        60
      ),
      ''
    )
  ], null);
$$;
revoke all on function public.fds_supplier_storage_segments() from public, anon;
grant execute on function public.fds_supplier_storage_segments() to authenticated;

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
  v_is_staff boolean := public.bwf_has_role(array['admin', 'uploader']);
  v_is_supplier boolean := public.bwf_has_role(array['supplier']);
  v_supplier_factory text;
  v_factory_id text := nullif(btrim(coalesce(p_factory_id, '')), '');
  v_factory_name text := btrim(coalesce(p_factory_name, ''));
begin
  if not v_is_staff then
    if not v_is_supplier then
      raise exception 'permission_denied' using errcode = '42501';
    end if;

    v_supplier_factory := public.fds_supplier_factory_folder();
    if v_supplier_factory is null then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    if v_factory_id is distinct from v_supplier_factory then
      raise exception 'factory_mismatch' using errcode = '42501';
    end if;

    -- The original must live under this factory's existing folder, not another factory's.
    if position('..' in v_path) > 0
       or split_part(v_path, '/', 1) <> all(public.fds_supplier_storage_segments()) then
      raise exception 'storage_path_invalid' using errcode = '22023';
    end if;

    -- Supplier uploads are always ordinary uploads, never the AI processor channel.
    p_source := 'upload';
    select nullif(btrim(l.factory_name), '') into v_factory_name
    from public.supplier_logins l
    where l.active is true
      and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1;
    v_factory_name := coalesce(v_factory_name, '');
  end if;

  if v_path = '' then
    raise exception 'storage_path_required' using errcode = '22023';
  end if;

  if p_doc_type not in ('quote', 'catalog', 'price_list', 'certificate') then
    raise exception 'document_type_invalid' using errcode = '22023';
  end if;
  if v_factory_id is null or v_factory_name = '' then
    raise exception 'manufacturer_required' using errcode = '22023';
  end if;
  if coalesce((p_metadata->>'document_year')::int between 1990 and 2100, false) is not true then
    raise exception 'document_year_required' using errcode = '22023';
  end if;
  if p_doc_type = 'catalog' and p_source is distinct from 'ai_processor' and (
    nullif(btrim(p_metadata->>'series'), '') is null
    or jsonb_typeof(p_metadata->'product_categories') is distinct from 'array'
    or jsonb_array_length(p_metadata->'product_categories') = 0
  ) then
    raise exception 'catalog_metadata_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_factory_id || ':' || p_doc_type || ':' || coalesce(p_content_hash, v_path), 0));

  -- Same object path (path is derived from factory + content hash) = same upload.
  select id into v_doc_id from public.supplier_documents where storage_path = v_path
    or (factory_id = v_factory_id and doc_type = p_doc_type
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
    v_factory_id,
    v_factory_name,
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
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.bwf_has_role(array['admin', 'uploader']) then
    if not public.bwf_has_role(array['supplier']) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    select * into v_doc from public.supplier_documents where id = p_document_id;
    if v_doc.id is null then
      raise exception 'document_not_found' using errcode = 'P0002';
    end if;
    if v_doc.factory_id is distinct from public.fds_supplier_factory_folder() then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
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
revoke all on function public.fds_supplier_document_enqueue_parse(uuid) from public, anon;
grant execute on function public.fds_supplier_document_enqueue_parse(uuid) to authenticated;

-- Storage: suppliers may write/read only their own factory folder.
drop policy if exists "supplier_documents_objects_insert" on storage.objects;
create policy "supplier_documents_objects_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'supplier-documents'
    and (
      public.bwf_has_role(array['admin', 'uploader'])
      or (
        public.bwf_has_role(array['supplier'])
        and split_part(name, '/', 1) = any(public.fds_supplier_storage_segments())
      )
    )
  );

drop policy if exists supplier_documents_objects_select_supplier on storage.objects;
create policy supplier_documents_objects_select_supplier
  on storage.objects for select to authenticated
  using (
    bucket_id = 'supplier-documents'
    and public.bwf_has_role(array['supplier'])
    and split_part(name, '/', 1) = any(public.fds_supplier_storage_segments())
  );

notify pgrst, 'reload schema';
