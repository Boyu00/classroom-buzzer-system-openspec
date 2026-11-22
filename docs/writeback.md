# 寫回原 Google Sheets（member B，#17）

FR-07：活動 CLOSED 後，老師把各單位勝出組的答案寫回匯入時的原格。

## API（教師限定，POST 需 Origin 與 CSRF）

| 路徑 | 說明 |
| --- | --- |
| `POST /api/activities/:id/export/preview` | 重讀線上 Sheets，回傳每題的勝出組、答案、目標格與狀態。不寫入、不留紀錄。 |
| `POST /api/activities/:id/export/write` | body `{ "confirmedPaused": true }`（確認已暫停其他人編輯）。重驗、RAW 寫入、回讀核對。 |
| `GET /api/activities/:id/exports` | 此活動的匯出紀錄，新到舊。 |
| `GET /api/activities/:id/exports/:exportId` | 單次匯出的逐題狀態。 |

預覽每題狀態：`WILL_WRITE`、`ALREADY_WRITTEN`（本活動先前已確認寫入，不再重寫）、`NO_WINNER`（無人作答，不寫）、`CONFLICT`（附 `reason`、`message`）。`canWrite` 為 `false` 時不可寫回；結構被改變時 `structureOk` 為 `false`。

寫回只在完全核對成功時回 `200`。其他情況一律是錯誤回應，且 `error.details` 帶逐題實況：

| 狀況 | HTTP／error.code |
| --- | --- |
| 來源與匯入時不同（含結構改變） | 409 `EXPORT_CONFLICT`，未寫入任何格 |
| 無法確認是否已寫入 | 502 `EXPORT_PENDING_VERIFICATION` |
| Google 明確拒絕（權限、不存在…） | 原 gateway 錯誤碼（如 403 `SHEETS_PERMISSION_DENIED`）；回讀失敗者 502 `EXPORT_FAILED` |
| 同活動已有寫回在進行 | 409 `EXPORT_IN_PROGRESS` |
| 未確認暫停編輯 | 400 `EXPORT_CONFIRMATION_REQUIRED` |
| 活動尚未結束 | 409 `INVALID_PHASE` |

## 寫入流程

1. 取得同活動互斥（記憶體集合）；先寫入一筆 `WRITING` 匯出批次與逐題項目（`PENDING`），再呼叫 Google；Google 呼叫都不在 SQLite 交易內。
2. **寫入前重驗**（AC-13）：以保存的工作表選取與順序（`import_sources`）重讀線上資料，用匯入時相同的規則重算結構指紋（工作表 ID、順序、標題、列欄數、合併範圍、每題座標與標記），再逐格核對內容：
   - 等於匯入時的原標記 → 可寫入；
   - 等於本次要寫的答案，且本活動對此題有「已成功」或「待核對」紀錄 → 視為已寫入，不重寫；
   - 其他（移動、刪除、改寫、插入列、改名、刪除工作表、合併改變…）→ 衝突，整批停止，不寫任何一格。無人作答格被改動也算衝突。
   - 僅因格內文字碰巧與答案相同、但沒有本活動的成功紀錄，也算衝突。
3. 以 `values:batchUpdateByDataFilter`、`valueInputOption: RAW`、以 `sheetId` 的 `gridRange` 逐格定位，只更新有勝出答案的格；不改格式、不碰其他內容。
4. **回讀核對**：寫入成功與否一律以回讀為準，不看 HTTP 狀態或 `totalUpdatedCells`。
   - 線上值 = 預期答案 → `SUCCEEDED`；
   - 線上值 = 原標記 → `FAILED`（確認沒寫入）；
   - 其他 → `CONFLICT`，不再覆寫；
   - 寫入結果不明（逾時、網路、5xx）且回讀也失敗 → `PENDING_VERIFICATION`；
   - Google 明確拒絕（403／404／400／429…）→ `FAILED`，不需回讀。
5. 批次狀態：任一項 `CONFLICT` → `CONFLICT`；否則任一 `PENDING_VERIFICATION` → `PENDING_VERIFICATION`；否則任一未成功 → `FAILED`；全部成功 → `SUCCEEDED`。

重試就是再執行一次寫回：已確認的不重寫、待核對的先回讀、失敗的補寫、外部不同內容則停止。伺服器中斷留下的 `WRITING` 紀錄會在下一次寫回時轉為待核對（查詢時也顯示為待核對）。

## 已知限制

- 重驗與寫入之間仍有極短的時間差，所以寫回前要求老師確認暫停其他人編輯；寫入後的回讀會抓到這段期間的改動並標為衝突。
- 比較時會把 `\r\n`、`\r` 統一成 `\n`（Sheets 會統一換行）。
- 結構指紋含工作表標題與列欄數，所以老師在匯入後改名或增減列欄會被保守地視為衝突。
- 一份活動只對應一份試算表（匯入時即如此）。
- 單一儲存格上限 50,000 字元；學生答案上限 1,000 字元，不會超過。

## 驗證

- `tests/writeback.test.js`（19 項）使用有狀態的假 Sheets，會真的保存格子內容，驗證寫入前後整份表只有目標格變動。涵蓋 AC-12／AC-13／AC-14／AC-17 的情境；`tests/sheets-gateway.test.js` 驗證請求格式。

## 真實 Google Sheets 驗證（2026-11-22）

環境：本機 Node 24、真實服務帳戶、課程範例試算表的兩份測試副本（單題 6 題；題組 2 組＋2 單題），以完整網址匯入；每份一個活動，兩組學生作答，結束後寫回。以 Sheets 原始 API（`userEnteredValue`、`userEnteredFormat`）檢查結果。腳本為一次性驗收用，不在 repository。

| 項目 | 結果 |
| --- | --- |
| AC-01／AC-03 以完整網址列出工作表、預覽、確認匯入（真實資料） | 通過；範例表必須先取消答案格的合併並填入標記 |
| AC-12 RAW 寫回 `=1+1`、`+SUM(A1:A2)`、`=HYPERLINK("x")`、`@堆疊`、`007`、中文與換行 | 全部以 `stringValue` 原文保存，非公式、非數字 |
| 含 `
` 的答案 | 線上保留 `
`；系統比較時統一換行，不會誤判 |
| AC-17 題組各成員寫回各自原格 | 通過 |
| 無人作答格、落敗組答案、其他所有儲存格內容與格式 | 完全不變（逐格比對前後內容與格式） |
| 重複寫回 | 識別已寫入，不重寫，仍成功 |
| AC-13 原格被改寫 | 409 `EXPORT_CONFLICT`，未寫入；恢復標記後可再寫回 |
| 服務帳戶需編輯者權限 | 已確認編輯者可寫 |

單題 25 項、題組 22 項檢查全部通過。AC-13 只用「改寫」做了真實驗證；移動、刪除、插入列、改名、刪工作表、合併改變僅以假 Sheets 自動測試驗證。

Google Sheets 讀取有每分鐘配額：連續密集驗收曾得到 `SHEETS_RATE_LIMITED`，系統正確回報該錯誤碼，等待一分鐘後即恢復。
