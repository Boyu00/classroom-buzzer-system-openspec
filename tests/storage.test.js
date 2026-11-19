import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, transaction } from '../src/storage/database.js';
import { openStore } from '../src/storage/store.js';
import { createWriteCoordinator } from '../src/storage/write-coordinator.js';
import { temporaryDatabase, removeTestDirectory, seedActivity, insertSubmission } from './helpers.js';

test('migration 可重跑，重新開啟保留資料、原題號與來源映射', (t) => {
  const path = temporaryDatabase(t);
  let db = openDatabase(path);
  try {
    transaction(db, seedActivity);
  } finally {
    db.close();
  }
  db = openDatabase(path);
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 1);
    const question = db.prepare('SELECT * FROM questions').get();
    assert.equal(question.question_id, '4');
    assert.equal(question.sheet_id, 17);
    assert.equal(question.row_index, 8);
    assert.equal(question.column_index, 3);
    assert.equal(question.original_marker, '{{Q:4}}');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('相同組別單位及同活動受理序號不可重複', (t) => {
  let db;
  t.after(() => db?.close());
  db = openDatabase(temporaryDatabase(t));
  transaction(db, seedActivity);
  insertSubmission(db, 's1', 'a', 1);
  assert.throws(() => insertSubmission(db, 's2', 'a', 2), /UNIQUE constraint failed/);
  assert.throws(() => insertSubmission(db, 's3', 'b', 1), /UNIQUE constraint failed/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM submissions').get().n, 1);
});

test('答案不能參照其他單位題目或不存在的組別', (t) => {
  let db;
  t.after(() => db?.close());
  db = openDatabase(temporaryDatabase(t));
  transaction(db, seedActivity);
  insertSubmission(db, 's1', 'a', 1);
  db.prepare("INSERT INTO units VALUES ('activity', 'other', 'SINGLE', 1)").run();
  db.prepare("INSERT INTO questions VALUES ('activity', 'other', '9', 0, 'test-sheet', 17, 9, 3, '{{Q:9}}', 'test-structure')").run();
  assert.throws(() => db.prepare("INSERT INTO submission_answers VALUES ('s1', 'activity', 'unit', '9', '錯誤對應')").run(), /FOREIGN KEY/);
  assert.throws(() => insertSubmission(db, 's2', 'unknown', 2), /FOREIGN KEY/);
});

test('失敗交易完整回滾答案與序號，後續交易仍可成功', (t) => {
  let db;
  t.after(() => db?.close());
  db = openDatabase(temporaryDatabase(t));
  transaction(db, seedActivity);
  assert.throws(() => transaction(db, () => {
    insertSubmission(db, 's1', 'a', 1);
    db.prepare("INSERT INTO submission_answers VALUES ('s1', 'activity', 'unit', '4', '第一行\n第二行')").run();
    db.exec("UPDATE activities SET next_accepted_order = 2 WHERE activity_id = 'activity'");
    throw new Error('測試中途故障');
  }), /測試中途故障/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM submissions').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM submission_answers').get().n, 0);
  assert.equal(db.prepare('SELECT next_accepted_order FROM activities').get().next_accepted_order, 1);
  transaction(db, () => insertSubmission(db, 's2', 'a', 1));
  assert.equal(db.prepare('SELECT count(*) AS n FROM submissions').get().n, 1);
});

test('交易禁止非同步與巢狀回呼', (t) => {
  let db;
  t.after(() => db?.close());
  db = openDatabase(temporaryDatabase(t));
  let invoked = false;
  assert.throws(() => transaction(db, async () => { invoked = true; }), /必須同步/);
  assert.equal(invoked, false);
  assert.throws(() => transaction(db, () => Promise.resolve()), /Promise/);
  assert.throws(() => transaction(db, () => transaction(db, () => {})), /巢狀/);
  assert.equal(db.isTransaction, false);
});

test('已套用的 migration 被修改時拒絕啟動並保留資料', (t) => {
  const path = temporaryDatabase(t);
  const directory = mkdtempSync(join(tmpdir(), 'classroom-migration-test-'));
  t.after(() => removeTestDirectory(directory));
  const migrationPath = join(directory, '001_initial.sql');
  const sql = readFileSync(new URL('../src/storage/migrations/001_initial.sql', import.meta.url), 'utf8');
  writeFileSync(migrationPath, sql);
  const db = openDatabase(path, { directory });
  transaction(db, seedActivity);
  db.close();
  writeFileSync(migrationPath, sql + '\n-- 已修改\n');
  assert.throws(() => openDatabase(path, { directory }), /不可修改/);
  writeFileSync(migrationPath, sql);
  const reopened = openDatabase(path, { directory });
  assert.equal(reopened.prepare('SELECT count(*) AS n FROM activities').get().n, 1);
  reopened.close();
});

test('migration 中途失敗不留下部分資料表或成功紀錄', (t) => {
  const path = temporaryDatabase(t);
  const directory = mkdtempSync(join(tmpdir(), 'classroom-migration-failure-'));
  t.after(() => removeTestDirectory(directory));
  const file = join(directory, '001_example.sql');
  writeFileSync(file, 'CREATE TABLE example(value TEXT); INVALID SQL;');
  assert.throws(() => openDatabase(path, { directory }));
  writeFileSync(file, 'CREATE TABLE example(value TEXT);');
  const db = openDatabase(path, { directory });
  assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 1);
  db.close();
});

test('相同活動順序執行，失敗不阻塞，關閉等待所有已排工作', async () => {
  const coordinator = createWriteCoordinator();
  const events = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = coordinator.run('activity', async () => {
    events.push('first-start');
    await gate;
    events.push('first-end');
    throw new Error('first failed');
  });
  const rejected = assert.rejects(first, /first failed/);
  const second = coordinator.run('activity', () => events.push('second'));
  const closing = coordinator.close();
  await assert.rejects(coordinator.run('activity', () => {}), /關閉/);
  await Promise.resolve();
  assert.deepEqual(events, ['first-start']);
  release();
  await Promise.all([rejected, second, closing]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second']);
});

test('store 共用寫入入口可回滾並持久保存後續資料', async (t) => {
  const path = temporaryDatabase(t);
  const store = openStore(path);
  await store.write('activity', seedActivity);
  await assert.rejects(store.write('activity', (db) => {
    insertSubmission(db, 'failed', 'a', 1);
    throw new Error('write failed');
  }), /write failed/);
  await store.write('activity', (db) => insertSubmission(db, 'saved', 'a', 1));
  await store.close();
  assert.throws(() => store.read(() => {}), /關閉/);
  const reopened = openStore(path);
  try {
    assert.equal(reopened.read((db) => db.prepare('SELECT submission_id FROM submissions').get().submission_id), 'saved');
  } finally {
    await reopened.close();
  }
});
