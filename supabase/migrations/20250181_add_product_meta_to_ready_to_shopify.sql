-- Carry extra product attributes from products → ready_to_shopify when a product
-- is added via 「A 加入Shopify」, so the publish flow can reference them.
alter table public.ready_to_shopify
  add column if not exists factory_id      text,
  add column if not exists remarks         text,
  add column if not exists color           text,
  add column if not exists dimension_l_mm  integer,
  add column if not exists dimension_w_mm  integer,
  add column if not exists dimension_h_mm  integer,
  add column if not exists material        text,
  add column if not exists image_url_2     text,
  add column if not exists image_url_3     text,
  add column if not exists in_stock        boolean,
  add column if not exists production_time text;
