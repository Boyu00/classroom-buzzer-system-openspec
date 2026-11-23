-- 寫回原 Sheets 時需要重驗「匯入當下選取的工作表與順序」；結構指紋涵蓋所有選取的工作表，
-- 包含沒有任何題目的工作表，單靠 questions 無法還原。每個活動一筆，隨確認匯入一起替換。
CREATE TABLE import_sources (
  activity_id TEXT PRIMARY KEY REFERENCES activities(activity_id),
  spreadsheet_id TEXT NOT NULL,
  sheet_ids_json TEXT NOT NULL CHECK (json_valid(sheet_ids_json))
) STRICT;
