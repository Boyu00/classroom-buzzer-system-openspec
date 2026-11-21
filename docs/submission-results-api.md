# 受理與固定結果 API

2026-11-20 完成 #7 受理、#10 題組、#11 排名核心及 tasks 5.3 的有答案結束流程，已經 PR #29 review 合併；使用既有 Cookie、Origin／CSRF，操作方式見 [身分與活動 API](access-api.md)。2026-11-21 新增 [SSE 同步](live-sync-api.md)；產品完整操作頁與真實 Sheets 匯入仍待整合，沒有可供使用者假匯入題目的端點。

## 學生送出

`POST /api/activities/:id/submissions`，必須是此活動的既有學生 session。首次受理只允許 OPEN。

```json
{"unitId":"匯入的單位 ID","answers":[{"questionId":"4","text":"  中文\n=SUM(1,2)  "}]}
```

單題需恰好一題；題組需恰好包含此單位全部題號，每題一次，不能拆送或混入其他單位。題號是字串並保留匯入原文。每題必須是有效 Unicode 字串、非全空白，最多 1,000 個 Unicode code points（包括前後空白與換行）；`😀` 算一字。拒絕未成對 surrogate，避免儲存時改字。保存原文字，不 trim、不執行 HTML 或公式；將來頁面須用 textContent，Sheets 使用 RAW。

成功 HTTP 200：

```json
{"data":{"submissionId":"隨機 UUID","unitId":"匯入的單位 ID","acceptedAt":"2026-11-20T01:00:00.000Z","answers":[{"questionId":"4","text":"  中文\n=SUM(1,2)  "}]}}
```

`answers` 依匯入題序回覆；`acceptedAt` 是伺服器 UTC 時間。同組同單位第一次受理後不可修改。雙擊、重試、改答案重送甚至結束後重送，都回第一次的 ID、答案與時間；重試不另配置序號。回覆遺失時可重試相同 unitId 或查 snapshot。驗證與去重依 session 決定組別，不信任 body 的 groupId、角色、時間或序號。

驗證、配置全活動遞增序號、保存受理及所有答案在同一交易；失敗全部回滾。題組只產生一筆受理與一個序號。結束與提交共用 `store.write(activityId, callback)` 佇列：先受理則會列入結果；先結束則拒絕新受理，已存在紀錄的重試仍可讀原紀錄。

## 快照與隱私

`GET /api/activities/:id/snapshot`：

- PREPARING／OPEN 學生：模式、狀態、公開單位／題號、自己的組別與自己的 `submissions`。不含他組名單、答案、狀態、總數、勝出者或任何全活動 `acceptedOrder`。
- PREPARING／OPEN 教師：另有 joinCode、groups、已受理 submissions（含 groupId／groupName、acceptedOrder），不接收學生未送出的草稿。SPEED 單位的 winnerSubmissionId 是最早受理者；FAIR 為 null，rankingStatus 為 PENDING_CLOSE，頁面應顯示「結束時計算」。
- CLOSED：與 results API 相同的完整固定結果格式，沒有 PREPARING／OPEN 的頂層 groups／submissions 欄位。

全活動序號可能透露他組送出數量，因此結束前學生成功回覆及快照均隱藏該欄位。內部資料庫與教師監看保留序號；CLOSED 後公開完整序號與順位。這是依根目錄 spec.md 既有隱私規則修正原 design 的回覆範例。

`/events` 已實作並共用上述授權快照；API、SSE、錯誤及他組事件抑制已有自動測試。完整瀏覽器頁面與人工 AC 仍待整合，詳見 [同步 API](live-sync-api.md)。

## 結束與結果

教師 `POST /api/activities/:id/close`，body 為 `{"confirmed":true}`。現在有答案也能結束：結果插入與 state=CLOSED 同交易。中途故障全部回滾，維持 OPEN，可修復後重試；不會留下已結束但缺排名的狀態。若資料庫已有不完整受理資料，回 409 INCOMPLETE_SUBMISSION，不能假裝完成。

`GET /api/activities/:id/results`：只允許教師或此活動既有學生，且必須 CLOSED；未結束回 409 RESULTS_NOT_READY。匿名不能查詢，活動結束後新學生也不能加入。

```json
{
  "data": {
    "activityId": "活動 ID", "mode": "SPEED", "state": "CLOSED",
    "units": [{
      "unitId": "單位 ID", "type": "SINGLE", "order": 0,
      "questions": [{"questionId":"4","order":0}],
      "submissions": [{
        "submissionId":"受理 ID", "unitId":"單位 ID", "groupId":"組別 ID", "groupName":"A組",
        "acceptedAt":"2026-11-20T01:00:00.000Z", "acceptedOrder":1,
        "answers":[{"questionId":"4","text":"答案"}], "rank":1, "isWinner":true
      }],
      "winnerSubmissionId":"受理 ID"
    }]
  }
}
```

units 依固定 unit_order，questions 依 question_order，submissions 依保存的 rank 排序。無人作答的單位仍存在，`submissions: []`、`winnerSubmissionId: null`，B 結果頁應顯示「無人作答」。CLOSED 後同單位重試回自己的受理，增加 acceptedOrder、rank、isWinner；不重新受理或修改結果。

SPEED 每單位按 acceptedOrder 升序完整排名，rank=1 唯一勝出。FAIR 本活動各組勝次從零開始，按固定單位順序，以此前勝次、acceptedOrder 升序完整排名；第一名加一次。題組只算一次，空單位不加；不讀其他活動歷史。acceptedAt 不參與排序，同毫秒仍由唯一序號決定。

結果 API 直接讀保存的 results，不在 GET 時重新計算。B 的結果頁、Sheets 寫回、CSV 須共用同份順位與 winnerSubmissionId，利用後端來源映射找到各題原格，不另算排名。資料表與已套用 migration 未修改，不需刪除既有資料庫。

PR #29 review 補充：results 的 questions 只有題號與順序，不含原格座標。B 的寫回／CSV 由後端直接查 questions 資料表映射，不能從學生結果回應猜座標。CLOSED 回應目前不保留頂層 joinCode／groups；未送出的組不虛構 submission，CSV 依受理逐題展開，無人作答題保留一列。若將來教師頁需要全部組別名單，另確認欄位需求再擴充，不改現有結果語意。

## 錯誤與驗證

常見 code：400 INVALID_ANSWERS；404 UNIT_NOT_FOUND；409 INVALID_PHASE／RESULTS_NOT_READY／INCOMPLETE_SUBMISSION；401 SESSION_REQUIRED／STUDENT_REQUIRED；403 STUDENT_REQUIRED／ACTIVITY_FORBIDDEN。其餘 Host、Origin、CSRF 檢查與既有 API 一致。資料庫故障只回通用 500，不回 SQL 或他組資料。

`npm test`：目前 56／56 通過。tests/submissions.test.js 包含 1,000 emoji 邊界、原文保存、12 次並行重試、相同時間戳、題組故障回滾、兩種佇列競態順序、HTTP 競態、API 隱私、完整排名、題組勝次、空單位、結果中途故障與 OPEN／CLOSED 重啟；新增同步測試見 docs/live-sync-api.md。

題目與故障 trigger 僅在獨立測試資料庫建立；不修改使用者活動，亦不代表真實 Sheets、完整操作頁面或人工 AC 已通過。
