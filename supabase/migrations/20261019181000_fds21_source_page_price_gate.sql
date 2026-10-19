-- Day 5（T-501 / T-502 / T-504）
-- 1. 搜尋角色可開某一筆產品已關聯的原文頁，不把 storage 路徑放進搜索結果。
-- 2. 報價單未確認價格不得審核通過，也不得寫成正式價（BR-02 / AC-002-3）。
-- 3. 任務完成時記入 token、OCR 頁、時長、費用與提取成功率。

-- ── 價格確認 ──────────────────────────────────────────────────────────

create or replace function public.fds_extraction_price_confirmed(
  p_doc_type text,
  p_raw jsonb,
  p_corrected jsonb,
  p_flags text[]
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_doc_type, 'quote') = 'catalog' then true
    else
      coalesce(
        public.fds_try_numeric(
          (coalesce(p_raw, '{}'::jsonb) || coalesce(p_corrected, '{}'::jsonb)) ->> 'price'
        ) >= 0,
        false
      )
      and not (
        'price_not_in_source' = any (coalesce(p_flags, '{}'::text[]))
        and not pg_catalog.jsonb_exists(coalesce(p_corrected, '{}'::jsonb), 'price')
      )
      and not (
        'missing_price' = any (coalesce(p_flags, '{}'::text[]))
        and not pg_catalog.jsonb_exists(coalesce(p_corrected, '{}'::jsonb), 'price')
      )
  end;
$$;

revoke all on function public.fds_extraction_price_confirmed(text, jsonb, jsonb, text[]) from public, anon, authenticated;

create or replace function public.fds_extraction_item_review(
  p_item_id uuid,
  p_status text,
  p_corrected jsonb default null,
  p_main_image_id uuid default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.extraction_items%rowtype;
  v_doc_type text;
  v_corrected jsonb;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'status_invalid' using errcode = '22023';
  end if;
  if p_corrected is not null and jsonb_typeof(p_corrected) <> 'object' then
    raise exception 'corrected_json_invalid' using errcode = '22023';
  end if;

  select * into v_item from public.extraction_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if v_item.imported_product_id is not null then
    raise exception 'item_already_imported' using errcode = '22023';
  end if;
  if p_main_image_id is not null and not (p_main_image_id = any (v_item.image_ids)) then
    raise exception 'image_not_linked' using errcode = '22023';
  end if;

  v_corrected := coalesce(p_corrected, v_item.corrected_json);
  if p_status = 'approved' then
    select d.doc_type into v_doc_type
    from public.supplier_documents d
    where d.id = v_item.document_id;
    if not public.fds_extraction_price_confirmed(v_doc_type, v_item.raw_json, v_corrected, v_item.flags) then
      raise exception 'price_needs_confirmation' using errcode = '22023';
    end if;
  end if;

  update public.extraction_items
  set status = p_status,
      corrected_json = coalesce(p_corrected, corrected_json),
      main_image_id = coalesce(p_main_image_id, main_image_id),
      review_note = case when p_note is null then review_note else nullif(left(btrim(p_note), 1000), '') end,
      reviewed_by = case when p_status = 'pending' then null else public.bwf_current_staff_id() end,
      reviewed_at = case when p_status = 'pending' then null else now() end,
      updated_at = now()
  where id = p_item_id
  returning * into v_item;

  return jsonb_build_object('id', v_item.id, 'status', v_item.status);
end;
$$;

drop function if exists public.fds_extraction_items_review_batch(uuid[], text);

create or replace function public.fds_extraction_items_review_batch(
  p_item_ids uuid[],
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
  v_blocked int := 0;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'status_invalid' using errcode = '22023';
  end if;

  if p_status = 'approved' then
    select count(*) into v_blocked
    from public.extraction_items e
    join public.supplier_documents d on d.id = e.document_id
    where e.id = any (p_item_ids)
      and e.imported_product_id is null
      and not public.fds_extraction_price_confirmed(d.doc_type, e.raw_json, e.corrected_json, e.flags);
  end if;

  update public.extraction_items e
  set status = p_status,
      reviewed_by = case when p_status = 'pending' then null else public.bwf_current_staff_id() end,
      reviewed_at = case when p_status = 'pending' then null else now() end,
      updated_at = now()
  from public.supplier_documents d
  where e.document_id = d.id
    and e.id = any (p_item_ids)
    and e.imported_product_id is null
    and (
      p_status <> 'approved'
      or public.fds_extraction_price_confirmed(d.doc_type, e.raw_json, e.corrected_json, e.flags)
    );

  get diagnostics v_updated = row_count;
  return jsonb_build_object('updated', v_updated, 'blocked', v_blocked);
end;
$$;

revoke all on function public.fds_extraction_items_review_batch(uuid[], text) from public, anon;
grant execute on function public.fds_extraction_items_review_batch(uuid[], text) to authenticated;

-- 正式價只能來自已通過的提取項，或由傢俬組手寫（沒有提取項）。
create or replace function public.fds_supplier_prices_verify_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.verified, false) is not true then
    return new;
  end if;
  if new.extraction_item_id is null then
    if not public.bwf_has_role(array['admin', 'uploader'])
       and current_user not in ('postgres', 'supabase_admin', 'service_role') then
      raise exception 'price_not_reviewed' using errcode = '42501';
    end if;
    return new;
  end if;
  if not exists (
    select 1 from public.extraction_items e
    where e.id = new.extraction_item_id and e.status = 'approved'
  ) then
    raise exception 'price_not_reviewed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.fds_supplier_prices_verify_gate() from public, anon, authenticated;

drop trigger if exists trg_supplier_prices_verify_gate on public.supplier_prices;
create trigger trg_supplier_prices_verify_gate
  before insert or update of verified, extraction_item_id
  on public.supplier_prices
  for each row
  execute function public.fds_supplier_prices_verify_gate();

-- 匯入時再擋一次：未確認價格的項目留在審核，不寫產品、不寫正式價。
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
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

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
          when coalesce(v_doc.factory_id, '') <> '' then 'id:' || v_doc.factory_id
          else 'name:' || lower(btrim(v_doc.factory_name))
        end,
        0
      )
    );

    select p.id into v_product_id
    from public.products p
    where public.fds_model_key(p.model) = v_key
      and not p.dismissed
      and case
            when coalesce(v_doc.factory_id, '') <> '' then p.factory_id = v_doc.factory_id
            else lower(btrim(coalesce(p.factories_display_name, ''))) = lower(btrim(v_doc.factory_name))
          end
    order by p.created_at
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
        dimension_l_mm, dimension_w_mm, dimension_h_mm, material, color, category,
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
                    case when jsonb_typeof(v_p -> 'colors') = 'array' then v_p -> 'colors' else '[]'::jsonb end) c), ''),
        coalesce(v_p ->> 'category', ''),
        coalesce(v_main_url, ''),
        v_images,
        round(public.fds_try_numeric(v_p ->> 'lead_time_days'))::int,
        nullif(concat_ws(E'\n',
                 nullif(v_p ->> 'series', '') ,
                 nullif(v_p ->> 'dimensions_text', '')), ''),
        'local',
        'draft',
        now(), now(), now(), v_staff, v_staff
      );
      v_created := v_created + 1;
    else
      v_linked := v_linked + 1;
    end if;

    v_currency := upper(nullif(btrim(coalesce(v_p ->> 'currency', v_doc.currency, '')), ''));
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
        currency, unit, moq, cost_price, valid_from, valid_to, verified, raw_ref, creator_staff_id
      ) values (
        v_product_id, nullif(v_doc.factory_id, ''), v_doc.factory_name, p_document_id, v_item.id, v_item.page_no,
        v_variant,
        v_currency, nullif(v_p ->> 'unit', ''), public.fds_try_numeric(v_p ->> 'moq'), v_price,
        public.fds_try_date(v_p ->> 'valid_from'), public.fds_try_date(v_p ->> 'valid_to'), true,
        jsonb_strip_nulls(jsonb_build_object('price_text', v_p ->> 'price_text', 'bbox', v_item.bbox)),
        v_staff
      )
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_prices := v_prices + v_n;
    end if;

    if jsonb_typeof(v_p -> 'other_prices') = 'array' then
      for v_other in select * from jsonb_array_elements(v_p -> 'other_prices') loop
        continue when public.fds_try_numeric(v_other ->> 'price') is null
          or btrim(coalesce(v_other ->> 'label', '')) = '';
        insert into public.supplier_prices (
          product_id, factory_id, factory_name, document_id, extraction_item_id, page_no, variant_label,
          currency, unit, moq, cost_price, valid_from, valid_to, verified, raw_ref, creator_staff_id
        ) values (
          v_product_id, nullif(v_doc.factory_id, ''), v_doc.factory_name, p_document_id, v_item.id, v_item.page_no,
          left(concat_ws(' · ', v_variant, btrim(v_other ->> 'label')), 200),
          v_currency, nullif(v_p ->> 'unit', ''), public.fds_try_numeric(v_p ->> 'moq'),
          public.fds_try_numeric(v_other ->> 'price'),
          public.fds_try_date(v_p ->> 'valid_from'), public.fds_try_date(v_p ->> 'valid_to'), true,
          jsonb_build_object('other_price', v_other), v_staff
        )
        on conflict do nothing;
        get diagnostics v_n = row_count;
        v_prices := v_prices + v_n;
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

-- ── 原文頁（不把路徑放進搜索 payload）──────────────────────────────────

create or replace function public.fds_source_page_context(
  p_document_id uuid,
  p_page_no int default null,
  p_product_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_doc public.supplier_documents%rowtype;
  v_page int;
  v_bbox jsonb;
  v_linked boolean := false;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select * into v_doc from public.supplier_documents where id = p_document_id;
  if v_doc.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;

  if p_product_id is not null then
    select r.page_no, coalesce(r.bbox, e.bbox)
      into v_page, v_bbox
    from public.product_source_refs r
    left join public.extraction_items e on e.id = r.extraction_item_id
    where r.product_id = p_product_id
      and r.document_id = p_document_id
      and (p_page_no is null or r.page_no is not distinct from p_page_no)
    order by r.created_at desc
    limit 1;
    v_linked := found;

    if not v_linked then
      select sp.page_no, sp.raw_ref -> 'bbox'
        into v_page, v_bbox
      from public.supplier_prices sp
      where sp.product_id = p_product_id
        and sp.document_id = p_document_id
        and sp.verified
        and (p_page_no is null or sp.page_no is not distinct from p_page_no)
      order by sp.created_at desc
      limit 1;
      v_linked := found;
    end if;

    if not v_linked then
      raise exception 'source_not_linked' using errcode = '42501';
    end if;
  else
    if not public.bwf_has_role(array['admin', 'uploader']) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    v_page := p_page_no;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'storage_path', v_doc.storage_path,
    'title', v_doc.title,
    'doc_type', v_doc.doc_type,
    'page_no', coalesce(v_page, p_page_no),
    'bbox', v_bbox
  ));
end;
$$;

revoke all on function public.fds_source_page_context(uuid, int, text) from public, anon;
grant execute on function public.fds_source_page_context(uuid, int, text) to authenticated;

-- 詳情：所有可搜尋的角色都能開原文頁；成本與檔案路徑仍只給 admin／uploader。
create or replace function public.fds_product_detail(p_product_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cost boolean;
  v_result jsonb;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_cost := public.bwf_has_role(array['admin', 'uploader']);

  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'model', nullif(p.model, ''),
    'sku', nullif(p.sku, ''),
    'description', nullif(p.description, ''),
    'specifications', nullif(p.specifications, ''),
    'remarks', case when v_cost then nullif(p.remarks, '') end,
    'factory_id', nullif(p.factory_id, ''),
    'factory_name', nullif(p.factories_display_name, ''),
    'dimension_l_mm', p.dimension_l_mm,
    'dimension_w_mm', p.dimension_w_mm,
    'dimension_h_mm', p.dimension_h_mm,
    'material', nullif(p.material, ''),
    'color', nullif(p.color, ''),
    'category', nullif(p.category, ''),
    'level1_category', p.level1_category,
    'level2_category', p.level2_category,
    'in_stock', p.in_stock,
    'lead_time', nullif(p.customize, ''),
    'created_at', p.created_at,
    'on_shopify', p.shopify_product_id is not null,
    'in_catalog', p.in_catalog,
    'middle_price', case when p.sale_price > 0 then round(p.sale_price * 0.8, 2) end,
    'sale_price', case when p.sale_price > 0 then p.sale_price end,
    'legacy_cost', case when v_cost then p.cost_price end,
    'can_view_cost', v_cost,
    'can_open_source', true,
    'images', (
      select coalesce(jsonb_agg(u.src order by u.ord), '[]'::jsonb)
      from (
        select distinct on (x.src) x.src, x.ord
        from (
          select p.image_url as src, 0 as ord
          union all
          select e ->> 'src', 1 + coalesce(public.fds_try_numeric(e ->> 'position'), n)
          from jsonb_array_elements(case when jsonb_typeof(p.images) = 'array' then p.images else '[]'::jsonb end)
               with ordinality as t(e, n)
          union all select p.image_url_2, 1000
          union all select p.image_url_3, 1001
          union all select p.lifestyle_image_url, 1002
        ) x
        where x.src like 'http%'
        order by x.src, x.ord
      ) u
    ),
    'prices', (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', sp.id,
        'cost', case when v_cost then sp.cost_price end,
        'currency', sp.currency,
        'unit', sp.unit,
        'moq', sp.moq,
        'variant_label', sp.variant_label,
        'factory_name', sp.factory_name,
        'valid_from', sp.valid_from,
        'valid_to', sp.valid_to,
        'validity', case
          when sp.valid_to is not null and sp.valid_to < current_date then 'expired'
          when sp.valid_from is not null and sp.valid_from > current_date then 'future'
          when sp.valid_to is null then 'unmarked'
          else 'valid'
        end,
        'page_no', sp.page_no,
        'document_id', sp.document_id,
        'document_title', d.title,
        'bbox', sp.raw_ref -> 'bbox',
        'storage_path', case when v_cost then d.storage_path end,
        'created_at', sp.created_at
      )) order by sp.created_at desc), '[]'::jsonb)
      from public.supplier_prices sp
      left join public.supplier_documents d on d.id = sp.document_id
      where sp.product_id = p.id and sp.verified
    ),
    'sources', (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'document_id', d.id,
        'title', d.title,
        'factory_name', d.factory_name,
        'doc_type', d.doc_type,
        'page_no', r.page_no,
        'bbox', coalesce(r.bbox, e.bbox),
        'storage_path', case when v_cost then d.storage_path end,
        'created_at', r.created_at
      )) order by r.created_at desc), '[]'::jsonb)
      from public.product_source_refs r
      join public.supplier_documents d on d.id = r.document_id
      left join public.extraction_items e on e.id = r.extraction_item_id
      where r.product_id = p.id
    )
  ))
  into v_result
  from public.products p
  where p.id = p_product_id;

  if v_result is null then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

-- ── 任務成本 ──────────────────────────────────────────────────────────
-- Gemini Flash 混合單價 USD 0.30 / 1M tokens。OCR 的 token 已計入 tokens；
-- 只有完全沒有 token 時才用每 OCR 頁 USD 0.002 作後備。

create or replace function public.fds_processing_job_complete(
  p_job_id uuid,
  p_result jsonb default null,
  p_document_status text default null,
  p_pages int default null,
  p_ocr_pages int default null,
  p_tokens bigint default null,
  p_cost_actual numeric default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
  v_tokens bigint;
  v_ocr int;
  v_cost numeric;
  v_items numeric;
  v_attention numeric;
  v_rate numeric;
  v_duration numeric;
begin
  select * into v_job
  from public.processing_jobs
  where id = p_job_id and status = 'running';
  if v_job.id is null then
    return false;
  end if;

  v_tokens := coalesce(p_tokens, v_job.tokens, 0);
  v_ocr := coalesce(p_ocr_pages, v_job.ocr_pages, 0);
  v_cost := round(
    v_tokens::numeric * 0.30 / 1000000
    + case when v_tokens = 0 then v_ocr::numeric * 0.002 else 0 end,
    6
  );
  v_items := coalesce(public.fds_try_numeric(p_result ->> 'items'), 0);
  v_attention := coalesce(public.fds_try_numeric(p_result ->> 'needs_attention'), 0);
  v_rate := case
    when v_items > 0 then round(1 - least(v_attention, v_items) / v_items, 4)
  end;
  v_duration := case
    when v_job.started_at is not null
      then round(extract(epoch from (clock_timestamp() - v_job.started_at))::numeric, 1)
  end;

  update public.processing_jobs
  set status = 'succeeded',
      progress = 1,
      pages = coalesce(p_pages, pages),
      ocr_pages = v_ocr,
      tokens = v_tokens,
      cost_actual = coalesce(p_cost_actual, v_cost),
      cost_estimate = coalesce(cost_estimate, coalesce(p_cost_actual, v_cost)),
      result = coalesce(p_result, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'duration_seconds', v_duration,
        'cost_usd', coalesce(p_cost_actual, v_cost),
        'success_rate', v_rate,
        'tokens', v_tokens,
        'ocr_pages', v_ocr
      )),
      error = null,
      finished_at = now(),
      heartbeat_at = now(),
      updated_at = now()
  where id = p_job_id and status = 'running'
  returning * into v_job;

  if v_job.id is null then
    return false;
  end if;

  if v_job.document_id is not null and p_document_status in ('uploaded', 'parsing', 'review', 'ready', 'failed') then
    update public.supplier_documents
    set status = p_document_status,
        page_count = coalesce(p_pages, page_count),
        error_message = null,
        modified_date = now()
    where id = v_job.document_id;
  end if;

  return true;
end;
$$;

update public.processing_jobs j
set cost_actual = round(
      coalesce(j.tokens, 0)::numeric * 0.30 / 1000000
      + case when coalesce(j.tokens, 0) = 0 then coalesce(j.ocr_pages, 0)::numeric * 0.002 else 0 end,
      6
    ),
    cost_estimate = coalesce(j.cost_estimate, round(
      coalesce(j.tokens, 0)::numeric * 0.30 / 1000000
      + case when coalesce(j.tokens, 0) = 0 then coalesce(j.ocr_pages, 0)::numeric * 0.002 else 0 end,
      6
    )),
    result = coalesce(j.result, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'cost_usd', round(
        coalesce(j.tokens, 0)::numeric * 0.30 / 1000000
        + case when coalesce(j.tokens, 0) = 0 then coalesce(j.ocr_pages, 0)::numeric * 0.002 else 0 end,
        6
      ),
      'duration_seconds', case
        when j.started_at is not null and j.finished_at is not null
          then round(extract(epoch from (j.finished_at - j.started_at))::numeric, 1)
      end,
      'success_rate', case
        when coalesce(public.fds_try_numeric(j.result ->> 'items'), 0) > 0 then round(
          1 - least(
            coalesce(public.fds_try_numeric(j.result ->> 'needs_attention'), 0),
            public.fds_try_numeric(j.result ->> 'items')
          ) / public.fds_try_numeric(j.result ->> 'items'),
          4
        )
      end,
      'tokens', j.tokens,
      'ocr_pages', j.ocr_pages
    ))
where j.status = 'succeeded' and j.cost_actual is null;

notify pgrst, 'reload schema';
