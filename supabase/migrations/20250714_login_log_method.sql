ALTER TABLE public.login_log
  ADD COLUMN IF NOT EXISTS login_method text NOT NULL DEFAULT 'password'
  CHECK (login_method IN ('password', 'sso'));

COMMENT ON COLUMN public.login_log.login_method IS
  'password = email/password or magic link session; sso = PMS SSO exchange.';

-- Historical backfill rows were inferred from upload activity (password sessions).
UPDATE public.login_log SET login_method = 'password' WHERE login_method IS NULL;
