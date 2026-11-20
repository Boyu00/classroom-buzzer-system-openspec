import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

export function temporaryDatabase(t) {
  const directory = mkdtempSync(join(tmpdir(), 'classroom-buzzer-test-'));
  t.after(() => removeTestDirectory(directory));
  return join(directory, 'test.sqlite3');
}

export function removeTestDirectory(directory) {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('classroom-')) {
    throw new Error('拒絕清理測試暫存根目錄以外的路徑。');
  }
  rmSync(target, { recursive: true, force: true });
}

// 此資料只供自動測試使用，產品沒有種子匯入或假 Sheets 成功端點。
export function seedActivity(db) {
  const now = '2026-11-20T00:00:00.000Z';
  db.prepare(`INSERT INTO sessions (session_id, token_hash, csrf_hash, role, created_at, expires_at)
    VALUES ('teacher', 'test-token-hash', 'test-csrf-hash', 'TEACHER', ?, ?)`).run(now, '2027-01-01T00:00:00.000Z');
  db.prepare(`INSERT INTO activities (activity_id, join_code, teacher_session_id, created_at)
    VALUES ('activity', 'TESTCODE', 'teacher', ?)`).run(now);
  for (const id of ['a', 'b']) {
    db.prepare('INSERT INTO groups VALUES (?, ?, ?, ?)').run(id, 'activity', `測試組 ${id}`, now);
  }
  db.prepare("INSERT INTO units VALUES ('activity', 'unit', 'SINGLE', 0)").run();
  db.prepare(`INSERT INTO questions VALUES ('activity', 'unit', '4', 0, 'test-sheet', 17, 8, 3, '{{Q:4}}', 'test-structure')`).run();
}

export function insertSubmission(db, id, group, order) {
  db.prepare('INSERT INTO submissions VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'activity', 'unit', group, '2026-11-20T00:00:00.000Z', order);
}
