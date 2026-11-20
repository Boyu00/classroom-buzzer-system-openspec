# Design

## Context

動機見 proposal.md；完整產品規格見根目錄 spec.md。現有專案只有 OpenSpec 設定，尚無應用程式或資料庫；採 Node.js、Express、SQLite、HTML／CSS／原生 JavaScript 與 SSE。兩人依 GitHub 既有分工接力，A 負責核心、排序與學生頁，B 負責 Sheets、教師與結果頁及匯出。下列為待實作設計，並非已存在的程式介面。

## Goals / Non-Goals

**Goals:** 單一程序、localhost 下確保受理與結束的交易一致性；共用固定結果；讓 A、B 可依明確介面交接，對應所有 AC。

**Non-Goals:** 多程序或多實例同步、公開網路部署、分散式鎖，以及在任意外部 Sheets 並行編輯下保證不覆寫。其餘產品排除項目見 spec.md 第 10 節。

## Decisions

### 0. 2026-11-20 已確認的活動預設與身分實作

使用者已明確確認採用 PR #26 建議：同一老師含多個登入 session，最多一個非 CLOSED 活動；加入碼六碼，字元集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`；組名 trim 後 1～30 Unicode code points，大小寫區分、不另做正規化。以 migration 002 的部分唯一索引與共用交易維持活動上限，保留 001 不改，舊資料有多個未結束活動時 migration 會拒絕而不刪資料。另一 SpecKit 小組的同步紀錄仍待補。

教師密碼 8～128 Unicode 字元、保留原文不可全空白，以隨機 salt 的 scrypt（N=32768、r=8、p=3、64-byte key）保存。session 與 CSRF 使用 32-byte 隨機 Cookie 衍生及 SHA-256 hash；setup／login／logout／首次 join 旋轉 token，保留 session_id 供歷史活動外鍵引用。Cookie 為 HttpOnly、SameSite=Strict，本機 HTTP 不設 Secure；GET session 與旋轉回應提供 CSRF token，所有變更驗證合法本機 Host、精確 Origin 與 X-CSRF-Token。

匿名／教師／學生期限分別為 1／8／24 小時，GET session 清理無引用的到期 row，有歷史活動或匯入預覽引用者保留但到期即無權限。學生 refresh 使用原 Cookie 恢復；遺失、到期或登出後不提供只靠組名的換裝置接管。這些是身分模組的明確設計預設，API 約定詳見 docs/access-api.md。

tasks 3.4 先完成狀態控制；有已受理答案時暫以 RESULT_FINALIZATION_PENDING 拒絕 close，待原規劃 tasks 5.3 接入完整結果同交易保存後才可通過完整 #6 驗收。SSE 與 2 秒階段更新仍由 #8 完成，不以快照查詢冒充推播。

### 1. 模組與責任

規劃使用 `src/`（後端）、`public/`（頁面）、`tests/`（測試）。A 建立共用設定、資料庫 migration、session／CSRF、活動、受理、排名與 SSE 模組；B 擴充 Sheets gateway、解析、匯出及教師／結果頁。兩人各自測試所負責功能，共同進行回歸與人工驗收。

依既有技術基準採 HTTP 控制與 SSE 推播；相較 WebSocket，單向事件已能涵蓋階段更新與監看，學生送出走 HTTP。避免引入額外前端框架，維持本機啟動與 Demo 成本。套件相容版本在 #3 實作時鎖定並提交 lockfile，不在本規劃捏造版本與安裝命令。

### 2. SQLite 與交易邊界

資料表規劃為 activities、groups、sessions、units、questions、submissions、submission_answers、results、exports、export_items，另有教師設定與匯入預覽暫存。預覽與正式匯入分離，session 綁定角色及活動／組別；學生組別一個有效 session，憑 Cookie 恢復。

- activities：ID、join_code、teacher_session_id、mode、state、next_accepted_order、import_revision、時間。
- units：activity_id、unit_id、type、unit_order；順序在開啟前固定。
- questions：activity_id、unit_id、question_id、question_order、spreadsheet_id、sheet_id、row_index、column_index、original_marker、structure_fingerprint。
- submissions：submission_id、activity_id、unit_id、group_id、accepted_at（UTC ISO 8601）、accepted_order；唯一鍵 (activity_id, unit_id, group_id) 及 (activity_id, accepted_order)。
- submission_answers：submission_id、question_id、原答案；results：activity_id、unit_id、submission_id、rank、is_winner。無人作答由完整 units／questions 與空受理集合表達，不虛構 submission。
- exports／export_items：匯出批次、逐題目標、預期內容、狀態、最後核對與錯誤。sessions 與資料庫均排除版控。

採單程序活動寫入佇列加 SQLite 寫入交易。提交交易重新查狀態與身分：若同組同單位已有紀錄，原已受理請求可回傳原紀錄（不視為 CLOSED 後新增）；否則要求 OPEN，驗證全單位、配置序號、保存全部答案並提交。交易失敗回滾全部修改。結束使用同佇列，在同交易從受理資料計算 results 並設 CLOSED；提交後才送 SSE。相較僅以毫秒時間排序，唯一序號可解決同時戳競態。

### 3. A／B 共用資料與 HTTP 約定

識別碼為伺服器產生的不透明字串；`questionId` 保留表內題號原文。mode 為 `SPEED`／`FAIR`，state 為 `PREPARING`／`OPEN`／`CLOSED`。JSON 使用 camelCase，持久欄位可用 snake_case。回應成功為 `{ data: ... }`，失敗為 `{ error: { code, message } }`，不得包含憑證或他組資料。

Unit 格式：`{ unitId, type: "SINGLE" | "GROUP", order, questions: [{ questionId, order }] }`。正式題目另保存後端專用 source mapping，不在學生快照暴露來源設定與教師資料。

受理格式：`{ submissionId, unitId, answers: [{ questionId, text }], acceptedAt, acceptedOrder }`。學生 API 以 session 確定 group，不接受客戶端指定角色／組別。學生已受理回應與紀錄不附全體順位或他組數量。

結果格式：`{ activityId, mode, state: "CLOSED", units: [{ unitId, order, questions, submissions: [{ submissionId, groupName, answers, acceptedAt, acceptedOrder, rank, isWinner }], winnerSubmissionId: string | null }] }`。Sheets 與 CSV 由此保存結果及後端映射輸出，禁止另算一套排名。

| 方法與路徑（規劃） | 負責 | 用途／權限 |
| --- | --- | --- |
| POST /api/teacher/setup、/api/teacher/login、/api/logout | A | 初次本機設定、登入、登出；設定完成後禁止覆寫；設定／登入亦驗證 Origin 與對應預登入 CSRF |
| GET /api/session | A | 建立或讀取匿名預登入工作階段與 CSRF，已登入時回傳最小角色資料 |
| POST /api/activities | A | 教師建立活動 |
| POST /api/join | A | 準備中以加入碼及組名加入 |
| GET /api/activities/:id/snapshot、/events | A | 依 session 過濾的快照與 SSE |
| PATCH /api/activities/:id/mode | A | 教師準備中選模式 |
| POST /api/activities/:id/open、/close | A | 教師合法轉移；close 要求確認旗標 |
| POST /api/activities/:id/submissions | A | 學生提交 `{ unitId, answers }` |
| GET /api/activities/:id/results | A | 僅 CLOSED 的教師與既有學生可取得固定結果；B 結果頁使用 |
| POST /api/activities/:id/import/preview、/confirm | B | 教師準備中匯入；confirm 使用預覽 token |
| POST /api/activities/:id/export/preview、/write | B | 教師 CLOSED；write 明確確認暫停外部編輯 |
| GET /api/activities/:id/exports/:exportId | B | 教師查逐題核對狀態 |
| GET /api/activities/:id/results.csv | B | 教師 CLOSED 下載 CSV |

未驗證回 401、無權限 403、無效內容 400、狀態／來源衝突 409、API 故障 502／503 並有穩定 error code。精確提示文案可在實作時調整，不能更動權限與狀態語意。變更 API 統一驗證 Origin、CSRF；SSE 不把 token 放 URL，使用同源 Cookie，先驗證再建立連線。

### 4. Sheets gateway 與匯入提交

B 以服務帳戶與 Sheets scope 存取教師指定來源，環境變數僅提供 repository 外的憑證路徑。教師選工作表以 sheet ID 與選擇順序保存，不依表名排序。解析器接收實際 cell 值、merge 範圍與結構；保留原 marker 並驗證全體唯一性、題組大小、合併格。

預覽保存不可猜測 token、activity、import revision、來源與解析結果。confirm 重新檢查 PREPARING、教師 session 及 revision，再透過 A 的共用交易入口整批替換 units／questions 與原格映射，成功才增加 revision 及通知 SSE。並行開啟或舊預覽衝突時拒絕；不得 B 各自寫表導致繞過 A 的狀態與鎖。

A 先完成核心時可用明確標示的測試 fixture 建立題目測試受理；fixture 僅在自動測試環境可用，不提供產品端「假匯入成功」路徑。B 接上真實匯入後才能宣稱 AC-01 通過。

### 5. 排名與呈現

A 在核心結果服務實作 SPEED 與 FAIR，兩者都保存每筆受理的最終 rank。FAIR 使用 Map 記錄本活動勝出次數，按固定 unit_order 逐一排序，題組以一個 unit 計次。OPEN 教師可讀所有受理與速度暫定勝出者；FAIR 顯示結束時計算。學生快照與 SSE 以獨立序列化器白名單欄位輸出，只保留公共狀態、模式、題號及自己的紀錄；不廣播完整資料再由前端隱藏。新連線與重連均送授權快照，不依遺漏事件復原。

學生頁 A 負責加入、等待、作答與自己的受理紀錄；CLOSED 連到 B 的共用結果頁。B 的教師控制台使用 A 的登入、控制、快照與 SSE；B 結果頁使用 A 的 results API。答案以 textContent 呈現，明確連線及錯誤提示，支援鍵盤與欄位標籤。

### 6. 原格安全寫回與 CSV

B 在預覽與 write 前重新取得來源值、sheet IDs、網格結構及合併資訊，核對保存 fingerprint 與原 markers。fingerprint 包含選取 sheets 的 ID、順序、標題、列欄數、合併範圍及每題座標／marker；結構差異採保守停止。已寫入值只可由該活動逐題確認成功的紀錄認定；逾時未知狀態先回讀，匹配本次預期答案才可記錄為已核對成功，不能只因任意同字串就允許覆寫外部編輯。

相同活動使用互斥匯出鎖；Google API 呼叫不長時間持有 SQLite 寫入交易，先保存批次及進度，外部呼叫後逐題核對並持久記錄。使用 RAW 值批次更新（例如 batchUpdateByDataFilter 的 gridRange，以 sheetId 定位）；僅更新有 winner 的格，不改格式。中斷後以紀錄與線上值恢復；未知設 PENDING_VERIFICATION，衝突設 CONFLICT，不以 HTTP 成功代替逐題核對。

CSV 從已保存結果產生，每題展開、固定欄位、UTC 時間、BOM、CRLF、引號轉義與公式前綴防護；資料庫保留原字串。

## Risks / Trade-offs

- [外部編輯不受本機鎖控制] → write 前核對並要求暫停編輯；仍存在檢查與寫入間競態，不宣稱 Google API 提供原子 compare-and-swap。
- [服務帳戶權限或網路不足] → 明示錯誤與進度，保留結果，真實授權由組員操作，不提交金鑰。
- [A 先做而 B 匯入尚未完成] → 共用模型、交易入口與 API 先凍結，用測試 fixture 驗證核心，交接後做真實整合。
- [SQLite 寫入互斥與外部 API 延遲] → 短交易、單程序序列化；Google 呼叫另行顯示進度，不承諾其 2 秒延遲。
- [規格與實作分歧] → tasks 對應 issue、FR／AC；PR 留驗證證據，變更先同步文件與另一小組。

## Migration Plan

本次是文件初始建置，沒有既有使用者資料可遷移。#3 建立可版本化 schema 與本機設定；後續 schema 修改由 migration 管理，升級前備份本機資料。功能與規劃以 branch／PR 合併，失敗保留原資料並修正 PR；有資料後不得靠刪除資料庫迴避驗收。整體驗證完成後才 sync 主規格及 archive change。
