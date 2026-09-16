-- Security Advisor: RLS Enabled No Policy on delivery_terms.
-- Lookup table (現貨 / 定制 lead-time buckets). Staff dashboard may read/write it.

ALTER TABLE public.delivery_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can manage delivery_terms"
  ON public.delivery_terms;

CREATE POLICY "authenticated can manage delivery_terms"
  ON public.delivery_terms
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
