# 分工與接力紀錄

初始規劃已由 PR #26 合併；member A 已實作 #3 本機骨架，尚待另一位組員依 README 安裝並 review。本次不代表 A 已完成全部核心或已正式交接 B。帳號對應依 PR #26 的實際分工留言及使用者確認。

| 角色 | GitHub 帳號 | Issues | 現況 |
| --- | --- | --- | --- |
| member A | a0972776282-tech | #3～#12 | #3 已於本機分支實作並測試，#4～#12 未實作 |
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
| 已完成 issues | #3 本機實作與自動驗證完成，PR review／合併與 GitHub issue 關閉尚未完成 |
| 未完成／已知問題 | #4～#19 與共同產品驗收未完成；#5 前需對齊 PR #26 中加入碼、組名與活動數量建議 |

## PR 與 review 證據（待填）

| 功能／tasks／issues | 作者 | PR 連結 | 審閱者與實質意見連結 | 驗證證據 |
| --- | --- | --- | --- | --- |
| 初始規劃 #1（非功能驗收） | a0972776282-tech | [PR #26](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/26) 已合併 | Boyu00 的具體建議，尚無正式 Approve review | OpenSpec strict validation |
| #3、tasks 2.1～2.3 骨架 | a0972776282-tech | 本機分支 feat/project-foundation；實作 PR 尚未建立 | 待另一位組員安裝並 review | docs/verification.md，11 項基礎測試 |

每人至少一筆由自己提出且已合併 PR，以及對另一人的實質 review。建立初始規劃 PR 可保留協作紀錄，但不代表功能 issues 已完成。

## 跨小組討論（待真實討論後填）

| 日期 | 參與者 | 討論事項 | 結論及規格版本 | 證據 |
| --- | --- | --- | --- | --- |
| 尚未紀錄 | — | — | — | — |

## AI 使用與交付（待填）

保留實際 AI 對話、各自負責內容與檢查心得；分享或提交前移除機密。YouTube 影片、表單確認及心得待真實完成後填入，不能以 AI 產生文件取代實際參與。
