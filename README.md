# 課堂搶答系統 — OpenSpec 組

以 Google Sheets Guided Notes 為題目來源的課堂搶答系統，支援老師、學生組別、單題／題組、速度／公平模式、線上原格寫回及 CSV。

**目前狀態：完成初始規劃文件，尚未實作應用程式。不能啟動或進行產品 Demo，也尚未完成線上 Sheets 授權與驗收。**

- [完整產品規格](spec.md)：產品需求保留原第一版內容，開發方法改用 OpenSpec。
- [提案](openspec/changes/build-classroom-buzzer/proposal.md)：目的與能力範圍。
- [設計與 A／B 介面](openspec/changes/build-classroom-buzzer/design.md)：模型、API、交易與整合設計。
- [實作任務](openspec/changes/build-classroom-buzzer/tasks.md)：對應既有 issues，所有實作均未完成。
- [分工與交接](docs/collaboration.md)、[驗收紀錄](docs/verification.md)。
- [第一次上傳 GitHub 教學](docs/github-first-upload.md)。

## 技術規劃

Node.js、Express、SQLite；前端 HTML／CSS／原生 JavaScript；HTTP API 與 SSE；Google 服務帳戶直接讀寫原雲端 Sheets；僅在 localhost 執行。套件與 lockfile 於實作 #3 建立後提供，現階段沒有 `npm start` 或產品測試命令。

Google 憑證放 repository 外，以環境變數提供路徑；不得提交憑證、密碼、session、本機資料庫或未移除機密的對話。`.gitignore` 是 Git 追蹤排除設定，瀏覽器手動上傳仍須自行確認選檔。

## OpenSpec 流程

本組採一個完整 change `build-classroom-buzzer`：Explore → Propose → 分階段 Apply → Verify → Sync → Archive。現有文件為待兩人 review 的提案，規劃完整不等於實作或驗收完成。各能力 spec 位於 change 的 `specs/` 下，尚未同步至 `openspec/specs/` 主規格。

已安裝 OpenSpec 的環境可檢查：

```powershell
openspec status --change build-classroom-buzzer
openspec validate build-classroom-buzzer --strict
```

以上僅檢查規劃狀態與規格格式，不會證明產品能運作。同步與歸檔等完整驗證後才執行。

## 兩人分工

| 負責人 | GitHub issues | 內容 |
| --- | --- | --- |
| member A（先實作） | #3～#12 | 骨架、教師驗證、活動、受理、SSE、隱私、題組送出、公平排序、學生頁 |
| member B（接續） | #13～#19 | Sheets 授權／匯入／映射、教師頁、結果頁、原格寫回／恢復、CSV |
| 共同 | #1～#2、#20～#25 | 規劃、跨組對齊、測試驗收、文件、Demo、繳交 |

[GitHub issues](https://github.com/Boyu00/classroom-buzzer-system-openspec/issues) 是協作追蹤依據。各自以自己的帳號開 branch、PR，由另一位實質 review。實作與驗證紀錄尚未建立，待完成後補上真實連結。

## 下一步

1. 將初始文件以 `docs/initial-openspec` branch 開 PR，兩人檢閱規格、分工與介面。
2. 合併後 member A 從最新 main 開自己的功能 branch，先做 #3，再依 tasks 依賴完成 #4～#12。
3. A 測試可用明確標示的 fixture；產品真實 Sheets 匯入由 B 完成，不能用 fixture 宣稱串接完成。
4. A 交接已驗證模型、API、結果服務與學生頁；B 完成 #13～#19，再共同真實驗收、錄影與繳交。
