-- Platform user profiles for 設定 > 用戶管理.
-- Synced from PMS staff/users + client_companies; role/active overrides stored here.

CREATE TABLE IF NOT EXISTS public.platform_user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  auth_user_id uuid,
  staff_id uuid,
  display_name text,
  role text NOT NULL DEFAULT 'uploader'
    CHECK (role IN ('admin', 'uploader', 'pm', 'designer', 'client')),
  active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'pms'
    CHECK (source IN ('pms', 'client')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_user_profiles_auth_user_id_idx
  ON public.platform_user_profiles (auth_user_id);

CREATE INDEX IF NOT EXISTS platform_user_profiles_last_login_idx
  ON public.platform_user_profiles (last_login_at DESC NULLS LAST);

ALTER TABLE public.platform_user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to platform_user_profiles" ON public.platform_user_profiles;
CREATE POLICY "Allow all access to platform_user_profiles"
  ON public.platform_user_profiles FOR ALL USING (true) WITH CHECK (true);
