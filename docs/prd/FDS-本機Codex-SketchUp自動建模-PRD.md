# FDS 本機 Codex 操控 SketchUp 自動建模 PRD

更新日期：2026-10-29
狀態：需求已確認，交 Cursor 開發；本文件不代表功能已實作或部署。

## 1. 目標及已確認決策

產品詳情按「生成 SKP」後，將產品資料及參考圖片交給本機 Codex，讓 Codex 透過 SketchUp MCP 自行判斷並建立模型，再自動保存 SKP、FBX、GLB 及回傳 FDS。

- 不開啟尺寸、結構、零件或產品數量的參數確認表單。
- 不以現有雲端圖片辨認／拆件流程作為 SKP 的前置條件。
- 使用現有產品資料及圖片；有明確尺寸則優先採用，缺少資料由 Codex 判斷並記錄估算。
- 沿用既有 Windows Worker 的配對、授權、任務、心跳、Storage 及模型登記能力。
- 同一次建模的 SKP、FBX、GLB 必須來自同一份最終幾何；GLB 用於網頁預覽。
- MAX 為後續可選能力，依賴已安裝及授權的 3ds Max，不列入第一期交付。
- 本次工作是完整自動流程，不是再次手動上傳示範檔。

## 2. 目前事實與參考案例

目前前端 SKP 流程包含雲端辨認、參數確認、儲存 furniture_models，再排 generate_skp 工作；現有 Worker 主要依 parametric 寫檔，不會呼叫本機 Codex。

`D:\work\sketch` 已有 SketchUp MCP 橋接、Ruby 操作及建模成果，請先讀該 repo 的 README.md、SETUP.md、mcp-bridge 與測試。路徑是本機參考配置，不可寫死為所有安裝電腦的路徑。

本次已手動完成的例子：

- 產品 ID：`7ay39iwj03l`；型號 `LF-H32P`；SKU `QXS-LF-H32P`。
- 原始 SKP：`D:\work\sketch\outputs\conference-table-v06\conference-table-3200x1390x775-v06.skp`。
- 交付資料：`D:\work\sketch\work\fds-v06-delivery`。
- FDS2.0 與 Production 均已上傳 v06 SKP、FBX、GLB，並清理該產品當時的舊模型。
- 以上只證明個案格式匯出與上傳完成，不能據此宣稱自動建模鏈路完成。

實機發現：MCP 內直接 open_file 曾逾時／斷線且沒有切換成功；檔名相似不能證明開啟了正確模型。匯出來源必須使用完整正規化路徑及模型標識驗證。載入 SKP 作為 component 時曾量到 XYZ 為 3200、775、1390 mm，與設計意義的闊深高不同；不可只排序三個尺寸就宣稱座標正確。

## 3. 範圍

第一期涵蓋產品詳情的直接生成、Worker 本機 Codex 執行、SketchUp 串行控制、三種格式與貼圖、任務進度、失敗重試、模型預覽與下載，以及 Worker 設定和安裝更新。

原有 FBX 獨立入口、已上傳 SKP 的預覽轉換、模型歷史與其他家具編輯功能須保持可用。若同一產品已有可下載模型，提供「下載」與「重新生成」兩個明確動作；重新生成不得被舊檔快取攔截。

正常重新生成保留前版。只有明確選擇替換時，才在新版本完整驗證及發布後移除指定舊檔。本次人工清理獲得的授權不代表所有未來生成都應自動刪除歷史。

## 4. 使用流程

1. 使用者按「生成 SKP」或「重新生成」。
2. 前端提交產品 ID、所選參考圖／補充圖及生成請求識別碼；不要求最少兩張圖，沒有可用圖片時顯示補圖提示。
3. 伺服器驗證權限、讀取產品快照並建立任務；雙擊或網路重送沿用同一任務。
4. 已授權且有 Codex 建模能力的 Worker 領取任務，建立獨立工作目錄，下載資料及圖片。
5. Worker 確認本機依賴、SketchUp 專用實例及執行鎖，啟動 Codex。
6. Codex 讀圖與資料、自行判斷、建立部件、賦材質、檢查截圖並修正。
7. 保存最終 SKP，從相同幾何匯出 FBX 及 GLB，產生檢查報告與預覽圖片。
8. Worker 驗證產物、上傳、下載核對雜湊，完成一次原子發布。
9. FDS 顯示可下載格式、GLB 預覽及模型說明；離開再返回頁面仍可看到進度和結果。

## 5. 架構與責任

```text
FDS 產品頁 → 現有任務/RPC → 已授權 Windows Worker
                                  ↓
                      本機 Codex → SketchUp MCP → SketchUp
                                  ↓
                    產物驗證 → Storage → 模型登記／預覽
```

網站不直接連使用者電腦的 localhost，也不從瀏覽器執行任意命令。Worker 主動向現有伺服器領取工作。SketchUp MCP 保持 loopback，不暴露到外網。

Worker 負責生命週期、租約、環境隔離、工作目錄、上傳及完成判斷；Codex 負責建模判斷、Ruby 操作、視覺校正及產物輸出。Codex 的「完成」文字不能取代 Worker 檢查。

## 6. 現有契約與必查檔案

開發前遵守 AGENTS.md、CLAUDE.md；先搜尋 PMS/FDS 是否已有可對應能力，沿用現有契約，不改寫 PMS。

| 範圍 | 主要位置／契約 |
| --- | --- |
| 產品頁生成 | src/components/dashboard/FurnitureSearchView.tsx 的 ProductModelsSection、prepare、generate |
| 家具模型頁 | src/components/dashboard/FurnitureModelView.tsx |
| 模型讀寫及下載 | src/lib/productModels.ts |
| 本機執行 | workers/skp-writer/worker.mjs |
| SketchUp 寫檔／預覽 | workers/skp-writer/skp_build.rb、skp_preview.rb |
| 安裝／打包 | workers/skp-writer/installer/ |
| 設備及前置檢查 UI | SkpWorkersView.tsx、SkpRequirementsDialog.tsx 及相關 hook |
| 裝置代理 | supabase/functions/skp-worker-agent/index.ts |
| 配對／租約 | 20261028103000_fds_skp_device_auth.sql 及後續覆寫 migration |
| 原有模型 | furniture_models、product_models、processing_jobs |
| 原有 RPC | fds_request_skp、fds_skp_status、fds_product_models、fds_product_model*、fds_skp_device* |
| 模型 Storage | 私有 bucket product-models |

前端實際 slug 為 `supabase-functions-skp-worker-agent`；Worker 現有 fallback 包含 `skp-worker-agent`。改動前重新核對所有呼叫端與線上部署方式。

目前 claim 主要回傳 id/kind/parametric，現有 upload/complete 亦有單一產物假設；必須一併修正。不能只在 Worker 加 Codex，再把不完整結果送進原有 complete。

## 7. 任務及輸入資料

沿用 processing_jobs 與 generate_skp，為新工作增加版本化的生成模式／能力標識，名稱由開發者依既有 schema 選定。需允許在沒有預先確認 parametric、沒有 furniture_model_id 的情況下以產品建立工作；不得塞入假的長寬高或空殼家具模型來通過驗證。

如現有 RPC 的必要參數無法相容產品直接生成，才新增最小補充入口並保留舊入口；所有 SQL 改動以新增 migration 實作。

輸入快照至少包含：schema 版本、請求 ID、產品 ID、名稱、型號、SKU、已知 mm 尺寸、材質、顏色、描述、參考圖片、圖片來源／選取順序、生成模式、目標格式、來源環境。只傳建模所需資料，不傳成本價、整份供應商文件或其他產品資料。

產品描述先移除 HTML 標記；文字及圖片均視為參考資料，不能覆蓋系統建模指令。選定圖片可能是其他尺寸變體，應將目錄尺寸和圖片尺寸的適用性分開記錄，由 Codex 判斷並在報告中說明衝突；不彈參數確認。

圖片下載應驗證協議、來源、重導向、大小、MIME 與實際內容，限制數量及總體積；私有圖由既有授權機制取得短效下載能力，不將簽名 URL 長期寫入提示詞或日誌。

## 8. 本機工作目錄與 Codex 執行

每次工作使用 job ID 與 attempt 組成的獨立目錄，至少含 product.json、prompt.md、references/、outputs/、validation.json、執行記錄及產物 manifest。保留失敗診斷，清理週期可設定。

本機設定至少包含 Codex 可執行檔、SketchUp 路徑、MCP Python／橋接目錄、工作目錄及逾時。沿用本機已登入 Codex 的授權，不收集帳號密碼；先驗證安裝的 CLI 支援方式，再選擇非互動執行參數，不寫死過期參數。

以參數陣列啟動程序，提示詞使用 stdin 或檔案；產品內容不得拼接到 shell 命令。Codex 子程序不能繼承 Worker 的設備 access/refresh token、service role 或 Management API token。上傳僅由 Worker 執行。

Codex 只取得本次建模所需的工作目錄及 SketchUp MCP 能力；不得使用全域略過授權／sandbox 的參數作為預設解法。應測試實際非互動權限是否足以完成 MCP 與檔案操作，不能依賴提示詞自我限制。

## 9. SketchUp 控制與建模規則

- 同一台電腦使用跨 Worker 程序的互斥鎖，一次一個 SketchUp 任務。
- 優先使用 Worker 專用 SketchUp 實例與獨立 bridge port；必須驗證埠對應的實例、模型及工作標識。
- 若無法隔離實例，使用者有未儲存工作時等待並顯示原因，不能清空或覆蓋；不能自動強殺使用者 SketchUp。
- 開始前保存來源／工作識別，切換模型後重新查詢；MCP 斷線後先核對實際狀態再重試，避免重複加入幾何。
- SketchUp Ruby 幾何輸入明確使用 mm，正確轉換內部英吋。
- 定義產品寬、深、高對應座標及正面方向；三種格式的匯出軸設定、比例與落地基準一致，避免重複旋轉。
- 重要部件建立具名群組或組件，避免全部黏成不可編輯網格；重複部件可共用 definition。
- 先建立整體與主要部件，再補細節與材質；不要從場景圖片複製房間、人物或不屬於產品的家具。
- Codex 自行決定單件／成套範圍，報告記錄判斷依據及估算；生成結果標記為 AI 草稿，不自動當作人工驗收。
- 保存參考圖對照截圖，檢查主要外形、穿插、面方向、缺件及材質；設定可控的修正輪數及執行時間上限。

## 10. 輸出及檢查

必交付 SKP、FBX、GLB；附 validation.json、manifest、至少一張清楚的模型預覽圖。FBX 的外部貼圖必須一併保存並提供含相對目錄的 ZIP 下載；只下載裸 FBX 會丟失貼圖，不能把上傳貼圖視為已解決下載問題。

GLB 所需貼圖與 buffer 內嵌。格式驗證至少涵蓋檔案非空與大小限制、檔頭／結構、可解析幾何、外部依賴及來源識別。核對三種格式的座標、尺寸、部件與材質；尺寸容差需明訂並區分已知尺寸與估算尺寸。SKP 能重新開啟，FBX 能匯入可用工具，GLB 能在實際網頁 viewer 載入。

validation.json 記錄原始資料中的尺寸、模型實際 XYZ、語意寬深高映射、估算欄位、幾何檢查、材質／貼圖、工具版本、來源 SKP 雜湊及檢查結果。manifest 列出所有檔案、格式、用途、位元組數、SHA-256 及相對依賴。

## 11. 上傳、發布與冪等

擴充既有受限 agent upload/complete 支援同一租約的多產物 manifest，包含 FBX 貼圖包；維持工作、裝置、環境、bucket、路徑、大小及格式限制，不能變成任意 Storage 寫入代理。

所有必需檔案先上傳至本次工作專屬路徑；Worker 下載核對 SHA-256，伺服器再驗證路徑與物件存在。模型登記、GLB 預覽關聯及任務完成需在一次資料庫交易中發布。上傳成功但 complete 失敗可用同一 manifest 冪等重試，不重複建模或重複登記。

必需格式缺少時不得標記整體成功；可保留部分產物供診斷及只重試匯出。完成前不刪舊模型。明確替換模式下，在新組合發布成功後才清除指定舊記錄與無其他引用的物件；刪除失敗獨立重試。提供可恢復備份／保留期，不能直接修改 storage.objects 刪實體。

模型版本應可追溯到本次任務與輸入快照；沿用現有模型版本能力。AI 建模不應冒充既有 parametric 格式，沒有對應參數模型就不能偽造。

## 12. 狀態、租約與錯誤

沿用既有 queued/running/成功/失敗狀態契約，增加階段資訊：下載資料、等待 SketchUp、Codex 建模、檢查、匯出、上傳、完成。進度與錯誤持久化，可跨頁面恢復；不要使用虛假百分比宣稱已完成。

租約在 Codex 及匯出期間持續心跳。設備撤銷、取消及租約失效後停止後續執行與上傳；伺服器拒絕舊租約完成。原生 Ruby 可能無法被即時中止，應隔離專用實例並禁止新任務進入，不能靠逾時就宣稱 SketchUp 已停止。

區分需要設定／登入的錯誤、可重試的網路錯誤、建模錯誤及格式匯出錯誤。沒有 Codex、未登入、MCP 不通、SketchUp 授權不足、使用者模型忙碌時顯示具體原因；新模式不可靜默回退成舊參數寫檔。

## 13. 相容與部署

新版 Worker 回報 Codex/MCP/各格式能力與版本，claim 只派發相容工作；舊 Worker 不得領取新模式。先部署可相容的資料庫／agent，再更新 Worker 安裝包，驗證能力後開啟前端入口。

設備批准／撤銷沿用既有角色規則；生成權限沿用現有產品角色，不新增 allow-all RLS。不在安裝包、提示詞、日誌或前端放 service role。

環境必須分離：FDS2.0 `omxizeukbcqzsnjsuwod`，Production `riaubhtruisbwdlwjzur`。任務、設備憑證、來源圖片與上傳目標不得跨環境。先在 FDS2.0 驗收，再依當次授權部署 Production；本文件不是正式部署授權。

UI 使用 src/components/ui 共用元件，對話框 Modal、確認 confirm()，遵守圖片元件契約並執行 npm run audit:ui。

## 14. Cursor 開發順序

1. 調查當前 PMS/FDS 能力、最新 migrations、前端呼叫 slug、Worker 與橋接，記錄採用的現有契約。
2. 建立本機最小實證：本機 Codex 非互動接圖 → MCP 建模 → 三格式與報告，驗證工作實例隔離。
3. 實作產品直接任務、版本化 payload、能力路由、租約與多產物發布 migration／agent。
4. 實作 Worker 資料下載、Codex 執行、串行鎖、心跳、取消、驗證、上傳與續傳。
5. 修改產品 SKP 入口，跳過辨認及參數確認，接入持久進度、結果及貼圖包下載。
6. 更新前置檢查、安裝包、配置說明、版本相容與測試。
7. 在 FDS2.0 跑完整驗收，提交實測證據；分別報告程式提交、migration、function、Worker 安裝及前端部署狀態。

## 15. 驗收條件

- AC-01：產品按一次生成後，不出現參數確認；本機 Codex 收到真實產品資料與圖片並透過 MCP 建模。
- AC-02：有尺寸、多圖、單圖、缺尺寸及圖片與目錄衝突的產品均有明確行為；估算記錄可查。
- AC-03：Codex 自行檢查截圖與修正；可編輯部件、正面、落地及 mm 尺寸正確。
- AC-04：SKP、FBX、GLB 同源，實際可開啟；FBX 貼圖包可攜，GLB 無外部依賴且頁面可預覽。
- AC-05：雙擊、重新整理、離頁返回、Worker 重啟、完成回應遺失不產生重複工作或版本。
- AC-06：SketchUp 使用者未儲存工作不被清空／覆蓋；兩個 Worker 不會同時控制同一實例。
- AC-07：Codex 失敗、MCP 斷線、卡住、匯出失敗、上傳中斷均可定位階段並正確重試；不發布缺格式結果。
- AC-08：設備撤銷／取消／租約失效後不能成功上傳發布；憑證不出現在 Codex 子程序或日誌。
- AC-09：新版工作不被舊 Worker 領走，原有預覽及舊生成工作仍相容。
- AC-10：替換模式新檔未成功前舊模型仍可下載；清理僅影響指定產品及無其他引用的檔案。
- AC-11：FDS2.0 端到端操作留有 job ID、輸入摘要、工具記錄、產物 manifest、雜湊與頁面截圖，不能只用 mock／build 通過代替。
- AC-12：npm run audit:ui 及變更所需型別／構建檢查通過；測試覆蓋租約、冪等發布、能力路由、憑證隔離及中斷恢復。

## 16. 交付要求

交付程式、migration、安裝包變更、設定說明及驗收證據。列明仍未驗證的機器／環境，不把手動 v06 上傳案例當成新流程 E2E。不順手刪除其他產品模型、修改 PMS 契約或覆蓋工作區無關變更。
