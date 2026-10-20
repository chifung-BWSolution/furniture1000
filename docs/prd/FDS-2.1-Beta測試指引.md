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
| 簡報生成（PPTX 下載；Canva 匯入等憑證） | PM報價 → 簡報生成 | 全部職員（Canva 匯入限 admin/uploader） |

## 2. 推薦測試流程（上載 → 解析 → 審核 → 搜索 → 溯源）

1. 上載：上載報價PDF →「供應商文件」面板選 PDF（≤60MB、≤200MB 儲存上限）→ 文件排隊解析。狀態轉「解析中 → 審核中」。
2. 解析：頁面分類（封面/目錄/產品/價目表/條款）、逐頁文字（掃描頁走 OCR）、分段、意 AI 結構化。文件大時分批跑（每批刷新狀態）。
3. 審核：「需注意」欄先處理（缺型號、價格不在原文、缺幣種、尺寸可疑）。可在欄位直接改值（顯示 AI 原值），改完才可批量通過。
4. 價格閘門：`price_not_in_source`／`missing_price` 必須人工補價才可通過；未確認項批量通過會自動跳過。
5. 匯入：全部/選中已通過項 →「匯入產品庫」。同廠家同型號沿用既有產品（不會改它的資料），只追加報價與來源。
6. 搜索：產品類型頁搜型號（去符號也命中：`FDS-T900` / `fds t900`）、疊加篩選、點卡片/詳情看多供應商與歷史價。
7. 溯源：詳情與卡片的「來源」直接開原文 PDF 對應頁（bbox 有座標時畫框）。
8. 簡報：PM報價 → 簡報生成 → 搜索選產品（≤30）→ 調標題 → 生成 PPTX 下載（價錢可關）。

## 3. 已知限制（至 2026-10-20）

- **解析準確率未做真實 PDF 對答案**（計劃 T-503）：目前只用合成 27 頁文件驗收；價格提取準確率要等 5–10 份真實供應商 PDF 回測。
- 非 JPEG 的掃描頁（CCITT／Flate／JPX）與 PDF 內嵌 Flate 圖不支援，會標 `unsupported`（等 Python Worker）。
- Edge worker 只接 ≤60MB PDF（Storage 上限 200MB）。
- AI 產品的分類暫存文字 `category`；`product_category_id` 要在「待處理產品」人工歸類；AI 顏色是原文（多為中文），顏色篩選按原文比對。
- 建模：只有辦公桌／會議桌／書架／儲物櫃四類參數化。方案是幾何引擎，不用 OpenSKP。設計師 SU 要下載 SKP；目前只輸出 GLB，SKP 尚未寫出，也未在 SketchUp 實機驗證（T-803）。沙發／椅子／曲面直接拒絕。
- 簡報：Canva 匯入通路等 `chifung.login` 完成 Connect API 註冊＋secrets 設定（T-901 收尾）；PPTX 通路已可用。
- 重新解析會保留已審核項目、同型號不重複產生；已匯入的價錢不能透過審核改動（要另開新報價）。
- 供應商文件/審核/成本頁只對 admin 與傢俬組（uploader）；其他角色搜索只能見折扣價＋原價，看不到任何成本價。

## 4. 後台/運維提示

- 任務層：`processing_jobs` 一文件一活動任務（partial unique index）、`idempotency_key` 唯一；斷點續跑用 checkpoint，不燒重試次數。失敗可在「供應商文件」面板重試／取消。
- 部署：FDS 2.1 的 migration 與 edge functions **必須同時部署**到正式 `riaubhtruisbwdlwjzur` 與分支 `omxizeukbcqzsnjsuwod`；edge slug 固定 `supabase-functions-<name>`（部署腳本 `scripts/deploy-edge-functions.ps1`）。
- Canva secrets（未設）：`CANVA_CLIENT_ID`／`CANVA_CLIENT_SECRET` 設到兩個 project 的 Edge secrets；redirect URI＝`<域名>/fds/pm/presentation`。
- 成本：`processing_jobs` 記 tokens／OCR 頁／時長／費用；文件列表可查。
