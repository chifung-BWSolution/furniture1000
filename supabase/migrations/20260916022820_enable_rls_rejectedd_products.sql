-- Security Advisor: RLS Disabled in Public on rejectedd_products.
-- Staff dashboard inserts archive rows (暫不考慮) while authenticated.

ALTER TABLE public.rejectedd_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can manage rejectedd_products"
  ON public.rejectedd_products;

CREATE POLICY "authenticated can manage rejectedd_products"
  ON public.rejectedd_products
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
