# 產品圖推測三視圖試驗（2026-10-24）

沿用 FDS `supabase-functions-generate-quote-reference-image` 的 Grok/Gemini 生圖及 `quote_photo_assets`/`quote-photos`，新增可選 `purpose: "orthographic"`，此模式要求 2–3 張同款產品圖，優先白底及互補角度。未傳時維持原場景生圖。PMS functions 搜尋未找到三視圖能力，沒有新增 PMS 接口或修改其契約。

僅部署 FDS2.0 `omxizeukbcqzsnjsuwod`：生圖 function version 7，部件分析 function version 28，已下載線上程式驗證。已部署 migration `fds_orthographic_asset_writer`，只授予 service_role 對既有素材表 SELECT/INSERT；沒有 Production 部署。前端修改在本機，未發布託管前端。

## 生成視窗接入

`FurnitureSearchView` 的 SU/3D 共用準備流程會先沿用既有模型檔檢查，再從產品圖及本次補圖中取得 2–3 張可讀且內容不同的圖片，重新編碼並上傳既有 `product-images`，呼叫三視圖接口（Grok 分析、Gemini 生圖）。成功圖在當前瀏覽器 session 按產品、描述及圖片來源快取；重新辨認部件沿用同圖，圖片或描述變更後失效。

三視圖以 `inferred_reference` 獨立欄位傳入現有 `generate-furniture-model`。原圖仍需最少兩張；數量/整組判斷只看原圖，之後才把 AI 圖附於最後，並明確要求原圖優先、AI 圖不能消除未知結構或捏造板件。SU 及 3D 的後續模型建立和原有結構校驗共用此分析結果。

`StructureConfirmForm` 在左側「結構描述」下顯示三視圖整張圖，使用共用 `LoadingImage` 及 `ImageLightbox` 點擊放大，標註 AI 推測及尺寸仍需核對。不為顯示三視圖放寬原有結構校驗。

三視圖素材以 `orthographic/` 路徑寫入既有 bucket 並設 `is_active=false`，不混入報價常用素材或占用場景圖片上限。三視圖生成角色與既有家具建模相同（admin/uploader/pm/designer），產品資料仍以呼叫者權限讀取；僅三視圖的素材寫入使用 service role，不擴大場景圖片庫修改權限。

實測曾發現測試庫 service_role 對 `quote_photo_assets` 沒有 SELECT/INSERT（RLS bypass 不代表 table GRANT）。已以上述 migration 修正並核對 migration 記錄。失敗時未建立模型，沒有略過錯誤繼續使用舊流程。

瀏覽器實測完成：`http://127.0.0.1:5175/fds/designer/types/7ay39iwj03l`，先出現既有模型沿用視窗，再選重新生成，依序經三視圖生成及原圖＋三視圖部件分析進入結構確認。左側結構描述下顯示三視圖，點擊開啟共用放大視窗、關閉後返回正常。截圖 `output/three-view-trial/integration-preview.png`。原有腳座、橫樑及線盒未知項仍阻止最終模型生成；本次沒有新增 GLB/FBX 或 SKP 任務。未驗證手機視窗或另一個使用者角色。

## 自動分析及產品描述

三視圖請求傳 `productId` 和 2–3 張參考圖；後端在使用者 RLS 權限下讀取該產品的 `model,description`，透過既有 Grok `grok-4.7` 視覺分析模式整理 `observed_structure`、`materials`、`functional_details`、`uncertainties`，再自動組成生圖指令交給指定的 Grok 或 Gemini。這些分析不是使用者確認的要求，回傳 `requirementsSource: ai_analysis`、`analysisModel`、`analysis`、`generatedPrompt` 供核對。此模式不使用呼叫端手寫 prompt 決定結構，也不再在試驗腳本硬編 LF-H32P 的腳架或中央通空指令。

描述補材質與功能；圖片決定可見幾何。宣傳詞不轉成結構，未知插座位置或遮擋結構保留不確定。分析失敗不提交生圖，不會退回手寫產品模板。原場景生成流程不增加分析呼叫。

自動分析版本的紀錄與圖片在 `output/three-view-trial/auto-analysis/`；腳本目前從此目錄讀取 `sources.json`。產品圖選擇仍是本次已目視檢查的 3 張圖，尚未增加前端自動選圖入口。

實際端到端驗證：版本 6 以 LF-H32P 三張圖及 DB 產品描述經 Grok 分析 → Gemini `gemini-3-pro-image-preview` 生圖，HTTP 200 並下載讀回。分析成功提取 E0 板、吸塑飾板、三位插座，標明插座位置未知；回傳 `requirementsSource=ai_analysis`。新生成圖仍把腳架簡化並增加較低的橫樑，因此不通過幾何忠實度驗收，未交 SU。素材已停用並讀回。分析輸入不含實際尺寸欄位，尺寸仍標為未知。

驗證：`node scripts/test-orthographic-image.mjs`、`npx tsc --noEmit`、`npm run audit:ui` 通過。單測另驗證描述及全部圖片交給分析、分析結果加入指令、手寫結構 prompt 不會覆蓋、分析失敗阻止生圖。

樣本為產品 `7ay39iwj03l` / `LF-H32P` 的現有會議枱圖片。原圖含椅子及室內場景，目標只取會議枱。輸入在預覽 Storage；未修改產品資料。輸出和實際模型 ID 記錄於 `output/three-view-trial/*-result.json`，不包含登入資料。試圖停用以免混入報價常用素材。

## 實測結果

以下為初次單場景圖試驗，後續使用 3 張白底產品圖重做；新試驗記錄在 `output/three-view-trial/multi-reference/`，保留初次結果便於比較。

三張白底圖重做：Gemini `gemini-3-pro-image-preview` HTTP 200，生成圖已下載及目視檢查。中央落地板消失，正面中央保持通空，三個視角及標籤清楚；但原產品兩端支撐「上段折斜、下段近垂直」被簡化成連續斜板，仍未完全還原。中央線盒比例亦需再核對。試圖已 `is_active=false` 並讀回確認，未交給 SU。

- Grok `grok-imagine-image-2.0`：HTTP 200，圖片讀回成功；多畫一張俯視圖，視角標籤錯置，立面仍帶透視，不通過三視圖驗收。
- Gemini `gemini-3-pro-image-preview`：HTTP 200，圖片讀回成功；三個視角及標籤較清楚，但加出了原圖未能支持的細長折彎支撐，隱藏結構仍屬假設。不足以當作可靠建模依據。
- 兩張都不能證明 SU 生成品質提升。未呼叫 Tripo、未排 SKP 任務、未生成 SU 模型；先校正支撐結構並補實際尺寸，再做模型比較。
- 不將 AI 視圖當成獨立實拍證據；原圖和 AI 圖須保留來源區別，不能靠湊滿兩張圖繞過現有多視角門檻。

## 重現

`node scripts/test-orthographic-image.mjs` 驗證場景指令相容、三視圖指令、2/3 張轉送、0/1/4 張拒絕、無效用途及網址在付費前拒絕。

`node scripts/trial-orthographic-image.mjs --deploy` 只部署上述預覽 slug 並讀回。

`node scripts/trial-orthographic-image.mjs --generate` 呼叫一次 Grok；`--generate --gemini` 呼叫 Gemini。需本機 `.env.local` 的預覽登入及管理憑證；在 `output/three-view-trial/multi-reference/sources.json` 列出 2–3 張已檢查的同款產品圖片路徑（JSON array）。拒絕重複路徑及相同檔案內容。本次選 `candidate-1.jpg`、`candidate-2.jpg`、`candidate-3.jpg`（原產品 `image_url_2`、`image_url_3` 及圖片集中的正面白底圖），捨棄會議室場景圖。提交前寫入紀錄，同一供應商紀錄已存在則拒絕再次生成。中斷時人工查核，不自動重送。

`node scripts/trial-orthographic-image.mjs --hide-trials` 停用本次生成素材並讀回，保留檔案及試驗紀錄。

`npm run audit:ui` 通過（沒有 UI 改動）。未做瀏覽器驗證。
