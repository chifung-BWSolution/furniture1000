-- FDS 2.1 Day 4（T-401～T-405）：審核通過的提取項目匯入產品庫，以及 PM／設計師搜索。
-- 產品身份＝型號＋供應商（BR-11）：同供應商同型號沿用既有 products 列且不改動它，只追加報價與來源。
-- 報價只進 supplier_prices（append-only，BR-01）；products.cost_price 不寫，避免把外幣成本混進舊報價流程。
-- 成本只回給 admin／uploader（C-04）；其他角色看中間價＝賣價 × 0.8。原文 PDF 仍只限 admin／uploader 開啟。

create or replace function public.fds_model_key(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(lower(regexp_replace(coalesce(p, ''), '[\s\-_./]+', '', 'g')), '');
$$;

create or replace function public.fds_product_haystack(
  p_title text,
  p_model text,
  p_sku text,
  p_factory text,
  p_color text,
  p_material text,
  p_category text,
  p_level1 text,
  p_level2 text
) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(concat_ws(' ', p_title, p_model, public.fds_model_key(p_model), p_sku, p_factory,
                         p_color, p_material, p_category, p_level1, p_level2));
$$;

create or replace function public.fds_like_escape(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

create or replace function public.fds_try_numeric(p text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  return nullif(btrim(coalesce(p, '')), '')::numeric;
exception when others then
  return null;
end;
$$;

create or replace function public.fds_try_date(p text)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif(btrim(coalesce(p, '')), '')::date;
exception when others then
  return null;
end;
$$;

create index if not exists idx_products_model_key
  on public.products (public.fds_model_key(model));

create index if not exists idx_products_search_trgm
  on public.products using gin (
    public.fds_product_haystack(title, model, sku, factories_display_name, color, material,
                                category, level1_category, level2_category) public.gin_trgm_ops
  );

-- Re-importing the same extraction item can never add a second copy of its prices.
create unique index if not exists supplier_prices_item_variant_key
  on public.supplier_prices (extraction_item_id, coalesce(variant_label, ''))
  where extraction_item_id is not null;

create index if not exists product_source_refs_product_idx
  on public.product_source_refs (product_id, created_at desc);

-- ── T-401 匯入 ─────────────────────────────────────────────────────────

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
    v_key := public.fds_model_key(v_p ->> 'model');
    if v_key is null then
      v_skipped := v_skipped || jsonb_build_object('id', v_item.id, 'reason', 'missing_model');
      continue;
    end if;

    -- BR-11: two documents of the same supplier and model can pass the
    -- per-document row lock together. Hold the identity key until commit
    -- so the second import sees the row the first one inserted.
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
    -- Two items with the same model in one document (different finish/size) stay separate prices.
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

revoke all on function public.fds_import_extracted_products(uuid, uuid[]) from public, anon;
grant execute on function public.fds_import_extracted_products(uuid, uuid[]) to authenticated;

-- English swatch names (White) also match the Chinese values kept on import (白色).
create or replace function public.fds_expand_color_terms(p_colors text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  with input as (
    select lower(btrim(c)) as c
    from unnest(coalesce(p_colors, '{}'::text[])) as t(c)
    where btrim(c) <> ''
  ),
  pairs(en, cn) as (
    values
    ('white', '白色'),
    ('ivory', '象牙色'),
    ('beige', '米色'),
    ('linen', '亞麻色'),
    ('antiquewhite', '奶白色'),
    ('lightgray', '淺灰色'),
    ('gray', '灰色'),
    ('dimgray', '暗灰色'),
    ('darkgray', '深灰色'),
    ('silver', '銀色'),
    ('gainsboro', '煙灰色'),
    ('slategray', '石板灰'),
    ('black', '黑色'),
    ('saddlebrown', '咖啡色'),
    ('chocolate', '巧克力色'),
    ('brown', '棕色'),
    ('darkbrown', '深棕色'),
    ('sienna', '胡桃木色'),
    ('tan', '黃褐色'),
    ('peru', '秘魯色'),
    ('wheat', '小麥色'),
    ('maroon', '桃花心木色'),
    ('burlywood', '原木色'),
    ('sandybrown', '橙棕色'),
    ('rosybrown', '古銅色'),
    ('khaki', '卡其色'),
    ('darkkhaki', '深卡其色'),
    ('red', '紅色'),
    ('darkred', '深紅色'),
    ('firebrick', '火磚色'),
    ('crimson', '暗紅色'),
    ('indianred', '印度紅'),
    ('pink', '粉紅色'),
    ('lightpink', '淺粉色'),
    ('deeppink', '深粉色'),
    ('coral', '珊瑚色'),
    ('salmon', '鮭魚色'),
    ('orange', '橙色'),
    ('darkorange', '深橙色'),
    ('orangered', '橙紅色'),
    ('gold', '金色'),
    ('yellow', '黃色'),
    ('lemonchiffon', '檸檬黃'),
    ('lightgoldenrodyellow', '淡金色'),
    ('green', '綠色'),
    ('darkgreen', '深綠色'),
    ('forestgreen', '森林綠'),
    ('olive', '橄欖綠'),
    ('darkolivegreen', '暗橄欖綠'),
    ('lightgreen', '淺綠色'),
    ('mediumspringgreen', '薄荷綠'),
    ('seagreen', '海綠色'),
    ('teal', '青綠色'),
    ('blue', '藍色'),
    ('steelblue', '鋼藍色'),
    ('darkblue', '深藍色'),
    ('navy', '海軍藍'),
    ('skyblue', '天藍色'),
    ('royalblue', '寶藍色'),
    ('lightblue', '淺藍色'),
    ('deepskyblue', '深天藍色'),
    ('dodgerblue', '道奇藍'),
    ('cornflowerblue', '矢車菊藍'),
    ('cyan', '青色'),
    ('darkcyan', '暗青色'),
    ('purple', '紫色'),
    ('darkviolet', '暗紫色'),
    ('indigo', '靛藍色'),
    ('lavender', '薰衣草色'),
    ('orchid', '蘭花紫'),
    ('plum', '梅紅色'),
    ('magenta', '品紅色'),
    ('violet', '紫羅蘭色'),
    ('mediumpurple', '中紫色'),
    ('darkmagenta', '暗洋紅'),
    ('rosybrown', '玫瑰金'),
    ('blanchedalmond', '香檳色'),
    ('darkgoldenrod', '青銅色'),
    ('darkslategray', '炭灰色'),
    ('whitesmoke', '煙白色'),
    ('snow', '雪白色'),
    ('mintcream', '薄荷奶油'),
    ('ghostwhite', '幽靈白'),
    ('azure', '水晶白'),
    ('honeydew', '蜜瓜色'),
    ('floralwhite', '蕾絲白'),
    ('oldlace', '紅木色'),
    ('cornsilk', '玉米絲色'),
    ('lavenderblush', '薰衣草紅'),
    ('seashell', '貝殼色'),
    ('mediumaquamarine', '薄荷色'),
    ('aquamarine', '水藍色'),
    ('aqua', '淺青色'),
    ('cadetblue', '湖藍色'),
    ('powderblue', '粉藍色'),
    ('paleturquoise', '淡藍色'),
    ('mediumturquoise', '藍綠色'),
    ('darkturquoise', '暗藍綠'),
    ('slateblue', '石板藍'),
    ('darkslateblue', '深石板藍'),
    ('mediumslateblue', '中石板藍'),
    ('blueviolet', '藍紫色'),
    ('darkorchid', '深蘭花紫'),
    ('mediumorchid', '中蘭花紫'),
    ('thistle', '薊紫色'),
    ('hotpink', '熱粉色'),
    ('lightcoral', '淺珊瑚色'),
    ('lightsalmon', '淺鮭魚色'),
    ('darksalmon', '暗鮭魚色'),
    ('tomato', '番茄色'),
    ('mediumvioletred', '玫瑰色'),
    ('palevioletred', '淡粉紫'),
    ('darkgoldenrod', '橄欖褐色'),
    ('goldenrod', '金菊色'),
    ('lightgoldenrod', '淡金菊'),
    ('lightyellow', '淡黃色'),
    ('papayawhip', '木瓜色'),
    ('peachpuff', '水蜜桃色'),
    ('moccasincolor', '橡皮色'),
    ('moccasin', '海貝色'),
    ('navajowhite', '那瓦霍白'),
    ('bisque', '杏色'),
    ('lawngreen', '草坪綠'),
    ('chartreuse', '查特酒綠'),
    ('yellowgreen', '黃綠色'),
    ('greenyellow', '綠黃色'),
    ('palegreen', '淡綠色'),
    ('springgreen', '春綠色'),
    ('darkseagreen', '深海綠'),
    ('mediumseagreen', '中海綠'),
    ('darkturquoise', '暗翠綠'),
    ('lime', '石灰色'),
    ('limegreen', '深石灰綠'),
    ('darkslategray', '深石板灰'),
    ('midnightblue', '午夜藍'),
    ('darkslateblue', '深藏青'),
    ('fuchsia', '紫紅色')
  )
  select coalesce(array_agg(distinct term), '{}'::text[])
  from (
    select i.c as term from input i
    union all
    select p.en from input i
      join pairs p on i.c = p.en or i.c = lower(p.cn)
    union all
    select lower(p.cn) from input i
      join pairs p on i.c = p.en or i.c = lower(p.cn)
  ) s(term)
  where term <> '';
$$;

revoke all on function public.fds_expand_color_terms(text[]) from public, anon, authenticated;

-- ── T-402～T-404 搜索 ───────────────────────────────────────────────────

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
    select p.id, p.title, p.model, p.sku, p.product_sku, p.image_url, p.factory_id, p.factories_display_name,
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
           case when v_cost then coalesce(pr.quote_cost, pr.cost_price) else pr.middle_price end as display_price
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
    'can_view_cost', v_cost,
    'items', coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', pg.id,
        'title', pg.title,
        'model', nullif(pg.model, ''),
        'sku', nullif(pg.sku, ''),
        'image_url', nullif(pg.image_url, ''),
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
        'sale_price', case when v_cost and pg.sale_price > 0 then pg.sale_price end,
        'legacy_cost', case when v_cost and pg.price_id is null then pg.cost_price end,
        'exact', pg.rank = 0,
        'quote', case when pg.price_id is not null then jsonb_strip_nulls(jsonb_build_object(
          'cost', case when v_cost then pg.quote_cost end,
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

create or replace function public.fds_product_search_facets()
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
    'factories', coalesce((
      select jsonb_agg(jsonb_build_object('name', f.name, 'count', f.n) order by f.name)
      from (
        select factories_display_name as name, count(*) as n
        from public.products
        where not dismissed and coalesce(factories_display_name, '') <> ''
        group by 1
      ) f
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('level1', c.level1, 'level2', c.level2, 'count', c.n)
                       order by c.level1, c.level2 nulls first)
      from (
        select level1_category as level1, nullif(level2_category, '') as level2, count(*) as n
        from public.products
        where not dismissed and coalesce(level1_category, '') <> ''
        group by 1, 2
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

-- ── T-405 產品詳情 ─────────────────────────────────────────────────────

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
    'sale_price', case when v_cost and p.sale_price > 0 then p.sale_price end,
    'legacy_cost', case when v_cost then p.cost_price end,
    'can_view_cost', v_cost,
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
        'storage_path', case when v_cost then d.storage_path end,
        'created_at', r.created_at
      )) order by r.created_at desc), '[]'::jsonb)
      from public.product_source_refs r
      join public.supplier_documents d on d.id = r.document_id
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

revoke all on function public.fds_search_products(text, text, text, text, text[], text[], numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, boolean, text, text, int, int) from public, anon;
revoke all on function public.fds_product_search_facets() from public, anon;
revoke all on function public.fds_product_detail(text) from public, anon;
grant execute on function public.fds_search_products(text, text, text, text, text[], text[], numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, boolean, text, text, int, int) to authenticated;
grant execute on function public.fds_product_search_facets() to authenticated;
grant execute on function public.fds_product_detail(text) to authenticated;

notify pgrst, 'reload schema';
