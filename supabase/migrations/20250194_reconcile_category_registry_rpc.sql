-- One-shot server-side category reconcile (replaces ~80×3 client round-trips).

create or replace function public.reconcile_category_registry()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_products int := 0;
  v_rts int := 0;
begin
  with l2_singleton as (
    select pc.level1, pc.level2
    from product_category pc
    where nullif(trim(pc.level2), '') is not null
      and (select count(*) from product_category pc2 where pc2.level2 = pc.level2) = 1
  ),
  prod_upd as (
    update products p
    set level1_category = s.level1
    from l2_singleton s
    where p.level2_category = s.level2
      and p.level1_category is distinct from s.level1
    returning p.id
  ),
  rts_upd as (
    update ready_to_shopify r
    set product_type = trim(s.level1) || ' / ' || trim(s.level2)
    from l2_singleton s
    join products p on p.level2_category = s.level2 and p.level1_category = s.level1
    where r.product_id = p.id
      and r.product_type is distinct from (trim(s.level1) || ' / ' || trim(s.level2))
    returning r.product_id
  )
  select (select count(*) from prod_upd), (select count(*) from rts_upd)
  into v_products, v_rts;

  return jsonb_build_object('products_updated', v_products, 'rts_updated', v_rts);
end;
$$;

grant execute on function public.reconcile_category_registry() to anon, authenticated;
