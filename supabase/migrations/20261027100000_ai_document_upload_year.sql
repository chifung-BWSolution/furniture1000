-- AI uploads know the document year before extraction discovers series/categories.
-- Keep the existing metadata RPC and strict validation for other upload sources.

alter table public.supplier_documents drop constraint if exists supplier_documents_catalog_meta_chk;
alter table public.supplier_documents add constraint supplier_documents_catalog_meta_chk check (
  parent_document_id is not null or document_year is null or (
    document_year between 1990 and 2100 and (
      doc_type <> 'catalog' or source = 'ai_processor' or (
        length(btrim(coalesce(series, ''))) > 0 and cardinality(product_categories) > 0
      )
    )
  )
);

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
  if p_doc_type = 'catalog' and p_source is distinct from 'ai_processor' and (
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
