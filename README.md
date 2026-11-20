# 課堂搶答系統 — OpenSpec 組

以 Google Sheets Guided Notes 為題目來源的課堂搶答系統，支援老師、學生組別、單題／題組、速度／公平模式、線上原格寫回及 CSV。

**目前狀態：#3～#5 與 #6 基礎 API 已合併。本機新一批完成答案受理、題組原子送出、速度／公平排名及結果與結束狀態同交易保存。教師／學生操作頁、SSE 與 Sheets 串接仍待後續，尚未完成產品驗收。**

- [完整產品規格](spec.md)：產品需求保留原第一版內容，開發方法改用 OpenSpec。
- [提案](openspec/changes/build-classroom-buzzer/proposal.md)：目的與能力範圍。
- [設計與 A／B 介面](openspec/changes/build-classroom-buzzer/design.md)：模型、API、交易與整合設計。
- [實作任務](openspec/changes/build-classroom-buzzer/tasks.md)：對應既有 issues，僅通過驗證者勾選。
- [分工與交接](docs/collaboration.md)、[驗收紀錄](docs/verification.md)。
- [身分與活動 API](docs/access-api.md)：登入、加入、權限、已確認的規則及 #6 整合邊界。
- [受理與結果 API](docs/submission-results-api.md)：不可覆寫受理、題組、隱私、排名與 B 共用結果格式。
- [第一次上傳 GitHub 教學](docs/github-first-upload.md)。

## 技術規劃

Node.js 24.22.0（相容範圍為 24.22 以上的 24.x）、Express 5.3.0、Node 內建 SQLite；前端 HTML／CSS／原生 JavaScript。版本與依賴已記錄於 `.node-version`、`package.json`、`package-lock.json`。目前僅在 `127.0.0.1` 執行，後續以 HTTP API／SSE 與 Google Sheets API 擴充。

Google 憑證放 repository 外，以環境變數提供路徑；不得提交憑證、密碼、session、本機資料庫或未移除機密的對話。`.gitignore` 是 Git 追蹤排除設定，瀏覽器手動上傳仍須自行確認選檔。

## 第一次安裝與啟動（Windows PowerShell）

先安裝 Node.js 24.22.0 或較新的 24.x，確認 `node --version`。不需要額外安裝 SQLite、Python 或編譯工具。

在自己的專案資料夾開啟 PowerShell（本機目前是 `D:\桌面\python\classroom-buzzer-system-openspec`）：

```powershell
npm ci --ignore-scripts
Copy-Item .env.example .env
npm start
```

`Copy-Item` 只在第一次尚無 `.env` 時執行，已有設定時保留原檔。啟動後開啟 [本機頁面](http://127.0.0.1:3000)，應看到「活動管理基礎已就緒，操作頁面準備中」。目前操作需透過 API，該狀態頁沒有登入／加入表單。[健康檢查](http://127.0.0.1:3000/api/health) 應回傳：

```json
{"data":{"status":"ok","stage":"foundation","database":"ok"}}
```

按 `Ctrl+C` 關閉。`npm run dev` 可在開發時監看程式變更並重啟。`PORT` 預設 3000；若被使用，可在 `.env` 改成 `PORT=3001`，網址也改為 3001。Host 固定為 `127.0.0.1`，不接受環境變數改成公開網路介面。

若 npm 顯示憑證錯誤 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，可在該 PowerShell 視窗使用已信任的系統憑證後重試；不需關閉 TLS 驗證：

```powershell
$env:NODE_USE_SYSTEM_CA = '1'
npm ci --ignore-scripts
```

## 資料庫與測試

預設資料庫在 `data/classroom.sqlite3`，首次啟動自動建立並執行 migration。可在 `.env` 指定 `DATABASE_PATH`（相對路徑以專案根目錄計）；資料庫、journal 與本機設定不入版控。工作階段與教師密碼雜湊存該本機資料庫；未設定時 session 回應提示初次設定，已設定後必須輸入原密碼。不要把密碼貼到 repository／紀錄；目前不需 Google 金鑰。

```powershell
npm run db:migrate
npm test
```

Migration 可重跑；已套用版本會核對 checksum，不可直接修改舊 SQL。後續變更新增 `002_名稱.sql`，升級前備份本機資料；不要用刪除資料庫解決 migration 錯誤。`.gitattributes` 統一文字換行，checksum 也正規化 CRLF。

測試使用獨立暫存 SQLite 與隨機本機連接埠，不修改你的活動資料。現有 37 項測試涵蓋資料層、身分與活動控制、答案驗證、並行去重、題組故障回滾、送出／結束競態、API 隱私、兩種排名與重啟結果保存；它們不代表 AC-01～AC-24 的產品驗收已通過。詳細結果見 [驗證紀錄](docs/verification.md)。

資料層使用約定、資料表與後續擴充方式見 [資料層說明](docs/storage.md)。

## OpenSpec 流程

本組採一個完整 change `build-classroom-buzzer`：Explore → Propose → 分階段 Apply → Verify → Sync → Archive。現有文件為待兩人 review 的提案，規劃完整不等於實作或驗收完成。各能力 spec 位於 change 的 `specs/` 下，尚未同步至 `openspec/specs/` 主規格。

已安裝 OpenSpec 的環境可檢查：

```powershell
openspec status --change build-classroom-buzzer
openspec validate build-classroom-buzzer --strict
```

以上僅檢查規劃狀態與規格格式，不會證明產品能運作。同步與歸檔等完整驗證後才執行。

## 兩人分工

| 負責人 | GitHub issues | 內容 |
| --- | --- | --- |
| member A（先實作） | #3～#12 | 骨架、教師驗證、活動、受理、SSE、隱私、題組送出、公平排序、學生頁 |
| member B（接續） | #13～#19 | Sheets 授權／匯入／映射、教師頁、結果頁、原格寫回／恢復、CSV |
| 共同 | #1～#2、#20～#25 | 規劃、跨組對齊、測試驗收、文件、Demo、繳交 |

[GitHub issues](https://github.com/Boyu00/classroom-buzzer-system-openspec/issues) 是協作追蹤依據。各自以自己的帳號開 branch、PR，由另一位實質 review。[PR #26](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/26) 初始規劃、[PR #27](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/27) #3 骨架及 [PR #28](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/28) 身分與活動 API 已合併；#27、#28 均有 Boyu00 的正式 Approve。後續實作 PR 依實際完成情況補上。

## 下一步

1. 本機變更不會自動上傳 GitHub：需依序 commit、push 分支、建立 PR，再由另一人 review 後合併 main。其他人的變更也需 fetch／pull 才會出現在本機。
2. 本次新分支 `codex/answer-submission` 完成 #7／#10、#11 排名核心與有答案結束，尚未上傳或開 PR。下一批接 #8 SSE 與 #9 全通道隱私，再做 #12 學生頁；學生 Cookie 遺失／登出後的恢復方式須在 #12 前確認，不能僅靠組名接管。
3. A 測試可用明確標示的 fixture；產品真實 Sheets 匯入由 B 完成，不能用 fixture 宣稱串接完成。
4. A 交接已驗證模型、API、結果服務與學生頁；B 完成 #13～#19，再共同真實驗收、錄影與繳交。
