-- FDS-26 評分全面校正：
-- 1. 新增 missing_dimension（長／寬／高任一缺失）規則，並納入 fds_auto_import_clear_extractions 硬門檻。
-- 2. 將任何已入庫但無價格、無圖片或尺寸缺失的項目（含 26RX-Q11）一併退回 pending（needs_attention = true）。
-- 3. 對全庫現存所有缺價格、缺圖片或尺寸缺失的 extraction_items 重新校正 confidence (<= 0.6) 與 flags。

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
    and e.main_image_id is not null
    and nullif(btrim(coalesce(e.corrected_json ->> 'model', e.raw_json ->> 'model', '')), '') is not null
    and coalesce(public.fds_try_numeric(coalesce(e.corrected_json ->> 'price', e.raw_json ->> 'price')), 0) > 0
    and coalesce(public.fds_try_numeric(coalesce(e.corrected_json ->> 'width_mm', e.raw_json ->> 'width_mm')), 0) between 50 and 6000
    and coalesce(public.fds_try_numeric(coalesce(e.corrected_json ->> 'depth_mm', e.raw_json ->> 'depth_mm')), 0) between 50 and 6000
    and coalesce(public.fds_try_numeric(coalesce(e.corrected_json ->> 'height_mm', e.raw_json ->> 'height_mm')), 0) between 50 and 6000
    and not (e.flags && array[
      'missing_model', 'missing_price', 'catalog_no_price', 'missing_image',
      'missing_dimension', 'dimension_suspicious',
      'price_not_in_source', 'price_from_image', 'price_year_conflict',
      'color_unmapped', 'low_confidence', 'currency_missing', 'ai_uncertain'
    ]::text[]);
  get diagnostics v_approved = row_count;

  perform set_config('fds.import_actor', 'worker', true);
  v_import := public.fds_import_extracted_products(p_document_id);

  return v_import || jsonb_build_object('auto_approved', v_approved);
end;
$$;

revoke all on function public.fds_auto_import_clear_extractions(uuid) from public, anon, authenticated;
grant execute on function public.fds_auto_import_clear_extractions(uuid) to service_role;

-- ── 1. 退回所有缺價格、缺圖片或缺尺寸但處於 approved/已匯入的提取項（含 26RX-Q11） ──

do $reassess$
declare
  v_item_ids uuid[];
  v_product_ids text[];
  v_doc_ids uuid[];
begin
  select
    array_agg(e.id),
    array_agg(distinct e.imported_product_id) filter (where e.imported_product_id is not null),
    array_agg(distinct e.document_id)
  into v_item_ids, v_product_ids, v_doc_ids
  from public.extraction_items e
  where (e.status = 'approved' or e.imported_product_id is not null)
    and (
      e.main_image_id is null
      or coalesce(public.fds_try_numeric(coalesce(e.corrected_json ->> 'price', e.raw_json ->> 'price')), 0) <= 0
      or public.fds_try_numeric(coalesce(e.corrected_json ->> 'width_mm', e.raw_json ->> 'width_mm')) is null
      or public.fds_try_numeric(coalesce(e.corrected_json ->> 'depth_mm', e.raw_json ->> 'depth_mm')) is null
      or public.fds_try_numeric(coalesce(e.corrected_json ->> 'height_mm', e.raw_json ->> 'height_mm')) is null
    );

  if coalesce(array_length(v_item_ids, 1), 0) > 0 then
    delete from public.product_source_refs where extraction_item_id = any(v_item_ids);
    delete from public.supplier_prices where extraction_item_id = any(v_item_ids);

    update public.extraction_items e
    set status = 'pending',
        needs_attention = true,
        review_note = null,
        reviewed_by = null,
        reviewed_at = null,
        imported_product_id = null,
        updated_at = now()
    where e.id = any(v_item_ids);

    if coalesce(array_length(v_product_ids, 1), 0) > 0 then
      delete from public.products p
      where p.id = any(v_product_ids)
        and p.status in ('auto_imported', 'draft')
        and not exists (select 1 from public.extraction_items e2 where e2.imported_product_id = p.id)
        and not exists (select 1 from public.supplier_prices sp where sp.product_id = p.id)
        and not exists (select 1 from public.bwf_quote_item qi where qi.product_id = p.id);
    end if;

    if coalesce(array_length(v_doc_ids, 1), 0) > 0 then
      update public.supplier_documents d
      set status = 'review', modified_date = now()
      where d.id = any(v_doc_ids) and d.status = 'ready';
    end if;
  end if;

  -- ── 2. 全庫重算所有缺價格、缺圖片、缺尺寸或缺型號項目的 confidence (<= 0.6) 與 flags ──
  update public.extraction_items e
  set confidence = least(coalesce(e.confidence, 0.6), 0.6),
      needs_attention = true,
      flags = (
        select array_agg(distinct f)
        from unnest(
          coalesce(e.flags, '{}'::text[])
          || case when e.main_image_id is null then array['missing_image'] else '{}'::text[] end
          || case
               when coalesce(public.fds_try_numeric(coalesce(e.corrected_json ->> 'price', e.raw_json ->> 'price')), 0) <= 0
                    and not (coalesce(e.flags, '{}'::text[]) && array['missing_price', 'catalog_no_price']::text[])
                 then array['missing_price']
               else '{}'::text[]
             end
          || case
               when public.fds_try_numeric(coalesce(e.corrected_json ->> 'width_mm', e.raw_json ->> 'width_mm')) is null
                 or public.fds_try_numeric(coalesce(e.corrected_json ->> 'depth_mm', e.raw_json ->> 'depth_mm')) is null
                 or public.fds_try_numeric(coalesce(e.corrected_json ->> 'height_mm', e.raw_json ->> 'height_mm')) is null
                 then array['missing_dimension']
               else '{}'::text[]
             end
          || array['low_confidence']
        ) as f
      ),
      updated_at = now()
  where e.main_image_id is null
     or coalesce(public.fds_try_numeric(coalesce(e.corrected_json ->> 'price', e.raw_json ->> 'price')), 0) <= 0
     or public.fds_try_numeric(coalesce(e.corrected_json ->> 'width_mm', e.raw_json ->> 'width_mm')) is null
     or public.fds_try_numeric(coalesce(e.corrected_json ->> 'depth_mm', e.raw_json ->> 'depth_mm')) is null
     or public.fds_try_numeric(coalesce(e.corrected_json ->> 'height_mm', e.raw_json ->> 'height_mm')) is null
     or nullif(btrim(coalesce(e.corrected_json ->> 'model', e.raw_json ->> 'model', '')), '') is null;
end
$reassess$;

notify pgrst, 'reload schema';
