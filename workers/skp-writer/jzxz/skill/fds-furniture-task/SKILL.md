---
name: fds-furniture-task
description: 執行 FDS 傢俬建模任務：讀取任務的產品資料、尺寸與參考圖，在 SketchUp 建出單件傢俬並存到指定 SKP，再回報完成。當訊息是「執行 FDS 任務 <任務編號>」「执行 FDS 任务 <任务编号>」或提到 FDS 任務時使用。
metadata:
  requiresMcp: sketchup
---

# FDS 傢俬建模任務

這是無人值守的自動任務：沒有人會回覆你，不要提問、不要等待確認。

## 流程

1. 讀任務（任務編號取自訊息）：
   `"<私有python.exe>" "[技能工作目錄]/scripts/fds_task.py" get <任務編號>`
2. 用 ViewImages 查看輸出列出的每張參考圖。
3. 用 GetSkillKnowledge 讀 `SketchUpMCP` 技能，按它的「腳本載體」做法建模；`build_model.py` 放在 `[AI工作區]/FDS-<任務編號>/`。
4. 存到任務輸出的「必須儲存到」路徑（execute_ruby 呼叫 `Sketchup.active_model.save(路徑)`，確認回傳 true）。
5. 回報完成：
   `"<私有python.exe>" "[技能工作目錄]/scripts/fds_task.py" finish <任務編號> --status done --skp "<同一路徑>" --summary "<部件、尺寸、材質>" --issue "<偏差>"`
   （`--issue` 可重複，沒有偏差就省略。）

## 建模規則

- 開工前清空目前模型；只建這一件產品，不建房間、地面、人物或其他傢俬。
- 單位 mm；產品底部在 z=0，寬沿 X、深沿 Y，以原點置中；正面朝 -Y。
- 外框尺寸必須等於任務的寬／深／高（誤差 ≤ 2 mm）。尺寸以數字為準，參考圖只決定造型和比例細節。
- 整件產品放在一個頂層群組，名稱用產品型號；每個部件是有名稱的子群組，材質按任務說明設定。

## 失敗時

任何一步做不到（SketchUp 連不上、出現對話框、無法存檔、尺寸對不上又改不好），立即：
`"<私有python.exe>" "[技能工作目錄]/scripts/fds_task.py" finish <任務編號> --status failed --summary "<原因>"`
然後結束，不要請使用者處理。未執行 `finish` 之前，FDS 不會視為完成。
