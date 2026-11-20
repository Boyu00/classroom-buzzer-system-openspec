# 教師驗證、組別與活動控制 API（#4～#6）

這批提供後端 API，操作頁面仍由後續 #12／#15 負責。尚無真實 Sheets 匯入、提交答案、SSE 或排名功能；不要以測試 fixture 宣稱完成產品驗收。

## 工作階段與呼叫順序

1. 使用同源 `GET /api/session` 取得自己的 role、csrfToken、teacherConfigured、expiresAt。尚無有效 Cookie 時建立匿名工作階段。
2. teacherConfigured 為 false 時由老師呼叫 `POST /api/teacher/setup`，JSON 為 `{ "password": "實際設定的密碼" }`；已設定時改用 `/api/teacher/login`。這是本機單一教師設定，不是帳號註冊。
3. 所有變更請求皆須帶相同工作階段 Cookie、精確同源 Origin、`X-CSRF-Token` 及 JSON 內容。正常同源瀏覽器 fetch 自動帶 Cookie 與 Origin，程式補上 CSRF header。
4. setup、login、logout 及首次 join 都旋轉 Cookie，成功回應有新的 csrfToken，前端須立即替換舊 token。再次 GET session／刷新可恢復，不需重新登入或建立組別。
5. `POST /api/logout` 將該工作階段撤銷並換成新匿名身分。老師與不同學生組別使用獨立瀏覽器 profile／無痕工作階段，不能只開共用 Cookie 的多個分頁模擬不同組。

Cookie 為 `classroom_session`，32 隨機 bytes 的 base64url 值，HttpOnly、SameSite=Strict、Path=/；本機 HTTP 不設 Secure。資料庫只存 token／CSRF 的 SHA-256 hash；CSRF 原值由 Cookie 秘密衍生，只有同源 session 回應可讀。教師密碼保留原輸入（不 trim），限 8～128 Unicode 字元、不能全空白，採隨機 salt 與 scrypt（N=32768、r=8、p=3、64-byte key）。設定後不能經 setup 覆寫。

工作階段固定期限：匿名 1 小時、教師 8 小時、學生 24 小時；刷新不延長期限。到期後需重新取得 session；教師可再登入。遺失或到期的學生 Cookie 不能只靠組名接管舊組，符合一組一有效工作階段規則，不提供跨裝置接管。過期且無活動／預覽引用的 session 在 GET session 時清理；被引用的歷史教師 row 保留以維持外鍵，但已無驗證權限。

## 活動與組別

| 方法與路徑 | JSON／用途 | 可用身分 |
| --- | --- | --- |
| POST /api/activities | `{ "mode": "SPEED" }`，mode 可省略；回 activityId、joinCode、mode、state | 教師 |
| POST /api/join | `{ "joinCode": "六碼加入碼", "groupName": "第一組" }`；回自己的 groupId／groupName 與活動狀態 | 匿名學生；已加入者可重送自己的相同組別以重連 |
| GET /api/activities/:id/snapshot | 結束前學生只附自己的組別／受理，教師另可看名單與已受理答案；結束後為完整結果 | 教師或該活動既有學生 |
| PATCH /api/activities/:id/mode | `{ "mode": "FAIR" }`，只接受 SPEED／FAIR | PREPARING 教師 |
| POST /api/activities/:id/open | `{}`；至少有一題才開啟 | PREPARING 教師 |
| POST /api/activities/:id/close | `{ "confirmed": true }` | OPEN 教師 |

本機僅一組教師密碼，多個教師登入工作階段代表同一位老師，故全系統最多一個非 CLOSED 活動。建立後為 PREPARING；已結束活動保留，重玩建立新活動。加入碼六碼，字元集為 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`，生成值大寫且排除 0／O、1／I；加入時允許 trim 與英文字母轉大寫。

組名 trim 後 1～30 Unicode code points，同活動唯一；名稱比對區分大小寫且不做其他 Unicode 正規化。組別與工作階段綁定同交易完成，並行同名只有一個成功。伺服器不信任 body 的角色或 groupId。活動一旦 OPEN，禁止新組加入及更換模式；既有組仍可用原 Cookie 重連，CLOSED 亦可。結束前學生快照不回傳他組名單、組數、加入碼、全活動受理序號或後端 Sheets 原格映射。

## #6 的目前整合邊界

目前可驗證含答案或無人作答活動的 PREPARING → OPEN → CLOSED，零題、重複或逆向轉移均拒絕，結束必須 boolean true 確認。產品目前沒有匯入端點，因此只能由自動測試 fixture 覆蓋開啟情境；真實操作須待 #13～#15 完成。

tasks 5.3 已接入完整 SPEED／FAIR 排名與 CLOSED 同交易保存，移除舊暫時限制 RESULT_FINALIZATION_PENDING；提交與結束共用同活動佇列，故障全部回滾。受理、快照、固定結果與 B 整合格式見 [受理與結果 API](submission-results-api.md)。#8 的 SSE 與 2 秒階段推播尚未完成，#6 全部人工驗收仍待整合。

## 錯誤與安全

成功回 `{ data: ... }`，錯誤回 `{ error: { code, message } }`。401 表示缺少／到期 session 或教師未登入；403 表示身分、Origin、Host 或 CSRF 不合法；400 表示無效組名、加入碼、模式、密碼或確認值；409 表示設定已存在、活動已存在、組名不可用或階段不允許。錯誤不含密碼、hash、工作階段識別或其他組資料。

Host 僅接受實際監聽埠的 127.0.0.1／localhost；變更 Origin 必須與該合法 Host 精確相符，不信任 forwarded headers。所有 API 回應 no-store，未登入／學生不能繞過教師控制、Sheets 或匯出命名空間的權限檢查。尚未實作的功能對合法身分回 404，不假報成功。

## 組員驗證

執行 `npm ci --ignore-scripts`、`npm test`，應有 37 項測試通過。`tests/auth.test.js` 驗證密碼、session 旋轉與重啟、Origin／CSRF、偽造角色、並行設定；`tests/activities.test.js` 驗證新規則、並行加入、快照隱私與單向狀態；新增 `tests/submissions.test.js` 驗證受理、題組、競態、排名與結果保存。完整 UI、效能、Sheets 與 AC 人工驗收尚待後續，請在 review 留下實際環境與結果。
