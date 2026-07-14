-- Password / session login audit (SSO remains in pms_sso_codes).
CREATE TABLE IF NOT EXISTS public.login_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_email text,
  user_name text,
  event text NOT NULL DEFAULT 'login' CHECK (event IN ('login', 'logout')),
  login_method text NOT NULL DEFAULT 'password' CHECK (login_method IN ('password', 'sso')),
  logged_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.login_log IS
  'Furniture platform sign-in/out events (password or refreshed session). SSO logins also in pms_sso_codes.';

CREATE INDEX IF NOT EXISTS login_log_logged_at_idx
  ON public.login_log (logged_at DESC);

CREATE INDEX IF NOT EXISTS login_log_user_email_idx
  ON public.login_log (user_email);

CREATE INDEX IF NOT EXISTS login_log_user_id_idx
  ON public.login_log (user_id);

ALTER TABLE public.login_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.login_log;
CREATE POLICY "Allow all for authenticated users"
  ON public.login_log FOR ALL USING (true) WITH CHECK (true);

-- Backfill: one inferred login per HK day from earliest upload_log activity (password login was not tracked before).
INSERT INTO public.login_log (user_id, user_email, user_name, event, logged_at)
SELECT DISTINCT ON (ul.user_id, ((ul.logged_at AT TIME ZONE 'Asia/Hong_Kong')::date))
  ul.user_id,
  ul.user_email,
  ul.user_name,
  'login',
  ul.logged_at
FROM public.upload_log ul
WHERE ul.user_id IS NOT NULL
  AND ul.user_email = 'chifung.login@gmail.com'
  AND ul.logged_at >= '2026-07-07T00:00:00+08:00'
ORDER BY ul.user_id, ((ul.logged_at AT TIME ZONE 'Asia/Hong_Kong')::date), ul.logged_at ASC;
