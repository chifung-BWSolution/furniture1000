-- Share links for client-portal viewing of a single bwf_quote (QR / copy URL).
CREATE TABLE IF NOT EXISTS public.bwf_quote_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_uuid uuid NOT NULL REFERENCES public.bwf_quote(id) ON DELETE CASCADE,
  quote_id text NOT NULL,
  share_token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz NULL,
  created_date timestamptz NULL,
  modified_date timestamptz NULL,
  creator_staff_id uuid NULL,
  editor_staff_id uuid NULL
);

CREATE INDEX IF NOT EXISTS idx_bwf_quote_share_links_quote_uuid
  ON public.bwf_quote_share_links (quote_uuid);

CREATE INDEX IF NOT EXISTS idx_bwf_quote_share_links_token_active
  ON public.bwf_quote_share_links (share_token)
  WHERE status = 'active';

COMMENT ON TABLE public.bwf_quote_share_links IS
  'Customer-portal share tokens for a quotation (QR / link). Active token opens 報價方案 detail.';

ALTER TABLE public.bwf_quote_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to bwf_quote_share_links" ON public.bwf_quote_share_links;
CREATE POLICY "Allow all access to bwf_quote_share_links"
  ON public.bwf_quote_share_links
  FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.bwf_quote_share_links TO anon, authenticated, service_role;
