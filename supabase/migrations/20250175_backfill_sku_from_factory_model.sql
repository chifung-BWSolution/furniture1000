-- Backfill sku = factory_id || '-' || model for all products where both fields exist
update public.products
set sku = factory_id || '-' || model
where factory_id is not null
  and factory_id <> ''
  and model is not null
  and model <> '';

-- Sync the same sku value into ready_to_shopify via product_id join
update public.ready_to_shopify rts
set sku = p.sku
from public.products p
where rts.product_id = p.id
  and p.sku is not null
  and p.sku <> '';
