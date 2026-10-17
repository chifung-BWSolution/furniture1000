-- Speed up the 已發佈 / 全部 / 已下架 list: standalone shopify_products rows
-- ordered by imported_at DESC, published_at DESC NULLS LAST.
create index if not exists idx_shopify_products_imported_published
  on public.shopify_products (imported_at desc nulls last, published_at desc nulls last)
  where configurable is null;
