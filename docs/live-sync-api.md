# 活動 SSE、重連與隱私

2026-11-21，member A #8／#9 實作。使用既有身分、活動與受理 API，沒有新增套件或 migration。真實 Sheets、完整學生／教師頁與人工驗收仍待後續。

## SSE 介面

`GET /api/activities/:id/events`：教師或此活動既有學生透過同源 Cookie 訂閱；匿名回 401，其他活動的學生回 403。先授權再送出 `text/event-stream` headers；所有回應 no-store，不允許跨來源讀取。拒絕不符服務網址的 Origin、cross-site 請求及 HEAD；不接受任何查詢參數，不能把 session／CSRF／角色／組別放 URL。

事件格式：

```text
event: snapshot
data: {"data":{"activityId":"活動 ID","mode":"SPEED","state":"OPEN","units":[],"groupId":"自己的組別 ID","groupName":"自己的組名","submissions":[]}}

event: heartbeat
data: {}
```

快照欄位與 `GET /api/activities/:id/snapshot` 完全共用序列化：

- PREPARING／OPEN 教師：公開活動欄位、題目單位、加入碼、組別清單與已受理答案／序號；FAIR 勝出欄為 null、rankingStatus=PENDING_CLOSE，畫面應顯示「結束時計算」。
- PREPARING／OPEN 學生：公共活動狀態、模式、單位／題號，以及自己的組別與受理。沒有他組名稱、答案、狀態、組數、受理數、全場序號、順位或勝出者；原格映射、session 機密與教師資料不外露。
- CLOSED：與 results API 同一份完整保存結果；各單位仍列出無人作答情況，結果不重算。格式見 [受理與結果 API](submission-results-api.md)。

首次連線及每次重連立即送最新授權快照，不依 Last-Event-ID 回放歷史。不產生 event id、全場 revision 或序號。每條學生連線比較自己的快照內容，未改變便不送事件：他組加入、提交或重試都不能觸發相同學生快照，避免從事件數量推知他組活動。heartbeat 每 15 秒固定發空物件，與活動寫入無關。

每次刷新、heartbeat 都重新驗證原 token。登出／旋轉 token 會由共用身分交易立即撤銷舊連線；到期另有計時器，不等下一次活動寫入。失效送 `session-ended`，只含通用 `SESSION_ENDED` 提示後關閉。服務停止或快照讀取故障送 `stream-ended`／通用 `STREAM_ENDED`，不含 SQL、例外堆疊、來源或他組資料。慢連線已阻塞時直接斷開，由重連快照恢復。

## B 的匯入與教師頁接點

所有活動異動仍使用 `store.write(activityId, synchronousCallback)`，在回呼內重新驗證身分、狀態與 revision。此入口現在在 **COMMIT 之後、Promise resolve 之前**自動通知訂閱者；例外回滾不通知。通知只有活動鎖識別碼，不帶完整資料，推播端重新授權查詢快照。

B 的 import confirm 依原設計同交易替換 units／questions 與 import_revision，即會自動觸發最新題號快照，不需另建 SSE 廣播。preview、export 等未改變可見快照的寫入不會重複推送。身分模組使用 `global:authentication`，會重新驗證所有已連線 session。

`store.subscribe(listener)` 回傳取消訂閱函式，listener 必須同步。通知失敗不改變已提交交易的成功結果，不得以通知錯誤誘使客戶端重新受理。SSE 對大快照遵守 backpressure：只保留需要刷新的旗標，drain 後重新授權取得最新資料，不堆積歷史；阻塞 15 秒後斷開。停止服務先關閉 SSE，避免 HTTP server.close 一直等長連線。

## 前端共用模組與連線提示

`public/activity-stream.js` 提供 A／B 共用的原生 EventSource 模組：

```javascript
import { watchActivity } from '/activity-stream.js';

const stream = watchActivity({
  activityId,
  statusElement: document.querySelector('#connection-status'),
  onConnection(state) {
    // connecting / connected / disconnected / unauthorized / closed
    // 作答控制只在最新快照已同步後啟用；仍須以 HTTP 受理回覆或自己的紀錄確認成功。
  },
  onSnapshot(snapshot) {
    // 完整取代目前活動狀態，不累加事件。組名與答案使用 textContent。
  },
});
// 換頁或結果頁不再需要推播時呼叫：stream.close();
```

open 只顯示「正在同步」，收到有效活動快照才顯示已連線；error／offline 明示中斷。網路恢復與 EventSource 自動重連以最新快照恢復，45 秒沒有 snapshot／heartbeat 時重建連線。session-ended 停止重試並提示重新確認身分；不提供僅靠組名接管。statusElement 只以 textContent 更新，設定 role=status、aria-live=polite，不只靠顏色。

根狀態頁會讀取 session，已有學生工作階段時自動顯示連線及活動階段。沒有加入／作答表單；完整 #12、B #15／#16 頁面仍須接此模組並做瀏覽器整合驗收。斷線不承諾恢復未送出草稿，也不能把連線成功當作答案受理成功。

## 實際驗證與界限

2026-11-27：準備中學生主動退出在同活動交易提交後，舊 token 的連線立即收到 session-ended 並關閉；教師取得移除本人組別後的新名單，其他學生快照不變則不發新事件。前端退出時先關閉舊連線並增加 epoch，不接受退出前的快照重新恢復學生身分。

整合最新 main（PR #30，5db2bc0）後，`npm test` 75／75 通過：含原 37 項、B 解析器 19 項、新增 12 項 HTTP／SSE、6 項前端連線狀態模組、1 項提交後通知測試。涵蓋各角色 API／事件／錯誤隱私、他組事件抑制、去重、交易回滾、登出與自然到期、重連、重啟、固定 heartbeat、內部錯誤清理及超過網路緩衝區的大快照。

1 師／10 組／20 題本機自動測試（Windows、Node 24.22.0），整合最新 main 後：OPEN 36.2 ms、最慢一般受理 260.9 ms、CLOSED 62.8 ms，均低於 2 秒。這是本機測試觀察，不能視為所有負載、跨網路或真實 Sheets 的效能保證。fixture／故障 trigger 只在暫存測試 DB；完整頁面、人工 AC 與真實 Sheets 仍未驗收。
