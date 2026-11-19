-- Products/factory pricing use the PMS factory code (e.g. QXS), while
-- supplier_logins.factory_id stores the PMS factories UUID. Keep the code on the
-- login row so "我的傢俬" can resolve the supplier's products without trusting
-- the browser. Older rows fall back to factories_display_name.

alter table public.supplier_logins add column if not exists factory_code text;

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
  v_factory_id text;
  v_factory_code text;
  v_factory_name text;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.bwf_has_role(array['supplier']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select l.factory_id,
         nullif(upper(btrim(coalesce(l.factory_code, ''))), ''),
         nullif(btrim(coalesce(l.factory_name, '')), '')
    into v_factory_id, v_factory_code, v_factory_name
  from public.supplier_logins l
  where l.active is true
    and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;

  if v_factory_id is null then
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
          and (
            sp.factory_id = v_factory_id
            or (v_factory_code is not null and upper(sp.factory_id) = v_factory_code)
            or (v_factory_name is not null and sp.factory_name = v_factory_name)
          )
        order by sp.quote_year desc nulls last, sp.created_at desc nulls last
        limit 1
      ) lp on true
      where (
          p.factory_id = v_factory_id
          or (v_factory_code is not null and upper(p.factory_id) = v_factory_code)
          or (v_factory_name is not null and p.factories_display_name = v_factory_name)
          or lp.cost_price is not null
        )
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
