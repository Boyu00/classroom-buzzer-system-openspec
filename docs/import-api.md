# Sheets 匯入預覽與確認 API（#14）

本批提供標記解析與匯入的後端 API。真實 Google Sheets 讀取（#13）、教師操作頁（#15）尚未完成；測試使用 gateway 替身，不代表 AC-01 或真實 Sheets 驗收。

## 呼叫方式

兩個端點僅限已登入教師，且活動必須在 PREPARING。變更請求需帶 Cookie、同源 Origin 與 `X-CSRF-Token`，規則同 [access-api.md](access-api.md)。成功回 `{ data }`，失敗回 `{ error: { code, message } }`；解析失敗另含 `error.details`。

| 方法與路徑 | 請求 JSON | 說明 |
| --- | --- | --- |
| POST /api/activities/:id/import/sheets | `{ "spreadsheet": "網址或 ID" }` | 列出可選的工作表（`sheetId`、標題、順序）並回報 `serviceAccountEmail`，供教師依序選擇與分享試算表 |
| POST /api/activities/:id/import/preview | `{ "spreadsheet": "網址或 ID", "sheetIds": [依序選擇的工作表 ID] }` | 讀取、解析並保存預覽；不修改現有題目 |
| POST /api/activities/:id/import/confirm | `{ "previewToken": "預覽回傳的憑證" }` | 以預覽整批取代舊匯入 |

`sheetIds` 為 1～50 個不重複的非負整數，順序即掃描順序。預覽回傳 `previewToken`、`expiresAt`、`importRevision`、`summary`（題數、單位數）與 `units`（每題的題號、順序、位置如 `工作表!B4`、sheetId、列與欄索引）。確認回傳新的 `importRevision`。

## 標記規則

答案格完整內容須為 `{{Q:題號}}` 或 `{{Q:題號|G:題組代號}}`，解析前去除前後空白；識別字限英數字、點、底線、連字號，大小寫區分。以 `{{` 開頭但格式不合法者回報錯誤，不會被忽略。

掃描依所選工作表順序，再依列、欄；單題各自成單位，同代號至少兩題合為題組（可跨工作表）；單位順序取首成員位置。拒絕零題、非法或重複標記、單一成員題組、合併儲存格內的答案格與重複選擇的工作表，並一次回報全部錯誤與位置。保存的 `original_marker` 為原格完整值（含前後空白），結構指紋也包含它，供後續寫回前逐字核對。

## 預覽與確認的保證

- 預覽憑證為 32 隨機 bytes，資料庫只存 SHA-256；15 分鐘過期；每個活動只保留最新一份，新預覽使舊預覽失效。
- 預覽綁定產生它的教師 session，同一位老師的其他登入 session 不能確認。
- 確認時在 A 的 `store.write(activityId)` 交易內重新檢查教師、PREPARING、憑證、過期與 `import_revision`，再整批刪除並寫入 units／questions，最後 revision 加一；任何一步失敗整批回滾，舊匯入完整保留。
- 活動 OPEN 後，預覽與確認一律回 409 `INVALID_PHASE`。
- Google 呼叫在 SQLite 交易之外；讀取失敗回 502 `SHEETS_UNAVAILABLE`，不洩漏內部訊息，也不改動既有匯入。
- 尚未注入 gateway 時回 503 `SHEETS_NOT_CONFIGURED`；產品沒有假匯入路徑。

| 狀態 | code | 情境 |
| --- | --- | --- |
| 400 | IMPORT_INVALID | 解析不合法，`details` 列出各錯誤的 code、message、location |
| 400 | INVALID_SPREADSHEET／INVALID_SHEET_SELECTION／INVALID_PREVIEW_TOKEN | 請求內容不合法 |
| 409 | PREVIEW_INVALID | 憑證不存在、過期、屬於其他 session，或已被較新預覽取代 |
| 409 | PREVIEW_STALE | 預覽後匯入修訂號已變更 |
| 409 | INVALID_PHASE | 活動不在 PREPARING |
| 403 | SHEETS_PERMISSION_DENIED | 服務帳戶沒有權限；訊息含應分享的服務帳戶 email |
| 404 | SPREADSHEET_NOT_FOUND | 找不到試算表 |
| 400 | SHEET_TOO_LARGE／SHEETS_REQUEST_REJECTED | 工作表範圍過大，或 Google 拒絕請求 |
| 503 | SHEETS_API_DISABLED／SHEETS_AUTH_FAILED／SHEETS_RATE_LIMITED／SHEETS_NOT_CONFIGURED | 專案未啟用 Sheets API、金鑰授權失敗、超過配額、尚未設定憑證 |
| 502 | SHEETS_UNAVAILABLE | 斷網、逾時、Google 服務錯誤，或回應格式不正確 |

## Gateway（#13）

`src/sheets/gateway.js` 以服務帳戶（`google-auth-library` 的 JWT 用戶端）取得 token，用 `fetch` 呼叫 Sheets API v4：`spreadsheets/{id}` 取得工作表清單（略過圖表等非表格工作表），`spreadsheets/{id}:getByDataFilter` 以 `gridRange.sheetId` 讀取所選工作表的 `formattedValue` 與合併範圍。API 以試算表原順序回傳，gateway 依教師選擇順序重新排序；API 省略的 0 值索引（含 `sheetId: 0`）會補回。錯誤訊息不含 token、金鑰或憑證路徑。

`createApp({ store, sheetsGateway })`、`startServer(config, { sheetsGateway })` 注入 `readSheets({ spreadsheet, sheetIds })`，回傳依選擇順序排列的陣列：

```js
{ spreadsheetId, sheetId, title, rowCount, columnCount,
  cells: string[][],   // 0 起算 [列][欄]，公式格取計算後字串，非字串視為空
  merges: [{ startRow, endRow, startCol, endCol }] }  // 半開區間，同 Sheets API
```

gateway 負責解析網址與 ID；錯誤可直接丟 `HttpError`（原樣回應），其他錯誤一律轉為 502。

## 與其他模組的銜接

- 學生快照與 results API 只含單位與題號；原格映射（試算表、工作表、列欄、原標記、結構指紋）保存在 `questions` 資料表，供 #17 寫回與 #19 CSV 直接讀取。
- 匯入確認與 A 的受理共用同一活動鎖：匯入只在 PREPARING、受理只在 OPEN，不會同時修改題目。
- SSE 通知（#8）尚未接上，待 A 完成後於確認成功後推播。

## 組員驗證

`npm ci --ignore-scripts`、`npm test`。`tests/import-parser.test.js` 涵蓋標記與解析（AC-02、AC-03、AC-17），`tests/import-service.test.js` 涵蓋預覽／確認、權限、失敗回滾與匯入到受理、結束的整合流程。
