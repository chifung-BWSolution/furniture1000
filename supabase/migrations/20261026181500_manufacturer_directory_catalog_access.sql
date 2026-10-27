-- Catalog queue enqueue (night worker only) + directory signals scoped by doc type.

drop function if exists public.manufacturer_directory_signals(integer);

create or replace function public.fds_supplier_catalog_enqueue_parse(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.supplier_documents%rowtype;
  v_job_id uuid;
  v_already boolean := false;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

  select * into v_doc
  from public.supplier_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;

  if v_doc.parent_document_id is not null then
    raise exception 'catalog_enqueue_root_only' using errcode = '22023';
  end if;

  if v_doc.doc_type not in ('catalog', 'price_list') then
    raise exception 'catalog_enqueue_doc_type' using errcode = '22023';
  end if;

  select j.id
    into v_job_id
  from public.supplier_document_jobs j
  where j.document_id = p_document_id
    and j.status in ('pending', 'processing')
  limit 1;

  if v_job_id is not null then
    v_already := true;
  else
    insert into public.supplier_document_jobs (document_id, status)
    values (p_document_id, 'pending')
    returning id into v_job_id;
  end if;

  update public.supplier_documents
  set processing_status = 'pending',
      modified_date = now()
  where id = p_document_id
    and processing_status not in ('processing');

  return jsonb_build_object(
    'jobId', v_job_id,
    'alreadyQueued', v_already
  );
end;
$$;

revoke all on function public.fds_supplier_catalog_enqueue_parse(uuid) from public, anon;
grant execute on function public.fds_supplier_catalog_enqueue_parse(uuid) to authenticated, service_role;

create or replace function public.manufacturer_directory_signals(
  p_year integer,
  p_doc_scope text default 'all'
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'quote_names', coalesce((
      select jsonb_agg(distinct btrim(i.factory_name))
      from public.bwf_quote_item i
      join public.bwf_quote q on q.id = i.quote_uuid
      where p_year is not null
        and extract(year from timezone('Asia/Shanghai', q.created_at)) = p_year
        and coalesce(q.status, '') not in ('回收桶', 'deleted', '廢棄')
        and coalesce(i.is_section_title, false) = false
        and btrim(coalesce(i.factory_name, '')) <> ''
    ), '[]'::jsonb),
    'catalogs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'factory_code', nullif(btrim(p.factory_id), ''),
        'factory_name', nullif(btrim(p.factories_display_name), ''),
        'year', p.yr
      ))
      from (
        select
          factory_id,
          factories_display_name,
          extract(year from timezone(
            'Asia/Shanghai',
            max(coalesce(created_date, created_at))
          ))::int as yr
        from public.products
        where nullif(btrim(coalesce(factory_id, '')), '') is not null
           or nullif(btrim(coalesce(factories_display_name, '')), '') is not null
        group by factory_id, factories_display_name
      ) p
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'factory_id', nullif(btrim(d.factory_id), ''),
        'factory_name', nullif(btrim(d.factory_name), ''),
        'doc_type', d.doc_type,
        'year', d.yr
      ))
      from (
        select
          factory_id,
          factory_name,
          doc_type,
          extract(year from timezone(
            'Asia/Shanghai',
            max(coalesce(created_at, created_date))
          ))::int as yr
        from public.supplier_documents
        where doc_type in ('catalog', 'quote', 'price_list')
          and (
            coalesce(p_doc_scope, 'all') <> 'catalog_only'
            or doc_type = 'catalog'
          )
        group by factory_id, factory_name, doc_type
      ) d
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.manufacturer_directory_signals(integer, text) from public;
revoke all on function public.manufacturer_directory_signals(integer, text) from anon;
revoke all on function public.manufacturer_directory_signals(integer, text) from authenticated;
grant execute on function public.manufacturer_directory_signals(integer, text) to service_role;

comment on function public.manufacturer_directory_signals(integer, text) is
  '廠家目錄 signals. p_doc_scope=catalog_only omits quote/price_list supplier_documents from document years.';

notify pgrst, 'reload schema';
