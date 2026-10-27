-- FDS 2.2：沒有待審標記的提取項在解析完成後自動入庫。
-- 不另定置信度數字。needs_attention 與阻擋旗標仍進人工。數字門檻等真實文件再定。

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
                    case when jsonb_typeof(v_p -> 'colors') = 'array' then v_p -> 'colors' else '[]'::jsonb end) c
                  where c ~ '^[A-Za-z]+$'), ''),
        coalesce(v_p ->> 'category', ''),
        coalesce(v_main_url, ''),
        v_images,
        round(public.fds_try_numeric(v_p ->> 'lead_time_days'))::int,
        nullif(concat_ws(E'\n',
                 nullif(v_p ->> 'series', '') ,
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

create or replace function public.fds_auto_import_clear_extractions(
  p_document_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approved int := 0;
  v_import jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  update public.extraction_items e
  set status = 'approved',
      review_note = coalesce(e.review_note, 'auto_imported'),
      reviewed_at = now(),
      updated_at = now()
  where e.document_id = p_document_id
    and e.status = 'pending'
    and e.needs_attention = false
    and e.imported_product_id is null
    and nullif(btrim(coalesce(e.corrected_json ->> 'model', e.raw_json ->> 'model', '')), '') is not null
    and not (e.flags && array[
      'missing_model', 'missing_price', 'price_not_in_source', 'price_year_conflict',
      'color_unmapped', 'low_confidence', 'dimension_suspicious', 'currency_missing'
    ]::text[]);
  get diagnostics v_approved = row_count;

  perform set_config('fds.import_actor', 'worker', true);
  v_import := public.fds_import_extracted_products(p_document_id);

  return v_import || jsonb_build_object('auto_approved', v_approved);
end;
$$;

revoke all on function public.fds_auto_import_clear_extractions(uuid) from public, anon, authenticated;
grant execute on function public.fds_auto_import_clear_extractions(uuid) to service_role;

notify pgrst, 'reload schema';
