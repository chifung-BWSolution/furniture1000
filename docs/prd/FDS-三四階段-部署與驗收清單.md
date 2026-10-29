# FDS 第三、第四階段：部署與驗收清單（未執行）

日期：2026-10-29
狀態：**本文件是待執行清單，不代表已部署或已驗收。**
相關：[交付狀態](./FDS-第三四階段-交付狀態.md)、[交接 PRD](./FDS-第三四階段-DeepSeek開發交接-PRD.md)

> 所有指令預設只針對 FDS 2.0 開發分支 `omxizeukbcqzsnjsuwod`。
> Production `riaubhtruisbwdlwjzur` 要另外取得明確授權。

## 1. Edge Function（三支）

- `sync-asana-factories`：**已部署並完成唯讀驗證**（2026-10-29；綁真實 task → sync 200 → 寫入 Description 與 1 個 Comment → 重跑 0 新增 → 測試 link 已刪除）。修正了 service_role 對 link／comment 表的權限（`20261029210000_fds23_asana_service_grants.sql`）。
- `send-quote-email`、`notify-customer-quote-request`：**已部署到分支**（2026-10-29）。smoke test 兩支都回 200（`claimed:0`），沒有寄出任何郵件；分支仍缺 `RESEND_API_KEY`／SMTP，真正發送會失敗。

```powershell
# 需要 SUPABASE_ACCESS_TOKEN（User 環境變數或 .env.local）
npx supabase functions deploy send-quote-email --project-ref omxizeukbcqzsnjsuwod --no-verify-jwt
npx supabase functions deploy notify-customer-quote-request --project-ref omxizeukbcqzsnjsuwod --no-verify-jwt
npx supabase functions deploy sync-asana-factories --project-ref omxizeukbcqzsnjsuwod --no-verify-jwt
```

- 三支都用 `x-worker-secret`（vault `fds_worker_secret`）或 admin／uploader／PM 登入帳號授權。
- `send-quote-email`、`notify-customer-quote-request` import `../_shared/email.ts`：**必須用 supabase CLI 部署**，單檔上傳不會打包 shared module。
- 部署後抓回 `/functions/<slug>/body`，grep `FDS_EMAIL_FROM`／`confirm_send`／`sync-asana-factories` 確認線上版本正確。

## 2. Edge Secrets（分支）

| Secret | 值 | 狀態 |
|---|---|---|
| `FDS_EMAIL_FROM` | `FDS Furniture <no-reply@bwteam-furniture.com>` | 已設（2026-10-29） |
| `ASANA_ACCESS_TOKEN` | 唯讀用 PAT | 已設（2026-10-29） |
| `RESEND_API_KEY` | Resend API key；`bwteam-furniture.com` 需先驗證 SPF／DKIM | **未設** |
| `FDS_APP_URL` | 前端網址（郵件內加單連結用，例 `https://<develop-preview>`） | **未設** |

設定方式：Supabase Dashboard → Edge Functions → Secrets；或 `POST /v1/projects/<ref>/secrets`。
Gmail SMTP（`GMAIL_SMTP_USER` + `GMAIL_SMTP_APP_PASSWORD`）會改寫寄件者，不能配合 `no-reply@bwteam-furniture.com` 使用。

## 3. 驗收步驟（用測試資料，不對真實客戶／供應商發送）

### FDS-15 郵件
1. 設好 `RESEND_API_KEY` 與 `FDS_APP_URL`，部署 `send-quote-email`。
2. 在測試報價填模板（電話）、收件人用測試信箱，按「排入發送」。
3. 觸發 worker：`POST /functions/v1/send-quote-email`（`x-worker-secret`）。
4. 核對：收到信、`bwf_quote_email_message.status=sent`、`email_notification_logs` 有紀錄。
5. 用測試瀏覽器打開分享連結 → `bwf_quote_share_view.is_valid=true`、`bwf_quote_email_settings.status=viewed`、排隊跟進信 `cancelled`。
6. 用 Googlebot UA 打 `record_quote_share_view` → `is_valid=false`，跟進信不受影響。

### FDS-14 PM 通知
1. 客戶頁提交一次（測試報價）→ 檢查 `bwf_quote_customer_request` 與報價一覽「客戶提交」面板。
2. 部署 `notify-customer-quote-request` 後觸發 worker → 測試 PM 信箱收到；`pm_notified_at` 有值。
3. 重建一次相同提交 → 不應重複建立需求或通知。

### FDS-12 Asana（唯讀）
1. 用 CLI 綁一個測試 factory：
   `node scripts/link-asana-factory.mjs --factory-id <uuid> --factory-name "測試廠家" --task-gid <真實 task gid>`
2. 觸發 `POST /functions/v1/sync-asana-factories`（`x-worker-secret`）。
3. 核對 `fds_asana_factory_link.remote_description`、`fds_asana_factory_comment` 筆數；再跑一次確認不重複。
4. 驗收後 `node scripts/link-asana-factory.mjs --remove <link id>`；**不要**向真實 task 發留言。

### FDS-13 分區示範圖
1. 部署 `generate-quote-reference-image`（現有 slug）。
2. 正式報價生成透視圖 → 成功；快速報價／`DP-` 報價 → 應回 403 `quote_photo_generate_scope_denied`，且界面不顯示「AI 生成」。
3. GLB 場景：供應商未定，暫不驗收。

## 4. 資料庫

- 分支已套七支 FDS 2.3 migration（customer request ×2、quote email ×2、zone scope、asana link、以及早前的 20261027 系列）。
- Production **未套**；上線前用 `node scripts/apply-migration.mjs <file> --refs=prod`，並先確認 `verify_jwt`、secrets 與 cron。
- 已加 cron（分支，host 以本庫 `fds-process-jobs` 為準，避免打到 Production）：
  - `fds-send-quote-email` 每 15 分鐘（只有到期／跟進到期才發請求）
  - `fds-notify-customer-request` 每 10 分鐘（只有未通知且有電郵可解析時）
  - `fds-sync-asana-factories` 每日 02:41（只有 enabled link 時）
- 三支 worker 已用 `--no-verify-jwt` 重新部署，並以 vault `fds_worker_secret` 實測 200。

## 5. 不可省略的真實驗收

- 三份真實已授權圖冊混選整頁／局部圖 → 合併 PDF（FDS-07）。
- SKP／FBX 由設計師在 SketchUp／3ds Max 實際開啟（FDS-06）。
- 手機（iOS／Android）完成選區、確認、透視圖生成（FDS-13）。
- 客戶手機提交選品、重複提交、PM 通知失敗重試（FDS-14）。
- A／B 兩張報價不同模板、三天邊界、停信與發送競爭（FDS-15）。
