# FDS 2.1 內部 Beta 測試指引

最後更新：2026-10-21
對象：傢俬組（uploader）、PM、設計師、管理員
紀錄：測試問題回報到 Daily Command Log，或直接貼給開發，附頁面、型號、截圖。

---

## 0. 怎麼打開 Beta

| | 內部 Beta | 正式站 |
|---|---|---|
| 網址 | https://bwfbwfbranding-work-furniture-git-develop-bwsystem.vercel.app | https://www.bwteam-furniture.com 、https://bwteam-furniture.com |
| Git | `develop` | `main` |
| 資料庫 | FDS2.0 分支 `omxizeukbcqzsnjsuwod` | 正式庫 `riaubhtruisbwdlwjzur` |

- 用上面的 develop preview。`bwteam-furniture.com` 仍是正式站，上面還沒有這輪 Beta 的資料。
- Preview 要先過 Vercel 登入（團隊 SSO）。登入後，develop 建置會出現「一鍵登入」。
- 一鍵登入只在 git 分支剛好是 `develop` 時存在。正式站用「使用 PMS 登入」。
- 在 Beta 上載、審核、改價，寫進的是分支庫，不會改正式庫的產品。

## 1. 現在可以測的功能

| 功能 | 入口 | 角色 |
|---|---|---|
| 供應商 PDF 上載與解析 | 產品管理 → 上載報價PDF →「供應商文件（原始 PDF）」 | admin／uploader |
| AI 提取審核（逐筆、批量、改欄、選主圖） | 產品管理 → AI 提取審核 | admin／uploader |
| 匯入產品庫（同廠同型號沿用既有產品，只追加報價） | 審核通過後按「匯入產品庫」 | admin／uploader |
| 產品搜索、詳情、多供應商與歷史價 | 設計師選傢俬 → 產品類型 | 全部職員；成本只給 admin／uploader |
| 以圖搜款 | 產品類型搜索旁的以圖搜款 | 全部職員 |
| 開原文頁 | 產品卡片／詳情的來源。沒有權限時不顯示入口 | 只限 admin／uploader |
| 3D 預覽（GLB）與生成 SU／3D | 打開產品詳情。側欄沒有獨立的「SU 模型／3D 模型」 | 全部職員 |
| 簡報 | PM報價 → 簡報生成 | 見下方限制；真實客戶簡報驗收未完成 |

## 2. 建議走一遍的流程

1. 上載：上載報價PDF → 供應商文件，選 PDF。儲存上限 200MB。超過 60MB 會在瀏覽器拆成約 40MB 的分段再逐段解析；已存放的大檔由 Windows 拆檔程式處理（部署後要重啟 worker）。審核頁仍是一份目錄。
2. 解析：狀態由排隊轉到解析中、審核中。大檔分批跑。上載後畫面會立刻叫醒 worker。若某批在最後一次執行時被中斷，每分鐘的 cron 仍會叫醒 worker：排隊中的任務仍看剩餘次數；心跳超過 10 分鐘的 running 任務不看次數，由 claim 標成 `worker_timeout` 或續跑。
3. 審核：先處理「需注意」（缺型號、價格不在原文、缺幣種、尺寸可疑）。欄位可改，改完才批量通過。
4. 價格：`price_not_in_source`、`missing_price` 要人工補價才能通過。未確認項在批量通過時會被跳過。
5. 匯入：已通過的項目按「匯入產品庫」。同廠家同型號沿用既有產品，只追加報價與來源。
6. 搜索：產品類型頁搜型號。去掉符號也會命中，例如 `FDS-T900` 與 `fds t900`。篩選可以疊加。
7. 溯源：admin／uploader 可從詳情或卡片打開原文 PDF 對應頁。其他角色看不到這道入口，也拿不到整份報價 PDF。

## 3. 不要當成已通過的項目

- **真實 PDF 準確率（T-503）**：還沒有用 5–10 份真實供應商 PDF 對答案。目前的解析驗收不是這次回測。
- **SKP 寫檔與 SketchUp 實機（T-802a、T-802b、T-803）**：這次不測、不驗收。產品詳情可以上載或下載 SKP／GLB／FBX，也可以排「生成 SU」。生成與上載後的預覽都要 Windows SKP Worker 在線。Worker 不在線時任務只會留在排隊。未在 SketchUp 裡打開核對過的檔，不能算通過。
- **Canva 真實簡報（T-901～903）**：PM報價 → 簡報生成是 Canva 頁。舊的「舊版產品 PPTX」模式已拿掉。還沒有用一份真實客戶匯報走完「Canva 設計 → 編輯 → 下載 PPTX → PowerPoint 仍可編輯」。不要把現有頁面當成這項驗收已通過。
- 建模類型已包含桌、櫃、梳化、辦公椅等。這不是「系統拒絕沙發／椅子」。未按設計圖還原組件結構，也沒有加工級精度。

## 4. 其他限制

- 非 JPEG 的掃描頁（CCITT／Flate／JPX）與 PDF 內嵌 Flate 圖會標 `unsupported`。
- AI 產品的分類先寫在文字 `category`。`product_category_id` 要在「待處理產品」人工歸類。顏色篩選比對的是原文（多為中文）。
- 重新解析會保留已審核項目。已匯入的價錢不能在審核裡改掉，要另開一筆報價。
- 供應商文件、審核、成本只給 admin 與傢俬組（uploader）。其他角色在搜索只看到折扣價與原價。

## 5. 給維護的人

- 任務表 `processing_jobs`：一份文件同時只會有一個活動任務；`idempotency_key` 唯一。失敗可在供應商文件面板重試或取消。
- migration 與 edge function 要分別部署到正式庫 `riaubhtruisbwdlwjzur` 與分支 `omxizeukbcqzsnjsuwod`。前端呼叫的 slug 是 `supabase-functions-<name>`。
- 正式庫還缺一批已在分支上的 FDS migration。不要用整包 `db push` 補，逐份核對後再上。
- Canva 的 Edge secret（`CANVA_CLIENT_ID`、`CANVA_CLIENT_SECRET`）若未設，簡報頁連不上 Canva。redirect URI 用該環境的網域加 `/fds/pm/presentation`。
