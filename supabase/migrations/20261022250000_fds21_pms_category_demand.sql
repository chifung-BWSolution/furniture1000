-- 常用傢俬第二層排序：PMS 真實落單的「類別熱度」。
--
-- 為什麼只有類別層級：PMS 記的是項目用的通用產品類型（同事椅 1,890 件、Staff Workstation 同事枱 1,482…，
-- 共 105 個 bwf_products / 30 個 product_types），Furniture 目錄是型號級貨品（5,289 件）。
-- 兩邊在「產品」層級沒有共同 ID／SKU，名稱比對（正規化／前綴／中文包含）實測 0 命中，
-- 且 PMS bwf_products 只有 display 一個可用欄位（bubble_id／slug 全 NULL，沒有 SKU）。
-- 能對上的只有「類別」：PMS product_types ↔ FDS products.level1_category。
--
-- 資料流：edge function supabase-functions-pms-category-demand 讀 PMS 各 product_types 的落單量，
-- 只把聚合（30 列）寫進 fds_pms_category_demand；FDS 這邊不存 PMS 明細。
-- 對照表 fds_pms_category_map（PMS type → FDS level1 + 權重）可經 admin RPC 改，不用改程式。
-- 常用傢俬排序＝popular_demand：類別熱度 → 類內報價用量。

-- ── 表 ────────────────────────────────────────────────────────────────

create table if not exists public.fds_pms_category_demand (
  pms_type text primary key,
  demand_qty integer not null default 0,
  order_lines integer not null default 0,
  distinct_products integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.fds_pms_category_demand is
  'PMS 各 product_types 的落單聚合（只存聚合，不存 PMS 明細）。由 edge function supabase-functions-pms-category-demand 更新。';

create table if not exists public.fds_pms_category_map (
  pms_type text not null,
  fds_level1 text not null,
  weight numeric not null default 1,
  note text,
  primary key (pms_type, fds_level1)
);

comment on table public.fds_pms_category_map is
  'PMS product_types.display → FDS products.level1_category 對照。level1 = ''(未分類)'' 對應 level1_category 為 null 的產品。';

alter table public.fds_pms_category_demand enable row level security;
alter table public.fds_pms_category_map enable row level security;
revoke all on public.fds_pms_category_demand from public, anon, authenticated;
revoke all on public.fds_pms_category_map from public, anon, authenticated;
grant all on public.fds_pms_category_demand to service_role;
grant all on public.fds_pms_category_map to service_role;

-- ── 對照表（人工維護；改用 admin RPC 也可以）────────────────────────
-- PMS 名＝product_types.display（2026-10-22 實測值）；FDS 名＝products.level1_category。
-- 一個 PMS type 可對多個 FDS level1，用 weight 分攤（同一個 type 兩邊相加＝1）。

insert into public.fds_pms_category_map (pms_type, fds_level1, weight, note) values
  ('Desk 工作枱', '辦公枱', 1, null),
  ('Chair 工作椅', '辦公椅', 1, null),
  ('Storage 儲物', '儲物櫃', 1, null),
  ('Restaurant 餐廳', '餐飲家具', 0.6, '餐廳同時有枱與椅'),
  ('Restaurant 餐廳', '休閑家具', 0.4, null),
  ('Accessories 五金', '(未分類)', 1, 'FDS 沒有五金類，只能落在未分類'),
  ('Boss 老闆房', '辦公枱', 0.5, '老闆枱 + 大班椅各半'),
  ('Boss 老闆房', '辦公椅', 0.5, null),
  ('School Kids 幼稚園', '學校家具', 1, null),
  ('Medical 醫療', '(未分類)', 1, 'FDS 沒有醫療類（醫療床/醫療櫃 0 件）'),
  ('辦公椅', '辦公椅', 1, null),
  ('學校家具', '學校家具', 1, null),
  ('儲物櫃', '儲物櫃', 1, null),
  ('Others 其他', '(未分類)', 1, '歸入未分類'),
  ('Decor 軟裝', '(未分類)', 1, '歸入未分類'),
  ('Sofa 梳化', 'Sofa 梳化', 1, 'PMS 有兩個同名 type，edge function 依名稱相加'),
  ('休閑家具', '休閑家具', 1, null),
  ('Outdoor 戶外', '休閑家具', 1, null),
  ('Phone Booth 靜音倉', '會客區、接待區', 1, null),
  ('Reception 接待處', '會客區、接待區', 1, null),
  ('辦公枱', '辦公枱', 1, null),
  ('餐飲家具', '餐飲家具', 1, null),
  ('會客區、接待區', '會客區、接待區', 1, null),
  ('Meeting 會議', '辦公枱', 1, null),
  ('School 學校', '學校家具', 1, null),
  ('醫養家具', '學校家具', 1, null),
  ('Leisure 休閒', '休閑家具', 1, null),
  ('Care Home 安老院', '學校家具', 1, null)
on conflict (pms_type, fds_level1) do update
  set weight = excluded.weight, note = excluded.note;

-- ── 對照表維護：只有 admin 可改 ─────────────────────────────────────

create or replace function public.fds_pms_category_map_set(
  p_pms_type text,
  p_fds_level1 text,
  p_weight numeric default 1,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.bwf_has_role(array['admin']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if btrim(coalesce(p_pms_type, '')) = '' or btrim(coalesce(p_fds_level1, '')) = '' then
    raise exception 'invalid_map' using errcode = '22023';
  end if;

  insert into public.fds_pms_category_map (pms_type, fds_level1, weight, note)
  values (btrim(p_pms_type), btrim(p_fds_level1), coalesce(p_weight, 1), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (pms_type, fds_level1) do update
    set weight = excluded.weight, note = excluded.note;
end;
$$;

revoke all on function public.fds_pms_category_map_set(text, text, numeric, text) from public, anon;
grant execute on function public.fds_pms_category_map_set(text, text, numeric, text) to authenticated;

-- ── 類別熱度匯總（管理／驗證用）────────────────────────────────────

create or replace function public.fds_pms_category_demand_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.demand_qty desc)
    from (
      select
        m.fds_level1 as level1,
        round(sum(d.demand_qty * m.weight))::int as demand_qty,
        round(sum(d.order_lines * m.weight))::int as demand_lines,
        array_agg(distinct d.pms_type order by d.pms_type) as pms_types
      from public.fds_pms_category_map m
      join public.fds_pms_category_demand d on d.pms_type = m.pms_type
      group by m.fds_level1
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fds_pms_category_demand_summary() from public, anon;
grant execute on function public.fds_pms_category_demand_summary() to authenticated, service_role;

-- ── 搜索：加類別熱度 + popular_demand 排序 ───────────────────────────
-- 舊簽名必須刪掉，否則 PostgREST 會在兩個重載之間無法選擇。

drop function if exists public.fds_search_products(
  text, text, text, text, text[], text[], numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric,
  boolean, text, text, int, int, int, boolean, uuid
);

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
  p_offset int default 0,
  p_since_days int default null,
  p_common boolean default null,
  p_document_id uuid default null
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

  with latest_quote as (
    -- 每個 quote_id 版本鏈的最新版本，排除回收桶（與報價一覽同一組語義）。
    select distinct on (btrim(q.quote_id)) q.id
    from public.bwf_quote q
    where q.quote_id is not null and btrim(q.quote_id) <> ''
      and coalesce(q.status, '') <> '回收桶'
    order by btrim(q.quote_id),
      case
        when q.version ~* '^v[0-9]+$' then substring(q.version from 2)::int
        when q.version ~* '^v[0-9]+[.][0-9]+$' then split_part(q.version, '.', 2)::int
        else 0
      end desc,
      q.created_at desc nulls last
  ),
  usage as (
    -- 每件產品在報價單裡的用量。p_common 為 false 時整段略過（planner 一時間過濾）。
    -- 欄名加 usage_ 前綴：quote_count 已被「供應商報價筆數」佔用。
    select
      qi.product_id,
      count(distinct qi.quote_uuid)::int as usage_quote_count,
      count(*)::int as usage_line_count,
      coalesce(sum(qi.quantity), 0)::numeric as usage_quantity_sum,
      coalesce(sum(qi.unit_price * qi.quantity), 0)::numeric as usage_amount_sum
    from public.bwf_quote_item qi
    join latest_quote lq on lq.id = qi.quote_uuid
    where p_common is true
      and qi.product_id is not null
      and coalesce(qi.is_section_title, false) = false
      and coalesce(qi.is_custom_term, false) = false
    group by qi.product_id
  ),
  demand as (
    -- 類別熱度：PMS 落單量經對照表落到 FDS level1。
    select
      m.fds_level1,
      sum(d.demand_qty * m.weight)::numeric as demand_qty,
      sum(d.order_lines * m.weight)::numeric as demand_lines
    from public.fds_pms_category_map m
    join public.fds_pms_category_demand d on d.pms_type = m.pms_type
    where p_common is true
    group by m.fds_level1
  ),
  base as (
    select p.id, p.title, p.model, p.sku, p.product_sku, p.image_url, p.image_url_2, p.image_url_3,
           p.lifestyle_image_url, p.factory_id, p.factories_display_name,
           p.dimension_l_mm, p.dimension_w_mm, p.dimension_h_mm, p.material, p.color, p.category,
           p.level1_category, p.level2_category, p.in_stock, p.customize, p.created_at,
           p.shopify_product_id, p.in_catalog, p.sale_price, p.cost_price,
           u.usage_quote_count, u.usage_line_count, u.usage_quantity_sum, u.usage_amount_sum,
           dm.demand_qty as category_demand_qty_raw, dm.demand_lines as category_demand_lines_raw,
           public.fds_product_haystack(p.title, p.model, p.sku, p.factories_display_name, p.color, p.material,
                                        p.category, p.level1_category, p.level2_category) as hay
    from public.products p
    left join usage u on u.product_id = p.id
    left join demand dm on dm.fds_level1 = coalesce(p.level1_category, '(未分類)')
    where not p.dismissed
      and (p_factory is null or p.factories_display_name = p_factory)
      and (p_level1 is null or p.level1_category = p_level1)
      and (p_level2 is null or p.level2_category = p_level2)
      and (p_in_stock is not true or p.in_stock is true)
      and (
        p_since_days is null or p_since_days <= 0
        or p.created_at >= now() - make_interval(days => least(p_since_days, 3650))
      )
      and (
        p_common is not true
        or coalesce(p_sort, '') = 'popular_demand'
        or (u.usage_quote_count is not null and u.usage_quote_count > 0)
      )
      and (
        p_document_id is null
        or exists (
          select 1 from public.product_source_refs src
          where src.product_id = p.id and src.document_id = p_document_id
        )
      )
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
      case when p_common is true and p_sort = 'popular_demand' then f.category_demand_qty_raw end desc nulls last,
      case when p_common is true and p_sort = 'popular_demand' then f.usage_quote_count end desc nulls last,
      case when p_common is true and p_sort = 'popular_demand' then f.usage_quantity_sum end desc nulls last,
      case when p_common is true and p_sort = 'popular_quantity' then f.usage_quantity_sum end desc nulls last,
      case when p_common is true and p_sort = 'popular_amount' then f.usage_amount_sum end desc nulls last,
      case when p_common is true and coalesce(p_sort, 'relevance') not in ('popular_quantity', 'popular_amount') then f.usage_quote_count end desc nulls last,
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
        'usage_quote_count', pg.usage_quote_count,
        'usage_line_count', pg.usage_line_count,
        'usage_quantity', pg.usage_quantity_sum,
        'usage_amount', pg.usage_amount_sum,
        'category_demand_qty', case when pg.category_demand_qty_raw is null then null else round(pg.category_demand_qty_raw)::int end,
        'category_demand_lines', case when pg.category_demand_lines_raw is null then null else round(pg.category_demand_lines_raw)::int end,
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
        case when p_common is true and p_sort = 'popular_demand' then pg.category_demand_qty_raw end desc nulls last,
        case when p_common is true and p_sort = 'popular_demand' then pg.usage_quote_count end desc nulls last,
        case when p_common is true and p_sort = 'popular_demand' then pg.usage_quantity_sum end desc nulls last,
        case when p_common is true and p_sort = 'popular_quantity' then pg.usage_quantity_sum end desc nulls last,
        case when p_common is true and p_sort = 'popular_amount' then pg.usage_amount_sum end desc nulls last,
        case when p_common is true and coalesce(p_sort, 'relevance') not in ('popular_quantity', 'popular_amount') then pg.usage_quote_count end desc nulls last,
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

revoke all on function public.fds_search_products(
  text, text, text, text, text[], text[], numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric,
  boolean, text, text, int, int, int, boolean, uuid
) from public, anon;
grant execute on function public.fds_search_products(
  text, text, text, text, text[], text[], numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric,
  boolean, text, text, int, int, int, boolean, uuid
) to authenticated;

-- ── 詳情：附類別熱度 ────────────────────────────────────────────────

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
    'usage', (
      select jsonb_build_object(
        'quote_count', count(distinct qi.quote_uuid)::int,
        'line_count', count(*)::int,
        'quantity_sum', coalesce(sum(qi.quantity), 0)::numeric,
        'amount_sum', coalesce(sum(qi.unit_price * qi.quantity), 0)::numeric
      )
      from public.bwf_quote_item qi
      join (
        select distinct on (btrim(q.quote_id)) q.id
        from public.bwf_quote q
        where q.quote_id is not null and btrim(q.quote_id) <> ''
          and coalesce(q.status, '') <> '回收桶'
        order by btrim(q.quote_id),
          case
            when q.version ~* '^v[0-9]+$' then substring(q.version from 2)::int
            when q.version ~* '^v[0-9]+[.][0-9]+$' then split_part(q.version, '.', 2)::int
            else 0
          end desc,
          q.created_at desc nulls last
      ) lq on lq.id = qi.quote_uuid
      where qi.product_id = p.id
        and coalesce(qi.is_section_title, false) = false
        and coalesce(qi.is_custom_term, false) = false
    ),
    'category_demand', (
      select jsonb_build_object(
        'level1', m.fds_level1,
        'qty', round(coalesce(sum(d.demand_qty * m.weight), 0))::int,
        'lines', round(coalesce(sum(d.order_lines * m.weight), 0))::int
      )
      from public.fds_pms_category_map m
      join public.fds_pms_category_demand d on d.pms_type = m.pms_type
      where m.fds_level1 = coalesce(p.level1_category, '(未分類)')
      group by m.fds_level1
    ),
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

-- ── 每日更新類別熱度 ────────────────────────────────────────────────
-- 沿用 fds-process-jobs 的 function host（正式／分支各打自己的 host）。
-- 授權用 vault 的 fds_worker_secret，與 process-jobs 同一把。
-- slug 用 CLI 部署出來的 pms-category-demand（此功能沒有前端呼叫者，
-- 不需要 supabase-functions- 前綴版）。

do $cron$
declare
  v_host text;
  v_command text;
begin
  select substring(command from $re$https://[a-z0-9]+\.supabase\.co$re$)
    into v_host
    from cron.job
    where jobname = 'fds-process-jobs'
    limit 1;

  if v_host is null or v_host = '' then
    v_host := 'https://riaubhtruisbwdlwjzur.supabase.co';
  end if;

  perform cron.unschedule('fds-pms-category-demand')
    from cron.job
    where jobname = 'fds-pms-category-demand';

  v_command := format($job$
    select net.http_post(
      url := %L || '/functions/v1/pms-category-demand',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret' limit 1)
      ),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 15000
    );
  $job$, v_host);

  perform cron.schedule('fds-pms-category-demand', '17 3 * * *', v_command);
end
$cron$;

notify pgrst, 'reload schema';
