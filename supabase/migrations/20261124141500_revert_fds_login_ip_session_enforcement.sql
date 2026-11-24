-- 退回 2026-11-24 早上的登入 IP 綁定：恢復瀏覽器可寫 login_log，並停用每週登入報告排程。
-- fds_active_sessions 與新增欄位保留，退回後的程式不再讀寫它們。

DROP POLICY IF EXISTS "Admins can read login_log" ON public.login_log;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.login_log;

CREATE POLICY "Allow all for authenticated users"
  ON public.login_log
  FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.login_log TO anon, authenticated;
GRANT ALL ON TABLE public.login_log TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(j.jobid)
    FROM cron.job AS j
    WHERE j.jobname = 'fds-login-weekly-digest';
  END IF;
END;
$cron$;

NOTIFY pgrst, 'reload schema';
