-- Day 6（T-601 / T-603）：1536 維 Google embedding，以圖搜款。
-- 相似度只代表「看起來接近」。回傳一律 relation = similar，不得當成同款。

create extension if not exists vector with schema extensions;

create table if not exists public.search_embeddings (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null default 'product' check (entity_type = 'product'),
  entity_id text not null,
  modality text not null check (modality in ('image', 'text')),
  embedding extensions.vector(1536) not null,
  model text not null,
  content_hash text,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, modality)
);

create index if not exists search_embeddings_image_cosine_idx
  on public.search_embeddings
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100)
  where modality = 'image';

alter table public.search_embeddings enable row level security;
revoke all on public.search_embeddings from public, anon, authenticated;
grant all on public.search_embeddings to service_role;

-- 下一批尚未有圖片向量、且主圖是 HTTP URL 的產品。只給 worker（service role）。
create or replace function public.fds_products_missing_image_embedding(p_limit int default 4)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'image_url', p.image_url,
    'title', p.title,
    'model', nullif(p.model, ''),
    'material', nullif(p.material, ''),
    'color', nullif(p.color, '')
  )), '[]'::jsonb)
  from (
    select p.id, p.image_url, p.title, p.model, p.material, p.color
    from public.products p
    where not p.dismissed
      and p.image_url like 'http%'
      and not exists (
        select 1 from public.search_embeddings e
        where e.entity_type = 'product' and e.entity_id = p.id and e.modality = 'image'
      )
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit, 4), 1), 8)
  ) p;
$$;

revoke all on function public.fds_products_missing_image_embedding(int) from public, anon, authenticated;
grant execute on function public.fds_products_missing_image_embedding(int) to service_role;

create or replace function public.fds_upsert_embedding(
  p_entity_id text,
  p_modality text,
  p_values float8[],
  p_model text,
  p_content_hash text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vec extensions.vector(1536);
begin
  if p_modality not in ('image', 'text') then
    raise exception 'modality_invalid' using errcode = '22023';
  end if;
  if cardinality(p_values) is distinct from 1536 then
    raise exception 'embedding_dimension' using errcode = '22023';
  end if;
  v_vec := ('[' || array_to_string(p_values, ',') || ']')::extensions.vector;
  insert into public.search_embeddings (entity_type, entity_id, modality, embedding, model, content_hash)
  values ('product', p_entity_id, p_modality, v_vec, left(p_model, 80), nullif(p_content_hash, ''))
  on conflict (entity_type, entity_id, modality) do update
    set embedding = excluded.embedding,
        model = excluded.model,
        content_hash = excluded.content_hash,
        created_at = now();
end;
$$;

revoke all on function public.fds_upsert_embedding(text, text, float8[], text, text) from public, anon, authenticated;
grant execute on function public.fds_upsert_embedding(text, text, float8[], text, text) to service_role;

create or replace function public.fds_embedding_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'with_image', (select count(*) from public.products p where not p.dismissed and p.image_url like 'http%'),
    'indexed', (select count(*) from public.search_embeddings e where e.entity_type = 'product' and e.modality = 'image' and e.model <> 'skipped'),
    'can_index', public.bwf_has_role(array['admin', 'uploader'])
  );
end;
$$;

revoke all on function public.fds_embedding_status() from public, anon;
grant execute on function public.fds_embedding_status() to authenticated;

-- 以圖搜款。cosine 距離愈小愈接近。relation 固定 similar。
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
  p_limit int default 5
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
           n.similarity
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

revoke all on function public.fds_match_product_images(float8[], text, text, text, text[], text[], numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, boolean, text, int) from public, anon;
grant execute on function public.fds_match_product_images(float8[], text, text, text, text[], text[], numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, boolean, text, int) to authenticated;

notify pgrst, 'reload schema';
