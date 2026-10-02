---
name: daily-report
description: Generate today's work report for Furniture 1000 (furniture1000). Use when the user says "daily report skill", "daily report", "今日報告", "每日報告", or asks for today's standup / status / 今日任務報告.
environments: [cloud, local]
---

# 每日任務報告（Furniture 1000）

產出**當日**（Asia/Hong_Kong）已上 `origin/main` 的使用者可見成果。報告只輸出在對話中，**除非使用者明確要求，不要寫入檔案**。

## 觸發

- 「daily report skill」「daily report」「今日報告」「每日報告」
- 今日 standup / status / 今日任務報告

## 硬性規則

- **僅今日**：以對話中的 Today's date 為準，業務日 = **Asia/Hong_Kong (UTC+8)**。不得重用前一日報告；使用者未指定日期時不得寫其他日。
- **繁體中文**：模組名、標題、說明一律繁中。英文僅限產品代碼、路由、模型名（如 PMS SSO、`/quote/quick`、Composer 2.5）。
- **寫成果，不寫做法**：每項一句使用者可見結果。禁止列實作步驟、表欄位、檔案路徑、API、逐 commit diff。
- **模組分段**：`{模組}（N 項）` 後**空一行**再寫 `1.` / `2.`。模組名與編號不可同一行。
- **本 skill 執行本身**不列入報告。
- **不要**為此 skill 開 branch / PR；**不要** commit 報告正文。
- 本 repo 預設在 **`main`** 開發；`complete` = 已 push 至 `origin/main`。

## 蒐集來源

### Git

```bash
git fetch origin main
git log origin/main --format='%H|%ai|%an|%s' \
  --since='<HK日 00:00 轉 UTC>' --until='<HK次日 00:00 轉 UTC>'
```

- 香港日 `YYYY-MM-DD 00:00:00 +0800` → UTC 減 8 小時，作為 `--since` / `--until`。
- 主旨太模糊時才讀 commit body。
- 排除：僅 replay 已列成果的 merge；屬於其他曆日的 commit。

### Cursor Cloud MCP

- 工具：`cursor-cloud` → `list-cloud-agents`
- `createdAfter` / `createdBefore`：同上香港日轉 UTC
- `includeArchived: true`；`hasMore` 時用 `offset` 分頁
- 可選：`batch-fetch-details` 合併相關 agent
- 排除：無使用者可見成果（純問答、取消、無 commit 且無上線變更）、**本次 daily report 執行**

### 合併依據

以 agent 名稱 + commit 主旨歸類；同一成果的多 commit / 多 agent 合併一項。

若 git 與 cloud agents 皆無當日成果，繁中說明後**停止**，不捏造。

## 模組分組（依 UI 導覽，非 git 路徑）

從 `src/components/dashboard/navConfig.ts` 的一級導覽推斷；跨模組登入、政策、文件放 **General**。

| 模組 | 導覽 id / 含義 |
|------|----------------|
| 儀表板 | `home` |
| 傢俬方案 | `solutions`（方案列表、設計專案、邀請客戶、已確定方案等） |
| 客戶專區 | `customers` |
| 傢俬報價 | `quote`（快速報價、報價單一覽、大金額投標） |
| 產品管理 | `products`（廠家目錄、上載 PDF、待處理、產品目錄） |
| 網上發佈 | `publish`（產品文案、產品價錢、傢俬組檢查、準備上載、已上載等） |
| 分析報表 | `reports` |
| 設定 | `admin`（用戶、登入紀錄、分類、系統設定） |
| General | 登入 / PMS SSO、Supabase 健康檢查、git 政策、文件等 |

## 輸出格式

除「當日無成果」一行說明外，**前後不加評論**。範本如下（`N` = 該模組項目數；全報告編號從 1 連續遞增）：

```
今日任務報告（YYYY-MM-DD）

**{模組}（N 項）**

1. [類型 · complete] 繁中成果標題
一句話說明使用者現在能做什麼，或畫面上有什麼改變。
（模型名稱）

**{下一模組}（N 項）**

2. [frontend · complete] …
…
```

### 排版（必須）

- `**{模組}（N 項）**` 獨立一行；模組標題後、下一模組標題前各**空一行**。
- 第一個模組標題後也要空一行（避免 Chat Markdown 把 `2.` 接到模組名同一行）。

### 類型與狀態

- **類型**：`frontend`（UI）| `bugfix` | `chore`（清理 / 政策 / 登入 / 文件）| `backend`（API / 資料、無 UI）
- **狀態**：已在 `origin/main` → `complete`；否則 `in progress`

### 模型標籤（`originalModelName` 或 commit 脈絡）

| 原始 | 顯示 |
|------|------|
| `composer-2.5…` / `composer-2.5-fast…` | Composer 2.5 |
| `cursor-grok-4.6…` | Cursor Grok 4.6 |
| `cursor-grok-4.5…` | Cursor Grok 4.5 |
| `claude-opus-5-5…` | Claude Opus |
| `claude-sonnet-5-5…` | Claude Sonnet |
| `gemini-3.8-flash…` | Gemini Flash |
| `gpt-5.6…` | GPT-5.6 |
| 其他 | 使用者可辨識的系列名 |
| 多模型 | 取最新一項 |

### 頁尾

最後一行：`HEAD：{origin/main 當日最新 commit 短 SHA}`

## 風格範例

**傢俬報價（1 項）**

1. [frontend · complete] 報價列可開啟關聯產品
明細列可點按鈕開啟產品對話框查看或編輯所連產品。
（Composer 2.5）

**產品管理（1 項）**

2. [bugfix · complete] 產品詳情對話框恢復正常
新增與編輯產品時對話框內容完整可用。
（Composer 2.5）

## 禁止

- 捏造項目、流程日誌、來源清單
- 把 implementation 英文標題當成果標題
- 在未指定日期時請使用者選日期
