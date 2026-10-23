-- BWF staff share platform role pm with BWA. The quote-write guard
-- bwf_reject_bwa_pm_quote_write() raised permission_denied for every pm,
-- so 報價單草稿編輯 → 版本審核 returned that error and saved nothing.
-- Internal quotes stay writable by pm. BWA inquiry RPCs are unchanged.

DROP TRIGGER IF EXISTS bwf_quote_reject_bwa_pm ON public.bwf_quote;
DROP TRIGGER IF EXISTS bwf_quote_item_reject_bwa_pm ON public.bwf_quote_item;
DROP TRIGGER IF EXISTS bwf_quote_share_reject_bwa_pm ON public.bwf_quote_share_links;
DROP FUNCTION IF EXISTS public.bwf_reject_bwa_pm_quote_write();

GRANT ALL ON TABLE public.bwf_quote TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.bwf_quote_item TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.bwf_quote_share_links TO anon, authenticated, service_role;

DROP POLICY IF EXISTS bwf_quote_block_bwa_pm ON public.bwf_quote;
DROP POLICY IF EXISTS bwf_quote_block_bwa_pm_anon ON public.bwf_quote;
DROP POLICY IF EXISTS bwf_quote_staff_full ON public.bwf_quote;
DROP POLICY IF EXISTS "Allow all access to bwf_quote" ON public.bwf_quote;
CREATE POLICY "Allow all access to bwf_quote"
  ON public.bwf_quote
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS bwf_quote_item_block_bwa_pm ON public.bwf_quote_item;
DROP POLICY IF EXISTS bwf_quote_item_block_bwa_pm_anon ON public.bwf_quote_item;
DROP POLICY IF EXISTS bwf_quote_item_staff_full ON public.bwf_quote_item;
DROP POLICY IF EXISTS "Allow all access to bwf_quote_item" ON public.bwf_quote_item;
CREATE POLICY "Allow all access to bwf_quote_item"
  ON public.bwf_quote_item
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS bwf_quote_share_block_bwa_pm ON public.bwf_quote_share_links;
DROP POLICY IF EXISTS bwf_quote_share_block_bwa_pm_anon ON public.bwf_quote_share_links;
DROP POLICY IF EXISTS bwf_quote_share_staff_full ON public.bwf_quote_share_links;
DROP POLICY IF EXISTS "Allow all access to bwf_quote_share_links" ON public.bwf_quote_share_links;
CREATE POLICY "Allow all access to bwf_quote_share_links"
  ON public.bwf_quote_share_links
  FOR ALL
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
