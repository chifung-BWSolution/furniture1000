-- Lightweight index for 報價參考分析.
-- Latest non-trash version per quote_id, plus category / industry / grade
-- labels and furniture size-band counts. Does not return project_data,
-- images, or cost.

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
  size_ge_2000 integer
)
language sql
stable
security invoker
set search_path = public
as $$
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
    sized.size_ge_2000
  from latest
  join sized on sized.quote_uuid = latest.id
  where sized.item_count > 0
  order by latest.created_at desc nulls last, latest.id desc
$$;

revoke all on function public.fds_quote_reference_index() from public, anon;
grant execute on function public.fds_quote_reference_index() to authenticated, service_role;

notify pgrst, 'reload schema';
