-- Auto-generate products.sku as "{factory_id}-{model}" via trigger.
-- Fills sku only when it is empty/null so manual edits (e.g. from 產品文案) are preserved.
create or replace function public.set_product_sku()
returns trigger
language plpgsql
as $$
begin
  if (new.sku is null or new.sku = '')
     and new.factory_id is not null and new.factory_id <> ''
     and new.model is not null and new.model <> '' then
    new.sku := new.factory_id || '-' || new.model;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_product_sku on public.products;
create trigger trg_set_product_sku
  before insert or update of factory_id, model, sku on public.products
  for each row
  execute function public.set_product_sku();

-- Backfill existing rows that still have an empty sku.
update public.products
set sku = factory_id || '-' || model
where (sku is null or sku = '')
  and factory_id is not null and factory_id <> ''
  and model is not null and model <> '';
