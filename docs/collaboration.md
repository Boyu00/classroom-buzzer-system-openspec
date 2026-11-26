# 分工與接力紀錄

功能實作已完成：A 負責的 #3～#12 與 B 負責的 #13～#17、#19 都已合併，#18 教師頁寫回面板（[PR #40](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/40)）也已合併。人工驗收清單（[PR #41](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/41)）與全回歸／tasks 勾選（[PR #42](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/42)）都已合併。人工驗收已於 2026-11-25 執行，逐項結果見 [docs/acceptance-checklist.md](acceptance-checklist.md) 第四節；下表只記實際發生的 PR 與 review，沒有 review 的項目不寫成已 review。

| 角色 | GitHub 帳號 | Issues | 現況 |
| --- | --- | --- | --- |
| member A | a0972776282-tech | #3～#12 | 全部已合併（PR #27、#28、#29、#31、#34，各經 Boyu00 正式 Approve） |
| member B | Boyu00 | #13～#19 | #13～#17、#19 已合併（PR #30、#32、#33、#35、#36、#37、#38，各經 A review）；#18 教師頁寫回面板（PR #40）已合併；寫回已在真實 Sheets 驗證；AC-01～AC-24 人工驗收已執行（見驗收清單），Demo 未完成 |
| 共同 | 兩人 | #1～#2、#20～#25 | #20 整合驗證（PR #39）已合併；#21 人工驗收已執行，紀錄在 PR #41（已合併）；全回歸與 tasks 勾選在 PR #42（已合併）；#22～#25（verify／sync／archive、README、Demo、繳交）未完成 |

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

## A → B 交接紀錄

| 項目 | 真實內容 |
| --- | --- |
| 交接日期／commit／PR | 2026-11-22，codex/student-page；#12 經 PR #34 review 後合併；B 的交接確認見本表「B 確認」列 |
| 安裝與啟動方式 | README 的 npm ci --ignore-scripts、npm start；目前完整產品操作頁尚未完成 |
| 測試命令與結果 | 本批 npm ci --ignore-scripts、npm test：87／87；學生 DOM／雙 Cookie HTTP 與真實 Chrome／無痕驗證，見 docs/student-page.md；完整人工 AC 與真實 Sheets 未測 |
| 模型／API 變更 | 受理與結果見 docs/submission-results-api.md；SSE／重連與 B 匯入接點見 docs/live-sync-api.md；沒有新 migration |
| 已完成 issues | #3 已經 PR #27 正式 review 並合併；#4／#5 與 #6 基礎 API 已經 PR #28 正式 review 並合併（a78412c） |
| 已合併的受理／排名 | [PR #29](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/29)，85fe739；Boyu00 核准最新 b41e6ae，37／37 測試通過 |
| 已合併同步／隱私 | [PR #31](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/31)，b9208d2，Boyu00 Approve；已採納測試競態建議並補到期邊界，76／76 通過 |
| 本批學生頁 | [PR #34](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/34)，codex/student-page：#12、tasks 5.4～5.6，87／87；docs/student-page.md 說明操作、恢復及 B #16 的結果入口 |
| 未完成／已知問題 | B #13～#19 與共同整合／真實 Sheets 驗收未完成；#6 完整頁面人工驗收仍待整合。使用者 2026-11-22 確認不提供僅靠組名的 Cookie 遺失／到期／登出接管 |
| B 確認 | 2026-11-22 [PR #34 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/34#pullrequestreview-6011416078)：B 依 README 以 Node 24.22.3 執行 npm ci --ignore-scripts、npm test 87／87 通過，並在真實 Chrome 走過學生流程；之後 B 的 #32、#36、#37 直接串接 A 的匯入、結果與即時同步 API。本列於 2026-11-26 補記，「未完成」列中的 B 項目後來由 #30～#40 完成。 |

## PR 與 review 證據

| 功能／tasks／issues | 作者 | PR 連結 | 審閱者與實質意見連結 | 驗證證據 |
| --- | --- | --- | --- | --- |
| 初始規劃 #1（非功能驗收） | a0972776282-tech | [PR #26](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/26) 已合併 | Boyu00 的具體建議，尚無正式 Approve review | OpenSpec strict validation |
| #3、tasks 2.1～2.3 骨架 | a0972776282-tech | [PR #27](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/27) 已合併，提交 b5dcda8 | [Boyu00 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/27#pullrequestreview-5992202981)，Node 24.22.3、11／11、可啟動 | docs/verification.md |
| #4／#5、#6 基礎控制 | a0972776282-tech | [PR #28](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/28) 已合併，a78412c；review 時最新提交 d3f5510；#6 保留開啟 | [Boyu00 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/28#pullrequestreview-5994013087) | 23 項回歸；docs/access-api.md |
| #7／#10、#11 排名核心、#6 有答案結束 | a0972776282-tech | [PR #29](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/29)，已合併 85fe739；核准 head b41e6ae | [Boyu00 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/29#pullrequestreview-6006195370)，Node 24.22.3、37／37；另有五點不擋合併建議 | docs/submission-results-api.md；tasks 4.1～4.4、5.1～5.3 |
| B #14 解析器 | Boyu00 | [PR #30](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/30)，核准 head 86d5df8；現已合併為 5db2bc0 並整合本批 | [A 要求修改](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/30#pullrequestreview-6005219096) 原格保留，修正後 [A 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/30#pullrequestreview-6006190177) | 解析分支 42／42；暫時整合 #29 後 56／56，隔離合併已撤銷；完整匯入仍待後續 |
| #8／#9 同步與隱私 | a0972776282-tech | [PR #31](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/31)，codex/live-sync-privacy，功能提交 4099452；已合併 b9208d2 | [Boyu00 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/31#pullrequestreview-6011096228)，核准 cff801f；建議等待教師端兩筆受理再計數，已採納；另外補到期計時器提前觸發的重新排程與測試 | review 修正後全套 76 項、SSE 13 項連跑三次全過；docs/live-sync-api.md；tasks 4.5～4.7 |
| #12 學生操作頁 | a0972776282-tech | [PR #34](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/34)，codex/student-page；已合併 e0034ae | [Boyu00 正式 Approve](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/34#pullrequestreview-6011416078)，核准 f51a6f2；Node 24.22.3，87／87、獨立瀏覽器 17／17；結果頁採用約定路徑 | 87／87；兩個 Chrome 工作階段鍵盤操作、隱私、刷新／結束，見 docs/student-page.md |
| B #14 匯入預覽與確認替換 | Boyu00 | [PR #32](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/32)，已合併 79f66f6 | [A 要求修改（正式 review）](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/32#pullrequestreview-6011119535)（舊讀取覆蓋新版預覽）；[A 複查留言：已修正、無新增修改要求](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/32#issuecomment-7076848404) | A 複查時重跑本分支 70／70；docs/import-api.md |
| B #13 服務帳戶與 Sheets 讀取 | Boyu00 | [PR #33](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/33)，已合併 72fbb3a | [A 要求修改（正式 review）](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/33#pullrequestreview-6011123772)（Google token 取得缺少逾時）；[A 複查留言：已修正](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/33#issuecomment-7076856653) | A 複查時重跑 88／88；docs/import-api.md |
| B #19 CSV 匯出 | Boyu00 | [PR #35](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/35)，已合併 dc2c70b | A 的實質意見與複查留言：[複查一](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/35#issuecomment-7076978072)、[P2 漏項修正後複查](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/35#issuecomment-7077216355)（留言形式，GitHub 上無 Approve 型態 review） | docs/csv-export.md；AC-20 Excel／Google 試算表人工核對 |
| B #16 結果頁 | Boyu00 | [PR #36](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/36)，已合併 a08359a | [A 要求修改（正式 review）](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/36#pullrequestreview-6022346115)；[複查](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/36#issuecomment-7103954402)、[同步 main 後複查](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/36#issuecomment-7104624184)（留言形式） | docs/results-page.md；`e2e:results` |
| B #15 教師控制台 | Boyu00 | [PR #37](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/37)，已合併 7f2b4f0 | [A 要求修改（正式 review）](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/37#pullrequestreview-6022386717)（舊 HTTP 快照覆蓋較新 SSE）；[複查](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/37#issuecomment-7104068556)、[同步 main 後複查](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/37#issuecomment-7104648696)（留言形式） | docs/teacher-page.md；`e2e:teacher` |
| B #17 原 Sheets 寫回（後端） | Boyu00 | [PR #38](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/38)，已合併 ec298f5 | [A 要求修改（正式 review）](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/38#pullrequestreview-6022431196)（兩項 P2）；[複查](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/38#issuecomment-7104185007)、[同步 main 後複查](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/38#issuecomment-7104680883)（留言形式） | docs/writeback.md；真實 Sheets 驗證 |
| #20 1 師／10 組／20 題整合驗證 | Boyu00 | [PR #39](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/39)，已合併 9c42346 | [A 複查留言：無阻擋問題，可合併](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/39#issuecomment-7133198170)（留言形式） | docs/verification.md |
| B #18 教師頁寫回面板 | Boyu00 | [PR #40](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/40)，已合併 3642391 | [A 兩項 P2 意見（留言）](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/40#issuecomment-7162312176)；[修正後複查：無阻擋問題，可合併](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/40#issuecomment-7163881560)（留言形式） | A 重跑 npm test 207／207、教師頁 E2E 58／58（假 Sheets）；合併後 main 209／209，見 docs/verification.md |
| #21 人工驗收清單與紀錄 | Boyu00 | [PR #41](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/41)，已合併 55fc841 | [A 複查意見](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/41#issuecomment-7163882601)；[修正後複查：通過，沒有新增阻擋問題](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/41#issuecomment-7164804232)（留言形式） | docs/acceptance-checklist.md 第四節 |
| 全回歸與 tasks 勾選 | Boyu00 | [PR #42](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/42)，已合併 3147e59 | [A 複查意見](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/42#issuecomment-7164503520)；[修正後複查：可合併](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/42#issuecomment-7164805338)（留言形式） | A 以 Node v24.22.0 重跑 209／209、58／58、20／20 |
| A 端 AC-13／AC-18 補測與 AI 對話摘要 | a0972776282-tech | [PR #44](https://github.com/Boyu00/classroom-buzzer-system-openspec/pull/44)，已合併 5180933 | B 審查：機密掃描、review 連結以 GitHub API 核對、git diff --check（GitHub 的 Approve 送出時回傳錯誤，審查結論記在 #43 留言） | docs/manual-acceptance-member-a.md、docs/ai-conversation-member-a.md |

每人至少一筆由自己提出且已合併 PR，以及對另一人的實質 review：A 的 #27～#34 都經 Boyu00 正式 Approve；Boyu00 的 PR 中 A 以「要求修改」的正式 review 提出實質意見，修正後多以留言表示複查通過（#35～#42 在 GitHub 上沒有 Approve 型態的 review，這裡如實標示）。建立初始規劃 PR 可保留協作紀錄，但不代表功能 issues 已完成。

PR #29 五點建議追蹤：CLOSED 名單欄位需求依結果頁整合再確認；後端 questions 映射已在受理／結果 API 文件說明。相同時間戳目前以服務注入測試，尚無改變產品 HTTP 時鐘的需求。學生恢復方式在 #12 前確認。finalizeResults 的逐筆答案數量查詢目前通過本機目標，後續負載測試若發現瓶頸再合併查詢。

## 跨小組討論（待真實討論後填）

2026-11-20 使用者已在本組確認採用 PR #26 的三項建議：單一未結束活動、六碼指定字元加入碼、trim 後 1～30 Unicode 字元組名；已同步 spec v1.2 與本組 artifacts。這不是與 SpecKit 小組的討論證據，以下跨組紀錄仍待真實完成。

| 日期 | 參與者 | 討論事項 | 結論及規格版本 | 證據 |
| --- | --- | --- | --- | --- |
| 尚未紀錄 | — | — | — | — |

## AI 使用與交付

AI 對話整理（節錄，非逐字稿，已移除機密）：[member A](ai-conversation-member-a.md)（PR #44）、[member B](ai-conversation-member-b.md)（PR #43）。保留實際 AI 對話、各自負責內容與檢查心得；分享或提交前移除機密。YouTube 影片、表單確認及心得待真實完成後填入，不能以 AI 產生文件取代實際參與。

2026-11-22 PR #34 合併前整合：main 已合併 #32（79f66f6）與 #33（72fbb3a）；解開 package.json／package-lock.json 衝突，同時保留 google-auth-library 11.3.4 與 devDependency linkedom 0.18.12，重裝後 119／119 通過。組員三項非阻擋建議（統一原生空欄位提示、本地時間顯示、顯式處理非 JSON 錯誤）留作後續介面改善，本次不變更已 review 的產品程式。
