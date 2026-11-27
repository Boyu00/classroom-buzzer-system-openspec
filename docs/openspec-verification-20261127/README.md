# OpenSpec Verify 與 Sync（Archive 待 Demo）

日期：2026-11-27，Asia/Taipei。來源 main **bd498d1540aec6014d691f3f02f8afe940f05d4e**，change **build-classroom-buzzer**，schema **spec-driven**。本次是逐項追溯檢查及主規格同步，不是執行不存在的 openspec verify 命令，也不把 strict 格式檢查當成全部產品驗收。

## 結論

- FR-01～FR-10、AC-01～AC-26 均有實作及既有通過證據，未發現新的產品功能缺口；各項仍保留人工、Console／API、fixture與自動證據的區別。
- 7c3a9b9 的最終回歸為222／222、教師58／58、結果20／20、退出13／13；已隨PR47合併。bd498d1只加入該報告與文件，產品程式及測試未變，所以本輪不重跑相同全套測試，也不虛報新通過次數。[原始輸出](../final-regression-20261127/README.md)
- 五項能力首次同步到 openspec/specs，29項需求、36個情境。Purpose原文及各需求／情境內容完整保留，主規格無delta操作標頭。[同步比對](spec-sync.json)
- 已實際核對跨組issue32、兩位成員的已合併PR／實質review、兩份AI摘要。tasks 1.2與9.3補記完成。
- **不能宣稱整個issue22完成或已Archive**：使用者明確回覆Demo尚未完成。tasks9.4／9.5仍未勾，DC-03／05／06的交付缺口如實列出，change維持active；沒有搬移、刪除或重新命名change。

## 功能需求追溯

| 需求 | 實作位置 | 測試與驗收 | 判定 |
| --- | --- | --- | --- |
| FR-01 角色、組別、工作階段、準備中退出 | [src/auth/service.js](../../src/auth/service.js)、[src/activities/service.js](../../src/activities/service.js)、[src/events/http.js](../../src/events/http.js)、[public/student-page.js](../../public/student-page.js) | [tests/auth.test.js](../../tests/auth.test.js)、[tests/activities.test.js](../../tests/activities.test.js)、[tests/student-leave.test.js](../../tests/student-leave.test.js)；AC-04、AC-08、AC-15、AC-16、AC-24、AC-25 | 已有實作與證據 |
| FR-02 直接線上匯入、標記、動態位置及預覽 | [src/sheets/gateway.js](../../src/sheets/gateway.js)、[src/import/parser.js](../../src/import/parser.js)、[src/import/service.js](../../src/import/service.js) | [tests/sheets-gateway.test.js](../../tests/sheets-gateway.test.js)、[tests/import-parser.test.js](../../tests/import-parser.test.js)、[tests/import-service.test.js](../../tests/import-service.test.js)；AC-01、AC-02、AC-03、AC-17 | 已有實作與證據 |
| FR-03 狀態控制、SSE、斷線與快照 | [src/activities/service.js](../../src/activities/service.js)、[src/events/http.js](../../src/events/http.js)、[public/activity-stream.js](../../public/activity-stream.js)、[src/storage/store.js](../../src/storage/store.js) | [tests/events.test.js](../../tests/events.test.js)、[tests/activity-stream.test.js](../../tests/activity-stream.test.js)、[tests/integration-scale.test.js](../../tests/integration-scale.test.js)；AC-04、AC-10、AC-15、AC-23 | 已有實作與證據 |
| FR-04 合法送出、交易序號與去重 | [src/submissions/service.js](../../src/submissions/service.js)、[src/storage/write-coordinator.js](../../src/storage/write-coordinator.js) | [tests/submissions.test.js](../../tests/submissions.test.js)、[tests/student-page.test.js](../../tests/student-page.test.js)、[tests/integration-scale.test.js](../../tests/integration-scale.test.js)；AC-05、AC-06、AC-07、AC-08、AC-10 | 已有實作與證據 |
| FR-05 教師監看與後端學生隱私 | [src/activities/service.js](../../src/activities/service.js)、[src/submissions/read-model.js](../../src/submissions/read-model.js)、[src/events/http.js](../../src/events/http.js) | [tests/events.test.js](../../tests/events.test.js)、[tests/submissions.test.js](../../tests/submissions.test.js)、[tests/integration-scale.test.js](../../tests/integration-scale.test.js)；AC-09、AC-16 | 已有實作與證據 |
| FR-06 固定結果及師生結果頁 | [src/results/service.js](../../src/results/service.js)、[public/results/model.js](../../public/results/model.js)、[public/results/dom.js](../../public/results/dom.js) | [tests/results-page.test.js](../../tests/results-page.test.js)、[tests/submissions.test.js](../../tests/submissions.test.js)、[scripts/e2e-results.mjs](../../scripts/e2e-results.mjs)；AC-11、AC-15 | 已有實作與證據 |
| FR-07 原 Sheets RAW 寫回、衝突、紀錄與重試 | [src/writeback/service.js](../../src/writeback/service.js)、[src/sheets/gateway.js](../../src/sheets/gateway.js)、[public/teacher/export-controller.js](../../public/teacher/export-controller.js) | [tests/writeback.test.js](../../tests/writeback.test.js)、[tests/teacher-export.test.js](../../tests/teacher-export.test.js)、[tests/sheets-gateway.test.js](../../tests/sheets-gateway.test.js)；AC-12、AC-13、AC-14、AC-17 | 已有實作與證據 |
| FR-08 題組掃描與完整原子受理 | [src/import/parser.js](../../src/import/parser.js)、[src/submissions/service.js](../../src/submissions/service.js) | [tests/import-parser.test.js](../../tests/import-parser.test.js)、[tests/submissions.test.js](../../tests/submissions.test.js)；AC-17、AC-18 | 已有實作與證據 |
| FR-09 固定十欄 CSV、可讀 unit_id 及公式防護 | [src/export/csv.js](../../src/export/csv.js)、[src/export/http.js](../../src/export/http.js) | [tests/csv.test.js](../../tests/csv.test.js)、[tests/integration-scale.test.js](../../tests/integration-scale.test.js)；AC-19、AC-20、AC-26 | 已有實作與證據 |
| FR-10 SPEED／FAIR 固定排名 | [src/results/service.js](../../src/results/service.js)、[src/activities/service.js](../../src/activities/service.js) | [tests/submissions.test.js](../../tests/submissions.test.js)、[tests/integration-scale.test.js](../../tests/integration-scale.test.js)；AC-05、AC-21、AC-22、AC-23 | 已有實作與證據 |

## 驗收項目與證據類型

以下為依既有證據的accepted判定，不是26項都以人工操作。AC-06／10已由兩人確認採自動，AC-13之A補測是五種預覽及一次實際write前重查，AC-18包含使用者Console啟動的API，AC-25沒有新截圖。不得擴大解讀成每個安全／競態分支皆人工驗過。

| 項目 | 實際證據方式 | 證據入口 |
| --- | --- | --- |
| AC-01 直接 API 匯入真實表 | 人工＋gateway／匯入測試 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-02 不同格位與非連續題號 | 人工＋解析／寫回測試 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-03 零題、壞標記、授權與斷網 | 人工＋解析／gateway 測試 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-04 準備／開啟邊界與2秒同步 | 人工＋開啟後新組 API＋整合測試 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-05 速度各題分別勝出 | 人工 SPEED CSV＋受理測試 | [docs/evidence/member-a/README.md](../../docs/evidence/member-a/README.md) |
| AC-06 同題並行與相同時間戳 | 雙方同意採自動；不標人工 | [docs/final-regression-20261127/npm-test.txt](../../docs/final-regression-20261127/npm-test.txt) |
| AC-07 重送去重與原答案不變 | 人工＋submissions／學生頁測試 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-08 空白、超長、偽造組別 | 人工 UI／API＋後端測試 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-09 OPEN 學生 API／SSE 隱私 | 人工／API＋events／整合測試 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-10 close／submit 競態 | 雙方同意採自動，兩種排程與回滾 | [docs/final-regression-20261127/npm-test.txt](../../docs/final-regression-20261127/npm-test.txt) |
| AC-11 固定完整結果與無人作答 | 人工＋結果頁20項瀏覽器測試 | [docs/final-regression-20261127/results-browser.txt](../../docs/final-regression-20261127/results-browser.txt) |
| AC-12 原 Sheets 中文／換行／公式純文字 | 真實 Sheets 既有人工／腳本＋writeback 測試 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-13 改格位或結構時停止 | B三種人工；A五次預覽＋一次write前重查；其餘自動 | [docs/manual-acceptance-member-a.md](../../docs/manual-acceptance-member-a.md) |
| AC-14 權限、逾時、重試及不重寫異值 | 人工權限與重試；未知結果／部分失敗採腳本／自動 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-15 刷新、重連及伺服器重啟 | 人工＋持久化／SSE／學生頁測試 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-16 越權拒絕與腳本純文字 | 人工／API＋auth／DOM／瀏覽器測試，非所有攻擊安全稽核 | [docs/evidence/member-a/README.md](../../docs/evidence/member-a/README.md) |
| AC-17 兩單題＋分散三題題組 | 真實改格位表人工／腳本＋解析／寫回測試 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-18 題組恰好送齊、交易不部分受理 | 正常UI＋使用者Console啟動7種API＋自動回滾 | [docs/manual-acceptance-member-a.md](../../docs/manual-acceptance-member-a.md) |
| AC-19 CSV十欄、轉義與無人作答 | 人工 Excel＋四份原始CSV＋csv測試 | [docs/evidence/member-a/README.md](../../docs/evidence/member-a/README.md) |
| AC-20 CSV公式防護 | 11/23 Excel／Sheets人工與後續特殊文字CSV＋自動 | [docs/csv-export.md](../../docs/csv-export.md) |
| AC-21 公平模式鼓勵較少勝出組 | 人工 FAIR CSV＋整合測試 | [docs/evidence/member-a/README.md](../../docs/evidence/member-a/README.md) |
| AC-22 同勝次／題組／無人作答／重啟 | 人工＋API＋排名及整合測試 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-23 模式鎖定與各輸出一致 | 人工／Console＋SPEED／FAIR整合 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-24 一活動、六碼、trim組名邊界 | 人工＋活動／auth／唯一索引自動測試 | [docs/acceptance-checklist.md](../../docs/acceptance-checklist.md) |
| AC-25 本人準備中退出與階段／權限／競態 | 11/27 使用者回報；真實瀏覽器13項及後端故障／競態自動 | [docs/cross-group-alignment.md](../../docs/cross-group-alignment.md) |
| AC-26 CSV Q:／G: 與原API不變 | 11/27 原始CSV實檔＋保存標記／壞映射HTTP自動 | [docs/cross-group-alignment.md](../../docs/cross-group-alignment.md) |

## 流程與交付 DC

| 項目 | 狀態 | 判定與限制 | 證據 |
| --- | --- | --- | --- |
| DC-01 | supported | 每人已合併PR及對另一人的實質review；API核對A的PR34／B的PR30及相對審閱者；不把PR35留言誤稱正式review。 | [docs/collaboration.md](../../docs/collaboration.md)、[docs/openspec-verification-20261127/collaboration-checks.json](../../docs/openspec-verification-20261127/collaboration-checks.json) |
| DC-02 | supported | 五能力可追溯規劃、實作與驗收；五能力主規格同步29需求／36情境，原change保留。 | [openspec/changes/build-classroom-buzzer/design.md](../../openspec/changes/build-classroom-buzzer/design.md)、[openspec/changes/build-classroom-buzzer/tasks.md](../../openspec/changes/build-classroom-buzzer/tasks.md)、[docs/verification.md](../../docs/verification.md) |
| DC-03 | pending | 完整OpenSpec流程，先完整驗證再封存；Explore／Propose／Apply及產品Verify已有證據，Sync完成；完整交付Verify及Archive尚未完成。 | [docs/openspec-verification-20261127/spec-sync.json](../../docs/openspec-verification-20261127/spec-sync.json) |
| DC-04 | supported-contract | 實際跨組產品規格決議與更新；已核對SpecKit issue32原始同意及本組決議；不宣稱重跑另一組系統或驗證其所有實作。 | [docs/collaboration.md](../../docs/collaboration.md)、[docs/openspec-verification-20261127/collaboration-checks.json](../../docs/openspec-verification-20261127/collaboration-checks.json) |
| DC-05 | partial | AI紀錄、分工、檢查與規格／程式／Demo一致；兩份摘要與實際測試／文件已查；摘要非逐字稿，Demo與個人方法心得交付尚待完成，不能把DC-05整項標完成。 | [docs/ai-conversation-member-a.md](../../docs/ai-conversation-member-a.md)、[docs/ai-conversation-member-b.md](../../docs/ai-conversation-member-b.md)、[docs/final-regression-20261127/README.md](../../docs/final-regression-20261127/README.md) |
| DC-06 | pending | 兩小組各一部≤5分鐘YouTube Demo；2026-11-27 使用者明確回覆尚未完成Demo；OpenSpec影片URL、長度與必要畫面未提供，另一組影片亦未核對。 | 待影片 |

完整機器可讀對照：[traceability.json](traceability.json)。跨組與協作API核對快照：[collaboration-checks.json](collaboration-checks.json)。日期、參與者及結論以真實原始留言為據，不因另一組同意規格就宣稱其程式已全部通過測試。

## Sync 與檢查

依本次status列出的五個delta路徑逐一建立主規格，套用specs instructions快照（zh-TW、無額外artifact rules），只套用ADDED內容，保留Purpose。每個新主規格使用 Specification／Purpose／Requirements／Requirement／Scenario 結構，與delta的需求本文逐字比較；再次執行sync應無差異。

檢查命令：openspec validate --specs --strict（五份主規格）、openspec validate build-classroom-buzzer --strict（change）、git diff --check，以及相對連結／Purpose與需求本文／證據雜湊比對。這些格式與一致性檢查不代替先前產品與真實Sheets驗收。

## 完成 issue22 的剩餘步驟

1. 完成OpenSpec組≤5分鐘YouTube Demo：教師與至少兩組學生、真實Sheets匯入及原格寫回；保存影片連結、長度與必要畫面時間點。大組另一部影片按DC-06另核對。
2. 補齊個人方法心得交付與Demo一致性檢查，更新DC-05／06與task9.4；核對完整前置條件後才勾9.5。
3. 重讀最新status／tasks及Sync差異，確認無未處理缺口，依archive流程封存並修正所有指向active change的相對連結。
4. 由另一位review實際Archive結果，合併後再關issue22。本PR僅Refs #22，不使用Closes #22提早關閉。
