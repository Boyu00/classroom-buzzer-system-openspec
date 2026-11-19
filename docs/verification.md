# 驗證與驗收紀錄

## 目前結果

- 已建立 OpenSpec 初始規劃；`openspec validate build-classroom-buzzer --strict` 在產生文件時執行通過。
- 該命令只驗證規劃格式，不驗證產品功能。
- member A #3 已完成本機骨架、資料庫 migration 與共用交易入口，產品登入、搶答與 Sheets 行為尚未實作。
- 2026-11-20：依 lockfile 重裝後 11 項基礎自動測試全過，啟動頁及健康檢查回應成功，詳見下表。
- 初始規劃 PR #26 已合併，組員留下具體設計建議；正式 Approve review、跨組對齊與 #3 的另一位組員安裝驗證尚未完成，不虛列為已通過。
- 真實 Google Sheets 授權、產品人工驗收與 Demo 尚未完成。AC-01～AC-23 維持未測；骨架層測試不代表完整產品情境已驗收。

## 自動驗證紀錄（實作後填寫）

| Commit／環境 | 實際命令 | 結果 | 對應 tasks／AC | 證據 |
| --- | --- | --- | --- | --- |
| 2026-11-20，Windows，Node 24.22.0／npm 11.19.1，feat/project-foundation | npm ci --ignore-scripts | 依 lockfile 重裝成功；66 套件稽核，0 個已知漏洞 | 2.1 | package-lock.json；真實命令輸出 |
| 同上，重裝後執行 | npm test | 11／11 通過 | 2.1、2.2 | tests/server.test.js、tests/storage.test.js |
| 同上，本機資料庫 | npm run db:migrate | 初始 migration 成功；重跑不重複套用 | 2.2 | schema_migrations；migration 測試 |
| 同上 | npm start；GET /；GET /api/health | 頁面 HTTP 200；health 為 status ok、stage foundation、database ok | 2.1 | 實際服務回應與 HTTP 測試；僅 127.0.0.1 |
| 同上 | git check-ignore .env data/classroom.sqlite3 data/classroom.sqlite3-wal sessions/example credentials/service-account.json node_modules/express/package.json | 列舉路徑均被排除；git status 無本機資料與憑證 | 2.3 | .gitignore 與實際命令輸出 |

測試先在沙箱內遇到 localhost 連線權限限制，改於核准的環境執行通過；另修正 Windows 測試清理順序，先關資料庫再移除該測試建立的暫存資料夾。所有產品驗收、效能與真實 Sheets 仍待後續。

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

## 交付檢查

| 項目 | 狀態 | 證據 |
| --- | --- | --- |
| DC-01 每人 PR 與實質 review | 未完成 | — |
| DC-02 能力文件與實作追溯 | 規劃文件及 #3 基礎實作已建立，其餘未完成 | tasks 2.1～2.3、docs/storage.md |
| DC-03 OpenSpec 完整流程 | Propose 完成、Apply 僅完成 #3；完整 Verify／Sync／Archive 未完成 | 初始規劃 PR #26；後續實作 PR 待補 |
| DC-04 與 SpecKit 小組一致性討論 | 待真實討論紀錄 | — |
| DC-05 AI 對話、文件與產品一致 | 未完成 | — |
| DC-06 五分鐘內完整 Demo | 未完成 | — |
| 助教 Google 表單提交 | 未提交 | — |
