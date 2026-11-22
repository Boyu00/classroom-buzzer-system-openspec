# 驗證與驗收紀錄

## 目前結果

- 已建立 OpenSpec 初始規劃；`openspec validate build-classroom-buzzer --strict` 在產生文件時執行通過。
- 該命令只驗證規劃格式，不驗證產品功能。
- member A 骨架、身分活動、受理／題組與排名已經 PR #27～#29 合併。本批完成 SSE、重連及各通道隱私自動測試；學生頁已於 #12 完成，教師／共用結果頁及 Sheets 尚未整合。
- 2026-11-20：依 lockfile 重裝後 11 項基礎自動測試全過，啟動頁及健康檢查回應成功，詳見下表。
- PR #27、#28、#29 均獲 Boyu00 正式 Approve 並合併，分別為 b5dcda8、a78412c、85fe739；各 review 與測試見 docs/collaboration.md。本批同步／隱私已建立 [PR #31](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/31)，Boyu00 已於 2026-11-22 正式 Approve（review-6011096228）；依 review 修正測試競態，另補到期邊界處理，合併狀態見 PR。
- 2026-11-20：#4／#5、#6 基礎控制連同既有回歸共 23／23 通過；API 與整合邊界見 docs/access-api.md。
- 2026-11-20：#7／#10、#11 排名核心與有答案結束連同回歸 37／37 通過；OpenSpec tasks 15／43。SSE、學生頁與完整人工 AC 尚未完成。
- 2026-11-21：#8／#9、tasks 4.5～4.7 連同回歸 56／56 通過；OpenSpec 18／43。包括真實 HTTP／SSE 與共用前端狀態模組測試，未宣稱完整操作頁人工驗收。
- 同日上傳前，發現 B 的 PR #30 已合併為 5db2bc0；整合最新 main 後再次執行，75／75 通過（包含解析器 19 項），OpenSpec 仍為 18／43。
- 真實 Google Sheets 授權、產品人工驗收與 Demo 尚未完成。AC-01～AC-24 的完整人工驗收維持未測，不以後端自動測試代替。

2026-11-22：PR #31 review 修正後，13 項 SSE 測試連跑三次全過；全套 76／76 通過。先等待教師端兩筆受理再比較重送事件數；到期計時器若提前觸發會重新排程，新增提前 100 ms 的回歸情境。OpenSpec strict validation 與 git diff --check 通過；tasks 維持 18／43。

2026-11-22：#12 學生頁完成加入、等待、單題／題組、受理原文、SSE 恢復與結果頁接點。npm ci --ignore-scripts 重裝後全套 87／87 通過（新增學生頁 11 項），一般 Chrome／無痕兩組操作亦通過，詳見 docs/student-page.md。題目來自獨立記憶體 fixture，不代表 Sheets 人工驗收；B 結果頁未存在時明示待整合。本批 tasks 5.4～5.6，進度 21／43；交接 review 5.7 尚待 B。

## 自動驗證紀錄（實作後填寫）

| Commit／環境 | 實際命令 | 結果 | 對應 tasks／AC | 證據 |
| --- | --- | --- | --- | --- |
| 2026-11-20，Windows，Node 24.22.0／npm 11.19.1，feat/project-foundation | npm ci --ignore-scripts | 依 lockfile 重裝成功；66 套件稽核，0 個已知漏洞 | 2.1 | package-lock.json；真實命令輸出 |
| 同上，重裝後執行 | npm test | 11／11 通過 | 2.1、2.2 | tests/server.test.js、tests/storage.test.js |
| 同上，本機資料庫 | npm run db:migrate | 初始 migration 成功；重跑不重複套用 | 2.2 | schema_migrations；migration 測試 |
| 同上 | npm start；GET /；GET /api/health | 頁面 HTTP 200；health 為 status ok、stage foundation、database ok | 2.1 | 實際服務回應與 HTTP 測試；僅 127.0.0.1 |
| 同上 | git check-ignore .env data/classroom.sqlite3 data/classroom.sqlite3-wal sessions/example credentials/service-account.json node_modules/express/package.json | 列舉路徑均被排除；git status 無本機資料與憑證 | 2.3 | .gitignore 與實際命令輸出 |
| 2026-11-20，feat/activity-access，本機 Node 24.22.0 | npm test | 23／23 通過 | 3.1～3.5 的後端 API；AC-24 自動情境 | tests/auth.test.js、tests/activities.test.js 與既有回歸 |
| 2026-11-20，codex/answer-submission，本機 Node 24.22.0 | npm test | 37／37 通過 | 4.1～4.4、5.1～5.3；對應 AC-05～AC-11、AC-15、AC-18、AC-21～AC-23 的後端自動情境 | tests/submissions.test.js；含故障注入回滾、並行重試／相同時間戳、兩種競態順序、隱私與重啟；不含 SSE／UI／Sheets |
| 同上 | openspec validate build-classroom-buzzer --strict；git diff --check | 規格格式與變更空白檢查通過 | 本批規劃／追蹤一致性；不等於完整產品 Verify | 實際命令輸出；tasks 15／43 |
| 2026-11-21，codex/live-sync-privacy，Windows、Node 24.22.0 | npm test | 56／56 通過 | 4.5～4.7；AC-04、AC-09、AC-15 的後端／連線模組自動情境 | tests/events.test.js（12 項）、tests/activity-stream.test.js（6 項）、提交後通知（1 項）與既有 37 項 |
| 同上，1 師／10 組／20 題、11 條 SSE | npm test 中的負載情境 | OPEN 17.8 ms、最慢一般受理 163.6 ms、CLOSED 38.8 ms，均 <2 秒 | 規格本機同步與一般受理目標；9.1 的其他整合尚未完成，不整項勾選 | events.test.js 的實際診斷輸出；fixture 題目，不是線上 Sheets |
| 同上，整合 main 5db2bc0（B PR #30）後 | npm test | 75／75 通過；OPEN 36.2 ms、最慢一般受理 260.9 ms、CLOSED 62.8 ms | 新批與組員解析器整合回歸；各目標仍 <2 秒 | 原 37＋解析器 19＋同步 12＋前端模組 6＋通知 1；無衝突 |

測試先在沙箱內遇到 localhost 連線權限限制，改於核准的環境執行通過；另修正 Windows 測試清理順序，先關資料庫再移除該測試建立的暫存資料夾。上述效能只代表本機自動觀察；完整產品人工驗收、其他負載與真實 Sheets 仍待後續。

## 人工驗收前提

準備真實雲端單題範本、混合題組範本、另一份改格位且題號不連續的測試表；複製到自己的 Sheets，原答案格加標記，分享給服務帳戶編輯。合併答案格在測試副本整理為獨立格。以獨立瀏覽器工作階段模擬教師及至少兩組學生，兩種模式測共通行為；效能目標另驗證 1 師／10 組／20 題。

原文 AC-01～AC-23 見根目錄 spec.md 第 8 節。證據可連到已移除機密的截圖、影片時間點或測試輸出；需記錄 commit、環境、實際步驟、預期與觀察結果。不可將測試替身成功當成線上串接驗收。

| AC | 情境摘要 | 狀態 | 日期／操作者／步驟／證據 |
| --- | --- | --- | --- |
| AC-01 | 真實 Sheets 匯入五題 | 未測 | — |
| AC-02 | 換版面與非連續題號 | 未測 | — |
| AC-03 | 無效標記、合併格、授權與斷網 | 未測 | — |
| AC-04 | 加入／開啟／同步邊界 | 未測 | — |
| AC-05 | 速度模式各題勝出 | 未測 | — |
| AC-06 | 並行與同時間戳唯一順序 | 未測 | — |
| AC-07 | 雙擊、重試、改答案重送 | 未測 | — |
| AC-08 | 空白、超長、單位與身分 | 未測 | — |
| AC-09 | 學生 API／SSE 隱私 | 未測 | — |
| AC-10 | 結束與送出競態 | 未測 | — |
| AC-11 | 固定完整結果與無人作答 | 未測 | — |
| AC-12 | 中文、換行、公式字串原格寫回 | 未測 | — |
| AC-13 | 格位移動、刪除、改寫衝突 | 未測 | — |
| AC-14 | 失敗／逾時重試與重複匯出 | 未測 | — |
| AC-15 | 刷新、重連與重啟 | 未測 | — |
| AC-16 | 權限與腳本字串 | 未測 | — |
| AC-17 | 題組動態映射與原格寫回 | 未測 | — |
| AC-18 | 題組完整性、原子性、去重 | 未測 | — |
| AC-19 | CSV 編碼、欄位、排序、轉義 | 未測 | — |
| AC-20 | CSV 公式注入防護 | 未測 | — |
| AC-21 | 公平模式鼓勵未勝出組 | 未測 | — |
| AC-22 | 公平同勝次、題組、無人作答、重啟 | 未測 | — |
| AC-23 | 模式鎖定與各輸出一致 | 未測 | — |
| AC-24 | 活動上限、加入碼與組名邊界 | 自動情境已通過；人工整合未測 | tests/activities.test.js；使用者於本組確認新規則，跨組同步待補 |

## 交付檢查

| 項目 | 狀態 | 證據 |
| --- | --- | --- |
| DC-01 每人 PR 與實質 review | 雙方均已有已合併 PR 與實質 review | PR #27～#31；B PR #30 與 A review-6006190177 |
| DC-02 能力文件與實作追溯 | 骨架、身分、受理／排名、SSE 與學生頁已建立，其餘未完成 | tasks 21／43；docs/student-page.md、docs/storage.md、docs/access-api.md、docs/submission-results-api.md、docs/live-sync-api.md |
| DC-03 OpenSpec 完整流程 | Propose 完成、Apply 21／43；完整 Verify／Sync／Archive 未完成 | PR #26～#29 已合併；同步／隱私 PR #31 已正式核准，review 修正後 76／76 通過 |
| DC-04 與 SpecKit 小組一致性討論 | 待真實討論紀錄 | — |
| DC-05 AI 對話、文件與產品一致 | 未完成 | — |
| DC-06 五分鐘內完整 Demo | 未完成 | — |
| 助教 Google 表單提交 | 未提交 | — |
