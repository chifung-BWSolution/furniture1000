-- FDS-26 評分與自動入庫硬門檻修正：
-- 1. fds_auto_import_clear_extractions 必須同時具備：
--    - 型號（model 非空）
--    - 產品圖（main_image_id is not null）
--    - 成本價（price > 0）
--    - 無阻擋旗標（含 missing_image / catalog_no_price / price_from_image / ai_uncertain）
-- 2. 復原既有透過 auto_imported 自動入庫但缺少產品圖或缺少成本價的項目，
--    退回 pending（needs_attention = true），並安全移除僅由這批自動入庫新建、未被報價單引用的 products 列。

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
    and not (e.flags && array[
      'missing_model', 'missing_price', 'catalog_no_price', 'missing_image',
      'price_not_in_source', 'price_from_image', 'price_year_conflict',
      'color_unmapped', 'low_confidence', 'dimension_suspicious', 'currency_missing',
      'ai_uncertain'
    ]::text[]);
  get diagnostics v_approved = row_count;

  perform set_config('fds.import_actor', 'worker', true);
  v_import := public.fds_import_extracted_products(p_document_id);

  return v_import || jsonb_build_object('auto_approved', v_approved);
end;
$$;

revoke all on function public.fds_auto_import_clear_extractions(uuid) from public, anon, authenticated;
grant execute on function public.fds_auto_import_clear_extractions(uuid) to service_role;

-- ── 復原既有缺圖或缺價的自動入庫資料 ────────────────────────────────────

do $revert$
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
  where e.review_note = 'auto_imported'
    and e.status = 'approved'
    and (
      e.main_image_id is null
      or coalesce(public.fds_try_numeric(coalesce(e.corrected_json ->> 'price', e.raw_json ->> 'price')), 0) <= 0
    );

  if coalesce(array_length(v_item_ids, 1), 0) = 0 then
    return;
  end if;

  -- 移除這批自動入庫項目產生的來源關聯與報價記錄
  delete from public.product_source_refs
  where extraction_item_id = any(v_item_ids);

  delete from public.supplier_prices
  where extraction_item_id = any(v_item_ids);

  -- 退回 extraction_items 為 pending，補齊缺少圖片／價格旗標並壓低信心度
  update public.extraction_items e
  set status = 'pending',
      needs_attention = true,
      review_note = null,
      reviewed_at = null,
      imported_product_id = null,
      confidence = least(coalesce(e.confidence, 0.6), 0.6),
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
        ) as f
      ),
      updated_at = now()
  where e.id = any(v_item_ids);

  -- 僅移除由這批自動入庫建立（status='auto_imported'）且未被報價單或其他項目引用的產品
  if coalesce(array_length(v_product_ids, 1), 0) > 0 then
    delete from public.products p
    where p.id = any(v_product_ids)
      and p.status = 'auto_imported'
      and not exists (select 1 from public.extraction_items e2 where e2.imported_product_id = p.id)
      and not exists (select 1 from public.supplier_prices sp where sp.product_id = p.id)
      and not exists (select 1 from public.bwf_quote_item qi where qi.product_id = p.id);
  end if;

  -- 有待審項目的文件退回 review
  if coalesce(array_length(v_doc_ids, 1), 0) > 0 then
    update public.supplier_documents d
    set status = 'review',
        modified_date = now()
    where d.id = any(v_doc_ids)
      and d.status = 'ready'
      and exists (
        select 1 from public.extraction_items e
        where e.document_id = d.id and e.status = 'pending'
      );
  end if;
end
$revert$;

notify pgrst, 'reload schema';
