-- One-time SSO exchange codes for PMS → Furniture login bridge.
-- Minted by edge function (service role); consumed once to create a Furniture session.

CREATE TABLE IF NOT EXISTS public.pms_sso_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pms_sso_codes_code ON public.pms_sso_codes (code);
CREATE INDEX IF NOT EXISTS idx_pms_sso_codes_expires_at ON public.pms_sso_codes (expires_at);

ALTER TABLE public.pms_sso_codes ENABLE ROW LEVEL SECURITY;

-- No client access — only service role (edge functions) may read/write.
CREATE POLICY "Deny all client access on pms_sso_codes"
  ON public.pms_sso_codes
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.pms_sso_codes IS
  'Short-lived one-time codes for PMS SSO login into Furniture 1000. Managed by pms-sso edge function only.';
