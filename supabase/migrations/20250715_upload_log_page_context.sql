-- Enrich upload_log with page context + SKU for 登入紀錄 edit rows.
ALTER TABLE public.upload_log
  ADD COLUMN IF NOT EXISTS page_label text,
  ADD COLUMN IF NOT EXISTS product_sku text;

COMMENT ON COLUMN public.upload_log.page_label IS
  'Human-readable page where the action occurred (e.g. 待處理產品, 產品文案).';

COMMENT ON COLUMN public.upload_log.product_sku IS
  'Product SKU at time of edit (denormalized for audit display).';

ALTER TABLE public.upload_log DROP CONSTRAINT IF EXISTS upload_log_stage_check;
ALTER TABLE public.upload_log ADD CONSTRAINT upload_log_stage_check CHECK (stage IN (
  'copywriting',
  'product_info',
  'furniture_group_check',
  'ready_to_publish',
  'listed_products',
  'product_catalog',
  'ai_processor',
  'settings',
  'general'
));
