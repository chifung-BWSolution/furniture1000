-- 以圖搜款也要吃關鍵字：前端改篩選時會重跑圖片搜索，
-- 搜尋框的字詞不應被靜靜忽略（否則文字搜索與圖片搜索結果不一致）。

drop function if exists public.fds_match_product_images(
  float8[], text, text, text, text[], text[], numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, boolean, text, int
);

create or replace function public.fds_match_product_images(
  p_values float8[],
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
  p_limit int default 5,
  p_text text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vec extensions.vector(1536);
  v_colors text[];
  v_materials text[];
  v_limit int := least(greatest(coalesce(p_limit, 5), 1), 5);
  v_q text := lower(btrim(coalesce(p_text, '')));
  v_terms text[];
  v_result jsonb;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if cardinality(p_values) is distinct from 1536 then
    raise exception 'embedding_dimension' using errcode = '22023';
  end if;
  v_vec := ('[' || array_to_string(p_values, ',') || ']')::extensions.vector;
  v_colors := public.fds_expand_color_terms(p_colors);
  v_materials := array(select lower(btrim(m)) from unnest(coalesce(p_materials, '{}')) m where btrim(m) <> '');
  v_terms := case when v_q = '' then '{}'::text[] else regexp_split_to_array(v_q, '\s+') end;

  with nearest as (
    select e.entity_id as id,
           1 - (e.embedding <=> v_vec) as similarity
    from public.search_embeddings e
    where e.entity_type = 'product' and e.modality = 'image' and e.model <> 'skipped'
    order by e.embedding <=> v_vec
    limit 80
  ),
  filtered as (
    select p.id, p.title, p.model, p.sku, p.image_url, p.factories_display_name,
           p.dimension_l_mm, p.dimension_w_mm, p.dimension_h_mm, p.material, p.color,
           p.in_stock, p.sale_price, p.created_at, p.shopify_product_id, p.in_catalog,
           n.similarity,
           public.fds_product_haystack(p.title, p.model, p.sku, p.factories_display_name, p.color, p.material,
                                       p.category, p.level1_category, p.level2_category) as hay
    from nearest n
    join public.products p on p.id::text = n.id
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
      and (p_price_min is null or (p.sale_price > 0 and p.sale_price * 0.8 >= p_price_min))
      and (p_price_max is null or (p.sale_price > 0 and p.sale_price * 0.8 <= p_price_max))
      and case coalesce(p_scope, 'all')
            when 'catalog' then p.in_catalog
            when 'shopify' then p.shopify_product_id is not null
            when 'quoted' then exists (select 1 from public.supplier_prices sp where sp.product_id = p.id and sp.verified)
            else true
          end
      -- 關鍵字與文字搜索同一套規則。
      and not exists (
        select 1 from unnest(v_terms) t
        where not (
          p.hay like '%' || public.fds_like_escape(t) || '%'
          or (public.fds_model_key(t) is not null and p.hay like '%' || public.fds_like_escape(public.fds_model_key(t)) || '%')
        )
      )
    order by n.similarity desc
    limit v_limit
  )
  select jsonb_build_object(
    'indexed', (select count(*) from public.search_embeddings where entity_type = 'product' and modality = 'image' and model <> 'skipped'),
    'items', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'model', nullif(p.model, ''),
      'sku', nullif(p.sku, ''),
      'image_url', nullif(p.image_url, ''),
      'factory_name', nullif(p.factories_display_name, ''),
      'dimension_l_mm', p.dimension_l_mm,
      'dimension_w_mm', p.dimension_w_mm,
      'dimension_h_mm', p.dimension_h_mm,
      'material', nullif(p.material, ''),
      'color', nullif(p.color, ''),
      'in_stock', p.in_stock,
      'middle_price', case when p.sale_price > 0 then round(p.sale_price * 0.8, 2) end,
      'sale_price', case when p.sale_price > 0 then p.sale_price end,
      'exact', false,
      'similarity', round(p.similarity::numeric, 4),
      'relation', 'similar',
      'created_at', p.created_at,
      'on_shopify', p.shopify_product_id is not null,
      'in_catalog', p.in_catalog
    )) order by p.similarity desc) from filtered p), '[]'::jsonb)
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object(
    'indexed', (select count(*) from public.search_embeddings where entity_type = 'product' and modality = 'image' and model <> 'skipped'),
    'items', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.fds_match_product_images(float8[], text, text, text, text[], text[], numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, boolean, text, int, text) from public, anon;
grant execute on function public.fds_match_product_images(float8[], text, text, text, text[], text[], numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, boolean, text, int, text) to authenticated;

notify pgrst, 'reload schema';
