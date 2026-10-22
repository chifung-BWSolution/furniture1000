# 報價一覽 / 大金額投標 — 請求爆量診斷與修正（2026-10-22）

承接 [`2026-10-22-menu-loading.md`](./2026-10-22-menu-loading.md) 與
[`2026-10-22-menu-loading-followup.md`](./2026-10-22-menu-loading-followup.md)。

- 量測目標：FDS2.0 分支 `omxizeukbcqzsnjsuwod`（非 Production `riaubhtrusbwdlwjzur`）。
- 身分：既有 quick-login 帳號（`platform_user_profiles.role = uploader`）。
- 量測方式：dev server（`vite`，React StrictMode 開啟）+ 瀏覽器 Network 面板；
  另以 Vite SSR 載入 `src/lib/*` 直接量資料層的 request 數與時間。
- 頁面：`src/components/dashboard/QuotationListView.tsx`（`mode = 'all'` 報價一覽 /
  `mode = 'large-amount'` 大金額投標，兩者同一支 component）。

---

## 1. 症狀

Network 面板顯示同一頁反覆出現 `bwf_quote` 查詢，`status=eq.回收桶`（側邊欄回收桶 badge）
出現 6 次，`status=neq.回收桶`（列表筆數 count）與列表本體各出現 2 次。點側邊欄切換
「報價一覽 / 大金額投標」時整組查詢重跑一次。

## 2. 原因（已逐項驗證）

| # | 原因 | 證據 |
|---|---|---|
| A | **每個 mount 都重打整組查詢，沒有共用快取。** | `fetchQuotes()` 依賴 `useEffect([fetchQuotes])`，每次 mount 重跑；`quoteListData.ts` 原先完全沒有快取。 |
| B | **React StrictMode 讓最重的兩個查詢各跑兩次。** | `src/main.tsx:60` 有 `<React.StrictMode>`；Network 面板看到 `status=neq.回收桶` 與列表本體查詢在同一毫秒發出兩次。 |
| C | **額外的 count 请求。** | `fetchQuoteListCount()` 用 `count: 'exact'` + `head: true` 另開一個 request，只為了頁尾「資料庫共 N 列」與「載入更多」按鈕。 |
| D | **siblings 版本查詢與 PMS 補資料是串行的。** | 原流程 `page → siblings → PMS` 三段依序；兩者其實互不依賴。 |
| E | **側邊欄回收桶 badge 每次 SidebarNav mount 都重新 count。** | `SidebarNav.tsx` 的 `useTrashCount` → `countTrashedQuotes()`，沒有快取；離開再進入「傢俬報價」區塊（`enabled` 由 false 變 true）會再跑一次。 |
| F | **瀏覽器每個 host 只有 6 條連線，請求一多就排隊。** | 同一條查詢單獨跑要 ~700ms，和其他請求併發時要 4–7s；DB 端 `EXPLAIN` 顯示 execution time 只有 **0.39–0.49ms**。 |

### 資料庫不是瓶頸

`EXPLAIN (ANALYZE)`（FDS2.0，`bwf_quote` 1109 列、heap 240 kB）：

| 查詢 | Execution Time | 計劃 |
|---|---|---|
| 列表本體（`status <> 回收桶 AND total_amount > 50000` + `order by created_at desc limit 40`） | 0.491 ms | Seq Scan + top-N heapsort |
| count（同一條件 `count(*)`） | 0.391 ms | Seq Scan |
| 回收桶 count（`status = 回收桶`） | 0.470 ms | Seq Scan |
| siblings（`quote_id in (...)`） | 0.152 ms | Bitmap Index Scan（`idx_bwf_quote_quote_id_version`） |

`bwf_quote` 沒有 `status` / `created_at` / `total_amount` 索引，但資料量小，
掃描成本可忽略 —— **慢的是請求數與連線排隊，不是資料庫**。

## 3. 本次修改

| 檔案 | 改動 |
|---|---|
| `src/lib/quoteListData.ts` | 新增 module-level 讀取快取（TTL 30s + in-flight 去重）：列表頁、siblings、count 共用；`invalidateQuoteListCache()` 可整批清除。 |
| `src/lib/pmsPitchings.ts` | 拆出 `fetchPitchingsForQuoteRows()`（只回 pitching 清單）與 `invalidatePmsPitchingsCache()`；`loadPitchingsForQuoteRows()` 行為不變。 |
| `src/components/dashboard/QuotationListView.tsx` | count 併入列表頁 request（`count: 'exact'` 走同一個 PostgREST 回應的 `Content-Range`），刪掉獨立的 count request；siblings 與 PMS 改為 `Promise.all` 平行；`isLargeAmount` 變化時才重新取。 |
| `src/lib/quoteTrash.ts` | 回收桶 badge count 加 TTL 60s 快取 + in-flight 去重；移入／還原回收桶時清掉快取並呼叫 `invalidateQuoteListCache()`。 |

設計取捨：

- **快取 TTL 30s**：離開頁面再回來（點側邊欄切換）不再重打；使用者按「重新載入」會
  `invalidateQuoteListCache()` + `invalidatePmsPitchingsCache()` 後強制重取。
- **count 併入列表頁**：`count: 'exact'` 與列表同一個 request 回來，多 ~640ms
  （1048ms → 1687ms），但省掉一整個 request 與一次連線排隊。實測整體更快。
- **siblings 仍用完整投影**：舊版列的 Asana 欄要 `pitching.asana_link`，
  且「最新版本」有可能落在 siblings 內，所以不能只取精簡欄位。

## 4. 修正前後（dev server + StrictMode，瀏覽器實測）

| 情境 | 修正前 | 修正後 |
|---|---|---|
| 開「大金額投標」首屏 | 17 個 fetch，其中 `bwf_quote` **7** 個（count×2 + 列表×2 + siblings×1 + 回收桶×2）；最後一個請求 11.7s 才回來 | 12 個 fetch，其中 `bwf_quote` **3** 個（回收桶×1 + 列表+count×1 + siblings×1）；PMS 2.6s 回來 |
| 切到「報價一覽」 | 整組重跑 | 列表 + count + siblings + PMS = 4 個 |
| 30s 內再切回來 | 整組重跑 | **0 個**（快取命中） |
| 按「重新載入」 | 重跑 | 強制重取（快取已清） |

`bwf_quote` 請求數：**7 → 3**（單頁）；側邊欄 badge：**2 → 1**。

## 5. 當時尚未處理（本次只記錄）

1. **`AppShell` 的 `store` 依賴迴圈。** `useAppStore()` 每次 render 都回傳新物件，
   而 `AppShell.tsx` 至少 7 個 effect 的依賴陣列帶 `store`（`:431 :523 :731 :784 :806 :909`…），
   所以每次 render 都重跑。URL 與 view 不同步時（例如手動改網址）會互相覆寫，
   實測打出 **254 次 `platform_user_profiles` + 42 次 `fetch-pms-pitchings`** 的請求風暴。
   根治要改成共用單例（Context / module-level cache），即 followup 文件 P2-8。
2. `usePlatformRole()` 被 `AppShell` 與 `BwfInquiryReplyPanel` 各呼叫一次，
   同一頁會重複查 `platform_user_profiles`（可改為傳遞或共用快取）。
3. `bwf_quote` 沒有 `status` / `created_at` 索引；目前 1109 列掃描成本可忽略，
   資料量上升後 `neq` 條件會變成瓶頸，屆時再評估 partial index 或 FDS 端分頁 RPC
   （沿用 `get_quote_catalog_page` 的 `p_limit` / `p_offset` / `returns jsonb` 慣例）。

### 後續處理（2026-10-22）

- 第 1 項：已在 `AppShell` 下加入 `AppStoreProvider`，讓 AppShell 與頁面子元件共用單一 store；
  store API 物件身份固定，context 更新仍會通知消費元件重新 render。`URL/view` effects 現在只會因
  實際讀取的欄位改變而重跑。TypeScript 檢查通過；原始瀏覽器 Network 情境尚待回歸量測。
- 第 2 項：已加入 `PlatformRoleProvider`，`AppShell` 和 `BwfInquiryReplyPanel` 讀取同一份角色狀態，
  避免各自查詢 `platform_user_profiles`。
- 第 3 項仍待資料量增加後評估，這次未新增索引或 RPC。
