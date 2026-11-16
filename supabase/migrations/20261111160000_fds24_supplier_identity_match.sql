-- FDS Supplier Portal: historical documents were uploaded with the PMS factory
-- code (QXS) as supplier_documents.factory_id, while supplier_logins stores the
-- factories UUID. Match all identifiers of the caller's factory, and store the
-- code for new supplier uploads so one factory does not split into two keys.

create or replace function public.fds_supplier_factory_identifiers()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    l.factory_id,
    nullif(upper(btrim(coalesce(l.factory_code, ''))), ''),
    nullif(btrim(coalesce(l.factory_name, '')), ''),
    nullif(btrim(regexp_replace(coalesce(l.factory_name, ''), '^\s*\d+\s*[.、]\s*', '')), '')
  ], null)
  from public.supplier_logins l
  where l.active is true
    and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;
revoke all on function public.fds_supplier_factory_identifiers() from public, anon;
grant execute on function public.fds_supplier_factory_identifiers() to authenticated;

-- Storage folder may use the UUID or the code; accept both existing layouts.
create or replace function public.fds_supplier_storage_segments()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select l.factory_id, nullif(upper(btrim(coalesce(l.factory_code, ''))), '') as code
    from public.supplier_logins l
    where l.active is true
      and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1
  )
  select array_remove(array[
    (select factory_id from f),
    (select code from f),
    nullif(left(trim(both '_' from regexp_replace(btrim(coalesce((select factory_id from f), '')), '[^A-Za-z0-9_-]+', '_', 'g')), 60), '')
  ], null);
$$;
revoke all on function public.fds_supplier_storage_segments() from public, anon;
grant execute on function public.fds_supplier_storage_segments() to authenticated;

create or replace function public.fds_supplier_review_documents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_factory_ids text[];
  v_supplier boolean := public.bwf_has_role(array['supplier']);
begin
  if public.bwf_has_role(array['admin', 'uploader']) then
    return coalesce((
      select jsonb_agg(row_to_json(d) order by d.created_at desc)
      from (
        select s.id, s.title, s.status, s.factory_id, s.factory_name, s.doc_type, s.created_at, s.error_message
        from public.supplier_documents s
        order by s.created_at desc
        limit 80
      ) d
    ), '[]'::jsonb);
  end if;

  if not v_supplier then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  v_factory_ids := public.fds_supplier_factory_identifiers();
  if v_factory_ids is null or cardinality(v_factory_ids) = 0 then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(d) order by d.created_at desc)
    from (
      select s.id, s.title, s.status, s.factory_id, s.factory_name, s.doc_type, s.created_at, s.error_message
      from public.supplier_documents s
      where s.factory_id = any(v_factory_ids)
      order by s.created_at desc
      limit 80
    ) d
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.fds_supplier_review_documents() from public, anon;
grant execute on function public.fds_supplier_review_documents() to authenticated;

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
  v_supplier_code text;
  v_supplier_name text;
  v_factory_id text := nullif(btrim(coalesce(p_factory_id, '')), '');
  v_factory_name text := btrim(coalesce(p_factory_name, ''));
begin
  if not v_is_staff then
    if not v_is_supplier then
      raise exception 'permission_denied' using errcode = '42501';
    end if;

    select l.factory_id,
           nullif(upper(btrim(coalesce(l.factory_code, ''))), ''),
           nullif(btrim(coalesce(l.factory_name, '')), '')
      into v_supplier_factory, v_supplier_code, v_supplier_name
    from public.supplier_logins l
    where l.active is true
      and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1;

    v_supplier_name := nullif(btrim(regexp_replace(coalesce(v_supplier_name, ''), '^\s*\d+\s*[.、]\s*', '')), '');
    if v_supplier_factory is null and v_supplier_name is null then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    if v_factory_id is null
       or v_factory_id <> all(public.fds_supplier_factory_identifiers()) then
      raise exception 'factory_mismatch' using errcode = '42501';
    end if;

    if position('..' in v_path) > 0
       or split_part(v_path, '/', 1) <> all(public.fds_supplier_storage_segments()) then
      raise exception 'storage_path_invalid' using errcode = '22023';
    end if;

    -- Store the same key historical products/documents use (factory code when we have it).
    v_factory_id := coalesce(v_supplier_code, v_supplier_factory, v_supplier_name);
    v_factory_name := coalesce(v_supplier_name, v_factory_name);
    p_source := 'upload';
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
    if v_doc.factory_id is null
       or v_doc.factory_id <> all(public.fds_supplier_factory_identifiers()) then
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

notify pgrst, 'reload schema';
