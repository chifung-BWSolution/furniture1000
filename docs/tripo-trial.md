# Tripo 試生成（FDS2.0）

> **已停用（2026-10-28）**：見 `docs/prd/尺寸驅動傢俬建模-PRD.md` FR-01。入口已移除，`fds_request_tripo_model`
> 及 `processing_jobs` 觸發器拒絕新提交；已有供應商 task_id 的任務仍會查詢及下載，歷史模型保留。以下為歷史紀錄。

入口：產品詳情的「Tripo 試生成」，只給 admin／uploader。原有 SU／參數 3D 不變。

1. 可直接選用產品現有的原圖（最多 8 張縮圖），或上載已整理好的單件傢俬 JPG／PNG／WebP；送出前都會轉成 JPEG 並顯示實際送出的圖片。
   現有原圖經瀏覽器下載後重新編碼，若有跨網域限制或讀不到，會提示改用上載。
2. 手動確認使用 API 點數後提交；同一產品同時只允許一個有效任務。
3. 沿用 `processing_jobs`，job_type=`generate_tripo`，由前端喚醒現有 `supabase-functions-process-jobs`；既有 cron 亦會接續處理。
4. `process-jobs/tripo.ts` 提交／查詢 Tripo 任務，取得有效 GLB 後存入私有 `product-models`，經 `fds_tripo_model_complete` 原子登記模型及完成任務。
5. 使用現有模型預覽及下載。尺寸未校正，不輸出 SKP，不宣稱可逐部件修改。

參考圖：`product-models/tripo-inputs/<auth uid>/<request UUID>.jpg`，只允許 admin／uploader 在自己的路徑新增。用一小時簽名 URL 交給供應商，圖片不寫入 DB。

輸出：`product-models/generated/tripo/<job UUID>/model.glb`。保留既有模型檔，下載清單依現有規則顯示最新格式。

## 設定及計費

- Edge secret：`TRIPO_API_KEY`，不放前端、不存 repo。
- API：`https://openapi.tripo3d.ai/v3`。
- 模型：`v3.1-20260211`；標準 PBR 材質、30,000 面、`orientation=align_image`，不開啟額外自動修圖。
- 2026-10-20 官方標準圖轉 3D 為 30 API credits（US$0.30），費率以供應商當期為準。Studio 與 API 點數分開。
- `2010` 是 API 點數不足；充值後由使用者重新手動提交。

## 重試邊界

付費提交前先把 `submission_started` 寫入任務 payload。回應不明或 worker 中斷且未保存 task_id 時，不自動重新提交付費任務；需先查 Tripo 後台。保存 task_id 後，查進度／下載失敗可使用原 task 重試，不再次生成。每次查詢取得新的下載網址，不持久化供應商的臨時連結。

狀態流轉沿用 `fds_processing_jobs_claim`、`fds_processing_job_checkpoint`、`fds_processing_job_heartbeat`、`fds_processing_job_fail` 及 `fds_processing_job_complete`。註冊完成時會鎖住 running job，避免取消後仍把檔案加入模型庫。Tripo pending 不用自我鏈式呼叫，以免忙輪詢。

## 驗證

`node scripts/test-tripo-worker.mjs`：非同步任務、HTTP 200 業務錯誤、點數不足、提交中斷不重複扣點、失敗／取消、無效 GLB。

`npm run build`：前端型別與建置。

試用部署只到 FDS2.0：`omxizeukbcqzsnjsuwod`。本次 migration=`20261020180000_fds_tripo_trial.sql`；未部署正式 DB／前端正式站。
