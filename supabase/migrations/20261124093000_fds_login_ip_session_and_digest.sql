-- FDS 登入安全（IP 綁定、14 日 Session 絕對有效期）與每週登入安全報告排程

-- 1. 擴充 public.login_log
ALTER TABLE public.login_log
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS auth_last_sign_in_at timestamptz;

COMMENT ON COLUMN public.login_log.ip_address IS '伺服器端由請求標頭擷取之真實客戶端 IP';
COMMENT ON COLUMN public.login_log.user_agent IS '登入／登出請求之 User-Agent';
COMMENT ON COLUMN public.login_log.session_id IS '對應 fds_active_sessions.session_id';
COMMENT ON COLUMN public.login_log.auth_last_sign_in_at IS 'Supabase Auth user.last_sign_in_at，用於避免頁面重整重複寫入 login';

DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.login_log'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%event%'
  LOOP
    EXECUTE format('ALTER TABLE public.login_log DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;
END;
$$;

ALTER TABLE public.login_log
  ADD CONSTRAINT login_log_event_check
  CHECK (
    event IN (
      'login',
      'logout',
      'forced_logout_ip_mismatch',
      'forced_logout_session_expired'
    )
  );

CREATE INDEX IF NOT EXISTS login_log_user_id_logged_at_idx
  ON public.login_log (user_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS login_log_user_id_auth_last_sign_in_at_idx
  ON public.login_log (user_id, auth_last_sign_in_at);

-- 收緊 login_log 權限：僅 service_role 可寫入，防止瀏覽器偽造 IP；admin 可讀
ALTER TABLE public.login_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.login_log;
DROP POLICY IF EXISTS "Admins can read login_log" ON public.login_log;

CREATE POLICY "Admins can read login_log"
  ON public.login_log
  FOR SELECT
  TO authenticated
  USING (public.bwf_has_role(ARRAY['admin']));

REVOKE INSERT, UPDATE, DELETE ON public.login_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.login_log TO service_role;

-- 2. 新增 public.fds_active_sessions（每帳號最新有效 Session 與綁定 IP）
CREATE TABLE IF NOT EXISTS public.fds_active_sessions (
  user_id uuid PRIMARY KEY,
  session_id text NOT NULL,
  bound_ip text,
  user_agent text,
  session_started_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fds_active_sessions IS
  'FDS 活躍登入階段與綁定 IP（僅供 Edge Function service_role 存取，執行 IP 變更檢查與 14 日到期控制）';

ALTER TABLE public.fds_active_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fds_active_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.fds_active_sessions TO service_role;

-- 3. 新增 public.fds_login_digest_email_runs（每週登入報告冪等寄送紀錄）
CREATE TABLE IF NOT EXISTS public.fds_login_digest_email_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  recipient text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  provider text,
  provider_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_start, recipient)
);

COMMENT ON TABLE public.fds_login_digest_email_runs IS
  '每週登入安全報告（Resend）冪等寄送狀態紀錄';

CREATE INDEX IF NOT EXISTS fds_login_digest_email_runs_week_start_idx
  ON public.fds_login_digest_email_runs (week_start DESC);

ALTER TABLE public.fds_login_digest_email_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fds_login_digest_email_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.fds_login_digest_email_runs TO service_role;

-- 4. 註冊 pg_cron 排程：每週一 10:00 HKT（02:00 UTC）寄送每週登入報告
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $cron$
DECLARE
  v_host text;
  v_command text;
BEGIN
  SELECT substring(command FROM $re$https://[a-z0-9]+\.supabase\.co$re$)
    INTO v_host
  FROM cron.job
  WHERE jobname = 'fds-process-jobs'
  LIMIT 1;

  IF v_host IS NULL OR v_host = '' THEN
    v_host := 'https://riaubhtruisbwdlwjzur.supabase.co';
  END IF;

  PERFORM cron.unschedule('fds-login-weekly-digest')
  FROM cron.job
  WHERE jobname = 'fds-login-weekly-digest';

  IF v_host = 'https://riaubhtruisbwdlwjzur.supabase.co' THEN
    v_command := format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/send-login-weekly-digest',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'fds_worker_secret'
            LIMIT 1
          )
        ),
        body := '{"source":"cron"}'::jsonb,
        timeout_milliseconds := 15000
      ) AS request_id;
    $job$, v_host);

    PERFORM cron.schedule('fds-login-weekly-digest', '0 2 * * 1', v_command);
  END IF;
END;
$cron$;

NOTIFY pgrst, 'reload schema';
