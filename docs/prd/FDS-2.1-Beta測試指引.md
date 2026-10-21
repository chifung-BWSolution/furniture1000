# FDS 2.1 內部 Beta 測試指引

最後更新：2026-10-20
對象：傢俬組（uploader）、PM、設計師、管理員
紀錄：測試問題回報到 Daily Command Log 或直接貼給開發，附頁面＋型號＋截圖。

---

## 1. Beta 版本內容

| 功能 | 入口 | 角色 |
|---|---|---|
| 供應商 PDF 上載＋解析（文字＋Grok OCR） | 產品管理 → 上載報價PDF →「供應商文件」 | admin／uploader |
| AI 提取審核（逐筆／批量、改欄、選主圖、開原文頁） | 產品管理 → AI 提取審核 | admin／uploader |
| 匯入產品庫（型號＋廠家身份、追加報價不改既有產品） | 同上，審核通過後按「匯入產品庫」 | admin／uploader |
| 產品搜索／詳情／溯源（折扣價＋原價，成本按角色遮蔽） | 設計師選傢俬 → 產品類型 | 全部職員 |
| 以圖搜款（Top 5 相似款） | 產品類型搜索框旁相機按鈕 | 全部職員 |
| 多供應商比較＋歷史價（不標最低價） | 產品詳情「比較」 | 全部職員（成本限 admin/uploader） |
| 參數化建模（桌/書架/櫃 GLB） | 設計師選傢俬 → SU模型 / 3D模型 | 全部職員 |
| Canva 客戶簡報（新需求尚未完成；目前為舊 PPTX 匯入流程） | PM報價 → 簡報生成 | 沿用既有授權；新通路待 PoC |

## 2. 推薦測試流程（上載 → 解析 → 審核 → 搜索 → 溯源）

1. 上載：上載報價PDF →「供應商文件」面板選 PDF（≤60MB、≤200MB 儲存上限）→ 文件排隊解析。狀態轉「解析中 → 審核中」。
2. 解析：頁面分類（封面/目錄/產品/價目表/條款）、逐頁文字（掃描頁走 OCR）、分段、意 AI 結構化。文件大時分批跑（每批刷新狀態）。
3. 審核：「需注意」欄先處理（缺型號、價格不在原文、缺幣種、尺寸可疑）。可在欄位直接改值（顯示 AI 原值），改完才可批量通過。
4. 價格閘門：`price_not_in_source`／`missing_price` 必須人工補價才可通過；未確認項批量通過會自動跳過。
5. 匯入：全部/選中已通過項 →「匯入產品庫」。同廠家同型號沿用既有產品（不會改它的資料），只追加報價與來源。
6. 搜索：產品類型頁搜型號（去符號也命中：`FDS-T900` / `fds t900`）、疊加篩選、點卡片/詳情看多供應商與歷史價。
7. 溯源：詳情與卡片的「來源」直接開原文 PDF 對應頁（bbox 有座標時畫框）。
8. 簡報新需求待實作：提供匯報內容／素材 → Canva 設計 → Canva 編輯 → 保存並下載 PPTX → PowerPoint 驗證。現有選產品、本機 PPTX 下載及 Canva 匯入不能視為通過此驗收。

### SKP 新流程驗收（待實作，不能當作目前可用）

1. 上傳 SKP 並綁定產品／模型工作項；等待預覽轉換完成，於系統內旋轉、縮放、平移，下載原檔核對。
2. 同一產品再點生成，應先列出上傳及過往生成版本，提示是否沿用，可先預覽。
3. 選「使用此文件」不再呼叫 AI、不新增生成任務；選「仍要重新生成」才建新版本，舊檔保留。
4. 查詢失敗不可當作沒有文件；損壞／無權限檔不可沿用。預覽失敗需可重試，原檔有效時仍可下載。
5. SKP 讀取／預覽轉換尚待 T-807a 驗證；現有 GLB 原型不代表已支援上傳 SKP 預覽。
## 3. 已知限制（至 2026-10-20）

- **解析準確率未做真實 PDF 對答案**（計劃 T-503）：目前只用合成 27 頁文件驗收；價格提取準確率要等 5–10 份真實供應商 PDF 回測。
- 非 JPEG 的掃描頁（CCITT／Flate／JPX）與 PDF 內嵌 Flate 圖不支援，會標 `unsupported`（等 Python Worker）。
- Edge worker 只接 ≤60MB PDF（Storage 上限 200MB）。
- AI 產品的分類暫存文字 `category`；`product_category_id` 要在「待處理產品」人工歸類；AI 顏色是原文（多為中文），顏色篩選按原文比對。
- 建模：目前為四類固定模板 GLB 原型，未依設計圖還原組件結構，AI 估算尺寸的來源標記亦待修正。方案是參數化幾何引擎，不用 OpenSKP；SKP 由 SketchUp 官方 C SDK 在 Windows SKP Worker 寫出。SU 頁可排「生成 SKP」，但 worker 未上線前任務只會排隊；`skp_writer.exe` 未編譯、未在 SketchUp 實機驗收（T-802a／T-803）。產品詳情可上載／下載 SKP、GLB。現有程式仍會拒絕沙發／椅子／曲面，這是待修正的實作落差，不是新版需求限制。完整流程與驗收見完整需求 F-AI-008、技術架構第 7 節。
- 簡報：使用者內容到 Canva 原生設計、編輯及下載的完整通路未驗證，T-901～903 待重做。既有本機 PPTX／Design Imports 不符合新需求，不能只補 secrets 後標示完成。
- 重新解析會保留已審核項目、同型號不重複產生；已匯入的價錢不能透過審核改動（要另開新報價）。
- 供應商文件/審核/成本頁只對 admin 與傢俬組（uploader）；其他角色搜索只能見折扣價＋原價，看不到任何成本價。

## 4. 後台/運維提示

- 任務層：`processing_jobs` 一文件一活動任務（partial unique index）、`idempotency_key` 唯一；斷點續跑用 checkpoint，不燒重試次數。失敗可在「供應商文件」面板重試／取消。
- 部署：FDS 2.1 的 migration 與 edge functions **必須同時部署**到正式 `riaubhtruisbwdlwjzur` 與分支 `omxizeukbcqzsnjsuwod`；edge slug 固定 `supabase-functions-<name>`（部署腳本 `scripts/deploy-edge-functions.ps1`）。
- Canva secrets（未設）：`CANVA_CLIENT_ID`／`CANVA_CLIENT_SECRET` 設到兩個 project 的 Edge secrets；redirect URI＝`<域名>/fds/pm/presentation`。
- 成本：`processing_jobs` 記 tokens／OCR 頁／時長／費用；文件列表可查。
