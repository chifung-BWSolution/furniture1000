-- 1. 收緊 public.login_log 權限：禁止匿名讀取，只允許 admin 讀取，僅 service_role 可寫入。
ALTER TABLE public.login_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.login_log;
DROP POLICY IF EXISTS "Admins can read login_log" ON public.login_log;

CREATE POLICY "Admins can read login_log"
  ON public.login_log
  FOR SELECT
  TO authenticated
  USING (public.bwf_has_role(ARRAY['admin']));

REVOKE ALL ON TABLE public.login_log FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.login_log FROM authenticated;
GRANT SELECT ON TABLE public.login_log TO authenticated;
GRANT ALL ON TABLE public.login_log TO service_role;

-- 2. 修正 public.fds_check_login_session：
--    - 當代理未傳 IP (p_ip IS NULL) 時仍記錄首次登入，並使用 IS NOT DISTINCT FROM 去重。
--    - 判斷新 Auth session 替換與同 session 換 IP 時區分處理，避免漏記同 IP 重登或誤重複。
CREATE OR REPLACE FUNCTION public.fds_check_login_session(
  p_user_id uuid,
  p_auth_session_id uuid,
  p_action text,
  p_ip text,
  p_user_agent text,
  p_email text,
  p_user_name text,
  p_login_method text,
  p_record_login boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_active public.fds_active_sessions%ROWTYPE;
  v_started_at timestamptz;
  v_reason text;
  v_event text;
  v_previous_ip text;
  v_replaced_session boolean;
  v_method text;
  v_name text;
BEGIN
  IF p_action NOT IN ('register_session', 'verify_session', 'clear_session') THEN
    RAISE EXCEPTION 'invalid_session_action';
  END IF;

  v_method := CASE
    WHEN p_login_method IN ('password', 'sso') THEN p_login_method
    ELSE 'password'
  END;
  v_name := NULLIF(btrim(COALESCE(p_user_name, '')), '');

  PERFORM pg_advisory_xact_lock(hashtextextended('fds-login:' || p_user_id::text, 0));

  SELECT created_at INTO v_started_at
  FROM auth.sessions
  WHERE id = p_auth_session_id
    AND user_id = p_user_id;

  SELECT * INTO v_active
  FROM public.fds_active_sessions
  WHERE user_id = p_user_id;

  -- 舊列沒有 Auth session id 時不當成「在其他位置登入」。
  IF v_active.user_id IS NOT NULL AND v_active.auth_session_id IS NULL THEN
    DELETE FROM public.fds_active_sessions WHERE user_id = p_user_id;
    v_active.user_id := NULL;
    v_active.auth_session_id := NULL;
    v_active.session_started_at := NULL;
    v_active.bound_ip := NULL;
  END IF;

  IF p_action = 'clear_session' THEN
    UPDATE public.fds_active_sessions
    SET invalidated_reason = COALESCE(invalidated_reason, 'signed_out'),
        updated_at = now()
    WHERE user_id = p_user_id
      AND auth_session_id = p_auth_session_id;

    INSERT INTO public.login_log (
      user_id, user_email, user_name, event, login_method, logged_at,
      ip_address, user_agent, session_id
    )
    SELECT
      p_user_id, p_email, v_name, 'logout', v_method, now(),
      p_ip, p_user_agent, p_auth_session_id::text
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.login_log
      WHERE user_id = p_user_id
        AND session_id = p_auth_session_id::text
        AND event = 'logout'
    );

    RETURN jsonb_build_object('ok', true);
  END IF;

  -- 這支 token 的 Auth session 已經不在。自願登出或其他撤銷，不是換 IP。
  IF v_started_at IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'signed_out');
  END IF;

  IF v_active.auth_session_id = p_auth_session_id THEN
    -- 舊規則留下的 ip_mismatch 不再算登出。
    IF v_active.invalidated_reason IS DISTINCT FROM 'ip_mismatch' THEN
      v_reason := v_active.invalidated_reason;
    END IF;
  ELSIF v_active.user_id IS NOT NULL
    AND v_started_at <= v_active.session_started_at THEN
    -- 較舊的 Auth session 不能覆蓋已經登入的較新 session。較新的會在下面換掉這一列。
    v_reason := 'session_replaced';
  END IF;

  IF v_reason IS NULL AND now() - v_started_at >= interval '336 hours' THEN
    v_reason := 'session_expired';
  END IF;

  IF v_reason IS NOT NULL THEN
    IF v_active.auth_session_id = p_auth_session_id
       AND v_reason IS DISTINCT FROM 'signed_out' THEN
      UPDATE public.fds_active_sessions
      SET invalidated_reason = v_reason,
          updated_at = now()
      WHERE user_id = p_user_id
        AND invalidated_reason IS NULL;
    END IF;

    IF v_reason IS DISTINCT FROM 'signed_out' THEN
      v_event := CASE v_reason
        WHEN 'session_expired' THEN 'forced_logout_session_expired'
        ELSE 'forced_logout_session_replaced'
      END;
      INSERT INTO public.login_log (
        user_id, user_email, user_name, event, login_method, logged_at,
        ip_address, user_agent, session_id
      )
      SELECT
        p_user_id, p_email, v_name, v_event, COALESCE(v_active.login_method, v_method), now(),
        p_ip, p_user_agent, p_auth_session_id::text
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.login_log
        WHERE user_id = p_user_id
          AND session_id = p_auth_session_id::text
          AND event = v_event
      );
    END IF;

    RETURN jsonb_build_object('valid', false, 'reason', v_reason);
  END IF;

  v_previous_ip := v_active.bound_ip;
  v_replaced_session := (v_active.auth_session_id IS DISTINCT FROM p_auth_session_id);

  IF v_replaced_session THEN
    INSERT INTO public.fds_active_sessions (
      user_id, session_id, auth_session_id, bound_ip, user_agent,
      session_started_at, login_method, invalidated_reason, last_verified_at, updated_at
    ) VALUES (
      p_user_id, p_auth_session_id::text, p_auth_session_id, p_ip, p_user_agent,
      v_started_at, v_method, NULL, now(), now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      session_id = EXCLUDED.session_id,
      auth_session_id = EXCLUDED.auth_session_id,
      bound_ip = EXCLUDED.bound_ip,
      user_agent = EXCLUDED.user_agent,
      session_started_at = EXCLUDED.session_started_at,
      login_method = EXCLUDED.login_method,
      invalidated_reason = NULL,
      last_verified_at = now(),
      updated_at = now();
    v_active.session_id := p_auth_session_id::text;
    v_active.auth_session_id := p_auth_session_id;
    v_active.bound_ip := p_ip;
    v_active.login_method := v_method;
  ELSE
    UPDATE public.fds_active_sessions
    SET bound_ip = COALESCE(p_ip, bound_ip),
        login_method = COALESCE(login_method, v_method),
        invalidated_reason = CASE
          WHEN invalidated_reason = 'ip_mismatch' THEN NULL
          ELSE invalidated_reason
        END,
        last_verified_at = now(),
        updated_at = now()
    WHERE user_id = p_user_id;
    v_active.bound_ip := COALESCE(p_ip, v_active.bound_ip);
  END IF;

  IF (p_action = 'register_session' AND p_record_login)
     OR v_replaced_session
     OR (NOT v_replaced_session AND p_ip IS NOT NULL AND v_previous_ip IS DISTINCT FROM p_ip) THEN
    INSERT INTO public.login_log (
      user_id, user_email, user_name, event, login_method, logged_at,
      ip_address, user_agent, session_id
    )
    SELECT
      p_user_id,
      p_email,
      v_name,
      'login',
      COALESCE(v_active.login_method, v_method),
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.login_log
          WHERE user_id = p_user_id
            AND session_id = p_auth_session_id::text
            AND event = 'login'
        ) THEN now()
        ELSE v_started_at
      END,
      p_ip,
      p_user_agent,
      p_auth_session_id::text
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.login_log
      WHERE user_id = p_user_id
        AND session_id = p_auth_session_id::text
        AND event = 'login'
        AND ip_address IS NOT DISTINCT FROM p_ip
    );
  END IF;

  IF v_name IS NOT NULL THEN
    UPDATE public.login_log
    SET user_name = v_name
    WHERE user_id = p_user_id
      AND session_id = p_auth_session_id::text
      AND event = 'login'
      AND user_name IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'valid', true,
    'sessionId', p_auth_session_id,
    'boundIp', v_active.bound_ip,
    'sessionStartedAt', v_started_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fds_check_login_session(uuid, uuid, text, text, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fds_check_login_session(uuid, uuid, text, text, text, text, text, text, boolean)
  TO service_role;

-- 3. 恢復 public.fds_login_digest_email_runs 表與每週一 10:00 HKT 登入報告排程（僅正式庫）
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

  PERFORM cron.unschedule(j.jobid)
  FROM cron.job AS j
  WHERE j.jobname = 'fds-login-weekly-digest';

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
