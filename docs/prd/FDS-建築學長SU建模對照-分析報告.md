# 建築學長 SU 建模邏輯 × FDS 對照分析

日期：2026-11-02
狀態：分析結論，尚未改程式
對象：FDS 本機 Codex 建模（`codex_v1`）與本機已安裝的建築學長電腦版（`D:\jzxz`，`Desktop.Shell` 1.1.28）

本報告只採用靜態觀察：建築學長的 `Settings\Skills\SketchUpMCP\`，以及 FDS 的 `workers/skp-writer/`。沒有執行兩邊的建模。

## 1. 結論

可以結合，而且只該結合「單件產品怎麼落盤、怎麼分批、怎麼才准說完成」。
FDS 已經有任務、專用 SketchUp、Codex、三格式匯出和尺寸驗收。建築學長多出來、而且被它自己證明有用的，是腳本載體閘門：新建幾何不準寫在一次工具呼叫裡。

不要把建築學長的房間／CAD 技能、主從 Agent、或整份 `SKILL.md` 搬進 FDS。

## 2. 兩邊現在各自做什麼

### FDS

產品頁「生成 SKP」走 `fds_request_product_skp`，建立 `generate_skp` 且 `payload.mode = codex_v1`。已授權、回報 `codex_v1` 的 Worker 領取後：

1. 開本次工作目錄，下載產品快照和參考圖。
2. 用互斥鎖啟動專用 SketchUp，bridge 只聽本機。
3. `workers/skp-writer/codex/prompt.mjs` 產生 `prompt.md`，Codex 以 `workspace-write` 在該目錄工作，只掛 `fds-sketchup`。
4. 工具是 `get_scene_info`、`get_selection`、`eval_ruby`、`screenshot`。`eval_ruby` 由 `fds_codex_session.rb` 的 `run_eval` 包進一次 `start_operation('FDS Codex')`，失敗就 `abort_operation`。
5. Codex 必須寫出 `outputs/report.json`，並讓 `orientation_review.passed = true`。Worker 再用 `validateOutputs` 量外框：有目錄尺寸的軸是 ±max(5 mm, 1%)，底部 z=0，X／Y 置中為警告。
6. Worker 自己匯出 SKP、FBX、GLB 和預覽，核對雜湊後發布。Codex 不能自己匯出，也不能宣稱完成來代替這些檢查。

座標已定死：毫米；寬 = X，深 = Y，高 = Z；正面朝 -Y；底部在 z=0；以原點置中。

### 建築學長

主提示詞在 `Settings\SystemPrompts\SystemPrompt.md`，只負責把沾邊的任務送進技能。SketchUp 步驟在 `SketchUpMCP\SKILL.md`，細節在 `references\`，真正擋住違規呼叫的是 `stdio_bridge.py`。

它有兩條路：

- 有 CAD／平面真源：先寫 `trace_manifest.json`，`validate_trace.py` 通過後才建模。來源決定數量、位置、footprint、旋轉。
- 自由創作或單件：跳過清單，直接寫腳本。

新建幾何（`add_group`、`add_face`、`pushpull`、`add_instance`、`add_edges` 等）必須先在工作區落成 `.py`，由腳本連 `127.0.0.1:9876`。只查詢、小改已存在物件、保存、截圖可以直接呼叫。橋接註解寫明：只靠提示詞時，模型連續三輪仍把幾何 Ruby 直接丟進 `execute_ruby`。

`workers/skp-writer/jzxz/skill/fds-furniture-task/SKILL.md` 是反方向。它讓建築學長領 FDS 任務，再叫建築學長去讀 `SketchUpMCP`。那不是 FDS 自己的 Codex 路徑。

## 3. 對照

| 題目 | FDS 現況 | 建築學長 | 是否併入 |
|---|---|---|---|
| 誰觸發 | 產品頁一個按鈕，無人值守 | 對話裡判斷技能，可問人、可派子 Agent | 維持 FDS |
| 幾何怎麼送進 SketchUp | 提示詞要求直接 `eval_ruby` | 必須先有腳本；閘門在 bridge | 併入。這是主要差距 |
| 單位 | Ruby 用 `.mm`；外層一次 undo | Ruby 用 `.mm`；MCP `create_geometry` 另吃裸英寸 | 只保留 `.mm`。FDS 沒有 `create_geometry` |
| 外框公差 | 目錄軸 ±max(5 mm, 1%) | FDS 技能寫 ≤ 2 mm | 併入 2 mm，只限有目錄值的軸 |
| 看圖驗收 | 最多 3 輪截圖；頂視和 `orientation_review` 是發布門檻 | 看過預覽仍要寫偏差，不准只寫完成 | 併入 `known_issues` 規則 |
| 重跑 | 斷線後要求先查場景 | `project_id` 只刪自己上一輪的組 | 併入，以 job id 當標記 |
| 交接檔 | `report.json` + Worker 的 `validation.json` | 另有 `model_state.json`、`PARAMS` | 不新增檔。尺寸快照放進現有報告 |
| CAD 圖層、床位朝向、門扇淨空 | 無 DWG 真源 | 整間室內的主流程 | 不併入 |
| 對話框 | 啟動停在授權視窗就算失敗 | 停下來請人去點 SketchUp | 不併入。FDS 繼續失敗並寫原因 |
| 風格參考 `.skp` | 無 | 只學材質和零件密度，不學布局 | 不在本期 |

## 4. 為什麼不能只改提示詞

`prompt.mjs` 第 59 行要求「每次 `eval_ruby` 後查場景」。這和建築學長已觀察到的失敗方式相同：模型把整段幾何寫進一次呼叫，單位、擠出方向和重複建立都要在同一次回傳裡猜。

FDS 還有一個建築學長沒有的約束：`run_eval` 已經開了 `start_operation`。若再把建築學長「每批自己 `start_operation`／`commit_operation`」抄進腳本，會在已開啟的操作裡再嵌一層。本期腳本不準自己開關 operation；一次 `load` 就是一批，成敗由外層 `run_eval` 提交或回滾。

Codex 啟動參數已是 `-s workspace-write` 且工作目錄就是本次 job。它能把 `build_model.rb` 寫在 job 目錄，不需要建築學長的 `FileIO_Write`，也不需要再連一個 TCP `9876`。

## 5. 建議的最小改動

只動 Worker 本機這三處：

- `workers/skp-writer/codex/prompt.mjs`：新建幾何改為寫 `build_model.rb`，`eval_ruby` 只准 `load` 這個檔。
- `workers/skp-writer/codex/mcp-server.mjs`：在 `eval_ruby` 進 SketchUp 之前擋掉內嵌幾何。
- `workers/skp-writer/codex/job.mjs` 的 `validateOutputs`：有目錄尺寸的軸改為 ≤ 2 mm；報告要有腳本路徑和 `known_issues`。

不改 `fds_request_product_skp`、不改 edge function、不加資料表、不把 `SketchUpMCP` 目錄拷進 repo。人工修正（`deps.feedback`）仍在原場景上改，但修正也要回寫同一個 `build_model.rb`，否則下次整份重跑會把被否決的形狀再生出來。

## 6. 風險

- 閘門若只檢查「目錄裡有沒有近期腳本」，模型可以先寫一個空檔再繼續內嵌 Ruby。FDS 要檢查的是這一次 `eval_ruby` 的原文，不是旁路檔案是否存在。
- `load` 必須鎖在本次 job 的 `build_model.rb`。放行任意路徑會讓 Codex 去載工作目錄以外的檔。
- 2 mm 比現行程式嚴。目錄尺寸和圖片比例衝突時，仍以目錄為準；達不到就讓任務停在驗證失敗，不放寬後照樣發布。
- 建築學長關於 `view.write_image` 不能傳 Hash 的限制，是它自己的橋接。FDS 的 `screenshot` 已用關鍵字參數而且走另一條路徑，不要改。
