import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAsyncFunction } from 'node:util/types';

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));

// 同步回呼內不能做網路呼叫或 await；外部 API 必須在交易前後執行。
export function transaction(db, work) {
  if (isAsyncFunction(work)) throw new TypeError('SQLite 交易回呼必須同步。');
  if (db.isTransaction) throw new Error('不允許巢狀交易。');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work(db);
    if (result && typeof result.then === 'function') {
      throw new TypeError('SQLite 交易回呼不能回傳 Promise。');
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export function migrate(db, directory = migrationsDirectory) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
  ) STRICT`);
  const files = readdirSync(directory).filter((name) => /^\d+_[\w-]+\.sql$/.test(name)).sort();
  const applied = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
  for (const record of applied) {
    if (!files.includes(record.version)) throw new Error(`缺少已套用的 migration：${record.version}`);
  }
  for (const filename of files) {
    const sql = readFileSync(join(directory, filename), 'utf8').replace(/\r\n/g, '\n');
    const checksum = createHash('sha256').update(sql).digest('hex');
    transaction(db, () => {
      const existing = db.prepare('SELECT checksum FROM schema_migrations WHERE version = ?').get(filename);
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`已套用的 migration 不可修改：${filename}`);
        return;
      }
      if (applied.some((record) => record.version > filename)) {
        throw new Error(`不能插入舊版本 migration：${filename}`);
      }
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(filename, checksum, new Date().toISOString());
    });
  }
}

export function openDatabase(filename, { directory = migrationsDirectory } = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename, { timeout: 5000, enableForeignKeyConstraints: true });
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    migrate(db, directory);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
