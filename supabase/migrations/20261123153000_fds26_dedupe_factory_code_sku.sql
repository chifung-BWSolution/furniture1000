-- FDS-26 防重複強化：
-- 1. fds_import_extracted_products：同廠家下同時比對 fds_model_key(p.model) 與 fds_model_key(p.sku)
--    （防止歷史產品只填 sku 沒填 model 導致重複建立），且同時支援 factory_id 與 factories_display_name 匹配。
-- 2. fds_asana_document_ingest：新增 p_factory_code，優先將廠家代號（如 PSLH、PBD、MA03）寫入
--    supplier_documents.factory_id，與歷史 4,755 筆 products.factory_id 保持同一格式。

create or replace function public.fds_import_extracted_products(
  p_document_id uuid,
  p_item_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.supplier_documents%rowtype;
  v_item public.extraction_items%rowtype;
  v_p jsonb;
  v_key text;
  v_product_id text;
  v_existing boolean;
  v_main_url text;
  v_images jsonb;
  v_variant text;
  v_currency text;
  v_price numeric;
  v_other jsonb;
  v_staff uuid := public.bwf_current_staff_id();
  v_created int := 0;
  v_linked int := 0;
  v_prices int := 0;
  v_n int;
  v_skipped jsonb := '[]'::jsonb;
  v_pending int;
  v_year int;
  v_other_variant text;
begin
  if coalesce(current_setting('fds.import_actor', true), '') is distinct from 'worker' then
    perform public.bwf_assert_role(array['admin', 'uploader']);
  end if;

  select * into v_doc from public.supplier_documents where id = p_document_id for update;
  if v_doc.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if coalesce(v_doc.factory_id, '') = '' and btrim(coalesce(v_doc.factory_name, '')) = '' then
    raise exception 'document_factory_missing' using errcode = '22023';
  end if;

  for v_item in
    select * from public.extraction_items e
    where e.document_id = p_document_id
      and e.status = 'approved'
      and e.imported_product_id is null
      and (p_item_ids is null or e.id = any (p_item_ids))
    order by e.seq
    for update
  loop
    v_p := v_item.raw_json || coalesce(v_item.corrected_json, '{}'::jsonb);
    if not public.fds_extraction_price_confirmed(v_doc.doc_type, v_item.raw_json, v_item.corrected_json, v_item.flags) then
      v_skipped := v_skipped || jsonb_build_object('id', v_item.id, 'reason', 'price_not_confirmed');
      continue;
    end if;
    v_key := public.fds_model_key(v_p ->> 'model');
    if v_key is null then
      v_skipped := v_skipped || jsonb_build_object('id', v_item.id, 'reason', 'missing_model');
      continue;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'fds-product:' || v_key || '|' ||
        case
          when coalesce(v_doc.factory_id, '') <> '' then 'id:' || upper(btrim(v_doc.factory_id))
          else 'name:' || lower(btrim(v_doc.factory_name))
        end,
        0
      )
    );

    -- 同廠家下比對 model 或 sku（去符號轉小寫），避免歷史只填 sku 的產品重複建立。
    select p.id into v_product_id
    from public.products p
    where (
        public.fds_model_key(p.model) = v_key
        or public.fds_model_key(p.sku) = v_key
      )
      and not p.dismissed
      and (
        (coalesce(v_doc.factory_id, '') <> '' and upper(btrim(coalesce(p.factory_id, ''))) = upper(btrim(v_doc.factory_id)))
        or (
          btrim(coalesce(v_doc.factory_name, '')) <> ''
          and lower(btrim(coalesce(p.factories_display_name, ''))) = lower(btrim(v_doc.factory_name))
        )
      )
    order by (public.fds_model_key(p.model) = v_key) desc, p.created_at
    limit 1;
    v_existing := v_product_id is not null;

    if not v_existing then
      select i.public_url into v_main_url
      from public.supplier_document_images i
      where i.id = coalesce(v_item.main_image_id, v_item.image_ids[1]) and i.image_type <> 'logo';

      select coalesce(jsonb_agg(jsonb_build_object('src', i.public_url, 'position', t.n, 'alt', coalesce(v_p ->> 'name', ''))
                                order by t.n), '[]'::jsonb)
        into v_images
      from unnest(v_item.image_ids) with ordinality as t(image_id, n)
      join public.supplier_document_images i on i.id = t.image_id
      where i.image_type <> 'logo';

      v_product_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 13);
      insert into public.products (
        id, title, description, model, factory_id, factories_display_name,
        dimension_l_mm, dimension_w_mm, dimension_h_mm, material, color, category, sale_price,
        image_url, images, production_date, specifications, source, status,
        created_at, created_date, modified_date, creator_staff_id, editor_staff_id
      ) values (
        v_product_id,
        left(coalesce(nullif(btrim(v_p ->> 'name'), ''), btrim(v_p ->> 'model')), 500),
        coalesce(v_p ->> 'description', ''),
        btrim(v_p ->> 'model'),
        coalesce(v_doc.factory_id, ''),
        v_doc.factory_name,
        public.fds_try_numeric(v_p ->> 'width_mm'),
        public.fds_try_numeric(v_p ->> 'depth_mm'),
        public.fds_try_numeric(v_p ->> 'height_mm'),
        coalesce(v_p ->> 'material', ''),
        coalesce((select string_agg(c, ',') from jsonb_array_elements_text(
                    case when jsonb_typeof(v_p -> 'colors') = 'array' then v_p -> 'colors' else '[]'::jsonb end) c
                  where c ~ '^[A-Za-z]+$'), ''),
        coalesce(v_p ->> 'category', ''),
        case when public.fds_try_numeric(v_p ->> 'sale_price') >= 0
          then public.fds_try_numeric(v_p ->> 'sale_price') end,
        coalesce(v_main_url, ''),
        v_images,
        round(public.fds_try_numeric(v_p ->> 'lead_time_days'))::int,
        nullif(concat_ws(E'\n',
                 nullif(v_p ->> 'series', ''),
                 nullif(v_p ->> 'dimensions_text', '')), ''),
        'local',
        case when v_item.review_note = 'auto_imported' then 'auto_imported' else 'draft' end,
        now(), now(), now(), v_staff, v_staff
      );
      v_created := v_created + 1;
    else
      v_linked := v_linked + 1;
    end if;

    v_currency := upper(nullif(btrim(coalesce(v_p ->> 'currency', v_doc.currency, '')), ''));
    v_year := v_doc.document_year;
    if v_year is null and coalesce(v_p ->> 'valid_from', '') ~ '^[0-9]{4}-' then
      v_year := substring(v_p ->> 'valid_from' from 1 for 4)::int;
    end if;
    if v_year is not null and (v_year < 1990 or v_year > 2100) then
      v_year := null;
    end if;
    v_price := public.fds_try_numeric(v_p ->> 'price');
    if exists (
      select 1 from public.supplier_prices sp
      where sp.product_id = v_product_id and sp.document_id = p_document_id
        and sp.extraction_item_id is distinct from v_item.id
    ) then
      v_variant := coalesce(
        nullif(left(concat_ws(' · ', nullif(v_p ->> 'name', ''), nullif(v_p ->> 'material', ''),
                              nullif(v_p ->> 'dimensions_text', '')), 200), ''),
        '#' || v_item.seq);
    else
      v_variant := null;
    end if;

    if v_price is not null and v_price >= 0 then
      insert into public.supplier_prices (
        product_id, factory_id, factory_name, document_id, extraction_item_id, page_no, variant_label,
        currency, unit, moq, cost_price, valid_from, valid_to, verified, raw_ref, creator_staff_id,
        quote_year, price_conflict
      ) values (
        v_product_id, nullif(v_doc.factory_id, ''), v_doc.factory_name, p_document_id, v_item.id, v_item.page_no,
        v_variant,
        v_currency, nullif(v_p ->> 'unit', ''), public.fds_try_numeric(v_p ->> 'moq'), v_price,
        public.fds_try_date(v_p ->> 'valid_from'), public.fds_try_date(v_p ->> 'valid_to'), true,
        jsonb_strip_nulls(jsonb_build_object('price_text', v_p ->> 'price_text', 'bbox', v_item.bbox)),
        v_staff, v_year, false
      )
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_prices := v_prices + v_n;
      if v_n > 0 then
        perform public.fds_refresh_price_year_conflict(
          v_product_id, v_year, v_currency, nullif(v_p ->> 'unit', ''), v_variant
        );
      end if;
    end if;

    if jsonb_typeof(v_p -> 'other_prices') = 'array' then
      for v_other in select * from jsonb_array_elements(v_p -> 'other_prices') loop
        continue when public.fds_try_numeric(v_other ->> 'price') is null
          or btrim(coalesce(v_other ->> 'label', '')) = '';
        v_other_variant := left(concat_ws(' · ', v_variant, btrim(v_other ->> 'label')), 200);
        insert into public.supplier_prices (
          product_id, factory_id, factory_name, document_id, extraction_item_id, page_no, variant_label,
          currency, unit, moq, cost_price, valid_from, valid_to, verified, raw_ref, creator_staff_id,
          quote_year, price_conflict
        ) values (
          v_product_id, nullif(v_doc.factory_id, ''), v_doc.factory_name, p_document_id, v_item.id, v_item.page_no,
          v_other_variant,
          v_currency, nullif(v_p ->> 'unit', ''), public.fds_try_numeric(v_p ->> 'moq'),
          public.fds_try_numeric(v_other ->> 'price'),
          public.fds_try_date(v_p ->> 'valid_from'), public.fds_try_date(v_p ->> 'valid_to'), true,
          jsonb_build_object('other_price', v_other), v_staff, v_year, false
        )
        on conflict do nothing;
        get diagnostics v_n = row_count;
        v_prices := v_prices + v_n;
        if v_n > 0 then
          perform public.fds_refresh_price_year_conflict(
            v_product_id, v_year, v_currency, nullif(v_p ->> 'unit', ''), v_other_variant
          );
        end if;
      end loop;
    end if;

    insert into public.product_source_refs (product_id, document_id, extraction_item_id, page_no, bbox)
    values (v_product_id, p_document_id, v_item.id, v_item.page_no, v_item.bbox)
    on conflict (product_id, document_id, page_no) do nothing;

    update public.extraction_items
    set imported_product_id = v_product_id, updated_at = now()
    where id = v_item.id;
  end loop;

  select count(*) into v_pending
  from public.extraction_items
  where document_id = p_document_id and status = 'pending';

  update public.supplier_documents
  set status = case when v_pending = 0 and status = 'review' then 'ready' else status end,
      editor_staff_id = v_staff,
      modified_date = now()
  where id = p_document_id;

  return jsonb_build_object(
    'created', v_created,
    'linked', v_linked,
    'prices', v_prices,
    'skipped', v_skipped,
    'pending', v_pending
  );
end;
$$;

-- ── fds_asana_document_ingest：優先存 factory_code 到 supplier_documents.factory_id ──

create or replace function public.fds_asana_document_ingest(
  p_link_id uuid,
  p_factory_id text,
  p_factory_name text,
  p_asana_task_gid text,
  p_asana_attachment_gid text,
  p_file_name text,
  p_file_ext text,
  p_storage_path text,
  p_file_size bigint default null,
  p_content_hash text default null,
  p_doc_type text default 'quote',
  p_remote_created_at timestamptz default null,
  p_document_year int default null,
  p_factory_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := btrim(coalesce(p_storage_path, ''));
  v_factory_uuid text := nullif(btrim(coalesce(p_factory_id, '')), '');
  v_doc_factory_key text := coalesce(nullif(upper(btrim(coalesce(p_factory_code, ''))), ''), v_factory_uuid);
  v_factory_name text := btrim(coalesce(p_factory_name, ''));
  v_ext text := lower(btrim(coalesce(p_file_ext, '')));
  v_doc_type text := case when p_doc_type in ('quote', 'catalog', 'price_list', 'certificate') then p_doc_type else 'quote' end;
  v_hash text := nullif(btrim(coalesce(p_content_hash, '')), '');
  v_size bigint;
  v_doc_id uuid;
  v_job_id uuid;
  v_job_type text;
  v_duplicate boolean := false;
  v_superseded_count int := 0;
  v_old_doc_ids uuid[];
  v_year int := greatest(
    1990,
    least(
      2100,
      coalesce(
        case when p_document_year between 1990 and 2100 then p_document_year else null end,
        extract(year from coalesce(p_remote_created_at, now()))::int
      )
    )
  );
  v_title text := left(regexp_replace(btrim(coalesce(p_file_name, '')), '\.(pdf|xlsx|xls)$', '', 'i'), 300);
begin
  if v_path = '' or v_factory_uuid is null or v_ext not in ('pdf', 'xlsx', 'xls') then
    raise exception 'invalid_asana_document_ingest' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_doc_factory_key || ':' || v_doc_type || ':' || v_year::text, 0)
  );

  select (o.metadata ->> 'size')::bigint into v_size
  from storage.objects o
  where o.bucket_id = 'supplier-documents' and o.name = v_path;
  if not found then
    raise exception 'storage_object_missing' using errcode = 'P0002';
  end if;
  v_size := coalesce(v_size, p_file_size, 0);

  select id into v_doc_id
  from public.supplier_documents
  where storage_path = v_path
     or (
       v_hash is not null
       and factory_id in (v_doc_factory_key, v_factory_uuid)
       and doc_type = v_doc_type
       and content_hash = v_hash
       and parent_document_id is null
     )
  limit 1;

  if v_doc_id is not null then
    v_duplicate := true;
  else
    select array_agg(d.id) into v_old_doc_ids
    from public.supplier_documents d
    where d.source = 'asana'
      and d.factory_id in (v_doc_factory_key, v_factory_uuid)
      and d.doc_type = v_doc_type
      and d.document_year = v_year
      and d.parent_document_id is null;

    if coalesce(array_length(v_old_doc_ids, 1), 0) > 0 then
      update public.processing_jobs j
      set status = 'cancelled',
          error = 'superseded_by_newer_version',
          finished_at = now(),
          updated_at = now()
      where j.status in ('queued', 'running')
        and (
          j.document_id = any(v_old_doc_ids)
          or j.document_id in (
            select c.id from public.supplier_documents c where c.parent_document_id = any(v_old_doc_ids)
          )
        );

      update public.fds_asana_attachment_sync a
      set status = 'skipped',
          skip_reason = 'superseded_by_newer_version',
          document_id = null,
          updated_at = now()
      where a.document_id = any(v_old_doc_ids)
        and a.asana_attachment_gid <> p_asana_attachment_gid;

      delete from public.supplier_documents
      where id = any(v_old_doc_ids);

      v_superseded_count := array_length(v_old_doc_ids, 1);
    end if;

    insert into public.supplier_documents (
      factory_id, factory_name, doc_type, title, storage_path, file_size,
      content_hash, source, status, document_year, description
    ) values (
      v_doc_factory_key,
      coalesce(nullif(v_factory_name, ''), '未命名廠家'),
      v_doc_type,
      nullif(v_title, ''),
      v_path,
      v_size,
      v_hash,
      'asana',
      'uploaded',
      v_year,
      left('由 Asana 任務 ' || btrim(coalesce(p_asana_task_gid, '')) || ' 自動同步：' || btrim(coalesce(p_file_name, '')), 500)
    )
    returning id into v_doc_id;

    if v_ext in ('xlsx', 'xls') then
      v_job_type := 'parse_excel';
    elsif v_size > 62914560 then
      v_job_type := 'needs_split';
    else
      v_job_type := 'parse_pdf';
    end if;

    insert into public.processing_jobs (job_type, payload, document_id)
    values (
      v_job_type,
      jsonb_build_object(
        'document_id', v_doc_id,
        'storage_path', v_path,
        'file_ext', v_ext,
        'source', 'asana',
        'asana_task_gid', p_asana_task_gid,
        'asana_attachment_gid', p_asana_attachment_gid
      ) || case when v_job_type = 'needs_split' then jsonb_build_object('reason', 'over_edge_limit') else '{}'::jsonb end,
      v_doc_id
    )
    returning id into v_job_id;

    update public.supplier_documents
    set status = 'parsing',
        error_message = null,
        modified_date = now()
    where id = v_doc_id;
  end if;

  insert into public.fds_asana_attachment_sync (
    link_id, factory_id, asana_task_gid, asana_attachment_gid,
    file_name, file_ext, file_size, doc_type, document_year, remote_created_at,
    content_hash, document_id, status, skip_reason, error_message,
    attempts, synced_at, updated_at
  ) values (
    p_link_id, v_factory_uuid::uuid, p_asana_task_gid, p_asana_attachment_gid,
    left(btrim(p_file_name), 500), v_ext, v_size, v_doc_type, v_year, p_remote_created_at,
    v_hash, v_doc_id, 'synced',
    case when v_duplicate then 'duplicate_content' else null end,
    null, 1, now(), now()
  )
  on conflict (asana_attachment_gid) do update
    set document_id = excluded.document_id,
        document_year = excluded.document_year,
        content_hash = coalesce(excluded.content_hash, public.fds_asana_attachment_sync.content_hash),
        file_size = coalesce(excluded.file_size, public.fds_asana_attachment_sync.file_size),
        doc_type = excluded.doc_type,
        status = 'synced',
        skip_reason = excluded.skip_reason,
        error_message = null,
        attempts = public.fds_asana_attachment_sync.attempts + 1,
        synced_at = now(),
        updated_at = now();

  return jsonb_build_object(
    'documentId', v_doc_id,
    'jobId', v_job_id,
    'jobType', v_job_type,
    'documentYear', v_year,
    'factoryKey', v_doc_factory_key,
    'duplicate', v_duplicate,
    'superseded', v_superseded_count
  );
end;
$$;

drop function if exists public.fds_asana_document_ingest(uuid, text, text, text, text, text, text, text, bigint, text, text, timestamptz, int);
revoke all on function public.fds_asana_document_ingest(uuid, text, text, text, text, text, text, text, bigint, text, text, timestamptz, int, text) from public, anon, authenticated;
grant execute on function public.fds_asana_document_ingest(uuid, text, text, text, text, text, text, text, bigint, text, text, timestamptz, int, text) to service_role;

notify pgrst, 'reload schema';
