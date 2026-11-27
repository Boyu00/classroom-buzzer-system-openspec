# 最終 main 回歸：2026-11-27

測試版本：**7c3a9b9f42d29e00644f9e3514d37efb8e30dbad**（PR43／45／46 已合併的 main）。本次在獨立 worktree、Windows、Node v24.22.0、npm 11.19.1 重新安裝，未複用舊 node_modules，測試資料庫與瀏覽器設定檔均使用暫存 fixture。後續本 PR 只新增報告及更新文件／任務紀錄，未修改產品程式。

## 實際執行結果

| 命令／檢查 | 結果 | 原始文字輸出 |
| --- | --- | --- |
| npm ci --ignore-scripts | 成功安裝 101 個套件；本次 npm audit 0 vulnerabilities，非完整安全稽核 | [安裝](install.txt) |
| npm test | 222／222，失敗、取消、略過、todo 均 0；29,255.4815 ms | [完整測試](npm-test.txt) |
| node scripts/e2e-teacher.mjs | 58／58 通過 | [教師頁](teacher-browser.txt) |
| node scripts/e2e-results.mjs | 20／20 通過 | [結果頁](results-browser.txt) |
| node scripts/e2e-student-leave.mjs | 13／13 通過 | [學生退出](leave-browser.txt) |
| openspec validate build-classroom-buzzer --strict | valid | [strict](openspec-strict.txt) |
| main 的七份交付／驗收文件相對連結 | 85 個有效，新增報告後另作增量連結檢查 | [機器可讀摘要](results.json) |
| 人工證據檔 | 19 張 PNG＋4 份 CSV，23 個大小／SHA-256 與 manifest 一致；此為乾淨 checkout 再驗 | [人工證據索引](../evidence/member-a/README.md) |
| git diff --check | 乾淨測試基準通過；新增報告／文件收尾後另重查 | 本 PR 檢查紀錄 |

文字輸出僅統一 LF 便於 Git 檢視，沒有刪除失敗內容。每份輸出 SHA-256 與固定測試版本見 [results.json](results.json)。安裝出現 node-domexception 棄用提示，不影響安裝或測試；本次沒有變更 lockfile／依賴。

## 整合與效能觀察

完整套件含 SPEED／FAIR 各 1 師／10 組／20 題、150 筆送出（含 5 個單位 10 組並行），均通過受理、隱私、順位及 CSV 檢查。SPEED 開啟 36 ms、結束 378 ms，送出 p95 260 ms／最慢 290 ms；FAIR 開啟 21 ms、結束 186 ms，p95 247 ms／最慢 296 ms。另 SSE 情境 OPEN 28.1 ms、最慢一般受理 165.2 ms、CLOSED 59.0 ms。這些是本機 fixture 的本次觀察值，不是網際網路或真實 Google 延遲保證。

## 驗收判定與範圍

本次沒有失敗案例，也未修改 src／public／tests／scripts。結合 [既有逐項紀錄](../acceptance-checklist.md)、[A 補測](../manual-acceptance-member-a.md)、[新 AC-25／26](../cross-group-alignment.md) 與 [已合併 PR46 的正式核准](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/46#pullrequestreview-6085524876)，可將 tasks 9.2 記為完成，issue21 的結案紀錄由本 PR 留證及 review。

人工與自動證據仍分開：AC-06／10 是兩人已確認採自動測試；AC-04 新組拒絕含 API 證據；AC-13 的 A 五種預覽＋一次實際 write 前重查，並非每種都實際 write；AC-18 有正常 UI 與使用者在 Console 啟動的 API 測試。AC-14 故障／未知狀態依既有腳本。本輪沒有重新讀寫真實 Sheets，沒有重做使用者的三視窗人工操作，不能用本次瀏覽器腳本取代先前人工證據。

## 後續

本 PR 為測試紀錄與 tasks 9.2 收尾，review／合併後可正式關閉 issue21。tasks 1.2、9.3、9.4、9.5 未在此順帶勾選；跨組與文件已有來源，仍按各自任務收尾。完整 FR／AC／DC Verify、Sync／Archive、五分鐘內 Demo、每人個人心得及表單提交仍分別處理。此報告不是整個專題完成或已繳交的證明。
