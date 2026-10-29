-- Extend the existing product search scope without changing its API or pagination.
do $migration$
declare r record; definition text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and pg_get_functiondef(p.oid) like '%when ''quoted'' then exists (select 1 from public.supplier_prices%'
  loop
    definition := pg_get_functiondef(r.oid);
    if definition not like '%when ''modeled''%' then
      definition := replace(definition, 'when ''quoted'' then exists',
        'when ''modeled'' then exists (select 1 from public.product_models pm where pm.product_id = p.id) when ''quoted'' then exists');
      execute definition;
    end if;
  end loop;
end $migration$;
