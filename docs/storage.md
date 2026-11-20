# #3 資料層與擴充約定

目前只完成資料表及交易基礎，沒有教師登入、建立活動、提交答案、排名計算或 Sheets HTTP API。這些規則由後續 issues 的服務層實作。

## 目錄與入口

- `src/server.js`：啟動、固定 loopback 綁定、關閉 HTTP 後等待資料寫入完成。
- `src/app.js`：Express 狀態頁、`GET /api/health`、錯誤格式；僅公開 `public/`。
- `src/config.js`：PORT、DATABASE_PATH；`npm start` 以 Node 內建 env-file 讀 `.env`。
- `src/storage/database.js`：開啟 SQLite、外鍵、migration checksum、同步交易。
- `src/storage/store.js`：服務共用資料層。
- `src/storage/write-coordinator.js`：依活動識別碼排序，前一工作失敗不阻塞後續工作。
- `src/storage/migrations/001_initial.sql`：初始 schema。

## 共用寫入方式

```javascript
import { openStore } from '../src/storage/store.js';

const store = openStore('/absolute/path/to/local.sqlite3');
const row = store.read((db) => db.prepare('SELECT 1 AS value').get());
await store.write(activityId, (db) => {
  // 在此重新查驗狀態與身分、驗證、去重並使用參數化 SQL 更新。
  // callback 必須同步，不得使用 await、網路呼叫、計時器或嵌套交易。
});
await store.close();
```

以上是介面範例，`activityId` 由後續活動服務提供；它不是目前可呼叫的產品功能。`read` 回呼僅供同步查詢，不用來寫入；所有寫入統一使用 `write`。跨活動的全域設定可使用明確全域鎖識別碼，呼叫順序由服務層規劃，禁止在同一活動回呼內再等待另一個 write。

`write(activityId, callback)` 將相同活動工作依呼叫順序排隊，回呼以 `BEGIN IMMEDIATE`／`COMMIT` 執行，例外 `ROLLBACK`。SQLite 單連線同步交易確保不同活動也不會同時持有這個連線的交易。此基礎只適用單程序，不能宣稱多實例同步。

外部 Google 呼叫在交易之外進行；回來後以同一入口再次核對活動狀態／匯入 revision／匯出紀錄。SSE 通知只能在 write 成功 resolve 後發送。`close()` 拒絕新工作、等待已排寫入，再關閉 DB。

## 初始資料表

| 表 | 用途／約束 |
| --- | --- |
| schema_migrations | 已套用 SQL 檔名、checksum、UTC 時間 |
| teacher_settings | 唯一教師本機設定及密碼雜湊，身分功能於 #4 實作 |
| sessions | 匿名／教師／學生角色、token hash、CSRF hash、到期時間；學生 session 綁定同活動組別 |
| activities | 加入碼唯一、模式與狀態、下一受理序號、匯入 revision、時間 |
| groups | 同活動組名唯一，角色與組名驗證在 #4／#5 服務實作 |
| units | 活動內單位 ID 與固定順序、SINGLE／GROUP |
| questions | 原題號、組內順序、spreadsheet ID、sheet ID、零起算列欄、原標記與結構 fingerprint |
| submissions | (活動、單位、組別) 與 (活動、受理序號) 皆唯一；#7 實作有效受理與去重 |
| submission_answers | 原答案文字，外鍵確保受理與題目屬於同活動／同單位 |
| results | 最終順位、勝出旗標；每單位順位唯一，rank 1 對應唯一 winner |
| import_previews | token hash、教師 session、revision、解析 JSON 與到期時間；#14 完成行為 |
| exports／export_items | 批次與逐題目標、內容、狀態、回讀時間及錯誤代碼；#17／#18 完成行為 |

原格映射與設定都只在後端資料庫，不放在 `public/`。目前 DB 約束不取代後續後端身分、空白／長度、狀態、完整題組、固定結果及寫回衝突驗證。

## Migration 與既有建議

新增版本用固定寬度、遞增檔名（例如 `002_export_details.sql`）。每檔一個交易，成功後才保存 checksum；失敗不保留部分資料表。不得在 migration 內自行 BEGIN／COMMIT。啟動時已套用檔案缺失、被改動或插入舊版本會停止，不刪除使用者資料。

PR #26 的組員留言另建議單一未結束活動、加入碼格式與組名長度。本次只做 #3，不以這些留言新增產品限制；#5 開始前由兩人對齊並同步規格。多工作表選擇順序與完整速度／公平順位已由既有產品規格及 design 定義，後續按規格實作。
