-- 客戶報價 Portal：PDF 預覽改用報價單編輯器同一套 QuotationPDFPreviewModal。
--
-- 客戶／分享連結拿到的 bwf_customer_quote_json 是刻意裁過的安全子集（沒有
-- companyInfo / quoteMeta / 圖片排版 / 封面封底 / 內頁 / 圖冊附件），所以前端
-- 無法自行砌回 QuotationPDFData。這裡新增一支 SECURITY DEFINER RPC，一次回傳
-- 「已裁成客戶安全版本」的 PDF payload：
--   * 公司資訊、客戶資訊、報價日期／版本／交付地址
--   * PDF 格式（分區小計位置、QR 標題）與圖片庫封面／封底／內頁
--   * 報價圖片排版快照、分區圖片、交付／條款、安裝費、折扣
--   * 正式報價明細（不含 cost / exchange rate / GP / multiplier）
--
-- 圖冊附件只回傳給 staff（quote-catalog-pages edge function 只准 staff 抽頁），
-- 客戶端不會因為 403 而令整份預覽失敗。

create or replace function public.bwf_quote_pdf_payload(p_quote_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.bwf_quote%rowtype;
  pd jsonb;
  form jsonb;
  info jsonb;
  company jsonb;
  meta jsonb;
  terms jsonb;
  v_format jsonb;
  v_cover_pages jsonb := '[]'::jsonb;
  v_content_pages jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_catalog_pages jsonb := '[]'::jsonb;
  v_show_address boolean := true;
begin
  select *
    into q
  from public.bwf_quote
  where id = p_quote_id
    and status is distinct from '回收桶';

  if not found then
    return null;
  end if;

  pd := case when jsonb_typeof(q.project_data) = 'object' then q.project_data else '{}'::jsonb end;
  form := case when jsonb_typeof(pd -> 'formData') = 'object' then pd -> 'formData' else '{}'::jsonb end;
  info := case when jsonb_typeof(pd -> 'clientInfo') = 'object' then pd -> 'clientInfo' else '{}'::jsonb end;
  company := case when jsonb_typeof(pd -> 'companyInfo') = 'object' then pd -> 'companyInfo' else '{}'::jsonb end;
  meta := case when jsonb_typeof(pd -> 'quoteMeta') = 'object' then pd -> 'quoteMeta' else '{}'::jsonb end;
  terms := public.bwf_customer_terms(coalesce(pd -> 'termsContent', to_jsonb(q.terms_content)));

  -- 舊報價沒有這個欄位：預設顯示地址，只有明確 false 才隱藏。
  v_show_address := coalesce(
    not (
      company -> 'showAddressInPdf' = 'false'::jsonb
      or company ->> 'showAddressInPdf' = 'false'
    ),
    true
  );

  if to_regclass('public.quote_format_settings') is not null then
    select jsonb_build_object(
        'zoneSubtotalPlacement', coalesce(nullif(btrim(zone_subtotal_placement), ''), 'section_and_summary'),
        'qrCaption', coalesce(nullif(btrim(qr_caption), ''), '線上選擇／修改產品')
      )
      into v_format
    from public.quote_format_settings
    where id = true;
  end if;

  if v_format is null then
    v_format := jsonb_build_object(
      'zoneSubtotalPlacement', 'section_and_summary',
      'qrCaption', '線上選擇／修改產品'
    );
  end if;

  if to_regclass('public.quote_photo_assets') is not null then
    select coalesce(jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'id', a.id,
          'title', coalesce(nullif(btrim(a.title), ''), '圖片'),
          'placement', a.placement,
          'objectPath', a.object_path
        ))
        order by case a.placement when 'cover' then 0 else 1 end, a.sort_order, a.created_at
      ), '[]'::jsonb)
      into v_cover_pages
    from public.quote_photo_assets a
    where a.is_active is true
      and a.placement in ('cover', 'back')
      and a.object_path is not null
      and btrim(a.object_path) <> '';

    select coalesce(jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'id', a.id,
          'title', coalesce(nullif(btrim(a.title), ''), '圖片'),
          'objectPath', a.object_path,
          'pageNumber', greatest(1, coalesce(a.page_number, 1))
        ))
        order by coalesce(a.page_number, 1), a.sort_order, a.created_at
      ), '[]'::jsonb)
      into v_content_pages
    from public.quote_photo_assets a
    where a.is_active is true
      and a.placement = 'content'
      and a.object_path is not null
      and btrim(a.object_path) <> '';
  end if;

  -- 圖冊頁由 staff-only edge function 抽取，客戶端不送回，否則預覽會 403。
  if public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    v_catalog_pages := case
      when jsonb_typeof(pd -> 'catalogPageAttachments') = 'array' then pd -> 'catalogPageAttachments'
      else '[]'::jsonb
    end;
  end if;

  select coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', coalesce(it.client_item_id, it.id::text),
        'quote_uuid', it.quote_uuid,
        'sort_order', it.sort_order,
        'name', it.name,
        'image', it.image,
        'reference_image', it.reference_image,
        'remarks_image', it.remarks_image,
        'unit_price', it.unit_price,
        'quantity', it.quantity,
        'unit', it.unit,
        'category', it.category,
        'material', it.material,
        'color', it.color,
        'remarks', it.remarks,
        'dimension_l_mm', it.dimension_l_mm,
        'dimension_w_mm', it.dimension_w_mm,
        'dimension_h_mm', it.dimension_h_mm,
        'dimension_mode', it.dimension_mode,
        'delivery_term_name', it.delivery_term_name,
        'factory_name', it.factory_name,
        'factory_from_catalog', it.factory_from_catalog,
        'is_custom_term', it.is_custom_term,
        'is_optional', it.is_optional,
        'hide_in_pdf', it.hide_in_pdf,
        'is_section_title', it.is_section_title,
        'product_id', it.product_id,
        'product_category_id', it.product_category_id
      ))
      order by it.sort_order, it.created_at
    ), '[]'::jsonb)
    into v_items
  from public.bwf_quote_item it
  where it.quote_uuid = q.id;

  return jsonb_build_object(
    'quote', jsonb_build_object(
      'id', q.id,
      'quote_id', q.quote_id,
      'version', q.version,
      'status', q.status,
      'total_amount', q.total_amount,
      'created_at', q.created_at,
      'modified_date', q.modified_date
    ),
    'companyInfo', jsonb_build_object(
      'name', left(coalesce(company ->> 'name', ''), 200),
      'address', left(coalesce(company ->> 'address', ''), 500),
      'showAddressInPdf', v_show_address,
      'phone', left(coalesce(company ->> 'phone', ''), 80),
      'email', left(coalesce(company ->> 'email', ''), 200),
      'website', left(coalesce(company ->> 'website', ''), 300)
    ),
    'clientInfo', jsonb_build_object(
      'name', left(coalesce(info ->> 'name', form ->> 'clientName', ''), 200),
      'contactName', left(coalesce(info ->> 'contactName', form ->> 'clientContactName', ''), 200),
      'phone', left(coalesce(info ->> 'phone', form ->> 'clientPhone', ''), 80),
      'email', left(coalesce(info ->> 'email', form ->> 'clientEmail', ''), 200)
    ),
    'formData', jsonb_build_object(
      'clientName', left(coalesce(form ->> 'clientName', ''), 200),
      'projectManager', left(coalesce(form ->> 'projectManager', ''), 120),
      'validityDays', left(coalesce(form ->> 'validityDays', ''), 40)
    ),
    'quoteMeta', jsonb_build_object(
      'pmName', left(coalesce(meta ->> 'pmName', form ->> 'projectManager', ''), 120),
      'validity', left(coalesce(meta ->> 'validity', form ->> 'validityDays', ''), 40),
      'deliveryAddress', left(coalesce(meta ->> 'deliveryAddress', ''), 500),
      'date', left(coalesce(meta ->> 'date', ''), 40)
    ),
    'format', v_format,
    'deliveryDetails', left(coalesce(pd ->> 'deliveryDetails', ''), 8000),
    'termsContent', coalesce(terms, '{}'::jsonb),
    'quotePhotoLayouts', case
      when jsonb_typeof(pd -> 'quotePhotoLayouts') = 'array' then pd -> 'quotePhotoLayouts'
      else '[]'::jsonb
    end,
    'quotePhotoAssets', case
      when jsonb_typeof(pd -> 'quotePhotoAssets') = 'array' then pd -> 'quotePhotoAssets'
      else '[]'::jsonb
    end,
    'zoneImages', case
      when jsonb_typeof(pd -> 'zoneImages') = 'object' then pd -> 'zoneImages'
      else '{}'::jsonb
    end,
    'zonePhotoLayouts', case
      when jsonb_typeof(pd -> 'zonePhotoLayouts') = 'object' then pd -> 'zonePhotoLayouts'
      else '{}'::jsonb
    end,
    'installationFee', case
      when jsonb_typeof(pd -> 'installationFee') = 'object' then pd -> 'installationFee'
      else null
    end,
    'discountNote', case
      when pd ? 'discountNote' then left(pd ->> 'discountNote', 500)
      else null
    end,
    'coverPages', v_cover_pages,
    'contentPages', v_content_pages,
    'catalogPages', v_catalog_pages,
    'items', v_items
  );
end;
$$;

create or replace function public.get_quote_pdf_payload(
  p_quote_id uuid,
  p_token text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quote uuid;
begin
  if p_token is not null and btrim(p_token) <> '' then
    v_quote := public.bwf_active_share_quote(p_token);
    if v_quote is null then
      raise exception 'invalid_token' using errcode = '42501';
    end if;
  else
    if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer', 'staff', 'client']) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    v_quote := p_quote_id;
  end if;

  if v_quote is null then
    return null;
  end if;

  return public.bwf_quote_pdf_payload(v_quote);
end;
$$;

revoke all on function public.bwf_quote_pdf_payload(uuid) from public;
revoke all on function public.bwf_quote_pdf_payload(uuid) from anon, authenticated;
grant execute on function public.bwf_quote_pdf_payload(uuid) to service_role, postgres;

revoke all on function public.get_quote_pdf_payload(uuid, text) from public;
grant execute on function public.get_quote_pdf_payload(uuid, text) to anon, authenticated;
