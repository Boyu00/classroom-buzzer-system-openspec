CREATE TABLE activities (
  activity_id TEXT PRIMARY KEY,
  join_code TEXT NOT NULL UNIQUE,
  teacher_session_id TEXT NOT NULL REFERENCES sessions(session_id),
  mode TEXT NOT NULL DEFAULT 'SPEED' CHECK (mode IN ('SPEED', 'FAIR')),
  state TEXT NOT NULL DEFAULT 'PREPARING' CHECK (state IN ('PREPARING', 'OPEN', 'CLOSED')),
  next_accepted_order INTEGER NOT NULL DEFAULT 1 CHECK (next_accepted_order > 0),
  import_revision INTEGER NOT NULL DEFAULT 0 CHECK (import_revision >= 0),
  created_at TEXT NOT NULL,
  opened_at TEXT,
  closed_at TEXT
) STRICT;

CREATE TABLE groups (
  group_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(activity_id),
  group_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (activity_id, group_name),
  UNIQUE (activity_id, group_id)
) STRICT;

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ANONYMOUS', 'TEACHER', 'STUDENT')),
  activity_id TEXT REFERENCES activities(activity_id),
  group_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK ((role = 'STUDENT' AND activity_id IS NOT NULL AND group_id IS NOT NULL)
    OR (role IN ('ANONYMOUS', 'TEACHER') AND activity_id IS NULL AND group_id IS NULL)),
  FOREIGN KEY (activity_id, group_id) REFERENCES groups(activity_id, group_id)
) STRICT;

CREATE TABLE teacher_settings (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE units (
  activity_id TEXT NOT NULL REFERENCES activities(activity_id),
  unit_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('SINGLE', 'GROUP')),
  unit_order INTEGER NOT NULL CHECK (unit_order >= 0),
  PRIMARY KEY (activity_id, unit_id),
  UNIQUE (activity_id, unit_order)
) STRICT;

CREATE TABLE questions (
  activity_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_order INTEGER NOT NULL CHECK (question_order >= 0),
  spreadsheet_id TEXT NOT NULL,
  sheet_id INTEGER NOT NULL CHECK (sheet_id >= 0),
  row_index INTEGER NOT NULL CHECK (row_index >= 0),
  column_index INTEGER NOT NULL CHECK (column_index >= 0),
  original_marker TEXT NOT NULL,
  structure_fingerprint TEXT NOT NULL,
  PRIMARY KEY (activity_id, question_id),
  UNIQUE (activity_id, unit_id, question_id),
  UNIQUE (activity_id, unit_id, question_order),
  UNIQUE (activity_id, spreadsheet_id, sheet_id, row_index, column_index),
  FOREIGN KEY (activity_id, unit_id) REFERENCES units(activity_id, unit_id)
) STRICT;

CREATE TABLE submissions (
  submission_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  accepted_order INTEGER NOT NULL CHECK (accepted_order > 0),
  UNIQUE (activity_id, unit_id, group_id),
  UNIQUE (activity_id, accepted_order),
  UNIQUE (activity_id, unit_id, submission_id),
  FOREIGN KEY (activity_id, unit_id) REFERENCES units(activity_id, unit_id),
  FOREIGN KEY (activity_id, group_id) REFERENCES groups(activity_id, group_id)
) STRICT;

CREATE TABLE submission_answers (
  submission_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  PRIMARY KEY (submission_id, question_id),
  FOREIGN KEY (activity_id, unit_id, submission_id) REFERENCES submissions(activity_id, unit_id, submission_id),
  FOREIGN KEY (activity_id, unit_id, question_id) REFERENCES questions(activity_id, unit_id, question_id)
) STRICT;

CREATE TABLE results (
  activity_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank > 0),
  is_winner INTEGER NOT NULL CHECK (is_winner IN (0, 1)),
  PRIMARY KEY (activity_id, unit_id, submission_id),
  UNIQUE (activity_id, unit_id, rank),
  CHECK ((rank = 1 AND is_winner = 1) OR (rank > 1 AND is_winner = 0)),
  FOREIGN KEY (activity_id, unit_id, submission_id) REFERENCES submissions(activity_id, unit_id, submission_id)
) STRICT;

CREATE TABLE import_previews (
  preview_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  activity_id TEXT NOT NULL REFERENCES activities(activity_id),
  teacher_session_id TEXT NOT NULL REFERENCES sessions(session_id),
  import_revision INTEGER NOT NULL CHECK (import_revision >= 0),
  parsed_json TEXT NOT NULL CHECK (json_valid(parsed_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE TABLE exports (
  export_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(activity_id),
  status TEXT NOT NULL CHECK (status IN ('PREVIEW', 'WRITING', 'SUCCEEDED', 'FAILED', 'PENDING_VERIFICATION', 'CONFLICT')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (export_id, activity_id)
) STRICT;

CREATE TABLE export_items (
  export_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  spreadsheet_id TEXT NOT NULL,
  sheet_id INTEGER NOT NULL CHECK (sheet_id >= 0),
  row_index INTEGER NOT NULL CHECK (row_index >= 0),
  column_index INTEGER NOT NULL CHECK (column_index >= 0),
  expected_before TEXT NOT NULL,
  intended_answer TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'PENDING_VERIFICATION', 'CONFLICT')),
  verified_at TEXT,
  error_code TEXT,
  PRIMARY KEY (export_id, question_id),
  FOREIGN KEY (export_id, activity_id) REFERENCES exports(export_id, activity_id),
  FOREIGN KEY (activity_id, question_id) REFERENCES questions(activity_id, question_id)
) STRICT;

CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX submissions_unit_order ON submissions(activity_id, unit_id, accepted_order);
CREATE INDEX exports_activity ON exports(activity_id, created_at);
