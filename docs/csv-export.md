# CSV 結果匯出（#19）

`GET /api/activities/:id/results.csv`：只有已登入的教師、且活動為 CLOSED 才能下載。學生與匿名使用者回 403／401，未結束回 409 `RESULTS_NOT_READY`，找不到活動回 404。權限先由 `auth/http.js` 的教師限定路徑檢查，服務層再檢查一次。

內容完全來自已保存的固定結果（與 `GET /api/activities/:id/results` 同一份，由 `readResults` 產生），不另算排名；產生 CSV 不會修改任何資料。

## 格式（FR-09、AC-19）

- 編碼 UTF-8 並以 BOM 開頭（讓 Excel 正確辨識中文），列與列之間、檔尾皆為 CRLF。`Content-Type: text/csv; charset=utf-8`，`Content-Disposition: attachment; filename="classroom-results-<活動 ID 前 8 碼>.csv"`，`Cache-Control: no-store`。
- 欄位固定為：`activity_id, mode, unit_id, question_id, group_name, answer, accepted_at, accepted_order, rank, is_winner`。
- 每筆受理依題展開成多列；題組各題共用同一組別、時間、受理序號、順位與 `is_winner`。
- 排序：單位順序 → 最終順位 → 組內題序。
- `accepted_at` 為 UTC ISO 8601（伺服器受理時間）；`accepted_order`、`rank` 為整數；`is_winner` 為 `true`／`false`。
- 無人作答的單位，每題仍一列：`group_name`、`answer`、`accepted_at`、`accepted_order`、`rank` 留空，`is_winner` 為 `false`。
- 轉義依 RFC 4180：含逗號、雙引號、CR、LF 的欄位加雙引號，內部雙引號加倍；答案內的換行原樣保留在引號內。

## 公式注入防護（AC-20）

使用者輸入欄位去除前導空白後若以 `=`、`+`、`-`、`@` 開頭，或**前導空白中**含 tab／CR／LF（檢查整段前導空白，不只第一個字元，例如「空白＋tab＋文字」也算），會在內容前加單引號（例如 `=1+1` → `'=1+1`、`  =1` → `'  =1`、`\t+cmd` → `'\t+cmd`）。只改輸出，資料庫與 results API 仍是原文。

防護欄位是 `group_name`、`answer`，以及 `question_id`：題號是老師在試算表裡輸入的標記，規格允許以 `-` 開頭（例如 `{{Q:-5}}`），所以一併處理。`activity_id`、`mode`、`unit_id`、時間與數字欄位為系統產生，不加前綴。

注意：單引號是「降低風險」的措施，在 Excel 開啟 CSV 時前綴會顯示成內容的一部分。這是規格選擇的取捨。

## 驗證

- `tests/csv.test.js`：純函式測試以迷你 RFC 4180 解析器把輸出解析回表格再比對（排序、題組展開、無人作答、中文／引號／逗號／換行、BOM 與 CRLF、公式防護表格、輸入物件不被修改）；HTTP 測試走完整流程（建立活動、學生送出含危險開頭的組名與答案、結束、下載），檢查標頭、BOM 原始位元組、與 results API 逐筆一致、資料庫原值不變，以及學生／匿名／未結束／不存在的拒絕。
- **尚未做**：AC-20 要求「以實際試算表開啟核對」，需要人工用 Excel 與 Google 試算表開啟範例檔確認防護前綴有效、中文與換行正確，結果請記錄在 `docs/verification.md`。
- 教師頁的「下載 CSV」按鈕在教師控制台（#15）分支，本 PR 只提供後端端點。
