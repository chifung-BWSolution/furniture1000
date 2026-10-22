# FDS menu 接口載入 — 修正追蹤（2026-10-22 續作）

承接 [`2026-10-22-menu-loading.md`](./2026-10-22-menu-loading.md)。本文件記錄：原審計的修正狀態、
本次實際做的兩項修改、以及**仍然沒動**的項目。

- 量測目標：FDS2.0 分支 `omxizeukbcqzsnjsuwod`（非 Production `riaubhtruisbwdlwjzur`）。
- 身分：既有 quick-login 帳號（`platform_user_profiles.role = uploader`）。
- 量測工具：`scripts/benchmark-menu-loading.mjs`（唯讀 probe）、`scripts/test-menu-loading.mjs`（單元測試）。
- **單次量測，沒有 p95 樣本**；數字會受網絡變異影響，只能用同一次執行的前後對照看趨勢。

---

## 1. 原審計 9 條優先問題的現況

| # | 問題 | 狀態 | 依據 |
|---|---|---|---|
| P1-1 | 報表首次載入全量掃描 | **部分** | 已把最新版本過濾下推到 DB、products 索引並行化；仍全掃 `bwf_quote` header 與 `products`，排名仍在前端彙總，**沒有伺服器端彙總 RPC** |
| P1-2 | 報價一覽首屏被三段串行查詢阻塞 | **部分** | 首屏已改為輕量投影 + 獨立 count + 非阻塞補資料；**殘留的「背景自動拉完全部頁」已於本次移除**，改為按需分頁 |
| P1-3 | AI 提取審核 HTTP 300 | **完成** | `extraction_items!extraction_items_document_id_fkey(count)` 明確指定 FK → HTTP 200 |
| P2-4 | 客戶產品搜尋預載 1000 筆 | **部分** | `solutionsApi` 改並行 + 收窄欄位；**仍預載 1000 筆並在客戶端篩選** |
| P2-5 | 用戶管理／登入紀錄共用過大的查詢 | **部分** | 前端已按資源分流；**Edge 端本次才改**（見第 2 節） |
| P2-6 | 已上載產品無伺服器分頁、整合相似全掃 | **未動** | `PublishedProductsView.tsx` / `SimilarProductsView.tsx` 未改 |
| P2-7 | Shopify 上載產品紀錄長串依賴 | **未動** | `src/lib/uploadLogReport.ts` 未改 |
| P2-8 | 共用初始化及重複 store | **未動** | `src/hooks/use-app-store.ts` 未改 |
| P2-9 | 客戶報價方案預載所有專案家具 | **未動** | `CustomerQuoteSchemesView.tsx` 未改 |

審計表格中其他仍未處理的項目：`dashboard`（`DashboardView.tsx` 五個 exact count）、`fds2-quote-trash`
（`quoteTrash.ts` 仍抓完整 `project_data` 且無分頁）、`fds2-customer-contact` / `fds2-customer-org`
（`use-client-zone-context.ts` 仍無條件抓 invited projects）、`fds2-admin-shopify`（讀取路徑含 `delete()` 寫入）、
`fds2-admin-command-logs` / `fds2-admin-dev-cost`（admin 成功路徑仍未驗證）、
`fds2-pm-quick` / `fds2-quote-quick` / `fds2-pm-presentation` 的建立與生成路徑（仍未量測）。

---

## 2. 本次修改

### 2.1 Edge function `fetch-platform-admin` 拆分 action

`supabase/functions/fetch-platform-admin/index.ts`

| 改動 | 說明 |
|---|---|
| 新增 `action: 'users'` | 只做 PMS staff 同步 + `platform_user_profiles` 對帳，回傳 `users` |
| 新增 `action: 'logs'` | 只讀 `platform_user_profiles` 的顯示名稱 + `login_log` / `pms_sso_codes`，**不碰 PMS、不做 profile 對帳**，回傳 `logs` + `securityTrend` |
| 保留 `action: 'fetch'` | 原有合併行為完全不變（既有契約），仍同時回 `users` + `logs` + `securityTrend` |
| `fetchAuthMeta` 改用 `auth.admin.listUsers()` | 原本是「每個帳號一次 `getUserById`」的 N 次**序列** round trip；改成 1 個 listUsers 分頁呼叫 |
| `fetchLoginLogs` 新增 `includeUploadActivity` | `'logs'` action 略過 `upload_log` + `products` SKU 查詢 —— 這兩筆本來就會被前端的 `mergeUploadActivityLogs` 整批取代 |

`action: 'logs'` 略過 upload activity 是安全的：前端 `mergeUploadActivityLogs()` 會把 edge 回的
`ul-` 前綴列全部丟掉、換成瀏覽器端自己組的列，所以 edge 的 upload 查詢本來就是白做的。

### 2.2 前端 `adminApi.ts` 按資源分流

`src/lib/adminApi.ts`

- `fetchPlatformUsers(forceRefresh)` / `fetchPlatformLoginLogs(forceRefresh)` 兩個新匯出。
- 快取由「一筆」改成 **per-resource Map**（key = `users` / `logs`），TTL 仍 30 秒；
  手動 refresh 只清自己的 key，寫入（改角色／邀請）和登入變更仍清全部。
- `invokeAdminAction()` 先試新的 `action`，失敗則**自動退回 `action: 'fetch'`** ——
  這樣前端可以先上線，Edge function 後部署（或反過來）都不會壞。
- `fetchPlatformAdminData()` 保留為合併讀取（兩個資源並行 + 各自快取）。

`UserManagementView` 改叫 `fetchPlatformUsers`，`LoginHistoryView` 改叫 `fetchPlatformLoginLogs`。

### 2.3 報價一覽改為按需分頁

`src/components/dashboard/QuotationListView.tsx`

- **移除**首屏後 `while (keepGoing)` 自動把剩餘全部頁面抓完的迴圈。資料庫共 1109 列時，
  原本會在背景再打 27 次分頁請求；現在只打 1 次，剩下等使用者按「載入更多」。
- `hasMore` 改由獨立 count（`fetchQuoteListCount`）判定；count 尚未回來時退回「最後一頁是滿頁」的判斷。
- 新增 `isEnriching` 狀態，把「首頁已上屏、正在補 siblings 與 PMS 標題」和「正在載入下一頁」分開，
  避免頁尾顯示錯誤的「正在載入較早的報價…」。

### 2.4 修正設定區塊的 effect 迴圈（本次新修的 bug）

`src/components/dashboard/AppShell.tsx`

**症狀**：直接開 `/fds/settings/users` 或 `/fds/settings/login-history`，頁面短暫渲染後跳去
`/fds/settings/shopify-categories`，console 出現 `Warning: Maximum update depth exceeded`。

**原因**：兩個 effect 互相覆寫。

- `AppShell.tsx:787`（URL → view）：`appViewFromPath()` 一直把 view 設回 `fds2-admin-logins`。
- `AppShell.tsx:555`（角色守門）：非 admin 不得進 admin-only 頁，把 view 設成 `fds2-admin-shopify`。

`useAppStore()` 回傳的是**每次 render 都新的物件**，所以帶 `store` 的 effect 每次 render 都重跑；
兩邊因此無限互相改寫，React 改到 50 次上限後中止。deep-link 才會觸發（client-side 點sidebar
不會，因為那時 URL 從來不指向 admin-only 頁）。

**修法**：URL → view 的 effect 在角色已知後，若該路徑對應的是**此角色不得進入**的頁面，
就不再設 view，改由角色守門那個 effect 決定去向。admin 帳號不受影響（守門本來就跳過）。

```ts
// The role guard further down decides which pages this account may open.
if (!roleLoading && !isAdmin && isAdminOnlyView(view)) return;
```

**驗證**（瀏覽器，quick-login 帳號 `cfb.system@chifung.net` 的 `platform_user_profiles.role`
在 FDS2.0 分支是 `uploader`，所以是「非 admin」）：

| 情境 | 修正前 | 修正後 |
|---|---|---|
| 非 admin 直開 `/fds/settings/login-history` | 跳頁 + `Maximum update depth exceeded` | 導向 `/fds/settings/shopify-categories`，**無 console error**，admin 頁內容未渲染 |
| 非 admin 直開 `/fds/settings/users` | 同上 | 同上 |

admin 路徑另外驗證過（暫時在 dev 本機把 `use-platform-role.ts` 的角色對應改成 admin 驗證，
**未改任何資料庫**，驗完已 `git checkout` 還原）：

- `/fds/settings/login-history` → URL 停留、渲染「登入紀錄 120 筆日誌」、只發 1 次 `{"action":"logs"}`
- `/fds/settings/users` → URL 停留、渲染「用戶管理 83 位用戶 · 82 啟用中」、只發 1 次 `{"action":"users"}`
- 兩頁皆無 console error

### 2.5 部署

- `supabase-functions-fetch-platform-admin` 與 `fetch-platform-admin` 兩個 slug 都更新到
  **FDS2.0 `omxizeukbcqzsnjsuwod`**。前端 `invokeAdmin` 依序試這兩個 slug，所以兩個都要。
- 兩個 slug 都用 `GET /functions/<slug>/body` 抓回內容確認過線上版本含 `action === "users"` /
  `action === "logs"` / `listUsers`。
- **Production `riaubhtruisbwdlwjzur` 尚未部署**，本次沒有動正式庫。

---

## 3. 量測結果（同一次 FDS2.0 目標，修改後）

### 3.1 Admin（本次重點）

| Probe | 審計原值 | 修改後 | 說明 |
|---|---:|---:|---|
| `admin-cold`（兩頁合計） | 5.539s / 3 req / 0.103MB | **1.888s / 4 req / 0.096MB** | Edge 內部 N 次 auth 查詢 → 1 次 |
| `admin-warm` | — | **0ms / 0 req** | 30 秒內共用快取 |
| `admin-refresh` | — | **1.413s / 4 req** | 手動 refresh 仍然真的重取 |
| `admin-users-only`（用戶管理頁） | — | **0.974s / 1 req / 0.016MB** | 只打 `{"action":"users"}` |
| `admin-logs-only`（登入紀錄頁） | — | **1.618s / 3 req / 0.080MB** | 只打 `{"action":"logs"}` + 瀏覽器端 upload activity |

瀏覽器實測（quick-login、dev server）確認兩頁各自只發一次對應 action，沒有交叉：

- 用戶管理頁 → 1 次 `{"action":"users"}`（HTTP 200，1657ms）
- 登入紀錄頁 → 1 次 `{"action":"logs"}`（HTTP 200，1219ms）+ 瀏覽器端 `upload_log` 621ms + `products` SKU 607ms

### 3.2 報價一覽

| Probe | 審計原值 | 修改後 |
|---|---:|---:|
| 列表頁 payload | 860,647 B | **25,929 B**（33× 小） |
| siblings payload | 1,053,339 B | **5,716 B** |
| 背景自動全掃 | 27 次分頁請求 | **0 次**（只 `offset=0&limit=40`） |

瀏覽器實測：頁尾顯示「已顯示最新 18 張報價 · 資料庫共 1109 列 · 49 個版本紀錄 · 搜尋／篩選僅套用已載入列」，
點「載入更多」才發 `offset=40/80&limit=40`；點完後等待，請求數不再增加（**沒有自動續載**）。

### 3.3 其他（本次未改動，僅記錄重跑值）

`rankings` 3.879–6.369s / 10 req / 2.996MB、`customer-products` 2.212–4.758s / 7 req / 1.364MB、
`custom-catalog` 1.572–1.694s / 7 req / 1.024MB、`review-documents` 0.575–0.921s / 1 req / 382B。

---

## 4. 新發現（既有問題）

1. **系統設定區塊的 effect 迴圈 —— 已於本次修好**（見第 2.4 節）。
   修正前：進 `/fds/settings/users` 或 `/fds/settings/login-history` 會跳頁並報
   `Maximum update depth exceeded`，兩個 admin 頁在瀏覽器裡無法停留。
2. `PublishedProductsView.tsx` 的 `shopify_products` 查詢仍**無 `.range()`**（主列表一次抓 2.1MB）。
3. `src/hooks/use-app-store.ts` 每個 AppShell mount 都會打 products count + `get_products_list_page(100)` +
   `product_variants`；`DesignProjectsView.tsx` 還會再呼叫一次 `useAppStore()` 造成第二套初始化。
   另外 `useAppStore()` 回傳**每次 render 都新的物件**，所以帶 `store` 的 effect 每次 render 都重跑
   —— 這也是上面那個迴圈之所以會觸發的土壤。根治要把它改成共用單例（Context 或 module-level cache）。
4. `CategoryManagementView.tsx` 的讀取路徑裡有 `delete()`（自動清孤兒 L1 分類），讀取即寫入。

---

## 5. 建議下一步

依效益／風險排序：

1. P1-1 剩下的部分：把報價排名彙總下推到伺服器（沿用 FDS 既有的 `get_quote_catalog_page` /
   `get_products_list_page` 慣例：`p_` 參數、`p_limit`/`p_offset`、`returns jsonb`）。
   PMS 沒有可對應的能力（PMS 完全沒有分頁 RPC 慣例，`bwf_quote` 也在 Furniture 庫），所以這是 FDS 端新增。
2. P2-6：`shopify_products` 伺服器分頁 + `SimilarProductsView` 的全表掃描。
3. P2-8：把 `use-app-store` 的初始化改成共用單例（Context 或 module-level cache），
   同時消除「effect 每次 render 都重跑」的根源。
4. P2-4：客戶產品搜尋改成按輸入搜尋，不再預載 1000 筆。

Production 部署前，先在 FDS2.0 跑一次同條件的 benchmark（至少 3 次）並分開記錄
首次 rows 可見、補資料、背景載入、離頁取消。
