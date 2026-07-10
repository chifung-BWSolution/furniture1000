-- 傢俬組檢查最後儲存時間（格式同 info_completed_at：timestamptz）
ALTER TABLE public.ready_to_shopify
  ADD COLUMN IF NOT EXISTS checked_edited_at timestamptz;

COMMENT ON COLUMN public.ready_to_shopify.checked_edited_at IS
  'Last edit/save on 傢俬組檢查 or when moved to 準備上載 (Hong Kong local time stored as timestamptz).';

CREATE INDEX IF NOT EXISTS ready_to_shopify_checked_edited_at_idx
  ON public.ready_to_shopify (checked_edited_at DESC NULLS LAST)
  WHERE furniture_group_checked IS NOT NULL;

-- 網上發佈各階段操作日誌（產品文案 / 產品信息 / 傢俬組檢查 / 準備上載）
CREATE TABLE IF NOT EXISTS public.upload_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text REFERENCES public.products(id) ON DELETE SET NULL,
  rts_id uuid,
  stage text NOT NULL CHECK (stage IN (
    'copywriting',
    'product_info',
    'furniture_group_check',
    'ready_to_publish'
  )),
  action text NOT NULL CHECK (action IN (
    'submit',
    'save',
    'complete',
    'add_to_ready',
    'upload'
  )),
  user_id uuid,
  user_email text,
  user_name text,
  logged_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.upload_log IS
  'Per-product publish pipeline audit: who changed/submitted/uploaded and when (aggregate by HK date via logged_at AT TIME ZONE ''Asia/Hong_Kong'').';

CREATE INDEX IF NOT EXISTS upload_log_stage_logged_at_idx
  ON public.upload_log (stage, logged_at DESC);

CREATE INDEX IF NOT EXISTS upload_log_product_id_idx
  ON public.upload_log (product_id);

CREATE INDEX IF NOT EXISTS upload_log_logged_at_hk_idx
  ON public.upload_log (((logged_at AT TIME ZONE 'Asia/Hong_Kong')::date), stage);

ALTER TABLE public.upload_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.upload_log;
CREATE POLICY "Allow all for authenticated users"
  ON public.upload_log FOR ALL USING (true) WITH CHECK (true);
