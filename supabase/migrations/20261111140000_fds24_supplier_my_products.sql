-- FDS Supplier Portal（第一期甲 §6.1）：供應商「我的傢俬」。
-- 只回自己廠的產品與自己廠已審核成本；不回售價、折扣價、毛利、其他廠價格。
-- factory_id 只從 supplier_logins 解析，不接受前端傳入。

create or replace function public.fds_supplier_my_products(
  p_search text default null,
  p_limit integer default 200
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_factory text;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.bwf_has_role(array['supplier']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  v_factory := public.fds_supplier_factory_folder();
  if v_factory is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.modified_date desc nulls last)
    from (
      select
        p.id,
        p.model,
        p.title,
        p.specifications,
        p.image_url,
        p.status,
        coalesce(p.in_stock, true) as in_stock,
        p.modified_date,
        lp.cost_price,
        lp.currency,
        lp.quote_year as latest_quote_year
      from public.products p
      left join lateral (
        select sp.cost_price, sp.currency, sp.quote_year
        from public.supplier_prices sp
        where sp.product_id = p.id
          and sp.factory_id = v_factory
        order by sp.quote_year desc nulls last, sp.created_at desc nulls last
        limit 1
      ) lp on true
      where (p.factory_id = v_factory or lp.cost_price is not null)
        and coalesce(p.dismissed, false) = false
        and (
          v_term is null
          or coalesce(p.model, '') ilike '%' || v_term || '%'
          or coalesce(p.title, '') ilike '%' || v_term || '%'
        )
      order by p.modified_date desc nulls last
      limit v_limit
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fds_supplier_my_products(text, integer) from public, anon;
grant execute on function public.fds_supplier_my_products(text, integer) to authenticated;

notify pgrst, 'reload schema';
