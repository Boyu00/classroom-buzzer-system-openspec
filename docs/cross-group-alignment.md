# 跨組對齊與新增驗證

## 決議來源

2026-11-27（臺灣時間），SpecKit 回覆者 45678XYZ 在 [issue32 回覆](https://github.com/tom1030507/classroom-buzzer-system-speckit/issues/32#issuecomment-7198214097) 同意活動上限、六碼加入碼、trim 後 1～30 Unicode 字元組名，並建議學生準備中退出及 CSV unit_id 格式統一。OpenSpec 依使用者指示作出 [確認回覆](https://github.com/tom1030507/classroom-buzzer-system-speckit/issues/32#issuecomment-7207072503)，更新 spec v1.3 與現有 build-classroom-buzzer 規劃。兩組教師密碼首次設定方式各自維持。

## 本次行為

- 學生在 PREPARING 可按「退出組別並重新加入」，同交易解除本人學生身分、旋轉 Cookie／CSRF，再刪除本人組別；匿名工作階段可重新加入並更正組名，原組名也釋放。OPEN／CLOSED 禁止退出，不刪答案或結果。
- API 為 POST /api/student/leave，依目前 session 識別本人，忽略 body 夾帶的活動／組別。與開啟共用活動佇列，刪除失敗會連同身分旋轉回滾。舊 token 與舊 SSE 失效，教師名單同步更新，其他學生資料不變。
- 退出前停止舊串流並增加頁面世代，避免舊快照恢復已退出的畫面；回覆遺失時重新確認 session，不猜測退出是否成功。
- CSV 的 unit_id 改為 Q:原題號／G:題組代號，例如 Q:3、G:A。十欄名稱、排序、順位、公式防護與無人作答列不變；資料庫／JSON API unitId 仍是不透明 ID。舊活動從已保存的標記解析，不呼叫線上 Sheets；映射損壞明確回 409，不退回錯誤識別值。
- 無新增 migration，也未改動既有人工驗收的資料庫、工作階段或線上測試表。

## 自動驗證結果

日期 2026-11-27，Windows、Node v24.22.0，獨立暫存 SQLite、Cookie 工作階段與無頭 Chrome。未用這些結果宣稱已由使用者完成人工驗收或真實 Sheets 寫回。

| 命令 | 結果 |
| --- | --- |
| npm test | 222／222 通過 |
| node scripts/e2e-student-leave.mjs | 13／13 通過，真實無頭瀏覽器、本機 fixture |
| node scripts/e2e-teacher.mjs | 58／58 通過，Google Sheets 為替身 |
| node scripts/e2e-results.mjs | 20／20 通過，本機 fixture |

退出測試包含：本人與他組隔離、匿名／教師／Origin／CSRF 拒絕、舊 Cookie 與 SSE 撤銷、刪除故障回滾、開啟與退出兩種佇列順序、OPEN／CLOSED 保留資料、雙擊、舊前端回覆及失去回覆時的恢復。

CSV 測試包含：不連續題號、不同題組代號、題組成員共用值、無人作答單題與題組、原 API ID 與資料不變、保存標記不一致時拒絕、BOM／CRLF／十欄／順位及公式防護。

## 待人工補驗 AC25 與 AC26

1. 新建準備中活動，用兩個學生工作階段加入；甲退出，老師只少甲、乙維持原身分，甲回加入頁，可重用原組名或更正名稱重新加入。
2. 開啟活動後學生頁不提供退出；已受理答案與結束結果保留。伺服器的拒絕與競態已有自動測試，不需為人工示範修改正常資料庫。
3. 匯入兩單題與一個三題題組，使用原題號及代號（例如 Q3、題組 A、Q12），結束後下載 CSV，以 Excel 開啟確認 unit_id 為 Q:3、G:A、Q:12；題組各列共用 G:A，無人作答列亦正確，其他欄位與結果一致。

以上人工步驟尚未執行，不能沿用 2026-11-25 的舊 CSV 作為新格式已人工通過的證據。歷史 AI 摘要與對齊輸出保留原日期，其舊格式描述不是 v1.3 的現行規則。
