# Windows SKP Worker 安裝程式

將 `dist/skp-worker/FDS-SKP-Worker-Setup.exe` 複製到新 Windows 10/11 x64 電腦即可。
內置 Node.js 和 Worker，不需要 Git、npm 或專案原始碼；需要 Windows .NET Framework 4.x（Windows 10/11 內置）。

1. 安裝已授權 SketchUp 桌面版，首次登入、選擇模板。
2. 開啟 EXE。預設是正式環境，畫面上有電腦名稱及 SketchUp 檢測。按「使用瀏覽器登入並授權」。
3. 瀏覽器開啟 FDS 授權頁。管理員核對配對碼後按「授權這台電腦」。登入本身不會授權。
4. 安裝程式領取裝置憑證，以 Windows DPAPI CurrentUser 保存，然後啟動 Worker。
5. 「檢查狀態」會分開顯示授權、連線、寫檔依賴。再到網站重新檢測，並實際生成一件 SKP 驗證。

測試環境在「進階設定」。一般安裝不要求、也不接受 Supabase service role key。
安裝位置：`%LOCALAPPDATA%\FDS\SkpWorker`。桌面捷徑可重新開啟管理畫面；預設建立目前使用者的登入啟動捷徑。
使用者必須保持登入，SketchUp 需要互動式桌面。關閉管理視窗不會停止 Worker，請使用「停止 Worker」。
授權被撤銷或憑證失效時，Worker 停止自動重試，需要重新授權。

憑證只存於 `connection.dat`，使用 Windows DPAPI CurrentUser 加密。不可複製此設定檔到其他帳號。
「解除連線」會刪除本機憑證並撤銷伺服器上的這台電腦。重裝會保留有效設定。
EXE 不包含 service role key。不要把裝置憑證放進命令列、Git 或安裝包。
封裝未簽章；正式對外分發前可用公司的 Windows 程式碼簽章憑證簽署。

## 建置及驗證

```powershell
powershell -ExecutionPolicy Bypass -File .\workers\skp-writer\installer\build.ps1
```

依賴本機 Node.js x64、已安裝的 npm 依賴、Windows .NET Framework C# 編譯器，以及網絡取得對應 Node 版本的授權檔。
建置會打包 Worker，附依賴授權，並執行 EXE 自測。
自測涵蓋封裝解壓、內置 Node 語法檢查、DPAPI 加解密，以及安裝包內沒有 service role。不會安裝、自啟或連接真實資料庫。
另產生 `.sha256` 校驗檔。真實新機安裝、瀏覽器授權、線上心跳及 SketchUp 寫檔仍須實機驗證。

## 無人值守安裝

只接受已經由瀏覽器授權取得的裝置憑證。含 `service_role` 或舊的 `key` 欄位會被拒絕。設定檔讀取後立即刪除，憑證不會出現在命令列。

```powershell
'{"url":"https://<ref>.supabase.co","anonKey":"<anon key>","environment":"production","deviceId":"<uuid>","refreshToken":"<refresh>","accessToken":"<access>","sketchUp":"C:\\Program Files\\SketchUp\\SketchUp 2026\\SketchUp\\SketchUp.exe","autoStart":true}' |
  Set-Content -Path "$env:TEMP\fds-skp-install.json" -Encoding UTF8
.\dist\skp-worker\FDS-SKP-Worker-Setup.exe --install "$env:TEMP\fds-skp-install.json"
.\dist\skp-worker\FDS-SKP-Worker-Setup.exe --stop
```
