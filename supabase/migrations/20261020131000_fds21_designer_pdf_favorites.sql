-- 設計師選傢俬：產品 PDF 目錄、常用傢俬（個人收藏）、最新產品（最近 N 天）。
-- 原始 PDF 仍只限 admin / uploader（storage_path 不回傳）。收藏按登入者隔離。

create table if not exists public.designer_favorites (
  user_id uuid not null,
  product_id text not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index if not exists designer_favorites_user_idx
  on public.designer_favorites (user_id, created_at desc);

alter table public.designer_favorites enable row level security;
revoke all on public.designer_favorites from public, anon, authenticated;
grant all on public.designer_favorites to service_role;

-- ── 收藏：只經 RPC，清單互不可見 ─────────────────────────────────────

create or replace function public.fds_designer_favorite_set(
  p_product_id text,
  p_on boolean
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on boolean := coalesce(p_on, false);
begin
  if auth.uid() is null
     or not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and not p.dismissed
  ) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  if v_on then
    insert into public.designer_favorites (user_id, product_id)
    values (auth.uid(), p_product_id)
    on conflict (user_id, product_id) do nothing;
  else
    delete from public.designer_favorites
    where user_id = auth.uid() and product_id = p_product_id;
  end if;

  return exists (
    select 1 from public.designer_favorites
    where user_id = auth.uid() and product_id = p_product_id
  );
end;
$$;

revoke all on function public.fds_designer_favorite_set(text, boolean) from public, anon;
grant execute on function public.fds_designer_favorite_set(text, boolean) to authenticated;

create or replace function public.fds_designer_favorite_has(p_product_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  return exists (
    select 1 from public.designer_favorites
    where user_id = auth.uid() and product_id = p_product_id
  );
end;
$$;

revoke all on function public.fds_designer_favorite_has(text) from public, anon;
grant execute on function public.fds_designer_favorite_has(text) to authenticated;

-- ── 產品 PDF 目錄：分段與件數，不含檔案路徑與頁面原文 ────────────────

create or replace function public.fds_designer_catalogs(
  p_query text default null,
  p_factory text default null,
  p_doc_type text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_open boolean;
  v_q text := lower(btrim(coalesce(p_query, '')));
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_open := public.bwf_has_role(array['admin', 'uploader']);

  return jsonb_build_object(
    'can_open_source', v_open,
    'factories', coalesce((
      select jsonb_agg(name order by name)
      from (
        select distinct d.factory_name as name
        from public.supplier_documents d
        where btrim(d.factory_name) <> ''
      ) names
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(row_to_json(x) order by x.created_at desc)
      from (
        select
          d.id,
          nullif(d.title, '') as title,
          nullif(d.factory_name, '') as factory_name,
          d.doc_type,
          d.status,
          d.page_count,
          d.created_at,
          (
            select count(distinct r.product_id)::int
            from public.product_source_refs r
            where r.document_id = d.id
          ) as product_count,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'seq', s.seq,
              'start_page', s.start_page,
              'end_page', s.end_page,
              'kind', s.kind,
              'title', nullif(btrim(s.title), '')
            ) order by s.seq)
            from public.supplier_document_segments s
            where s.document_id = d.id
          ), '[]'::jsonb) as segments
        from public.supplier_documents d
        where (p_factory is null or btrim(p_factory) = '' or d.factory_name = p_factory)
          and (
            p_doc_type is null
            or p_doc_type not in ('quote', 'catalog')
            or d.doc_type = p_doc_type
          )
          and (
            v_q = ''
            or lower(coalesce(d.title, '')) like '%' || public.fds_like_escape(v_q) || '%'
            or lower(d.factory_name) like '%' || public.fds_like_escape(v_q) || '%'
            or exists (
              select 1 from public.supplier_document_segments s
              where s.document_id = d.id
                and lower(coalesce(s.title, '')) like '%' || public.fds_like_escape(v_q) || '%'
            )
          )
        order by d.created_at desc
        limit 200
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.fds_designer_catalogs(text, text, text) from public, anon;
grant execute on function public.fds_designer_catalogs(text, text, text) to authenticated;

-- ── 搜索：收藏、最近 N 天、某一份目錄 ────────────────────────────────
-- 舊簽名必須刪掉，否則 PostgREST 會在兩個重載之間無法選擇。

drop function if exists public.fds_search_products(
  text, text, text, text, text[], text[], numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric,
  boolean, text, text, int, int
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
  p_only_favorites boolean default null,
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
      and (
        p_since_days is null or p_since_days <= 0
        or p.created_at >= now() - make_interval(days => least(p_since_days, 3650))
      )
      and (
        p_only_favorites is not true
        or exists (
          select 1 from public.designer_favorites fav
          where fav.user_id = auth.uid() and fav.product_id = p.id
        )
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
        'favorited', exists (
          select 1 from public.designer_favorites fav
          where fav.user_id = auth.uid() and fav.product_id = pg.id
        ),
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

notify pgrst, 'reload schema';
