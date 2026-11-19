# Proposal

## Why

課堂 Guided Notes 以學生上台填答進行搶答，耗時且難以同步記錄。建立可在本機模擬老師與多組學生的線上搶答系統，直接讀取及寫回雲端 Google Sheets，並以 OpenSpec 保留兩人協作的規格與驗收依據。

## What Changes

- 建立教師驗證、活動生命週期、組別工作階段與權限隔離。
- 直接匯入 Google Sheets 的單題與題組標記，預覽並保存動態原格映射。
- 提供學生作答、題組原子送出、伺服器受理排序、去重、SSE 同步及學生隱私。
- 提供速度與公平兩種模式，於結束時固定保存結果，支援重啟恢復。
- 提供教師與學生結果頁、原 Sheets 安全寫回與 CSV 匯出。
- 沿用根目錄 spec.md 的全部 FR、AC 與技術選擇；本次僅產出規劃文件，實作另由 Apply 執行。
- 一個完整 change 依現有 GitHub issues 分配：member A #3–#12、member B #13–#19，共同 #1–#2、#20–#25。

## Capabilities

### New Capabilities

- `activity-sessions`: 教師驗證、組別加入、工作階段、活動狀態與權限。
- `sheets-import`: 線上讀取、標記解析、題組、預覽與動態映射。
- `answer-submission`: 作答驗證、交易受理、去重、同步與隱私。
- `result-ranking`: 結束結果、速度排序、公平排序與持久保存。
- `result-export`: 結果頁、原 Sheets 寫回、衝突及失敗處理、CSV。

### Modified Capabilities

無。此為尚無主規格與應用程式的初始建置。

## Impact

預計新增 Node.js／Express 後端、SQLite 儲存、HTML／CSS／原生 JavaScript 頁面、Google Sheets API 整合及測試。僅綁定 localhost；帳密、服務帳戶憑證、工作階段與資料庫不納入版控。無公開部署、自動判題、人工改判或帳號註冊。完成後須以真實 Sheets、老師與至少兩組學生人工驗收，並保留 PR、review、AI 對話與 Demo 證據。
