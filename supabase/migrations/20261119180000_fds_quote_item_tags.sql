-- 歷史報價明細的分類、顏色、材質改成固定標籤。
-- 分類沿用 product_category；顏色只收白、黑、灰、木色、金屬、彩色；
-- 材質沿用搜尋頁那組材質標籤。原文欄位保留。已鎖定的行不再重算。

alter table public.bwf_quote_item
  add column if not exists color_tags text[] not null default '{}',
  add column if not exists material_tags text[] not null default '{}',
  add column if not exists tags_locked boolean not null default false;

comment on column public.bwf_quote_item.color_tags is
  '固定顏色標籤：白、黑、灰、木色、金屬、彩色。原文仍在 color。';
comment on column public.bwf_quote_item.material_tags is
  '固定材質標籤，可多個。原文仍在 material。';
comment on column public.bwf_quote_item.tags_locked is
  '人手確認後為 true，自動回填不再改這一行。';

create table if not exists public.quote_item_category_alias (
  source_text text primary key,
  level2 text not null,
  created_at timestamptz not null default now()
);

comment on table public.quote_item_category_alias is
  '報價明細原文分類對到 product_category.level2。只放不會猜錯的寫法。';

create table if not exists public.quote_item_tag_term (
  kind text not null check (kind in ('color', 'material')),
  tag text not null,
  term text not null,
  primary key (kind, term)
);

comment on table public.quote_item_tag_term is
  '顏色家族和材質標籤的對照字。一行原文可命中多個標籤。';

alter table public.quote_item_category_alias enable row level security;
alter table public.quote_item_tag_term enable row level security;
revoke all on table public.quote_item_category_alias from public, anon, authenticated;
revoke all on table public.quote_item_tag_term from public, anon, authenticated;

insert into public.quote_item_category_alias (source_text, level2) values
  ('直型辦公枱', '工作枱'),
  ('L型辦公枱', '工作枱'),
  ('L型辦公桌', '工作枱'),
  ('單人辦公枱', '工作枱'),
  ('趟門文件櫃配鎖', '文件櫃'),
  ('會議桌', '會議枱'),
  ('會議台', '會議枱'),
  ('會議檯', '會議枱'),
  ('executive desk', '老闆枱'),
  ('executive chair', '大班椅'),
  ('吧椅', '吧台、吧椅'),
  ('學生實驗枱', '理化枱'),
  ('老師實驗枱', '理化枱'),
  ('單人位梳化', '單人梳化'),
  ('貨架', '層架'),
  ('鋼製貨架', '層架'),
  ('三抽櫃', '活動櫃'),
  ('老師椅', '書椅')
on conflict (source_text) do update set level2 = excluded.level2;

insert into public.quote_item_tag_term (kind, tag, term) values
  ('color', '木色', '胡桃'),
  ('color', '木色', '橡木'),
  ('color', '木色', '櫻桃'),
  ('color', '木色', '樱桃'),
  ('color', '木色', '楓木'),
  ('color', '木色', '枫木'),
  ('color', '木色', '木紋'),
  ('color', '木色', '木纹'),
  ('color', '木色', '木色'),
  ('color', '木色', '柚木'),
  ('color', '木色', '白蠟'),
  ('color', '木色', '白蜡'),
  ('color', '白', '白'),
  ('color', '白', 'white'),
  ('color', '黑', '黑'),
  ('color', '黑', 'black'),
  ('color', '灰', '灰'),
  ('color', '灰', 'gray'),
  ('color', '灰', 'grey'),
  ('color', '金屬', '銀'),
  ('color', '金屬', '不鏽'),
  ('color', '金屬', '不锈'),
  ('color', '金屬', '拉絲'),
  ('color', '金屬', '拉丝'),
  ('color', '金屬', '金屬'),
  ('color', '金屬', '金属'),
  ('color', '金屬', '電鍍'),
  ('color', '金屬', '电镀'),
  ('color', '金屬', 'chrome'),
  ('color', '彩色', '橙'),
  ('color', '彩色', '綠'),
  ('color', '彩色', '绿'),
  ('color', '彩色', '藍'),
  ('color', '彩色', '蓝'),
  ('color', '彩色', '紅'),
  ('color', '彩色', '红'),
  ('color', '彩色', '黃'),
  ('color', '彩色', '黄'),
  ('color', '彩色', '粉'),
  ('color', '彩色', '紫'),
  ('color', '彩色', 'orange'),
  ('color', '彩色', 'green'),
  ('color', '彩色', 'blue'),
  ('color', '彩色', 'red'),
  ('color', '彩色', 'yellow'),
  ('color', '彩色', 'pink'),
  ('material', '玻纖背架', '玻纖背架'),
  ('material', '玻纖背架', '玻璃纖維背架'),
  ('material', '不鏽鋼', '不鏽鋼'),
  ('material', '不鏽鋼', '不銹鋼'),
  ('material', '不鏽鋼', 'stainless steel'),
  ('material', '鋁合金', '鋁合金'),
  ('material', '鋁合金', '铝合金'),
  ('material', '鋁合金', 'aluminium'),
  ('material', '鋁合金', 'aluminum'),
  ('material', '密度板', '密度板'),
  ('material', '密度板', '中纖板'),
  ('material', '密度板', '中纤板'),
  ('material', '密度板', 'mdf'),
  ('material', '刨花板', '刨花板'),
  ('material', '刨花板', 'particle board'),
  ('material', '刨花板', 'chipboard'),
  ('material', '夾板', '夾板'),
  ('material', '夾板', '夹板'),
  ('material', '夾板', '膠合板'),
  ('material', '夾板', '胶合板'),
  ('material', '夾板', 'plywood'),
  ('material', '防火板', '防火板'),
  ('material', '實木', '實木'),
  ('material', '實木', '实木'),
  ('material', '實木', 'solid wood'),
  ('material', '木皮', '木皮'),
  ('material', '木皮', 'veneer'),
  ('material', '橡木', '橡木'),
  ('material', '橡木', 'oak'),
  ('material', '胡桃木', '胡桃木'),
  ('material', '胡桃木', 'walnut'),
  ('material', '白蠟木', '白蠟木'),
  ('material', '白蠟木', '白蜡木'),
  ('material', '白蠟木', 'ash wood'),
  ('material', '網布', '網布'),
  ('material', '網布', '网布'),
  ('material', '網布', 'mesh'),
  ('material', '尼龍', '尼龍'),
  ('material', '尼龍', '尼龙'),
  ('material', '尼龍', 'nylon'),
  ('material', '西皮', '西皮'),
  ('material', '科技布', '科技布'),
  ('material', '絨布', '絨布'),
  ('material', '絨布', '绒布'),
  ('material', '絨布', 'velvet'),
  ('material', '麻布', '麻布'),
  ('material', '麻布', 'linen'),
  ('material', '真皮', '真皮'),
  ('material', '真皮', 'genuine leather'),
  ('material', '仿皮', '仿皮'),
  ('material', '仿皮', 'faux leather'),
  ('material', '仿皮', 'synthetic leather'),
  ('material', '皮革', '皮革'),
  ('material', '皮革', 'leather'),
  ('material', '布藝', '布藝'),
  ('material', '布藝', '布艺'),
  ('material', '布藝', 'fabric'),
  ('material', '海綿', '海綿'),
  ('material', '海綿', '海绵'),
  ('material', '海綿', 'foam'),
  ('material', '塑膠', '塑膠'),
  ('material', '塑膠', '塑料'),
  ('material', '塑膠', 'plastic'),
  ('material', '玻璃', '玻璃'),
  ('material', '玻璃', 'glass'),
  ('material', '亞克力', '亞克力'),
  ('material', '亞克力', '亚克力'),
  ('material', '亞克力', 'acrylic'),
  ('material', '藤材', '藤材'),
  ('material', '藤材', '藤編'),
  ('material', '藤材', '藤编'),
  ('material', '藤材', 'rattan'),
  ('material', '竹材', '竹材'),
  ('material', '竹材', 'bamboo'),
  ('material', '鋼材', '鋼材'),
  ('material', '鋼材', '钢材'),
  ('material', '鋼材', 'steel'),
  ('material', '金屬', '金屬'),
  ('material', '金屬', '金属'),
  ('material', '金屬', 'metal'),
  ('material', 'MFC', 'mfc'),
  ('material', 'HPL', 'hpl'),
  ('material', 'PP', 'pp'),
  ('material', 'PU', 'pu')
on conflict (kind, term) do update set tag = excluded.tag;

create or replace function public.fds_quote_category_key(p_text text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(
    split_part(replace(replace(coalesce(p_text, ''), E'\r\n', E'\n'), E'\r', E'\n'), E'\n', 1),
    '[[:space:]]+',
    ' ',
    'g'
  )), '');
$$;

create or replace function public.fds_quote_item_category_id(p_category text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with key as (
    select public.fds_quote_category_key(p_category) as label
  )
  select coalesce(
    (
      select c.id
      from public.product_category c
      cross join key
      where key.label is not null
        and btrim(c.level2) = key.label
      limit 1
    ),
    (
      select c.id
      from public.quote_item_category_alias a
      join public.product_category c on btrim(c.level2) = a.level2
      cross join key
      where key.label is not null
        and lower(a.source_text) = lower(key.label)
      limit 1
    )
  );
$$;

create or replace function public.fds_quote_item_kind_tags(p_kind text, p_text text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with src as (
    select lower(btrim(coalesce(p_text, ''))) as folded
  ),
  cleaned as (
    select case
      when folded in (
        '可選', '待定', '待確認', '待定色', 'tbc', '如圖', '按圖', '見圖',
        '圖片', '圖片色', 'as shown', 'n/a', '-', '/', '色卡', '另議', '白板'
      ) then ''
      else replace(folded, '白板', ' ')
    end as folded
    from src
  )
  select coalesce(array_agg(distinct t.tag order by t.tag), '{}'::text[])
  from public.quote_item_tag_term t
  cross join cleaned
  where t.kind = p_kind
    and cleaned.folded <> ''
    and position(lower(t.term) in cleaned.folded) > 0;
$$;

create or replace function public.bwf_quote_item_apply_tags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.is_section_title, false) or coalesce(new.is_custom_term, false) then
    return new;
  end if;
  if new.tags_locked then
    return new;
  end if;
  if new.product_category_id is null then
    new.product_category_id := public.fds_quote_item_category_id(new.category);
  end if;
  new.color_tags := public.fds_quote_item_kind_tags('color', new.color);
  new.material_tags := public.fds_quote_item_kind_tags('material', new.material);
  return new;
end;
$$;

drop trigger if exists bwf_quote_item_apply_tags on public.bwf_quote_item;
create trigger bwf_quote_item_apply_tags
  before insert or update on public.bwf_quote_item
  for each row
  execute function public.bwf_quote_item_apply_tags();

revoke all on function public.fds_quote_category_key(text) from public, anon, authenticated;
revoke all on function public.fds_quote_item_category_id(text) from public, anon, authenticated;
revoke all on function public.fds_quote_item_kind_tags(text, text) from public, anon, authenticated;
revoke all on function public.bwf_quote_item_apply_tags() from public, anon;
grant execute on function public.bwf_quote_item_apply_tags() to authenticated, service_role;

-- 觸發器重算未鎖定的明細。已有的 product_category_id 保留。
update public.bwf_quote_item
set category = category
where coalesce(is_section_title, false) = false
  and coalesce(is_custom_term, false) = false
  and tags_locked = false;

-- 參考索引改回傳標籤，不再回傳原文。同一行的分類、顏色、材質仍綁在一起。
create or replace function public.fds_quote_reference_index()
returns table (
  id uuid,
  quote_id text,
  version text,
  total_amount numeric,
  created_at timestamptz,
  bwf_pitching_id uuid,
  industries text[],
  scopes text[],
  grades text[],
  work_period text,
  item_count integer,
  sized_item_count integer,
  size_lt_1200 integer,
  size_1200_1600 integer,
  size_1600_2000 integer,
  size_ge_2000 integer,
  item_traits text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    return;
  end if;

  return query
  with latest as (
    select distinct on (q.quote_id)
      q.id,
      q.quote_id,
      q.version,
      q.total_amount,
      q.created_at,
      q.bwf_pitching_id,
      q.project_data
    from public.bwf_quote q
    where q.quote_id is not null
      and btrim(q.quote_id) <> ''
      and coalesce(q.status, '') <> '回收桶'
    order by q.quote_id,
      case
        when btrim(q.version) ~* '^v[0-9]+\.[0-9]+$'
          then split_part(substr(btrim(q.version), 2), '.', 2)::numeric
        when btrim(q.version) ~* '^v[0-9]+$'
          then substr(btrim(q.version), 2)::numeric
        else 0
      end desc,
      q.created_at desc nulls last,
      q.id desc
  ),
  lines as (
    select
      i.quote_uuid,
      (
        select max(token[1]::numeric)
        from regexp_matches(
          concat_ws(
            ' ',
            nullif(btrim(i.dimension_l_mm), ''),
            nullif(btrim(i.dimension_w_mm), ''),
            nullif(btrim(i.dimension_h_mm), '')
          ),
          '[0-9]+(?:[.][0-9]+)?',
          'g'
        ) as token_row(token)
      ) as side
    from public.bwf_quote_item i
    join latest on latest.id = i.quote_uuid
    where coalesce(i.is_section_title, false) = false
      and coalesce(i.is_custom_term, false) = false
  ),
  sized as (
    select
      lines.quote_uuid,
      count(*)::integer as item_count,
      count(*) filter (where lines.side is not null)::integer as sized_item_count,
      count(*) filter (where lines.side is not null and lines.side < 1200)::integer as size_lt_1200,
      count(*) filter (where lines.side is not null and lines.side >= 1200 and lines.side < 1600)::integer as size_1200_1600,
      count(*) filter (where lines.side is not null and lines.side >= 1600 and lines.side < 2000)::integer as size_1600_2000,
      count(*) filter (where lines.side is not null and lines.side >= 2000)::integer as size_ge_2000
    from lines
    group by lines.quote_uuid
  ),
  traits as (
    select
      i.quote_uuid,
      coalesce(array_agg(distinct
        btrim(c.level2) || E'\x1f' ||
        array_to_string(coalesce(i.color_tags, '{}'::text[]), '|') || E'\x1f' ||
        array_to_string(coalesce(i.material_tags, '{}'::text[]), '|')
      ), '{}'::text[]) as item_traits
    from public.bwf_quote_item i
    join latest on latest.id = i.quote_uuid
    join public.product_category c on c.id = i.product_category_id
    where coalesce(i.is_section_title, false) = false
      and coalesce(i.is_custom_term, false) = false
    group by i.quote_uuid
  )
  select
    latest.id,
    latest.quote_id,
    latest.version,
    latest.total_amount,
    latest.created_at,
    latest.bwf_pitching_id,
    coalesce((
      select array_agg(btrim(val) order by ord)
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(latest.project_data #> '{formData,clientIndustry}') = 'array'
            then latest.project_data #> '{formData,clientIndustry}'
          else '[]'::jsonb
        end
      ) with ordinality as industry_row(val, ord)
      where btrim(val) <> ''
    ), '{}'::text[]) as industries,
    coalesce((
      select array_agg(btrim(val) order by ord)
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(latest.project_data #> '{formData,serviceScope}') = 'array'
            then latest.project_data #> '{formData,serviceScope}'
          else '[]'::jsonb
        end
      ) with ordinality as scope_row(val, ord)
      where btrim(val) <> ''
    ), '{}'::text[]) as scopes,
    coalesce((
      select array_agg(btrim(val) order by ord)
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(latest.project_data #> '{formData,quotationType}') = 'array'
            then latest.project_data #> '{formData,quotationType}'
          else '[]'::jsonb
        end
      ) with ordinality as grade_row(val, ord)
      where btrim(val) <> ''
    ), '{}'::text[]) as grades,
    nullif(btrim(latest.project_data #>> '{formData,workPeriod}'), '') as work_period,
    sized.item_count,
    sized.sized_item_count,
    sized.size_lt_1200,
    sized.size_1200_1600,
    sized.size_1600_2000,
    sized.size_ge_2000,
    coalesce(traits.item_traits, '{}'::text[]) as item_traits
  from latest
  join sized on sized.quote_uuid = latest.id
  left join traits on traits.quote_uuid = latest.id
  where sized.item_count > 0
  order by latest.created_at desc nulls last, latest.id desc;
end;
$$;

revoke all on function public.fds_quote_reference_index() from public, anon;
grant execute on function public.fds_quote_reference_index() to authenticated, service_role;

notify pgrst, 'reload schema';
