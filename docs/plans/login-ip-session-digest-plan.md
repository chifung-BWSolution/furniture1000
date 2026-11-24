# FDS（Furniture 1000）登入安全與每週登入報告實作計劃

## 目標摘要
在 **FDS / Furniture 1000**（`d:\work\furniture1000`）中獨立實作以下三項安全與營運通知功能：
1. **每週 Resend 登入報告**：每週一 **10:00 HKT**（`02:00 UTC`，cron `0 2 * * 1`）彙總上週一至上週日（`Asia/Hong_Kong`）的帳號登入次數與不同 IP 數量，特別標出「**≥ 2 個不同 IP 登入**」的帳號明細，並使用 FDS 既有 BW Furniture 品牌郵件模板寄送給 Franco、Angel、Nero。
2. **IP 變更檢查與強制登出再登入**：登入成功時由伺服器綁定當前真實客戶端 IP；後續操作／分頁回到前景／定時檢查時，若偵測到同一 Session 的來源 IP 變更，或同一帳號從另一 IP 重新登入，立即強制登出並要求重新登入。
3. **Session 每 14 日登出一次**：前端與後端同步執行 14 日（`14 * 24 * 60 * 60` 秒 = `1,209,600` 秒）絕對有效期檢查，到期自動登出並要求重新登入。

---

## 專案與環境配置
- **Supabase 專案**：`riaubhtruisbwdlwjzur`。
- **專案約束（依 `AGENTS.md` 與 `CLAUDE.md`）**：
  - 部署 Edge Function 前務必核對前端 `supabase.functions.invoke(...)` 實際呼叫的 slug（新函式統一確認前端與部署 slug 完全一致，避免舊 `supabase-functions-*` 重複 slug 陷阱）。
  - 含中文註解的 Migration 一律透過 `node scripts/apply-migration.mjs` 套用，不用 PowerShell 直接送 JSON。
  - 不改寫 PMS 既有契約。
- **預設收件人**（支援由 Supabase Secret `FDS_LOGIN_DIGEST_RECIPIENTS` 覆寫）：
  - `franco.kaffa@gmail.com`
  - `angel.kaffa@gmail.com`
  - `cfb.system@chifung.net`
- **郵件模板與寄件者**：
  - 模板：`supabase/functions/_shared/brandedEmail.ts`（`renderBrandedEmail()`、`renderDetailBox()`、`companyFooterText()` — BW Furniture 藍色主題 `#2F6BED` / `#0E1B3A`、`#F1F5FC` 底色、Logo `https://www.bwteam-furniture.com/assets/bwf-logo.png`）。
  - 寄信函式：`supabase/functions/_shared/email.ts`（`sendEmail()` 優先走 Resend `RESEND_API_KEY`，寄件者 `FDS_EMAIL_FROM ?? "BW Furniture <no-reply@bwteam-furniture.com>"`）。

---

## 現況盤點與關鍵缺口
- `src/contexts/AuthProvider.tsx`：目前無 14 日 Session 到期檢查與 IP 變更檢查，且每次全頁載入（`INITIAL_SESSION` / `SIGNED_IN`）都會寫入 `login` 紀錄，導致登入次數被頁面重整放大。
- `public.login_log`（`supabase/migrations/20250714_create_login_log.sql`）：目前由瀏覽器 `src/lib/loginLog.ts` 直接 `insert`，**缺少 `ip_address` 欄位**，無法在前端可靠取得真實客戶端 IP。
- `supabase/functions/pms-sso/index.ts`：SSO 登入路徑需同步記錄來源 IP 並建立 Active Session。

---

## 實作步驟

### 1. 資料庫 Migration
新增 `supabase/migrations/<timestamp>_fds_login_ip_session_and_digest.sql`：
1. **擴充 `public.login_log`**：
   - 新增欄位：`ip_address text`、`user_agent text`、`session_id text`、`auth_last_sign_in_at timestamptz`。
   - 擴充 `event` check constraint：允許 `'login'`、`'logout'`、`'forced_logout_ip_mismatch'`、`'forced_logout_session_expired'`。
   - 新增索引：`(user_id, logged_at desc)`、`(user_id, auth_last_sign_in_at)`。
   - 收緊 `public.login_log` 寫入權限：改由 Edge Function（`service_role`）寫入真實 IP，避免瀏覽器偽造 IP。
2. **新增 `public.fds_active_sessions`**：
   - 欄位：`user_id uuid primary key`、`session_id text not null`、`bound_ip text`、`user_agent text`、`session_started_at timestamptz not null default now()`、`last_verified_at timestamptz not null default now()`、`updated_at timestamptz not null default now()`。
   - 啟用 RLS，僅 `service_role` 可存取。
3. **新增 `public.fds_login_digest_email_runs`**（冪等紀錄表）：
   - 欄位：`id uuid primary key default gen_random_uuid()`、`week_start date not null`、`recipient text not null`、`status text not null check (status in ('pending','sent','failed'))`、`provider text`、`provider_id text`、`error text`、`sent_at timestamptz`、`created_at timestamptz`、`updated_at timestamptz`，加上 `unique (week_start, recipient)`。
4. **註冊 `pg_cron` 排程**：
   - Job 名稱：`fds-login-weekly-digest`
   - 排程：`0 2 * * 1`（每週一 `02:00 UTC` = `10:00 HKT`）
   - 比照 `send-upload-log-report-email` 使用 `x-worker-secret` + `fds_worker_verify_secret` 驗證。

### 2. Edge Functions
1. **新增 `supabase/functions/fds-session-guard/index.ts`**（前端與部署 slug 統一為 `fds-session-guard`）：
   - 統一以 `cf-connecting-ip` → `x-forwarded-for` 第一個 IP → `x-real-ip` 擷取真實 IP。
   - `record_login`（驗證 Bearer JWT）：
     - 以 `(user_id, auth_last_sign_in_at, ip_address)` 去重，避免單純按 F5 重新整理重複計入登入次數。
     - 寫入 `public.login_log`（含真實 `ip_address`、`login_method`、`user_name`），並更新 `fds_active_sessions`（寫入新 `session_id`、`bound_ip`、`session_started_at`）。
     - 回傳 `{ ok: true, sessionId, boundIp, sessionStartedAt }`。
   - `verify_session`（驗證 Bearer JWT）：
     - 檢查 `fds_active_sessions` 的 `session_id` 與 `bound_ip` 是否與當前請求相符，以及 `session_started_at` 是否已滿 14 日（容忍 60 秒時鐘偏移）。
     - 若不符，寫入 `public.login_log`（`forced_logout_ip_mismatch` / `forced_logout_session_expired`）並回傳 `{ valid: false, reason }`。
   - `record_logout`（驗證 Bearer JWT）：寫入 `logout`（含 IP）並清除 `fds_active_sessions`。
2. **更新 `supabase/functions/pms-sso/index.ts`**：
   - 在 SSO code exchange 階段擷取真實 IP，寫入 `public.login_log`（`login_method = 'sso'`）並初始化 `fds_active_sessions`。
3. **新增 `supabase/functions/_shared/loginDigestEmail.ts`**：
   - 呼叫 `renderBrandedEmail()`（`locale: "zh-Hant"`）與 `companyFooterText("zh-Hant")`，產出 BW Furniture 風格的每週登入安全報告 HTML 與純文字版本。
   - 內容包含：摘要 KPI（`renderDetailBox`）、多 IP 異常帳號表（≥ 2 個不同 IP）、所有帳號登入次數與 IP 清單、強制登出統計。
4. **新增 `supabase/functions/send-login-weekly-digest/index.ts`**（部署 slug 統一為 `send-login-weekly-digest`）：
   - 驗證 `x-worker-secret`（排程）或 `admin` JWT（手動測試），支援 `dry_run` / `preview` 模式。
   - 預設收件人：`["franco.kaffa@gmail.com", "angel.kaffa@gmail.com", "cfb.system@chifung.net"]`。
   - 透過 `_shared/email.ts` 的 `sendEmail()`（優先使用 Resend）寄送，並於 `fds_login_digest_email_runs` 記錄冪等狀態。

### 3. 前端整合
1. 更新 `src/lib/loginLog.ts`：
   - 將 `writeLoginLog()` 改為呼叫 `supabase.functions.invoke('fds-session-guard', ...)`（不再由瀏覽器直接寫入 `login_log`）。
   - 新增 `verifyFdsSession()` 與 `isFdsSessionExpired(lastSignInAt)`（14 日常數 `14 * 24 * 60 * 60 * 1000`，容忍 60 秒時鐘偏移）。
2. 更新 `src/contexts/AuthProvider.tsx`：
   - 登入成功後呼叫 `fds-session-guard` 的 `record_login` 並保存 `sessionId`。
   - 已登入狀態下於掛載、分頁切回前景（`visibilitychange`）與每 5 分鐘執行 14 日到期檢查 + `verifyFdsSession()`。
   - 偵測到 `ip_mismatch`、`session_replaced` 或 `session_expired` 時，立即執行 `supabase.auth.signOut()`、清除快取，並將原因傳給 `src/components/auth/LoginView.tsx` 顯示繁中提示。
3. 更新 `src/components/dashboard/admin/LoginHistoryView.tsx`：
   - 於管理員登入紀錄表格增加 `IP 位址` 欄位及強制登出事件顯示（沿用既有共用 Table 元件）。
4. Supabase Auth 設定：確認專案 Auth Session Timebox 設定為 `1209600` 秒（14 天）。

---

## 驗證與部署清單
- [ ] 新增測試：14 日到期檢查、IP 變更／Session 取代邏輯、每週登入報告 HTML/純文字產出。
- [ ] 執行 `npm run build` / 型別檢查 / `npm run audit:ui`。
- [ ] 使用 `node scripts/apply-migration.mjs` 套用 Migration 至 `riaubhtruisbwdlwjzur`。
- [ ] 部署 `fds-session-guard`、`send-login-weekly-digest`、`pms-sso` 並讀回線上 function body 確認 slug 與程式碼一致。
- [ ] 以 `dry_run` 與測試信箱驗證 BW Furniture 郵件模板渲染，確認無誤後啟用 `pg_cron` 排程。
