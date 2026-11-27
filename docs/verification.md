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

## 2026-11-22 PR #34 review 與合併前整合

Boyu00 正式 Approve：review-6011416078，對應 head f51a6f2；組員記錄 Node 24.22.3、87／87 與真實 Chrome 自動操作 17／17 通過（記憶體 fixture，不代表 Sheets 人工驗收）。本機整合 origin/main 72fbb3a（#32、#33）後解開套件衝突，npm ci --ignore-scripts 與 npm test 119／119 通過，openspec strict validation、git diff --check 通過。僅解依賴與更新文件，學生頁程式不變；非阻擋建議見 collaboration.md。

## #20 整合驗證：1 位老師、10 組學生、20 題（2026-11-23）

**測試**：`tests/integration-scale.test.js`，SPEED 與 FAIR 各一次。走真實 HTTP 與真實 SSE：老師與 10 組各開一條 SSE；題目以 B 的正式匯入流程（預覽→確認）匯入 20 題、15 個單位（10 個單題＋5 個兩題的題組）；前 5 個單位 10 組同時送出（競爭），其餘 10 個單位依輪替順序逐組送出，共 150 筆受理、200 個答案。

**檢查項目**
- 同步：開啟與結束都要在 2 秒內讓 11 條連線看到新階段；老師看到全部 150 筆。
- 受理：全部送出成功；受理序號為 1..150 連續且不重複；同組重送同單位回傳原受理，不新增紀錄；結束後重送仍回傳原紀錄。
- 隱私：OPEN 期間每組的 SSE 完整紀錄不含他組名稱與答案，也不含 acceptedOrder、rank、isWinner、joinCode、spreadsheetId、originalMarker 等欄位。
- 排名：每單位 10 組都有紀錄、順位 1..10、恰一個勝出；順位與「獨立計算的期望結果」（只用結果中的受理序號，SPEED 依序號、FAIR 依此前勝出次數再依序號）逐單位相符；教師與學生看到的固定結果相同。
- CSV：10 組 × 20 題 = 200 列加標頭、UTF-8 BOM、標頭欄位正確；學生下載被拒絕（403）。
- 資料庫：submissions 150、submission_answers 200、results 150、勝出者 15。

**結果**
- 執行命令：`node --test tests/integration-scale.test.js`；連跑 5 次，每次 2／2 通過。
- 其中一次的量測：SPEED 開啟同步 10 ms、結束同步 138 ms、150 筆送出 p95 113 ms、最慢 114 ms；FAIR 開啟同步 9 ms、結束同步 133 ms、送出 p95 103 ms、最慢 116 ms，公平模式 10 組都有得勝，各 1～2 次。
- 全回歸：`npm test` 在 main（dc2c70b，含 #35 CSV）加本測試共 132／132 通過。
- 測試強度：我故意破壞三處行為再跑，測試都會失敗：關掉公平排序（FAIR 的順位比對失敗）、讓學生看到所有組的受理（隱私檢查失敗）、讓重送不再回傳原受理（重送檢查失敗）；還原後全過。

**環境與限制（如實說明）**
- 本機單機，Windows。預設 PATH 的 Node 為 v26.13.1，不符合專案要求（`.node-version` 24.22.0、`engines` >=24.22.0 <25），所以上面的首次量測是在 v26.13.1 取得；之後改用 conda 環境 `node24` 的 Node **v24.22.3**（符合要求，`node:sqlite` 可用）重跑：`npm test` 132／132 通過，整合測試連跑 3 次每次 2／2 通過（SPEED 開啟同步 11～12 ms、結束同步約 147 ms；FAIR 開啟同步 9～14 ms、結束同步 170～555 ms、最慢一筆送出 202 ms，皆遠低於 2 秒）。結束同步偶爾較慢的那一次仍在要求內。
- Google Sheets 是記憶體替身，不代表 AC-01／AC-03；老師頁與學生頁的畫面不在此測試範圍（有各自的瀏覽器 E2E）。
- 10 組、150 筆受理屬課堂規模；沒有做更大的壓力測試。
- tasks 9.1 還有「確認各功能都已隨實作提交測試」：#36（結果頁）、#37（教師頁）、#38（寫回）合併後需再跑一次全回歸並更新這裡，所以 9.1 先不勾選。

## Node 24.22.3 全分支重測（2026-11-23）

環境：Windows，conda 環境 `node24` 的 Node v24.22.3（符合 `engines` >=24.22.0 <25）、npm 11.19.1。先前多數結果是在預設 PATH 的 Node v26.13.1 取得，這裡全部以符合版本重跑。

| 分支 | `npm test` | 瀏覽器 E2E（真實 Chrome） |
| --- | --- | --- |
| test/integration-10x20（main＋#20） | 132／132 | — |
| feat/results-page（#36） | 137／137 | `e2e-results` 20／20 |
| feat/teacher-console（#37） | 151／151 | `e2e-teacher` 39／39 |
| feat/sheets-writeback（#38） | 154／154 | — |
| feat/export-ui（#18 教師頁面板，未開 PR） | 157／157 | `e2e-teacher` 48／48 |
| playtest（所有功能合併，僅本機試玩） | 175／175 | `e2e-teacher` 50／50、`e2e-results` 20／20 |

**真實 Google Sheets**（feat/sheets-writeback，兩份測試副本，同樣在 Node 24.22.3）：單題表 25／25、題組表 22／22 通過，內容與 2026-11-22 的結果一致（RAW 純文字、其他內容與格式不變、重複寫回識別、改寫原格 → 409 停止）。驗收腳本不在 repository；跑完已還原測試副本的標記。

限制：E2E 的 Sheets 仍是記憶體替身（真實 Sheets 只有上面那項後端流程驗收）；未涵蓋手機版面、螢幕閱讀器與其他瀏覽器。

## 全功能合併後的全回歸（2026-11-24，tasks 9.1）

基準：main 已含 #35（CSV）、#36（結果頁）、#37（教師頁）、#38（原格寫回），加本 PR 的整合測試。環境：Windows，Node v24.22.3（conda 環境 `node24`）。

| 命令 | 結果 |
| --- | --- |
| `npm test` | 184／184 通過 |
| `npm run e2e:teacher`（真實 Chrome） | 40／40 通過（含 #37 的快照順序情境；結果頁與 CSV 連結依端點存在而出現） |
| `node scripts/e2e-results.mjs`（真實 Chrome；沒有對應的 npm script） | 20／20 通過 |
| `node --test tests/integration-scale.test.js` 連跑 3 次 | 每次 2／2 通過 |

**各功能都已隨實作提交測試（對照）**

| 功能 | 測試檔 |
| --- | --- |
| 專案基礎、資料層、migration | `server.test.js`、`storage.test.js` |
| 身分、活動建立與狀態控制 | `auth.test.js`、`activities.test.js` |
| 受理、題組、排名、結束、競態 | `submissions.test.js` |
| SSE 同步、重連、隱私 | `events.test.js`、`activity-stream.test.js` |
| 學生頁 | `student-page.test.js` |
| Sheets gateway（讀取、寫入、錯誤對應） | `sheets-gateway.test.js` |
| 標記解析、預覽、確認匯入 | `import-parser.test.js`、`import-service.test.js` |
| 教師頁（含快照順序）、目前活動 API | `teacher-page.test.js`、`teacher-activity.test.js`、`e2e:teacher` |
| 結果頁 | `results-page.test.js`、`scripts/e2e-results.mjs` |
| CSV 匯出與公式防護 | `csv.test.js` |
| 原格寫回（預覽、重驗、回讀、重試、衝突、互斥） | `writeback.test.js` |
| 1 師／10 組／20 題整合 | `integration-scale.test.js` |

**尚未完成**：#18 的教師頁寫回面板（PR #40）合併後需再跑一次全回歸並更新這裡，所以 tasks 9.1 先不勾選。Sheets 在自動測試與 E2E 中是記憶體替身；真實 Sheets 驗收見各功能文件與 #21。

## #40 合併後的全回歸（2026-11-25，tasks 9.1）

基準：main 3642391，已含全部功能與 #40（教師頁寫回面板）。環境：Windows，Node v24.22.3（conda 環境 `node24`）。

| 命令 | 結果 |
| --- | --- |
| `npm test` | 209／209 通過 |
| `npm run e2e:teacher`（真實 Chrome；Google 為替身） | 58／58 通過（含寫回面板與 #37 的快照順序情境） |
| `node scripts/e2e-results.mjs`（真實 Chrome；沒有對應的 npm script） | 20／20 通過 |

**這些自動測試不代表人工驗收**。2026-11-25 在真實瀏覽器與真實 Google Sheets 上的人工驗收（含各項目的環境、步驟、結果與限制）記在 acceptance-checklist.md 第四節（位於 [PR #41](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/41)，**尚未合併**；合併前請以該 PR 的文件為準）：
- 人工驗證通過：AC-01～05、07～09、11、12、14～17、19～24。
- 部分通過：AC-13（人工 3 種，其餘 5 種為真實表腳本驗證，見 [writeback.md](writeback.md)）。
- API 層級腳本驗證（非瀏覽器人工操作）：AC-18、AC-04 的「開啟後新組加入被拒」。
- 以自動測試為準：AC-06、AC-10（並行競態，人工無法穩定製造）。

**tasks 勾選依據**：6.1、6.7（AC-01～AC-03、AC-17 真實證據）、7.2、7.3（AC-12、AC-13、AC-17）、7.4（AC-14）、7.5 的真實 Sheets 證據都已在上述紀錄中；9.1 為本節的全回歸。**9.2 不勾選**：AC-13 只有部分人工驗證，AC-06、AC-10 未人工驗，依「未測不標通過」維持未完成。

已知限制：匯出紀錄無法區分某次寫回是真的寫入或確認先前已寫入（PR #40 複查後移除了前端的推論）。

## 2026-11-27 跨組對齊追加回歸

基準 main 5180933，追加準備中學生退出與 CSV Q:題號／G:代號。Windows、Node v24.22.0：npm test 222／222、node scripts/e2e-student-leave.mjs 13／13、教師頁 58／58、結果頁 20／20 通過。前端提示文字微調後另重跑 student-page 15／15。OpenSpec strict 與 git diff --check 通過。細節及待人工 AC-25／AC-26 見 [跨組對齊與新增驗證](cross-group-alignment.md)；不把本機 fixture／無頭瀏覽器結果冒充真實 Google Sheets 人工驗收，也未改動原人工測試資料。
