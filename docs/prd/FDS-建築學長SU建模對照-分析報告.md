# 建築學長 SU 建模邏輯 × FDS 對照分析

日期：2026-11-02（同日復查修訂）
狀態：分析結論；第 7.3 節五項已實作（見 7.4）
對象：FDS 本機 Codex 建模（`codex_v1`）與本機已安裝的建築學長電腦版（`D:\jzxz`，`Desktop.Shell` 1.1.28）

第 1–6 節的依據是靜態觀察：建築學長的 `Settings\Skills\SketchUpMCP\`、它的 .NET 組件（以 REA 檢查），以及 FDS 的 `workers/skp-writer/`。
第 7 節另外對照了兩邊各一次實際任務的資料夾。

## 1. 結論

可以結合，但只該收「單件產品的幾何寫在腳本裡、分批載入、做完要列出偏差」這幾條。
FDS 已經有任務、專用 SketchUp、Codex、三格式匯出、本機人工驗收和尺寸檢查。建築學長多出來、而且它自己用程式擋過的，是腳本載體閘門。

不要搬建築學長的房間／CAD 技能、主從 Agent，也不要拷貝它的 `SKILL.md`。

## 2. 兩邊現在各自做什麼

### FDS

產品頁「生成 SKP」走 `fds_request_product_skp`，建立 `generate_skp`，`payload.mode = codex_v1`。已授權、回報 `codex_v1` 的 Worker 領取後：

1. 建立 `<workRoot>/<job>-a<attempt>/`，下載產品快照和參考圖到 `references/`。
2. 取得 SketchUp 互斥鎖，用 `seed.skp` 複製出 `working.skp`，啟動專用 SketchUp；bridge 只聽本機。
3. `codex/prompt.mjs` 產生 `prompt.md`。Codex 以 `exec -C <job目錄> -s workspace-write` 執行，只掛 `fds-sketchup`。
4. 工具是 `get_scene_info`、`get_selection`、`eval_ruby`、`screenshot`（每 job 最多 12 張）。`eval_ruby` 由 `fds_codex_session.rb` 的 `run_eval` 包進一次 `start_operation('FDS Codex')`，失敗就 `abort_operation`；單次等待 170 秒。
5. 提示詞要 Codex 用 `eval_ruby` 的 `File.write` 把 `outputs/report.json` 寫出。Worker 要求報告裡的圖片分類數量正確、有單元計畫、`orientation_review.passed = true` 且 `unresolved` 為空，而且至少有一張頂視截圖。
6. Worker 自己匯出 SKP、FBX、GLB、預覽，`validateOutputs` 量外框：有目錄值的軸是 ±max(5 mm, 1%)，底部 z=0；置中和材質只是警告。
7. 之後進入**本機人工驗收**（`review.json`：accepted／revise／discarded）。選 revise 時，Worker 開新目錄 `<job>-a<attempt>-r<n>/`，用上一版的 SKP 當起始場景，把修正意見附在提示詞後再跑一次 Codex。驗收通過才上傳發布。

座標已定死：毫米；寬 = X，深 = Y，高 = Z；正面 -Y；底部 z=0；平面以原點置中。

MCP 工具日誌（`logs/mcp-tools.jsonl`）對 `eval_ruby` 只記工具名、成敗、耗時、原文 SHA-256 和字數，不記原文。

### 建築學長

主提示詞 `Settings\SystemPrompts\SystemPrompt.md` 只負責把沾邊的任務送進技能。SketchUp 步驟在 `SketchUpMCP\SKILL.md`，細節在 `references\`，攔截在 `stdio_bridge.py`。

兩條路：

- 有 CAD／平面真源：先寫 `trace_manifest.json`，`validate_trace.py` 通過後才建模。來源決定數量、位置、footprint、旋轉。
- 自由創作或單件：不寫清單，直接寫腳本。

新建幾何必須先在工作區落成 `.py`，由腳本連 `127.0.0.1:9876`。只查詢、小改已存在物件、保存、截圖可直接呼叫。

`stdio_bridge.py` 的閘門：`execute_ruby` 原文包含 `add_group`、`add_face`、`pushpull`、`add_instance`、`add_edges`、`add_line`、`add_curve`、`add_circle`、`add_arc`、`followme`、`definitions.add` 之一，而且工作區兩小時內沒有任何 `.py`，就回工具錯誤、不送進 SketchUp。註解寫明只靠提示詞時，模型連續三輪仍直接丟幾何 Ruby。

這個閘門很鬆：只要工作區有任何近期 `.py` 就整段放行，不看這一次 Ruby 是不是來自腳本；自己出錯時也放行（fail-open）。它擋的是習慣，不是能證明「幾何一定來自腳本」。

### REA 復查：.NET 主程式沒有第二道閘門

用 REA `inspect_managed_members` 讀 `Runtime.Core.dll` 的 1579 條 `ldstr` 字串（Evidence `ev_483e7f10…`，兩頁讀完、`exhausted: true`）：

- 沒有 `execute_ruby`、`build_model`、腳本載體相關字串。`stdio_bridge.py` 註解說閘門刻意不放在 .NET 的 `SkillExecutor`，與此一致。
- `sketchup`／`app:sketchup` 出現在資源名表（`autocad`、`rhino`、`blender`…），配合「资源…正被另一个任务占用」訊息，是按軟體互斥的資源鎖。FDS 已有自己的 SketchUp 鎖。
- `AddFace`、`PushPull`、`CreateWall` 與 `` ```ruby `` 等出現在記憶提取規則旁，用來辨識「成功執行的建模程式碼」以寫進長期記憶，不是攔截。

以上是字串層面的靜態觀察，沒有反編譯方法體、沒有執行。

## 3. 對照

| 題目 | FDS 現況 | 建築學長 | 是否併入 |
|---|---|---|---|
| 誰觸發 | 產品頁一個按鈕，之後本機人工驗收 | 對話中判斷技能，可問人、可派子 Agent | 維持 FDS |
| 幾何怎麼送進 SketchUp | 提示詞要 Codex 直接 `eval_ruby` | 先有 `.py`；bridge 只查有無近期 `.py` | 併入，而且 FDS 要檢查這一次呼叫的原文 |
| 單位 | Ruby 用 `.mm`；外層一次 undo | Ruby 用 `.mm`；`create_geometry` 另吃裸英寸 | 只保留 `.mm`。FDS 沒有 `create_geometry` |
| 外框公差 | 目錄軸 ±max(5 mm, 1%) | 牆／洞口 ≤ 2 mm，家具中心 ≤ 5 mm，footprint ≤ 10 mm | 維持現值（見第 6 節） |
| 看圖驗收 | 四視角；頂視和 `orientation_review` 是硬門檻；之後人工驗收 | 看過預覽仍要寫偏差 | 併入 `known_issues`，顯示給人工驗收 |
| 重跑 | 只要求斷線後先查場景 | `project_id` 只刪自己上一輪的組 | 併入，用 job id 標記 |
| 修正回寫 | 修正輪開新目錄，只帶上一版 SKP | 場景手改後必須回寫腳本 | 併入，Worker 把上一輪腳本複製進新目錄 |
| CAD 圖層、床位、門扇淨空 | 無 DWG 真源 | 整間室內主流程 | 不併入 |
| 對話框 | 啟動卡在授權窗即失敗 | 停下請人點 | 不併入 |

`workers/skp-writer/jzxz/skill/fds-furniture-task/SKILL.md` 裡的「外框 ≤ 2 mm」是本 repo 自己寫給建築學長的試驗技能（提交 `0752d02a`），不是建築學長原有的標準，不能拿來當收緊 FDS 公差的依據。

## 4. 為什麼不能只改提示詞

`prompt.mjs` 現在第 59 行要 Codex「每次 `eval_ruby` 後若不確定結果先查場景」，等於默認幾何就寫在一次次 `eval_ruby` 裡。建築學長的經驗是：光寫規則，模型仍會這樣做。

FDS 的閘門要和建築學長不同：

- **檢查原文，不檢查旁邊有沒有檔案。** 允許的唯一建模呼叫是載入本次 job 的 `build_model.rb`。
- **不能自己開 operation。** `run_eval` 已經開了一層；腳本裡再 `start_operation` 會嵌套。一次載入就是一批。
- **報告改用 Codex 的檔案工具寫。** Codex 本來就能寫 job 目錄。報告若繼續走 `eval_ruby` 的 `File.write`，報告文字裡出現 `pushpull` 這類字就會被自己的閘門擋住。
- **修正輪要帶腳本。** 修正輪在新目錄執行，不複製上一輪的 `build_model.rb` 就無從「回寫同一支腳本」。

字串閘門仍可被繞過（例如 `send`、字串拼接、`eval`）。它的作用是讓正常建模走腳本，不是安全邊界。要證明幾何能由腳本重建，需要另外在乾淨場景重跑腳本並比對外框；本期不做，列為後續。

## 5. 建議的最小改動

只動 Worker 本機：

- `codex/prompt.mjs`：幾何寫 `build_model.rb`；`eval_ruby` 只准載入它；報告用檔案工具寫；修正輪改腳本後重載。
- 新增純函式模組（例如 `codex/ruby-gate.mjs`）做閘門判斷，`codex/mcp-server.mjs` 在 `bridgeCall` 前呼叫它，並在工具日誌記下這次是不是腳本載入。
- `codex/env.mjs` 的 `bridgeEnv` 多傳 `FDS_CODEX_SCRIPT`（腳本絕對路徑）。
- `codex/job.mjs`：發布前要求有腳本載入記錄、報告欄位；修正輪先複製上一輪腳本。

不改 `fds_request_product_skp`、edge function、資料表、Storage 路徑，也不把 `SketchUpMCP` 拷進 repo。

## 6. 決定與風險

- **公差（已定，2026-11-02）。** 維持 ±max(5 mm, 1%)：3200 mm 的桌子容許到 32 mm。改成 2 mm 會讓圓角、收邊、腳墊的估算誤差直接變成驗證失敗；偏差改為寫進 `known_issues` 給人工驗收看。
- **字串閘門的誤擋與漏擋。** 原文裡的註解或字串也會命中關鍵字；反過來，動態呼叫能漏過。要用測試固定行為，並明說它不是安全控制。
- **`load` 路徑。** 必須由環境變數給絕對路徑，比對時正規化斜線；不能讓模型自選檔案。
- **單次 170 秒。** 一次載入整支腳本可能超時；靠 `FdsBuild.batch(name)` 分批。
- **舊修正輪。** 改版前生成、目錄裡沒有 `build_model.rb` 的 job，修正時沒有可複製的腳本。腳本只會刪除帶本 job 標記的幾何，舊幾何沒有標記，會留在場景裡，報告要說明。
- `screenshot` 的 `view.write_image(filename: …)` 是 FDS 自己的 bridge，已經在用；建築學長「不能傳 Hash」的限制屬於它的橋接，不要套到 FDS。

## 7. 實際任務資料夾對照（2026-11-02）

建築學長：`Documents\jzxz_AIWorkSpace\雅緻格調單人沙發_JSSF010-1`（單人沙發，135,100 個面，22 個部件，SKP 6.9 MB）。
FDS：`%LOCALAPPDATA%\FDS\SkpWorker\jobs\80179101-…-a1`（LF-H34P 會議枱，146 個面，SKP 220 KB）。

### 7.1 建築學長怎麼做這張沙發

1. `build_model.py` 開頭是一份 `PARAMS`：總尺寸、每個部件的尺寸／中心／圓角、拉扣位置、縫線半徑、材質 RGB、相機、`known_issues`。
2. `--prepare`：在 Python 裡算出每個部件的三角網格（軟包隆起、拉扣凹陷、扶手輪廓、滾邊管、刀形腳），每件存成 `geometry\<部件>.json`，清單寫進 `mesh_manifest.json`（5 批、總外框、面數）。
3. 同一步用 Python 生成皮紋貼圖 `暖灰褐西皮_細紋.png`：底色取自照片，256 px、紋理大小 55 mm。
4. 建模：每批一次 `execute_ruby`，Ruby 只做 `Geom::PolygonMesh` → `fill_from_mesh(AUTO_SOFTEN | SMOOTH_SOFT_EDGES)`，邊全部柔化；每件是具名 Group，分 Tag（`01_底座`…`05_縫線與滾邊`），根組帶 `project_id`、`sku`、`overall_mm`、`facing` 屬性。重跑只刪自己同名的部件。每批結果寫 `NN_<批次>_result.json`（部件、entity id、面數）。
5. `--validate`：部件數等於清單、每件面數 > 0、逐件 `manifold?`、外框誤差 < 2 mm、材質數／貼圖材質數，寫 `validation.json` 和 `model_state.json`。
6. 驗收：清除未用材質與組件定義；存 SKP 後**重新開檔**再讀一次，做語義檢查（坐墊在靠背前面、拉扣 2 顆、金屬腳 4 支），寫 `final_audit.json`。
7. 預覽：設背景色、關邊線與輪廓、開環境光遮蔽、開貼圖、固定相機與 FOV，輸出透視、正面、俯視三張；SKP 裡加場景頁 `01_透視`、`02_正面`、`03_俯視`。
8. 每次修正前備份腳本和 SKP（`build_model_尺寸核驗修正前.py`、`…_柔化前備份.skp`），修正腳本本身也留在資料夾。
9. `trace_manifest.json`：照片的每個區域（底座、坐靠墊、扶手、金屬腳、拉扣、攝影背景）對應到哪個部件、信心是 explicit 還是 inferred、哪些被排除及原因。

### 7.2 FDS 現在少了哪些

| 項目 | 建築學長 | FDS 現在 | 影響 |
|---|---|---|---|
| 參數化腳本 | `build_model.py` + `PARAMS`，改數字重跑 | 沒有，幾何散在多次 `eval_ruby` | 修正只能在場景上補；第 5 節 PRD 已處理 |
| 曲面網格 | 外部算網格，`fill_from_mesh` + 自動柔化 | Codex 用 `add_face`／`pushpull` 拼方塊 | **沙發、軟包、圓角件明顯偏方**，這是外觀差距最大的一項 |
| 邊線柔化 | 所有接縫 `soft`／`smooth` | 不處理 | 預覽和 FBX 看得到多邊形折線 |
| 貼圖來源 | 依照片顏色生成貼圖 | 今天起改用 SketchUp 內建 `.skm` 再調色 | 內建庫每類只有 4–6 款（皮革只有 `Leather_06`、布 5 款），紋理粗細和色調只能靠調色貼近照片 |
| 部件級檢查 | 部件數、每件面數、`manifold?` | 只檢查頂層組 > 0、沒有散落幾何 | 缺件或破面不會被擋 |
| 語義檢查 | 重開檔後查坐墊／靠背前後、拉扣數、腳數 | 只靠 Codex 看截圖自評 | 方向或缺件錯誤只能靠人工驗收發現 |
| 存檔回讀 | 存檔後重新開檔再量 | 量記憶體中的模型再匯出 | 存檔失真不會被發現（目前沒見過，屬低風險） |
| 預覽樣式 | 去邊線、環境光遮蔽、固定相機，三張預覽 | 預設樣式等角一張，加 Codex 的檢查截圖 | 網站預覽較粗糙 |
| SKP 場景頁 | 透視／正面／俯視三頁 | 沒有 | 設計師開檔要自己轉視角 |
| Tag 與屬性 | 每部件分 Tag；根組有 sku、尺寸、正面方向 | 只有 job id 與 nonce | 設計師難以按類別隱藏部件，SKP 不帶產品身份 |
| 清理 | 清未用材質與組件定義 | 今天起清未用材質；定義未清 | 檔案略大 |
| 照片對應 | `trace_manifest`：區域 → 部件 → 信心 | `reference_analysis` 只到整張圖 | 報告看不出哪個部件是推算的 |
| 修正備份 | 每次修正前備份腳本與 SKP | 修正輪開新目錄，上一輪 SKP 保留 | 已有等效機制，不用補 |
| 開檔保護 | `previous_document.json` 防止覆蓋使用者模型 | 專用 SketchUp 實例 | 不需要 |

### 7.3 建議順序

1. **網格載體＋柔化**：把第 5 節 PRD 的 `build_model.rb` 擴充為「可以載入 Codex 在 job 目錄算好的 `geometry/*.json`」，Ruby 端固定用 `fill_from_mesh` 並柔化。網格計算可以由 Codex 用 Worker 自帶的 Node 寫腳本產生，不用另裝 Python。
2. **部件級與語義檢查**：報告加 `parts`（名稱、數量、預期 manifold），匯出時由 `fds_codex_session.rb` 逐件量面數與 `manifold?`，`validateOutputs` 比對。
3. **預覽樣式與場景頁**：在 `fds_codex_session.rb` 的匯出步驟固定設定（純 Worker 端改動，不靠提示詞）。
4. **Tag 與根組屬性**：提示詞要求按部件類別分 Tag；匯出時由 Worker 寫入 sku、型號、外框、正面方向。
5. **生成貼圖**：內建庫對不上的皮紋、絨布、特殊木紋，允許 Codex 在 job 目錄產生小尺寸貼圖 PNG 再套用。

`trace_manifest` 的完整格式為房間 CAD 而設，單件傢俬只需要在報告的 `parts` 裡加「依據哪張圖、explicit／inferred」兩欄，不必照搬。

### 7.4 實作狀態（2026-11-02）

五項都已實作，並經真實 SketchUp 2026 端到端驗證（測試沙發 11 個部件、3 個批次、修正重載不重複；GLB 6 張圖、FBX 2 張貼圖；部件與語義檢查全過）。

1. **網格載體＋柔化**：`fds_codex_session.rb` 新增 `FdsKit`。`FdsKit.mesh` 收頂點與面索引，固定用 `fill_from_mesh` 加柔化，自動修正面朝向；另有 `rounded_box`（圓角、坐墊鼓面）、`tube`（滾邊、管腳）、`box`。和原建議不同：網格直接在 `build_model.rb` 用 Ruby 算，不另讀 `geometry/*.json`，少一層檔案格式。
2. **部件級與語義檢查**：匯出回傳每個部件的面數、`manifold?`、Tag、外框；`validateOutputs` 加 `product_root`、`parts_not_empty`、`parts_match_report`、`parts_solid`、`parts_tagged` 與 `semantic_N`（`count`／`front_of`／`above`）。缺 `batches`、`parts`、`semantic_checks`、`known_issues` 的報告直接退回。
3. **預覽樣式與場景頁**：匯出固定設定淺底、無邊線、環境光遮蔽，建「01 透視／02 正面／03 俯視」三頁，另出 `preview-front.png`、`preview-top.png`。正面、俯視用平行投影，並按 4:3 輸出比例重新取景（之前寬視窗會裁掉兩側）。
4. **Tag 與根組屬性**：`FdsKit.part` 必帶 Tag；匯出把名稱、型號、SKU、外框、正面方向（`-Y`）、job id 寫進 `fds_product` 屬性與模型描述。
5. **生成貼圖**：`FdsKit.texture` 在 job 的 `textures/` 產生皮紋、布紋、木紋 PNG；`FdsKit.material(skm:)` 載入內建庫。
