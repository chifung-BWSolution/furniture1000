-- 同型號多供應商比較：報價歷史要按「同規格／同計價單位」分組，並補回中間價。
--
-- 1. 問題：ranked 只按 product_id 排名，於是同一部份文件裡的
--    「1200mm／$1,000」與「1800mm／$1,500」被當成同一條報價的前後兩筆，
--    產生假的漲跌。修正：排名與漲跌比較都加上 unit + variant_label（規格）分組。
-- 2. 問題：pm / designer 看不到成本後只剩幣別，無法比較。
--    修正：每個供應商補回中間價（售價 × 0.8）與原價（成本仍只給 admin / uploader）。

create or replace function public.fds_compare_supplier_prices(p_product_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cost boolean;
  v_key text;
  v_result jsonb;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_cost := public.bwf_has_role(array['admin', 'uploader']);

  select public.fds_model_key(p.model) into v_key
  from public.products p
  where p.id = p_product_id and not p.dismissed;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  with anchor as (
    select factory_id, factories_display_name
    from public.products
    where id = p_product_id
  ),
  peers as (
    select p.id, p.model, p.factories_display_name, p.factory_id,
           p.dimension_l_mm, p.dimension_w_mm, p.dimension_h_mm, p.material, p.color,
           p.sale_price,
           p.id = p_product_id as is_current,
           case
             when coalesce(p.factory_id, '') <> '' and coalesce(a.factory_id, '') <> ''
               then p.factory_id = a.factory_id
             else lower(btrim(coalesce(p.factories_display_name, '')))
                  = lower(btrim(coalesce(a.factories_display_name, '')))
                  and btrim(coalesce(p.factories_display_name, '')) <> ''
           end as same_supplier
    from public.products p
    cross join anchor a
    where not p.dismissed
      and (p.id = p_product_id or (v_key is not null and public.fds_model_key(p.model) = v_key))
  ),
  ranked as (
    select sp.id, sp.product_id, sp.cost_price, sp.currency, sp.unit, sp.moq, sp.variant_label,
           sp.valid_from, sp.valid_to, sp.page_no, sp.document_id, sp.raw_ref, sp.created_at,
           d.title as document_title,
           -- 同規格（單位 + 規格標籤）才排在一起，漲跌只在同一組內比較。
           row_number() over (
             partition by sp.product_id,
                          coalesce(sp.unit, ''),
                          coalesce(sp.variant_label, '')
             order by
               case
                 when (sp.valid_to is null or sp.valid_to >= current_date)
                  and (sp.valid_from is null or sp.valid_from <= current_date) then 0
                 else 1
               end,
               sp.created_at desc
           ) as rn
    from public.supplier_prices sp
    left join public.supplier_documents d on d.id = sp.document_id
    where sp.verified and sp.product_id in (select id from peers)
  )
  select jsonb_build_object(
    'model_key', v_key,
    'auto_selected', false,
    'can_view_cost', v_cost,
    'truncated', (select count(*) > 20 from peers),
    'suppliers', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'product_id', p.id,
        'is_current', p.is_current,
        'same_supplier', p.same_supplier,
        'model', nullif(p.model, ''),
        'factory_name', nullif(p.factories_display_name, ''),
        'dimension_l_mm', p.dimension_l_mm,
        'dimension_w_mm', p.dimension_w_mm,
        'dimension_h_mm', p.dimension_h_mm,
        'material', nullif(p.material, ''),
        'color', nullif(p.color, ''),
        -- 中間價（售價 × 0.8）與原價：任何角色都看得到，成本才遮蔽。
        'middle_price', case when p.sale_price > 0 then round(p.sale_price * 0.8, 2) end,
        'sale_price', case when p.sale_price > 0 then p.sale_price end,
        'offers', coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', r.id,
            'current', r.rn = 1,
            'cost', case when v_cost then r.cost_price end,
            'currency', nullif(r.currency, ''),
            'fx_recorded', public.fds_try_numeric(coalesce(
              r.raw_ref ->> 'exchange_rate', r.raw_ref ->> 'fx_rate')) is not null,
            'unit', nullif(r.unit, ''),
            'moq', r.moq,
            'variant_label', nullif(r.variant_label, ''),
            'valid_from', r.valid_from,
            'valid_to', r.valid_to,
            'validity', case
              when r.valid_to is not null and r.valid_to < current_date then 'expired'
              when r.valid_from is not null and r.valid_from > current_date then 'future'
              when r.valid_to is null then 'unmarked'
              else 'valid'
            end,
            'trend', case
              when v_cost and r.rn = 1 and prev.cost_price is not null and r.cost_price is not null then
                case
                  when r.cost_price > prev.cost_price then 'up'
                  when r.cost_price < prev.cost_price then 'down'
                  else 'flat'
                end
            end,
            'page_no', r.page_no,
            'document_id', r.document_id,
            'document_title', r.document_title,
            'created_at', r.created_at
          )) order by coalesce(r.variant_label, ''), coalesce(r.unit, ''), r.rn)
          from ranked r
          left join lateral (
            -- 上一筆必須是同規格同單位的報價，否則不產生漲跌。
            select p2.cost_price
            from ranked p2
            where p2.product_id = r.product_id
              and coalesce(p2.unit, '') = coalesce(r.unit, '')
              and coalesce(p2.variant_label, '') = coalesce(r.variant_label, '')
              and p2.rn > r.rn
              and coalesce(p2.currency, '') = coalesce(r.currency, '')
            order by p2.rn
            limit 1
          ) prev on true
          where r.product_id = p.id
        ), '[]'::jsonb)
      )) order by p.is_current desc, p.factories_display_name)
      from (select * from peers order by is_current desc, factories_display_name limit 20) p
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.fds_compare_supplier_prices(text) from public, anon;
grant execute on function public.fds_compare_supplier_prices(text) to authenticated;

notify pgrst, 'reload schema';
