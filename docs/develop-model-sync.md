# develop → main 產品模型單向同步

- 沿用 `product_models`、`product-models` Storage 和 `skp-worker-agent`，不改 PMS 契約。
- 只在 FDS develop `omxizeukbcqzsnjsuwod` 套用 `20261104160000_fds_develop_model_sync.sql`。**不可把這個 migration 套到 Production**；main 不建立反向佇列。
- 產品模型 insert/update（含預覽補檔、版本備註）排入 durable queue。每分鐘處理一筆；失敗兩分鐘後重試，執行中以十分鐘租約避免重複處理。revision 防止處理期間的新更新被當成已完成。
- 目標是 Furniture Production `riaubhtruisbwdlwjzur`。核對 product id、型號及 SKU，複製主檔、預覽、FBX 貼圖包及相同目錄附件；檔案 SHA-256 驗證後才登記模型。
- 目標路徑固定為 `generated/develop-sync/<原路徑>`，重試 upsert；main 已存在相同產品、格式及 content_hash 時略過，保留其資料。來源的 user/job/furniture model 外鍵不跨庫複製。
- 不同步刪除，不改 main 自行上傳的檔案。無 product_id 的獨立參數模型不在此產品模型同步範圍。
- branch Edge Secrets：`FDS_MODEL_SYNC_PRODUCTION_KEY`（目標 service role）及 `FDS_MODEL_SYNC_CRON_KEY`（隨機專用呼叫憑證）；後者同步存於 branch Vault `fds_model_sync_cron_key`。不要把值寫進 repo、瀏覽器或 Worker。
- 部署 branch 實際使用的 `supabase-functions-skp-worker-agent` 和相容 slug `skp-worker-agent`，包含 `_shared/modelSync.ts`；`sync-models` action 僅允許 develop 且須專用憑證。
- 驗證：`node --test scripts/test-model-sync.mjs`。佇列狀態看 `fds_model_sync_queue` 的 revision/synced_revision、last_error、synced_at；cron 名稱 `fds-develop-model-sync`。
