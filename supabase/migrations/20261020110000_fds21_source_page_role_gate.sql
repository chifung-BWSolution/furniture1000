-- 私有原文只限 admin / uploader（C-04 角色表 §13：查看原始 PDF（私有）pm／designer ❌）。
--
-- 問題：fds_source_page_context 原本讓 pm／designer 也能取得 storage_path，
-- edge function 再用 service role 簽整份 PDF 的 URL。畫面雖然只畫某一頁，
-- 但簽名 URL 指向整份檔案，下載後可看到全部頁面與供應商成本，等於繞過成本遮蔽。
--
-- 修正：
--   1. fds_source_page_context 一律只接受 admin / uploader（伺服器端擋，不靠前端）。
--   2. fds_product_detail / fds_search_products 回傳 can_open_source，
--      前端據此隱藏「開原文」入口（不開 offer 的按鈕）。

-- ── 原文頁：只給 admin / uploader ─────────────────────────────────────

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
  -- 私有來源文件只有 admin / uploader 可開；pm / designer 不得取得任何簽名 URL。
  if not public.bwf_has_role(array['admin', 'uploader']) then
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

-- ── 詳情：can_open_source 依角色 ──────────────────────────────────────

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
    -- 私有原文只限 admin / uploader；pm / designer 拿不到檔案路徑。
    'can_open_source', v_cost,
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

revoke all on function public.fds_product_detail(text) from public, anon;
grant execute on function public.fds_product_detail(text) to authenticated;

-- ── 搜索結果：附 can_open_source ──────────────────────────────────────

create or replace function public.fds_search_products(
  p_query text default null,
  p_factory text default null,
  p_level1 text default null,
  p_level2 text default null,
  p_colors text[] default null,
  p_materials text[] default null,
  p_price_min numeric default null,
  p_price_max numeric default null,
  p_l_min numeric default null,
  p_l_max numeric default null,
  p_w_min numeric default null,
  p_w_max numeric default null,
  p_h_min numeric default null,
  p_h_max numeric default null,
  p_in_stock boolean default null,
  p_scope text default 'all',
  p_sort text default 'relevance',
  p_limit int default 24,
  p_offset int default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cost boolean;
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_terms text[];
  v_key text;
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_colors text[];
  v_materials text[];
  v_result jsonb;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_cost := public.bwf_has_role(array['admin', 'uploader']);
  v_terms := case when v_q = '' then '{}'::text[] else regexp_split_to_array(v_q, '\s+') end;
  v_key := public.fds_model_key(v_q);
  v_colors := public.fds_expand_color_terms(p_colors);
  v_materials := array(select lower(btrim(m)) from unnest(coalesce(p_materials, '{}')) m where btrim(m) <> '');

  with base as (
    select p.id, p.title, p.model, p.sku, p.product_sku, p.image_url, p.image_url_2, p.image_url_3,
           p.lifestyle_image_url, p.factory_id, p.factories_display_name,
           p.dimension_l_mm, p.dimension_w_mm, p.dimension_h_mm, p.material, p.color, p.category,
           p.level1_category, p.level2_category, p.in_stock, p.customize, p.created_at,
           p.shopify_product_id, p.in_catalog, p.sale_price, p.cost_price,
           public.fds_product_haystack(p.title, p.model, p.sku, p.factories_display_name, p.color, p.material,
                                        p.category, p.level1_category, p.level2_category) as hay
    from public.products p
    where not p.dismissed
      and (p_factory is null or p.factories_display_name = p_factory)
      and (p_level1 is null or p.level1_category = p_level1)
      and (p_level2 is null or p.level2_category = p_level2)
      and (p_in_stock is not true or p.in_stock is true)
      and (cardinality(v_colors) = 0 or exists (
            select 1 from unnest(v_colors) c where lower(coalesce(p.color, '')) like '%' || public.fds_like_escape(c) || '%'))
      and (cardinality(v_materials) = 0 or exists (
            select 1 from unnest(v_materials) m where lower(coalesce(p.material, '')) like '%' || public.fds_like_escape(m) || '%'))
      and (p_l_min is null or p.dimension_l_mm >= p_l_min)
      and (p_l_max is null or p.dimension_l_mm <= p_l_max)
      and (p_w_min is null or p.dimension_w_mm >= p_w_min)
      and (p_w_max is null or p.dimension_w_mm <= p_w_max)
      and (p_h_min is null or p.dimension_h_mm >= p_h_min)
      and (p_h_max is null or p.dimension_h_mm <= p_h_max)
      and case coalesce(p_scope, 'all')
            when 'catalog' then p.in_catalog
            when 'shopify' then p.shopify_product_id is not null
            when 'quoted' then exists (select 1 from public.supplier_prices sp where sp.product_id = p.id and sp.verified)
            else true
          end
  ),
  matched as (
    select b.*
    from base b
    where not exists (
      select 1 from unnest(v_terms) t
      where not (
        b.hay like '%' || public.fds_like_escape(t) || '%'
        or (public.fds_model_key(t) is not null and b.hay like '%' || public.fds_like_escape(public.fds_model_key(t)) || '%')
      )
    )
  ),
  priced as (
    select m.*,
           cur.id as price_id, cur.cost_price as quote_cost, cur.currency, cur.unit, cur.moq,
           cur.valid_from, cur.valid_to, cur.variant_label, cur.factory_name as quote_factory,
           (select count(*) from public.supplier_prices sp2 where sp2.product_id = m.id and sp2.verified) as quote_count,
           case when m.sale_price > 0 then round(m.sale_price * 0.8, 2) end as middle_price,
           case
             when v_key is not null and (public.fds_model_key(m.model) = v_key
                                         or public.fds_model_key(m.sku) = v_key
                                         or public.fds_model_key(m.product_sku) = v_key) then 0
             when v_key is not null and public.fds_model_key(m.model) like public.fds_like_escape(v_key) || '%' then 1
             when v_q <> '' and lower(m.title) like public.fds_like_escape(v_q) || '%' then 2
             else 3
           end as rank,
           case when v_q = '' then 0 else public.similarity(m.hay, v_q) end as sim
    from matched m
    left join lateral (
      select sp.*
      from public.supplier_prices sp
      where sp.product_id = m.id and sp.verified
      order by (sp.variant_label is null) desc, sp.created_at desc
      limit 1
    ) cur on true
  ),
  shown as (
    select pr.*,
           pr.middle_price as display_price
    from priced pr
  ),
  filtered as (
    select s.*, count(*) over () as total
    from shown s
    where (p_price_min is null or s.display_price >= p_price_min)
      and (p_price_max is null or s.display_price <= p_price_max)
  ),
  page as (
    select f.*
    from filtered f
    order by
      case when coalesce(p_sort, 'relevance') = 'relevance' then f.rank end,
      case when coalesce(p_sort, 'relevance') = 'relevance' then (f.in_stock is true) end desc,
      case when coalesce(p_sort, 'relevance') = 'relevance' then f.sim end desc,
      case when p_sort = 'price_asc' then f.display_price end asc nulls last,
      case when p_sort = 'price_desc' then f.display_price end desc nulls last,
      case when p_sort = 'size' then f.dimension_l_mm end asc nulls last,
      f.created_at desc,
      f.id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', coalesce((select max(total) from filtered), 0),
    'can_view_cost', false,
    -- 私有原文只限 admin / uploader（cost 角色）。
    'can_open_source', v_cost,
    'items', coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', pg.id,
        'title', pg.title,
        'model', nullif(pg.model, ''),
        'sku', nullif(pg.sku, ''),
        'image_url', nullif(pg.image_url, ''),
        'image_urls', (
          select coalesce(jsonb_agg(u order by ord), '[]'::jsonb)
          from (
            select t.u, t.ord
            from unnest(array[
              nullif(btrim(pg.image_url), ''),
              nullif(btrim(pg.image_url_2), ''),
              nullif(btrim(pg.image_url_3), ''),
              nullif(btrim(pg.lifestyle_image_url), '')
            ]) with ordinality as t(u, ord)
            where t.u ~* '^https?://'
          ) urls
        ),
        'factory_id', nullif(pg.factory_id, ''),
        'factory_name', nullif(pg.factories_display_name, ''),
        'dimension_l_mm', pg.dimension_l_mm,
        'dimension_w_mm', pg.dimension_w_mm,
        'dimension_h_mm', pg.dimension_h_mm,
        'material', nullif(pg.material, ''),
        'color', nullif(pg.color, ''),
        'category', nullif(pg.category, ''),
        'level1_category', pg.level1_category,
        'level2_category', pg.level2_category,
        'in_stock', pg.in_stock,
        'lead_time', nullif(pg.customize, ''),
        'created_at', pg.created_at,
        'on_shopify', pg.shopify_product_id is not null,
        'in_catalog', pg.in_catalog,
        'middle_price', pg.middle_price,
        'sale_price', case when pg.sale_price > 0 then pg.sale_price end,
        'legacy_cost', null,
        'exact', pg.rank = 0,
        'quote', case when pg.price_id is not null then jsonb_strip_nulls(jsonb_build_object(
          'cost', null,
          'currency', pg.currency,
          'unit', pg.unit,
          'moq', pg.moq,
          'variant_label', pg.variant_label,
          'factory_name', pg.quote_factory,
          'valid_from', pg.valid_from,
          'valid_to', pg.valid_to,
          'validity', case
            when pg.valid_to is not null and pg.valid_to < current_date then 'expired'
            when pg.valid_from is not null and pg.valid_from > current_date then 'future'
            when pg.valid_to is null then 'unmarked'
            else 'valid'
          end,
          'count', pg.quote_count
        )) end,
        'source', (
          select jsonb_build_object('document_id', d.id, 'title', d.title, 'page_no', r.page_no, 'doc_type', d.doc_type)
          from public.product_source_refs r
          join public.supplier_documents d on d.id = r.document_id
          where r.product_id = pg.id
          order by r.created_at desc
          limit 1
        )
      ))
      order by
        case when coalesce(p_sort, 'relevance') = 'relevance' then pg.rank end,
        case when coalesce(p_sort, 'relevance') = 'relevance' then (pg.in_stock is true) end desc,
        case when coalesce(p_sort, 'relevance') = 'relevance' then pg.sim end desc,
        case when p_sort = 'price_asc' then pg.display_price end asc nulls last,
        case when p_sort = 'price_desc' then pg.display_price end desc nulls last,
        case when p_sort = 'size' then pg.dimension_l_mm end asc nulls last,
        pg.created_at desc,
        pg.id
    ), '[]'::jsonb)
  )
  into v_result
  from page pg;

  return v_result;
end;
$$;

revoke all on function public.fds_search_products(text, text, text, text, text[], text[], numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, boolean, text, text, int, int) from public, anon;
grant execute on function public.fds_search_products(text, text, text, text, text[], text[], numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, boolean, text, text, int, int) to authenticated;

notify pgrst, 'reload schema';
