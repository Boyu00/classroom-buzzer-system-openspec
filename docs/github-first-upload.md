# 第一次把文件放上 GitHub

本教學適用既有 repository `Boyu00/classroom-buzzer-system-openspec`，使用瀏覽器操作。目的是先送出可供另一位 review 的規劃 PR；不會在本階段上傳產品程式。若 repository 現在已出現別人的新檔案，先確認差異，再上傳，避免覆蓋對方工作。

## 1. 登入並確認權限

開啟 [專案 Code 頁](https://github.com/Boyu00/classroom-buzzer-system-openspec)，登入你自己的 GitHub 帳號。每人使用自己的帳號保留貢獻。如果只有讀取權限，請 repository 擁有者在 Settings 的 Collaborators／存取管理處邀請你的帳號，接受邀請後繼續；不要共用帳號。

## 2. 若仍是空 repository，先建立 main 基底

空 repository 沒有 main 的提交，先做一次最小初始化，之後才能比較 branch 並開 PR。若已看到 main 和檔案列表，跳過本步。

1. 在 Quick setup 區找 `creating a new file`，點進去。
2. 檔名輸入 `README.md`，內容先填：

   ```markdown
   # 課堂搶答系統 — OpenSpec 組

   初始 repository；完整規劃文件將透過 PR 加入。
   ```

3. 點 `Commit changes…`，提交訊息填 `chore: initialize repository`，完成首次提交；預設分支應為 main。

這個提交只建立基底，不算功能 PR，也不代表完成 issue #1。此後的正式文件與功能皆走 branch／PR。

## 3. 準備要上傳的內容

本機工作目錄：`D:\桌面\python\classroom-buzzer-system-openspec`。檔案已直接放在這裡；也可用提供的 ZIP 解壓縮到另一個空資料夾，得到相同上傳結構。

只選以下檔案與資料夾內容：

```text
README.md
spec.md
.gitignore
.github/
  pull_request_template.md
docs/
  collaboration.md
  verification.md
  github-first-upload.md
openspec/
  config.yaml
  changes/
    build-classroom-buzzer/
      .openspec.yaml
      proposal.md
      design.md
      tasks.md
      specs/
        activity-sessions/spec.md
        sheets-import/spec.md
        answer-submission/spec.md
        result-ranking/spec.md
        result-export/spec.md
```

把上述「內容」上傳到 repository 根目錄。不要把最外層 `classroom-buzzer-system-openspec` 資料夾一起包進去；根目錄應直接看到 README.md、spec.md、docs、openspec。ZIP 先解壓縮，不要只把 ZIP 檔放上 GitHub。

`.gitignore`、`.github` 和 `.openspec.yaml` 前面的點是名稱的一部分，不能刪掉。若拖曳時漏了這些檔案，可再用 `choose your files` 選取，或以 `Add file → Create new file` 按正確完整路徑建立並貼上本機內容。`.openspec.yaml` 是 change 的 metadata，必須保留。

不要上傳金鑰、密碼、資料庫、session、node_modules 或整份未整理的 AI 對話；手動網頁上傳不會替你套用本機 .gitignore。

## 4. 上傳並建立文件 branch

1. 在 repository 的 Code 頁點 `Add file → Upload files`。
2. 將第 3 步的檔案與資料夾內容拖進上傳區，等檔案清單出現。若 README 已有暫存版本，這次以完整 README 更新它。
3. 檢查清單：根目錄 README、spec；下層有 `openspec/changes/build-classroom-buzzer/.openspec.yaml` 和五份能力 spec。
4. 提交訊息填 `docs: add initial OpenSpec proposal and member tasks`。
5. 在提交選項選 `Create a new branch for this commit and start a pull request`，branch 名稱填 `docs/initial-openspec`，再點 `Propose changes`。若頁面先要求建立／選 branch，也可先由分支選單建立同名 branch，再上傳至該 branch。

若看不到上傳按鈕、要求 fork 或無法選新 branch，先確認你是否已接受 collaborator 邀請。不要按不理解的覆蓋或強制操作。

## 5. 建立 Pull Request

PR 是請另一位檢查後，將你的 branch 合併回 main 的請求。在比較畫面確認 base 是 `main`，compare 是 `docs/initial-openspec`。未自動跳出比較畫面時，可在 Pull requests 頁按 New pull request 選這兩個分支。

標題：`docs: 建立 OpenSpec 初始規劃與兩人分工`

說明可貼：

```markdown
## 目的
保留既有產品需求，將開發方法調整為 OpenSpec，建立完整提案及對應 issues 的 A／B 任務。

## 內容
- 根目錄產品規格、README、Git 排除規則。
- build-classroom-buzzer 的 proposal、design、五份能力 spec 與 tasks。
- member A #3～#12、member B #13～#19 的分工與交接說明。
- 待填的人工驗收紀錄與 GitHub 上傳教學。

## 驗證
openspec validate build-classroom-buzzer --strict 通過。
目前只有規劃文件，產品尚未實作，所有實作 tasks 未完成。

## 對應 issue
Refs #1
本 PR 未宣稱跨小組對齊已完成，不自動關閉 issue #1。

## 請 review
確認產品需求、分工、資料模型、API 與交接條件是否適合接續實作。
```

按 `Create pull request`。若是 draft，待準備好審查時改成 Ready for review。

## 6. 請另一位 review，再合併

在 PR 的 Reviewers 選另一位組員。對方使用自己的帳號查看 Files changed，對具體需求或設計留下意見，處理完成後提交 review；不能只補一句空泛的「看過了」代替檢閱。

確認另一位 review、問題已處理後，再由有權限者按 Merge pull request 或選定的合併方式並確認。完成後 main 應直接看到完整資料夾結構，issues 與任務狀態仍依真實完成條件更新。

## 7. 之後 member A 怎麼開始

下一個功能從最新 main 建立功能 branch，例如 `feat/project-foundation`，先處理 #3。文件 PR 合併後，可在 Codex 要求「依既有 change，只實作 member A 的 #3 並驗證，先不做其他 issues」。本次檔案尚無 package.json，現在不要執行 npm start。

網頁上傳不會自動把本機目錄變成 Git repository。開始實作前，讓 Codex 或 GitHub Desktop 將本機連上同一個遠端並同步最新 main，避免反覆整包上傳。未來仍由各自帳號保留 branch／PR／review。

## 參考

- [GitHub 官方：上傳檔案](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
- [GitHub 官方：Review PR](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)
