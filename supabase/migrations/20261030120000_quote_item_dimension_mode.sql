-- Preserve the selected dimension interpretation without changing existing dimensions.
begin;
alter table public.bwf_quote_item add column if not exists dimension_mode text not null default 'lwh' check (dimension_mode in ('lwh', 'dh'));
create or replace function public.save_bwf_quote_items(
  p_quote_uuid uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  elem jsonb;
  idx int := 0;
begin
  if auth.role() is distinct from 'service_role'
     and not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  if p_quote_uuid is null then
    raise exception 'p_quote_uuid is required' using errcode = '22023';
  end if;

  delete from public.bwf_quote_item where quote_uuid = p_quote_uuid;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return;
  end if;

  for elem in select value from jsonb_array_elements(p_items)
  loop
    insert into public.bwf_quote_item (
      quote_uuid,
      sort_order,
      client_item_id,
      name,
      image,
      reference_image,
      remarks_image,
      unit_price,
      quantity,
      unit,
      cost_price,
      exchange_rate,
      hkd_cost_price,
      category,
      material,
      color,
      remarks,
      dimension_l_mm,
      dimension_w_mm,
      dimension_h_mm,
      dimension_mode,
      delivery_term_name,
      factory_name,
      factory_from_catalog,
      is_custom_term,
      is_optional,
      is_section_title,
      sku,
      hide_in_pdf,
      product_id,
      product_category_id
    ) values (
      p_quote_uuid,
      coalesce((elem->>'sort_order')::int, idx),
      nullif(elem->>'client_item_id', ''),
      coalesce(elem->>'name', ''),
      coalesce(elem->>'image', ''),
      nullif(elem->>'reference_image', ''),
      nullif(elem->>'remarks_image', ''),
      coalesce((elem->>'unit_price')::numeric, 0),
      coalesce((elem->>'quantity')::numeric, 1),
      nullif(elem->>'unit', ''),
      case when elem ? 'cost_price' and elem->>'cost_price' is not null and elem->>'cost_price' <> ''
        then (elem->>'cost_price')::numeric else null end,
      case when elem ? 'exchange_rate' and elem->>'exchange_rate' is not null and elem->>'exchange_rate' <> ''
        then (elem->>'exchange_rate')::numeric else null end,
      case when elem ? 'hkd_cost_price' and elem->>'hkd_cost_price' is not null and elem->>'hkd_cost_price' <> ''
        then (elem->>'hkd_cost_price')::numeric else null end,
      nullif(elem->>'category', ''),
      nullif(elem->>'material', ''),
      nullif(elem->>'color', ''),
      elem->>'remarks',
      nullif(btrim(elem->>'dimension_l_mm'), ''),
      nullif(btrim(elem->>'dimension_w_mm'), ''),
      nullif(btrim(elem->>'dimension_h_mm'), ''),
      coalesce(nullif(elem->>'dimension_mode', ''), 'lwh'),
      nullif(elem->>'delivery_term_name', ''),
      nullif(elem->>'factory_name', ''),
      coalesce((elem->>'factory_from_catalog')::boolean, false),
      coalesce((elem->>'is_custom_term')::boolean, false),
      coalesce((elem->>'is_optional')::boolean, false),
      coalesce((elem->>'is_section_title')::boolean, false),
      nullif(btrim(elem->>'sku'), ''),
      coalesce((elem->>'hide_in_pdf')::boolean, false),
      nullif(coalesce(elem->>'product_id', elem->>'productId'), ''),
      nullif(coalesce(elem->>'product_category_id', elem->>'productCategoryId'), '')::uuid
    );
    idx := idx + 1;
  end loop;
end;
$$;
notify pgrst, 'reload schema';
commit;
