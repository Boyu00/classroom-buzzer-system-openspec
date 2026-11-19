import { loadConfig } from '../config.js';
import { openDatabase } from './database.js';

try {
  const db = openDatabase(loadConfig().databasePath);
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  db.close();
  console.log(`資料庫 migration 已完成，共 ${versions.length} 版。`);
} catch {
  console.error('Migration 失敗，請檢查資料庫權限與 migration 檔案；請勿刪除既有資料庫。');
  process.exitCode = 1;
}
