# 建築學長 SU 建模邏輯 × FDS 對照分析

日期：2026-11-02（同日復查修訂）
狀態：分析結論，尚未改程式
對象：FDS 本機 Codex 建模（`codex_v1`）與本機已安裝的建築學長電腦版（`D:\jzxz`，`Desktop.Shell` 1.1.28）

依據只有靜態觀察：建築學長的 `Settings\Skills\SketchUpMCP\`、它的 .NET 組件（以 REA 檢查），以及 FDS 的 `workers/skp-writer/`。兩邊都沒有實際跑一次建模。

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
