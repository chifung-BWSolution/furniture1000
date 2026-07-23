-- products.id is text (nanoid), but rejectedd_products.original_product_id was uuid.
-- Inserts from 產品目錄 / 待處理「暫不考慮」always failed with 22P02.
-- Align the column type and clear catalog membership for already-dismissed rows.

alter table public.rejectedd_products
  alter column original_product_id type text
  using original_product_id::text;

-- Products marked 暫不考慮 must leave the catalog so refresh does not revive them.
update public.products
set in_catalog = false
where dismissed is true
  and in_catalog is true;

notify pgrst, 'reload schema';
