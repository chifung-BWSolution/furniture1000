# 圖片／modal 元件契約稽核 — 2026-10-22

## 範圍與方法

- 掃描 `src/**/*.tsx`（排除 `src/stories/`），規則寫在 `scripts/audit-image-components.mjs`，
  可用 `npm run audit:ui` 重跑；違反即 exit code 1，可直接擋 CI。
- 三條規則：
  1. `raw-img-dynamic` — 動態 `src` 卻用裸 `<img>`，沒走共用 `LoadingImage`。
  2. `custom-dialog` — 用 `<Dialog>` 而不是全站共用的 `<Modal>`。
  3. `lightbox-originals`（advisory）— 共用 `<ImageLightbox>` 沒傳 `thumbWidth`，
     底部縮圖列會拉原圖。
- 另加一條結構性教訓（`modal-transform-trap`）：`Modal` 卡片本身用
  `translate-x/y` 置中，**transform 會讓 `absolute` 子元素變成相對卡片定位**，
  所以「釘在視窗右上角的關閉鈕」會掉到畫面中間。要釘視窗邊緣就用
  `variant="fullscreen"`（面板 `fixed inset-0`，無 transform）。
- 本地分支 develop，HEAD `3a7ceac`。檢查期間工作區有其他同步 UI 修改（另一條工作流），
  報告只保證「本次檢查時刻」的狀態。

## 發現的問題（稽核前 19 個 blocking + 8 個 advisory）

**A. 真的會載 storage 原圖（本次已修）**

| 檔案 | 圖 | 問題 |
|---|---|---|
| `cases/CaseShared.tsx` | 自訂 `CaseImage` | 裸 `<img>`，一頁 100 張原圖 |
| `cases/CasePhotosPage.tsx` / `CaseBrandsPage.tsx` | 完工相片／Logo | 同上，且自訂 `Dialog` lightbox |
| `customers/CustomerPortalExtraViews.tsx:440` | 案例圖 | 裸 `<img src={item.image}>` |
| `customers/shared/ClientZoneFloorPlan.tsx` | 平面圖 | 裸 `<img src={floorPlanUrl}>` |
| `solutions/FloorPlanViewerModal.tsx` | 平面圖縮圖 | 裸 `<img>`（storage URL） |
| `solutions/SolutionProjectListView.tsx` | 平面圖預覽 | 裸 `<img>`（storage URL） |
| `publish/PublishedProductDetailModal.tsx` | 產品圖 | 有 `productThumbUrl()` 但沒用共用元件 |
| `QuotationDraftEditor.tsx` | 報價項目圖 | 裸 `<img src={item.image}>`（storage URL） |
| `FurnitureProductScopeDialog.tsx` | 建模參考圖 | 裸 `<img>` |
| `TripoModelTrial.tsx` | 參考圖 | 裸 `<img>`（storage URL） |
| `corporate/CorporateModules.tsx` | Logo 牆／YouTube | 裸 `<img>`（外部 CDN，加載狀態缺失） |
| `PresentationView.tsx` | Canva 縮圖 | 裸 `<img>` + 自己寫 failed 狀態 |

量級參考：PMS 正式庫一張完工相片原圖 **1,632,885 bytes**；
`/storage/v1/render/image/public/...?width=320&quality=65&format=webp` 為 **9,938 bytes**（164×）。
一頁 20 個項目 × 5 張 = 100 張 → 原圖約 160MB，壓縮後約 1MB。

**B. 自訂 modal（本次已修）**

- `cases/CaseOrdersPage.tsx`：訂單詳情用 `<Dialog>`／`<DialogContent>`，
  與全站 `<Modal>`（`ui/modal.tsx`）不一致 → 已改用 `<Modal size="3xl" title description>`。

**C. 合法例外（已在稽核腳本內登記原因，不會再被當違規）**

| 檔案 | 原因 |
|---|---|
| `QuotationPDFPreview.tsx` | pdf.js 產生的 `data:` 頁面圖，需要自然比例 |
| `RemarksRichEditor.tsx` | contenteditable 內的貼圖，必須是原生 `<img>` |
| `SourcePageDialog.tsx` | `blob:` 物件 URL（已下載的文件頁），需要自然比例 |
| `CustomerPortalExtraViews.tsx`（`imagePreview`） | 本地 blob 預覽 |
| `ProductWorkbench.tsx` / `QuotationDraftEditor.tsx` | 瀏覽器／外部服務產生的 QR code |

## 本次修正

- 9 個檔案的裸 `<img>` 改成共用 `LoadingImage`（storage 圖自動轉 320px webp）。
- `cases/CaseOrdersPage.tsx` 的 `<Dialog>` → 共用 `<Modal>`。
- `ProductImageGallery.tsx` 的 `ProductImageGalleryLightbox` 加 `thumbWidth`（預設 160），
  所有產品圖庫的縮圖列都改用壓縮圖。
- `cases/CaseBrandsPage.tsx` 的單張 Logo lightbox 加 `simple`（單圖不需要縮圖列）。
- `ui/modal.tsx` 新增 `variant="fullscreen"`；`ui/image-lightbox.tsx` 改用它，
  關閉鈕釘視窗右上、縮圖列釘視窗底部、點暗色處關閉。

稽核結果（修正後）：**blocking 0、advisory 0**；`tsc --noEmit` 0 error；`vite build` 通過。

## 如何杜絕（往後）

1. **不要自己寫 `<img>` / `<Dialog>`。** 圖片一律 `src/components/ui/loading-image.tsx`
   的 `LoadingImage`（自動把 storage 物件 URL 轉成壓縮圖，並有 skeleton／淡入／失敗 fallback）；
   modal 一律 `src/components/ui/modal.tsx` 的 `Modal`；放大檢視一律
   `src/components/ui/image-lightbox.tsx` 的 `ImageLightbox`。
2. **跑稽核**：`npm run audit:ui`（或 `node scripts/audit-image-components.mjs --json`）。
   違規 exit 1，請在 commit 前跑；CI／agent 也應該跑同一支。
3. **例外要登記**：真的不能用共用元件時（例如 contenteditable 內的原生 `<img>`），
   在 `scripts/audit-image-components.mjs` 的 `RAW_IMG_EXCEPTIONS` 加一條
   `[檔案, 匹配字串, 原因]`——**必須寫原因**，讓例外是一個決定而不是習慣。
4. **版面陷阱**：共用元件的 className 影響壓縮寬度與填滿行為：
   - `h-* w-*`／`aspect-*` → 填滿盒子，縮圖用 320px。
   - `max-h-*`／`max-w-*` → 預覽盒，用 1600px（`PREVIEW_WIDTH`）。
   - `absolute` 與 `relative` 不可同時在同一個元素（Tailwind 誰贏看 CSS 順序）；
     需要疊圖就多包一層 `<div className="absolute inset-0">`。
   - `object-contain` 放在 `imgClassName`，不要放 `className`（`className` 會被
     `LoadingImage` 拆成 wrapper 與 img 兩份）。
5. **modal 定位**：`Modal` 卡片用 translate 置中，`absolute` 子元素會被卡片「吃掉」。
   要釘視窗邊緣 → `variant="fullscreen"`；要在卡片內 → 用 `absolute` + 卡片相對位置。
6. `npm run lint` 目前**不能用**（專案沒有 eslint 設定檔、eslint 也沒安裝），
   所以稽核靠 `scripts/audit-*.mjs` 這條線；不要假設 lint 有在擋。
