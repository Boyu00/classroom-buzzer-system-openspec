# 課堂搶答系統 — OpenSpec 組

以 Google Sheets Guided Notes 為題目來源的課堂搶答系統，支援老師、學生組別、單題／題組、速度／公平模式、線上原格寫回及 CSV。

**目前狀態：** 既有功能與 v1.3 新增的準備中退出、可讀 CSV unit_id 已實作。真實 Sheets／獨立瀏覽器的預定人工操作已完成；AC-06／AC-10 由兩人確認採自動證據，其他 API／故障情境的範圍見 [驗收紀錄](docs/acceptance-checklist.md)。PR #43、#45、#46 的整合文件仍待 review／合併，合併後最終回歸與 tasks 9.2 收尾尚未完成。

- [完整產品規格](spec.md)：原第一版產品需求加上已確認的跨組對齊規則，現行 v1.3，開發方法採 OpenSpec。
- [提案](openspec/changes/build-classroom-buzzer/proposal.md)：目的與能力範圍。
- [設計與 A／B 介面](openspec/changes/build-classroom-buzzer/design.md)：模型、API、交易與整合設計。
- [實作任務](openspec/changes/build-classroom-buzzer/tasks.md)：對應既有 issues，僅通過驗證者勾選。
- [分工與交接](docs/collaboration.md)、[驗收紀錄](docs/verification.md)。
- [身分與活動 API](docs/access-api.md)：登入、加入、權限、已確認的規則及 #6 整合邊界。
- [受理與結果 API](docs/submission-results-api.md)：不可覆寫受理、題組、隱私、排名與 B 共用結果格式。
- [SSE 與重連 API](docs/live-sync-api.md)：授權推播、提交後通知、隱私、前端共用連線模組與 B 的接點。
- [學生頁操作與 B 整合接點](docs/student-page.md)。
- [Sheets 匯入 API](docs/import-api.md)、[教師頁](docs/teacher-page.md)、[結果頁](docs/results-page.md)、[原格寫回](docs/writeback.md)、[CSV 匯出](docs/csv-export.md)。
- [人工驗收清單與紀錄](docs/acceptance-checklist.md)：AC-01～AC-26 逐項的驗證方式、預期、證據與結果。另有 [A 原始證據索引](docs/evidence/member-a/README.md)。
- [第一次上傳 GitHub 教學](docs/github-first-upload.md)。

## 技術規劃

2026-11-27 跨組對齊：規格更新為 v1.3，學生準備中可「退出組別並重新加入」，OPEN／CLOSED 不允許退出；CSV unit_id 改為 Q:原題號／G:題組代號，內部作答 ID 不變。決議見 [SpecKit issue32](https://github.com/tom1030507/classroom-buzzer-system-speckit/issues/32)。操作與驗證見 [學生頁](docs/student-page.md)、[CSV](docs/csv-export.md)；新增瀏覽器測試可執行 `node scripts/e2e-student-leave.mjs`。

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

`Copy-Item` 只在第一次尚無 `.env` 時執行，已有設定時保留原檔。啟動後開啟 [本機頁面](http://127.0.0.1:3000)，可從首頁進入[學生搶答頁](http://127.0.0.1:3000/student.html)，以老師提供的加入碼及組名加入。教師從 `http://127.0.0.1:3000/teacher.html` 登入與操作（見下節），學生流程見[學生頁教學](docs/student-page.md)。[健康檢查](http://127.0.0.1:3000/api/health) 應回傳：

```json
{"data":{"status":"ok","stage":"foundation","database":"ok"}}
```

按 `Ctrl+C` 關閉。`npm run dev` 可在開發時監看程式變更並重啟。`PORT` 預設 3000；若被使用，可在 `.env` 改成 `PORT=3001`，網址也改為 3001。Host 固定為 `127.0.0.1`，不接受環境變數改成公開網路介面。

若 npm 顯示憑證錯誤 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，可在該 PowerShell 視窗使用已信任的系統憑證後重試；不需關閉 TLS 驗證：

```powershell
$env:NODE_USE_SYSTEM_CA = '1'
npm ci --ignore-scripts
```

## 教師控制台（#15、#18）

啟動後開啟 `http://127.0.0.1:3000/teacher.html`：設定密碼／登入、建立活動、匯入題目、開啟、即時監看、結束確認與結果。結束後可在同一頁預覽並寫回原 Google Sheets（含逐題實況、重試與紀錄）。流程、安全設計與驗證方式見 [docs/teacher-page.md](docs/teacher-page.md)、[docs/writeback.md](docs/writeback.md)；`npm run e2e:teacher` 以真實 Chrome 走完整流程（Google 以替身取代，需本機有 Chrome 或 Edge）。

## 結果頁（#16）

活動結束後，老師與已加入該活動的學生用 `/results.html?activityId=<活動 ID>` 查看固定結果（學生頁會在結束後提供連結）。權限、安全設計與驗證方式見 [docs/results-page.md](docs/results-page.md)；`node scripts/e2e-results.mjs` 以真實 Chrome 驗證各種身分（需本機有 Chrome 或 Edge）。

## Google Sheets 設定（#13）

老師的 Guided Notes 由後端以服務帳戶直接讀取（不經 .xlsx）。金鑰只放在你自己的電腦、repository 外，不得提交、貼到文件或對話。

1. 在 Google Cloud Console 建立專案，啟用 **Google Sheets API**（不需要 Drive API）。建議用個人帳號；部分學校帳號的組織政策禁止建立服務帳戶金鑰。
2. 建立服務帳戶（不需授予專案角色），在「金鑰」新增 JSON 金鑰並下載，存到 repository 以外的資料夾（例如 `C:/Users/你的帳號/secret/`）。金鑰外洩時請立即在同一頁面刪除。
3. 把老師的試算表副本「共用」給服務帳戶的 email（格式 `名稱@專案.iam.gserviceaccount.com`）。只讀取需要檢視者；結束後寫回原格需要**編輯者**。教師頁在權限不足時也會顯示該 email。
4. 在 `.env`（已被 .gitignore 排除）設定金鑰路徑，路徑建議用正斜線：

```
GOOGLE_APPLICATION_CREDENTIALS=C:/Users/你的帳號/secret/你的服務帳戶金鑰.json
```

5. 啟動 `npm start`，主控台會顯示「Google Sheets 讀取已啟用」。憑證不存在或無效時服務仍會啟動，只印出不含路徑與內容的警告，匯入回報「尚未設定」。

使用 scope `https://www.googleapis.com/auth/spreadsheets`。單張工作表上限 200,000 格、所選工作表合計 500,000 格；每次 Google 請求逾時 15 秒。API 與錯誤碼見 [docs/import-api.md](docs/import-api.md)。

### 整理課程範本（加標記）

不要直接改原始範本：先**複製一份**（檔案 → 建立副本），再在副本上整理，並把副本共用給服務帳戶（編輯者）。

1. 在每一題的作答格填入標記：單題 `{{Q:1}}`；題組 `{{Q:2a|G:2}}`、`{{Q:2b|G:2}}`（同一個 `G:` 代號為同一題組，至少兩題）。題號在整份匯入範圍內不可重複，題號與代號限英數字、點、底線、連字號。
2. **作答格不可是合併儲存格**。課程範本的作答欄常是 G:H 合併，請先選取該格 → 格式 → 合併儲存格 → 取消合併，再填入標記；否則匯入預覽會指出是哪一格並拒絕。
3. 其他文字、格式不必改；寫回時只會替換作答格的內容。
4. 標記必須是整格唯一內容（前後空白會被忽略）。

寫回結束後，作答格的標記會被勝出答案取代，所以要重做時請再貼回標記，或另外複製一份範本。

## 資料庫與測試

預設資料庫在 `data/classroom.sqlite3`，首次啟動自動建立並執行 migration。可在 `.env` 指定 `DATABASE_PATH`（相對路徑以專案根目錄計）；資料庫、journal 與本機設定不入版控。工作階段與教師密碼雜湊存該本機資料庫；未設定時 session 回應提示初次設定，已設定後必須輸入原密碼。不要把密碼貼到 repository／紀錄；Sheets 匯入需要 Google 服務帳戶金鑰，設定方式見上方 Google Sheets 設定。

```powershell
npm run db:migrate
npm test
```

Migration 可重跑；已套用版本會核對 checksum，不可直接修改舊 SQL。後續變更新增 `002_名稱.sql`，升級前備份本機資料；不要用刪除資料庫解決 migration 錯誤。`.gitattributes` 統一文字換行，checksum 也正規化 CRLF。

測試使用獨立暫存 SQLite 與隨機本機連接埠，不修改你的活動資料。測試涵蓋身分／受理／排名、SSE 授權與隱私、學生頁與教師頁 DOM、結果頁、Sheets 解析與匯入、寫回的各種失敗與競態、CSV，以及 1 師／10 組／20 題的整合情境。實際項數與各次重測結果以 [驗證紀錄](docs/verification.md) 為準；瀏覽器端流程另有 `npm run e2e:teacher`、`node scripts/e2e-results.mjs`（需本機有 Chrome 或 Edge，Google 以替身取代）。自動測試**不代表**人工驗收已通過，人工驗收見 [驗收清單](docs/acceptance-checklist.md)。

資料層使用約定、資料表與後續擴充方式見 [資料層說明](docs/storage.md)。

## 功能與 Issue、PR 對照

| 功能 | Issue | 負責 | PR |
| --- | --- | --- | --- |
| 骨架、教師驗證、活動與加入、受理、題組、排名、SSE 與隱私、學生頁 | #3～#12 | A | [#27](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/27)、[#28](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/28)、[#29](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/29)、[#31](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/31)、[#34](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/34) |
| Google 服務帳戶讀取、標記解析與匯入預覽／確認 | #13、#14 | B | [#30](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/30)、[#32](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/32)、[#33](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/33) |
| 教師控制台、結果頁、CSV | #15、#16、#19 | B | [#37](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/37)、[#36](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/36)、[#35](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/35) |
| 原 Sheets 寫回（後端） | #17 | B | [#38](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/38) |
| 教師頁寫回面板 | #18 | B | [#40](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/40) |
| 1 師／10 組／20 題整合驗證 | #20 | 共同 | [#39](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/39) |
| 人工驗收清單與紀錄、全回歸與 tasks 勾選 | #21 | 共同 | [#41](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/41)、[#42](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/42)、[#44](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/44) |

每個 PR 的作者、審閱者與意見連結見 [分工與接力紀錄](docs/collaboration.md)。

## 驗收結果摘要（更新至 2026-11-27）

在真實瀏覽器（Chrome 一般與無痕、Edge）與真實 Google Sheets（三份測試副本，含 SPEED 與 FAIR）上人工驗收 AC-01～AC-24，逐項證據與限制見 [docs/acceptance-checklist.md](docs/acceptance-checklist.md) 第四節：

- **人工驗證通過：** AC-01～05、07～09、11、12、14～17、19～24（AC-20 為 2026-11-23 的 Excel／Google 試算表核對）。
- **兩人分別補測：** AC-13（匯入後改格位）8 種變動，B 人工 3 種，A 人工 5 種（預覽阻擋，另 1 次實際寫回前重查）；AC-18（題組完整性）B 以 API 腳本、A 以瀏覽器與 Console 驗證。A 的紀錄見 [docs/manual-acceptance-member-a.md](docs/manual-acceptance-member-a.md)。
- **以 API 層級腳本驗證、非瀏覽器人工操作：** AC-04 的「開啟後新組加入被拒」。
- **以自動測試為準（兩人確認）：** AC-06、AC-10（並行競態，人工無法穩定製造）。

- **新增 AC-25／AC-26：** 11/27 退出／重新加入、階段限制與刷新正常；新 CSV 的 Q:3／G:A／Q:12 已人工操作與實檔核對，見 [新增驗證](docs/cross-group-alignment.md)。19 張截圖及四份原始 CSV 見 [證據索引](docs/evidence/member-a/README.md)，舊檔與新格式分開標示。

## 已知限制

- 服務只監聽 `127.0.0.1`，其他裝置不能加入同一場活動；展示與驗收都在同一台電腦以獨立瀏覽器工作階段進行。
- 學生僅準備中可「退出組別並重新加入」；OPEN／CLOSED 不提供退出。結束後加入另一活動仍需新的匿名工作階段，或清除 Cookie。
- 寫回成功後，原格的 `{{Q:…}}` 標記會被答案取代，重新匯入同一份試算表前要先貼回標記或另複製範本。
- 匯出紀錄無法區分某次寫回是「真的寫入」還是「確認先前已寫入」；寫回前的預覽會顯示先前已寫入的格數。
- 教師密碼登入沒有嘗試次數限制（僅本機）。
- 尚未做手機版面與螢幕閱讀器測試。
- 跨小組對齊已留實際討論與 v1.3 決議，見 [分工紀錄](docs/collaboration.md)；另一組的實作狀態仍須各自驗證。

## OpenSpec 流程

本組採一個完整 change `build-classroom-buzzer`：Explore → Propose → 分階段 Apply → Verify → Sync → Archive。提案與實作已分階段 review，最終版本回歸與完整 Verify 尚未完成。各能力 spec 位於 change 的 `specs/` 下，尚未同步至 `openspec/specs/` 主規格。

已安裝 OpenSpec 的環境可檢查：

```powershell
openspec status --change build-classroom-buzzer
openspec validate build-classroom-buzzer --strict
```

以上僅檢查規劃狀態與規格格式，不會證明產品能運作。同步與歸檔等完整驗證後才執行。

## 兩人分工

| 負責人 | GitHub issues | 內容 |
| --- | --- | --- |
| member A（先實作） | #3～#12；追加 #46 | 骨架、教師驗證、活動、受理、SSE、隱私、題組送出、公平排序、學生頁；準備中退出與 CSV 跨組對齊 |
| member B（接續） | #13～#19 | Sheets 授權／匯入／映射、教師頁、結果頁、原格寫回／恢復、CSV |
| 共同 | #1～#2、#20～#25 | 規劃、跨組對齊、測試驗收、文件、Demo、繳交 |

[GitHub issues](https://github.com/Boyu00/classroom-buzzer-system-openspec/issues) 是協作追蹤依據。各自以自己的帳號開 branch、PR，由另一位 review；每個 PR 的作者、審閱者與意見連結見 [docs/collaboration.md](docs/collaboration.md)。

## 下一步

1. Review 後依 #43 → #45 → #46 合併，保留歷史與新規格；固定最新 main SHA 執行完整回歸，再更新驗收結論、tasks 9.2／issue #21。
2. 交付資料：AI 對話整理已入庫（[A](docs/ai-conversation-member-a.md)、[B](docs/ai-conversation-member-b.md)）；個人心得各自完成；Demo 影片由 A 拍攝（#24）。
3. OpenSpec：上述完成後做完整 Verify、Sync、Archive（#22）；半成品不歸檔。
4. 最終確認交付資料後提交表單（#25，期限 2026-11-30 00:00）；不以表單已提交作為開始 Verify 的前提。
5. 本機變更不會自動上傳 GitHub：需依序 commit、push 分支、建立 PR，再由另一人 review 後合併 main；其他人的變更也需 fetch／pull 才會出現在本機。
