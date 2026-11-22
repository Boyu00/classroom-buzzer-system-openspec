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
| 交接日期／commit／PR | 2026-11-22，codex/student-page；#12 本批待組員 review，完整 A→B 交接驗證仍待 B 確認 |
| 安裝與啟動方式 | README 的 npm ci --ignore-scripts、npm start；目前完整產品操作頁尚未完成 |
| 測試命令與結果 | 本批 npm ci --ignore-scripts、npm test：87／87；學生 DOM／雙 Cookie HTTP 與真實 Chrome／無痕驗證，見 docs/student-page.md；完整人工 AC 與真實 Sheets 未測 |
| 模型／API 變更 | 受理與結果見 docs/submission-results-api.md；SSE／重連與 B 匯入接點見 docs/live-sync-api.md；沒有新 migration |
| 已完成 issues | #3 已經 PR #27 正式 review 並合併；#4／#5 與 #6 基礎 API 已經 PR #28 正式 review 並合併（a78412c） |
| 已合併的受理／排名 | [PR #29](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/29)，85fe739；Boyu00 核准最新 b41e6ae，37／37 測試通過 |
| 已合併同步／隱私 | [PR #31](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/31)，b9208d2，Boyu00 Approve；已採納測試競態建議並補到期邊界，76／76 通過 |
| 本批學生頁 | codex/student-page：#12、tasks 5.4～5.6，87／87；docs/student-page.md 說明操作、恢復及 B #16 的結果入口 |
| 未完成／已知問題 | B #13～#19 與共同整合／真實 Sheets 驗收未完成；#6 完整頁面人工驗收仍待整合。使用者 2026-11-22 確認不提供僅靠組名的 Cookie 遺失／到期／登出接管 |

## PR 與 review 證據（待填）

| 功能／tasks／issues | 作者 | PR 連結 | 審閱者與實質意見連結 | 驗證證據 |
| --- | --- | --- | --- | --- |
| 初始規劃 #1（非功能驗收） | a0972776282-tech | [PR #26](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/26) 已合併 | Boyu00 的具體建議，尚無正式 Approve review | OpenSpec strict validation |
| #3、tasks 2.1～2.3 骨架 | a0972776282-tech | [PR #27](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/27) 已合併，提交 b5dcda8 | [Boyu00 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/27#pullrequestreview-5992202981)，Node 24.22.3、11／11、可啟動 | docs/verification.md |
| #4／#5、#6 基礎控制 | a0972776282-tech | [PR #28](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/28) 已合併，a78412c；review 時最新提交 d3f5510；#6 保留開啟 | [Boyu00 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/28#pullrequestreview-5994013087) | 23 項回歸；docs/access-api.md |
| #7／#10、#11 排名核心、#6 有答案結束 | a0972776282-tech | [PR #29](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/29)，已合併 85fe739；核准 head b41e6ae | [Boyu00 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/29#pullrequestreview-6006195370)，Node 24.22.3、37／37；另有五點不擋合併建議 | docs/submission-results-api.md；tasks 4.1～4.4、5.1～5.3 |
| B #14 解析器 | Boyu00 | [PR #30](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/30)，核准 head 86d5df8；現已合併為 5db2bc0 並整合本批 | [A 要求修改](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/30#pullrequestreview-6005219096) 原格保留，修正後 [A 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/30#pullrequestreview-6006190177) | 解析分支 42／42；暫時整合 #29 後 56／56，隔離合併已撤銷；完整匯入仍待後續 |
| #8／#9 同步與隱私 | a0972776282-tech | [PR #31](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/31)，codex/live-sync-privacy，功能提交 4099452；已合併 b9208d2 | [Boyu00 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/31#pullrequestreview-6011096228)，核准 cff801f；建議等待教師端兩筆受理再計數，已採納；另外補到期計時器提前觸發的重新排程與測試 | review 修正後全套 76 項、SSE 13 項連跑三次全過；docs/live-sync-api.md；tasks 4.5～4.7 |
| #12 學生操作頁 | a0972776282-tech | codex/student-page；待本批上傳後開 PR | 待 Boyu00 review | 87／87；兩個 Chrome 工作階段鍵盤操作、隱私、刷新／結束，見 docs/student-page.md |

每人至少一筆由自己提出且已合併 PR，以及對另一人的實質 review。建立初始規劃 PR 可保留協作紀錄，但不代表功能 issues 已完成。

PR #29 五點建議追蹤：CLOSED 名單欄位需求依結果頁整合再確認；後端 questions 映射已在受理／結果 API 文件說明。相同時間戳目前以服務注入測試，尚無改變產品 HTTP 時鐘的需求。學生恢復方式在 #12 前確認。finalizeResults 的逐筆答案數量查詢目前通過本機目標，後續負載測試若發現瓶頸再合併查詢。

## 跨小組討論（待真實討論後填）

2026-11-20 使用者已在本組確認採用 PR #26 的三項建議：單一未結束活動、六碼指定字元加入碼、trim 後 1～30 Unicode 字元組名；已同步 spec v1.2 與本組 artifacts。這不是與 SpecKit 小組的討論證據，以下跨組紀錄仍待真實完成。

| 日期 | 參與者 | 討論事項 | 結論及規格版本 | 證據 |
| --- | --- | --- | --- | --- |
| 尚未紀錄 | — | — | — | — |

## AI 使用與交付（待填）

保留實際 AI 對話、各自負責內容與檢查心得；分享或提交前移除機密。YouTube 影片、表單確認及心得待真實完成後填入，不能以 AI 產生文件取代實際參與。
