# Windows SKP Worker 安裝程式

將 `dist/skp-worker/FDS-SKP-Worker-Setup.exe` 複製到新 Windows 10/11 x64 電腦即可。
內置 Node.js 和 Worker，不需要 Git、npm 或專案原始碼；需要 Windows .NET Framework 4.x（Windows 10/11 內置）。

1. 安裝已授權 SketchUp 桌面版，首次登入、選擇模板。
2. 開啟 EXE，選測試或正式環境，填對應 service role key，確認 SketchUp.exe 路徑。
   金鑰必須屬於所選專案（會核對 JWT 的 ref），貼錯專案會直接提示。
3. 按「安裝 / 更新並啟動」，再按「檢查狀態」。
   首次安裝會自動開啟 SketchUp 一次以建立 `seed.skp`；若見歡迎視窗，請選一次模板（建議毫米），之後任務不會再停在該視窗。
4. 在網站按重新檢測，最後生成一件 SU 驗證輸出。

安裝位置：`%LOCALAPPDATA%\FDS\SkpWorker`。桌面捷徑可重新開啟管理畫面；預設建立目前使用者的登入啟動捷徑。
使用者必須保持登入，SketchUp 需要互動式桌面。關閉管理視窗不會停止 Worker，請使用「停止 Worker」。
自動重試只處理 Worker 程序退出，不能修復 SketchUp 授權或資料庫錯誤。

金鑰只存於 `connection.dat`，使用 Windows DPAPI CurrentUser 加密。不可複製此設定檔到其他帳號；新機須重新輸入。
EXE 不包含金鑰。不要將 service role key 放進命令列、Git 或安裝包。
安裝不會修改資料庫，目標環境須先套用 Worker 相關 migration。詳細缺項需要 `20261020170000_fds_skp_preflight_details.sql` 及其前置 migrations。
狀態檢查依據本機程序及 90 秒內心跳；環境就緒不代表已完成 SketchUp 授權或實際寫檔驗收。

升級：先關閉舊管理畫面，開啟新 EXE 並再次安裝。安裝會停止目前使用者的 Worker；請在沒有生成任務時升級。
停用登入自啟：取消選項後再次安裝。移除：先停止 Worker，再刪除上述安裝資料夾、桌面及 Startup 中的 FDS SKP Worker 捷徑。
封裝未簽章；正式對外分發前可用公司的 Windows 程式碼簽章憑證簽署。

## 建置及驗證

```powershell
powershell -ExecutionPolicy Bypass -File .\workers\skp-writer\installer\build.ps1
```

依賴本機 Node.js x64、已安裝的 npm 依賴、Windows .NET Framework C# 編譯器，以及網絡取得對應 Node 版本的授權檔。
建置會打包既有 Worker（沿用同一組資料表及 RPC），附依賴授權，並執行 EXE 自測。
自測涵蓋封裝解壓、內置 Node 語法檢查、DPAPI 加解密、中文路徑設定與專案網址驗證；不會安裝、自啟或連接真實資料庫。
另產生 `.sha256` 校驗檔。真實新機安裝、登入自啟、線上心跳及 SketchUp 寫檔仍須實機驗證。

## 無人值守安裝（驗收或批量部署）

```powershell
'{"url":"https://<ref>.supabase.co","key":"<service_role key>","sketchup":"C:\\Program Files\\SketchUp\\SketchUp 2026\\SketchUp\\SketchUp.exe","autoStart":true}' |
  Set-Content -Path "$env:TEMP\fds-skp-install.json" -Encoding UTF8
.\dist\skp-worker\FDS-SKP-Worker-Setup.exe --install "$env:TEMP\fds-skp-install.json"
.\dist\skp-worker\FDS-SKP-Worker-Setup.exe --stop
```

設定檔讀取後立即刪除，金鑰不會出現在命令列；一般使用者仍應使用圖形介面。
`autoStart` 決定是否建立登入自啟捷徑；`createSeed`（預設 true）會在沒有 `seed.skp` 時開啟 SketchUp 等待選模板，最多 8 分鐘，無人值守可設 false。
失敗時離開碼為 1，詳情寫入 `worker.log`。重裝會保留既有 `seed.skp`，不需再次選模板。
