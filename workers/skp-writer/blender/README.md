# Codex + Blender

Worker 管理程式的「建模方式」提供第三個選項 **Codex + Blender**。

- 本機需安裝 Blender、已登入的 Codex CLI。Blender 建模、四視角檢查和 FBX／GLB 匯出不依賴 SketchUp。
- 自動尋找 `Program Files/Blender Foundation/Blender */blender.exe` 和 PATH。其他安裝位置設定 `FDS_BLENDER_EXE`。
- Codex 透過隨 Worker 打包的 MCP 寫 `build_model.py`、執行獨立背景 Blender；不操作使用者開著的 Blender。
- Blender 使用米、正面 -Y、Z 向上；轉換器套用 modifiers／世界座標，轉為毫米，保留逐 mesh 部件、基色、透明度及 UV 圖片貼圖。程序材質須先烘焙；不保留 Blender modifier stack 到 SKP。
- 評估後三角形上限 200,000。Blender 直接匯出 FBX（含貼圖 ZIP）／GLB、渲染 iso／front／side／top；Worker 量測 GLB 與 Blender 的尺寸、座標及部件語意，仍需人工驗收。
- SKP 在原生格式驗證後另行轉換，使用獨立 SketchUp 與批量幾何建構，限時 90 秒。缺少 SketchUp、模板或轉換失敗時，只把 SKP 記為 unavailable，不阻擋 FBX／GLB 驗收發布；也不取代既有 SKP。
- 原始 `.blend`、Python 腳本和轉換資料保存在本機任務資料夾；修正時載入上一版。線上仍只登記既有 SKP／FBX／GLB 與報告，無新增 PMS 接口。

上線前套用 `supabase/migrations/20261104120000_fds_skp_blender_engine.sql` 和 `supabase/migrations/20261104140000_fds_blender_native_publish.sql`，安裝最新 Worker，選擇第三種方式。裝置只在 Blender 和 Codex 依賴齊備時回報 `blender_v1`，沿用既有 `codex_v1` 任務、租約及多產物原子發布。其他兩種方式仍須提供 SKP 才可發布。

驗證：

```powershell
node --test workers/skp-writer/codex/*.test.mjs workers/skp-writer/blender/*.test.mjs
node workers/skp-writer/blender/smoke.mjs
node workers/skp-writer/blender/native-smoke.mjs <保留的任務目錄> --codex
powershell -NoProfile -ExecutionPolicy Bypass -File workers/skp-writer/installer/build.ps1
```

`smoke.mjs` 不呼叫 AI 或線上服務，使用本機 Blender 生成帶 UV 貼圖的方塊，在獨立 SketchUp 匯入兩次以檢查替換行為，再驗證 SKP／FBX／GLB 的格式、尺寸和內嵌貼圖。

`native.test.mjs` 透過真正 MCP 在沒有 SketchUp 連線埠時建模、讀取四視角、驗證貼圖及測試缺少 SKP 的驗收發布路徑（模擬線上接口）。`native-smoke.mjs` 使用保留家具進行隔離重播；`--codex` 會呼叫已登入的真實 Codex CLI，修正量測問題並重做四視角報告，不更新資料庫或自動發布。
