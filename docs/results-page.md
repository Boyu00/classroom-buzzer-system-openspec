# 結果頁（#16）

網址：`/results.html?activityId=<活動 ID>`。這是 A 的學生頁約定的接點（學生頁在活動結束且 `HEAD /results.html` 回 `text/html` 時顯示「查看各組結果」連結），老師也用同一頁。頁面是原生 HTML／CSS／JavaScript 模組，沒有新增 API，直接使用 `GET /api/activities/:id/results` 與 `watchActivity`。

## 誰能看、看到什麼

- **老師**與**已加入該活動的學生**，在活動 CLOSED 之後可看到：每個單位（依單位順序）、各組依**最終順位**排列的答案、**受理順序**、勝出組別與勝出標示；沒有人作答的單位明示「無人作答」。順位與受理順序分開顯示（FAIR 模式下順位 1 的受理順序不一定是 1）。
- 學生會看到自己的組別標示「你們這組」。
- 其他活動的學生回 403、匿名回 401（頁面顯示需要確認身分並提供教師與學生入口）、不存在的活動回 404，頁面都以明確文字說明，且不顯示任何答案。
- **活動尚未結束**時 API 回 409 `RESULTS_NOT_READY`，頁面顯示「活動尚未結束」，不顯示任何組別的答案；同時以 SSE 等待，老師結束後的 CLOSED 快照（與 results API 同一份）一到就自動顯示結果，不需重新整理。
- 老師另有「回教師控制台」，學生有「回學生作答頁」。CSV 下載連結只給老師：頁面以 `HEAD` 探測 `results.csv`，端點存在且回傳 `text/csv` 才顯示（端點在 #19，兩個 PR 合併順序不影響）。

## 安全與無障礙

- 伺服器 CSP 禁止內嵌腳本與樣式，頁面全是外部檔案；組名、答案一律經 `el()`／`mount()` 以文字節點加入，不使用 `innerHTML`。`tests/results-page.test.js` 會掃描禁止的寫法。
- 表格有標題與欄標頭、狀態與錯誤以 `role=status`／`role=alert` 宣告、有「跳到主要內容」連結、勝出與自己的組別不只靠顏色（有文字標示）。

## 驗證

- `npm test`：`tests/results-page.test.js`（純邏輯、靜態安全掃描、`GET`／`HEAD /results.html` 回 `text/html` 且帶嚴格 CSP、模組可取得）。
- `node scripts/e2e-results.mjs [--shots <資料夾>]`：以真實 Chrome（headless，CDP）驗證各種身分：匿名、缺少活動、活動進行中（無答案外洩、結束後自動顯示）、學生自己的組別標示與另一組、結束後公開答案、換行保留、`<script>` 字串以純文字顯示且未執行、無人作答、老師視角、其他活動的學生被拒絕、不存在的活動。使用記憶體 fixture，**不是線上 Sheets 驗收**，也不在 `npm test` 內執行。

## 已知限制與待辦

- 本頁與教師控制台各有一份 `el()`／`mount()` 小工具（`public/results/dom.js` 與 `public/teacher/dom.js`），兩個分支合併後可整併成共用模組。
- 結束後的快照不含組別清單，所以看不到「從未送出的組」（與 #29 review 提過的限制相同）。
- 手機畫面與螢幕閱讀器尚未實測；真實 Sheets、寫回（#17）與匯出紀錄（#18）仍待後續。
