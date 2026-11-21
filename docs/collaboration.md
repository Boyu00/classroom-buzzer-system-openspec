# 分工與接力紀錄

初始規劃 PR #26 及 #3 骨架 PR #27 已合併；Boyu00 正式核准 #27，並以 Node 24.22.3 在其電腦完成安裝、11 項測試與啟動確認。member A 正在本機分支 feat/activity-access 接續 #4／#5 與 #6 基礎 API，尚未正式交接全部核心。

| 角色 | GitHub 帳號 | Issues | 現況 |
| --- | --- | --- | --- |
| member A | a0972776282-tech | #3～#12 | #3 已合併；#4／#5 與 #6 基礎 API 本機實作，#6 整合與 #7～#12 待後續 |
| member B | Boyu00 | #13～#19 | 未實作 |
| 共同 | 兩人 | #1～#2、#20～#25 | 規劃文件已產生，review／討論／交付未完成 |

## 既有 issues 與責任

| Issue | 負責 | 工作 |
| --- | --- | --- |
| #1 | 共同 | OpenSpec init、explore、propose |
| #2 | 共同 | 與 SpecKit 小組功能一致性 |
| #3 | A | Express／SQLite 骨架、localhost、lockfile、排除檔 |
| #4 | A | 教師驗證、Cookie、Origin／CSRF |
| #5 | A | 活動、加入碼、組別與重連 |
| #6 | A | 狀態機、結束確認 |
| #7 | A | 受理序號、去重、驗證與競態 |
| #8 | A | SSE、快照、依 session 過濾 |
| #9 | A | 學生 API／事件隱私 |
| #10 | A | 題組原子送出 |
| #11 | A | 公平排序與結果保存 |
| #12 | A | 學生頁面 |
| #13 | B | Google 服務帳戶與 Sheets 讀取 |
| #14 | B | 標記、動態映射、預覽、舊匯入保留 |
| #15 | B | 教師頁面、控制與監看 |
| #16 | B | 老師與學生結果頁 |
| #17 | B | 原 Sheets 核對、RAW 寫回與回讀 |
| #18 | B | 匯出紀錄、失敗、逾時、待核對與重試 |
| #19 | B | CSV |
| #20～#21 | 共同 | 自動整合及真實線上驗收 |
| #22 | 共同 | Verify、Sync、Archive |
| #23～#25 | 共同 | README／分工、Demo、表單繳交 |

完整 issue 內容以 [GitHub](https://github.com/Boyu00/classroom-buzzer-system-openspec/issues) 為準；本表不是已完成紀錄。

## 接力順序

1. 共同 review 初始文件，凍結 design.md 中的模型、API、原格映射與結果格式。
2. A 依 tasks 先完成 #3，再完成身分、活動、受理、同步、排名與學生頁；每批以 branch／PR 合併，B review。
3. A 於自動測試使用 fixture，尚未完成 B Sheets 匯入時，不宣稱完整產品流程可用。教師頁由 B 完成，A 的控制 API 可先以測試驗證。
4. A 將實際啟動／測試指令、介面、migration、測試結果與尚待整合事項寫入下方；B 從最新 main 開 branch。
5. B 完成 Sheets 與教師頁，再串接 A 的結果 API，完成結果頁、寫回與 CSV；A review B 的 PR。
6. 兩人完成真實 Sheets 人工驗收、修正、影片、文件及繳交。半成品不 sync／archive，不關閉未達條件的 issues。

## A → B 交接（待實際完成後填寫）

| 項目 | 真實內容 |
| --- | --- |
| 交接日期／commit／PR | 尚未交接 |
| 安裝與啟動方式 | #3 骨架：README 的 npm ci --ignore-scripts、npm start；完整產品尚不可操作 |
| 測試命令與結果 | #3 骨架 npm test：11／11；產品 AC 與真實 Sheets 未測 |
| 模型／API 變更 | 規劃見 design.md；實作差異待記錄 |
| 已完成 issues | #3 已經 PR #27 正式 review 並合併；#4／#5 與 #6 基礎 API 已經 PR #28 正式 review 並合併（a78412c） |
| 已上傳、待 review | codex/answer-submission：[PR #29](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/29)，#7／#10 受理與題組、#11 排名核心、#6 結束與結果原子保存，37／37 測試通過；格式見 docs/submission-results-api.md；尚未合併 |
| 未完成／已知問題 | #8 SSE、#9 完整 API／事件隱私、#12 學生頁、B #13～#19 與共同驗收未完成；#6 完整推播驗收仍待 #8。學生登出／遺失 Cookie 的恢復設計在 #12 前確認 |

## PR 與 review 證據（待填）

| 功能／tasks／issues | 作者 | PR 連結 | 審閱者與實質意見連結 | 驗證證據 |
| --- | --- | --- | --- | --- |
| 初始規劃 #1（非功能驗收） | a0972776282-tech | [PR #26](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/26) 已合併 | Boyu00 的具體建議，尚無正式 Approve review | OpenSpec strict validation |
| #3、tasks 2.1～2.3 骨架 | a0972776282-tech | [PR #27](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/27) 已合併，提交 b5dcda8 | [Boyu00 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/27#pullrequestreview-5992202981)，Node 24.22.3、11／11、可啟動 | docs/verification.md |
| #4／#5、#6 基礎控制 | a0972776282-tech | [PR #28](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/28) 已合併，a78412c；review 時最新提交 d3f5510；#6 保留開啟 | [Boyu00 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/28#pullrequestreview-5994013087) | 23 項回歸；docs/access-api.md |
| #7／#10、#11 排名核心、#6 有答案結束 | a0972776282-tech | [PR #29](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/29)，codex/answer-submission，程式提交 066e7c9；已建立、未合併 | 說明中請 Boyu00 review；尚未收到 review | 37 項回歸；docs/submission-results-api.md；tasks 4.1～4.4、5.1～5.3 |

每人至少一筆由自己提出且已合併 PR，以及對另一人的實質 review。建立初始規劃 PR 可保留協作紀錄，但不代表功能 issues 已完成。

## 跨小組討論（待真實討論後填）

2026-11-20 使用者已在本組確認採用 PR #26 的三項建議：單一未結束活動、六碼指定字元加入碼、trim 後 1～30 Unicode 字元組名；已同步 spec v1.2 與本組 artifacts。這不是與 SpecKit 小組的討論證據，以下跨組紀錄仍待真實完成。

| 日期 | 參與者 | 討論事項 | 結論及規格版本 | 證據 |
| --- | --- | --- | --- | --- |
| 尚未紀錄 | — | — | — | — |

## AI 使用與交付（待填）

保留實際 AI 對話、各自負責內容與檢查心得；分享或提交前移除機密。YouTube 影片、表單確認及心得待真實完成後填入，不能以 AI 產生文件取代實際參與。
