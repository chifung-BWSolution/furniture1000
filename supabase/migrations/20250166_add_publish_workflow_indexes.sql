-- Performance indexes for the 網上發佈 (publish) workflow list queries.
-- The product 文案 / 信息 / 發佈前檢查 pages filter products by in_shopify_queue
-- together with copy_done / info_done / ready_to_publish, and order by
-- copy_done_at / created_at. Without indexes the exact-count query does a full
-- table scan (~2000 rows) and the list takes minutes to load.
--
-- NOTE: Run each CREATE INDEX CONCURRENTLY statement SEPARATELY in the Supabase
-- SQL Editor. CONCURRENTLY builds the index in the background without locking
-- the table, avoiding the "connection terminated due to connection timeout"
-- error seen when creating many indexes in one batch. It also cannot run inside
-- a transaction block, so do not run them all together.

-- 產品文案: in_shopify_queue = true AND (copy_done is null OR copy_done = false)
create index concurrently if not exists products_publish_copy_idx
  on public.products (in_shopify_queue, copy_done, copy_done_at desc);

-- 產品信息: in_shopify_queue = true AND info_done = false
create index concurrently if not exists products_publish_info_idx
  on public.products (in_shopify_queue, info_done);

-- 發佈前檢查: in_shopify_queue = true AND info_done = true AND ready_to_publish
create index concurrently if not exists products_publish_precheck_idx
  on public.products (in_shopify_queue, info_done, ready_to_publish);

-- Common ordering / general list ordering by created_at
create index concurrently if not exists products_created_at_idx
  on public.products (created_at desc);

-- Category + factory filters used across publish & catalog pages
create index concurrently if not exists products_level1_category_idx
  on public.products (level1_category);
create index concurrently if not exists products_level2_category_idx
  on public.products (level2_category);
create index concurrently if not exists products_factories_display_name_idx
  on public.products (factories_display_name);

-- Refresh planner statistics so the new indexes are picked up immediately
analyze public.products;
