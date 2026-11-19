import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(env = process.env) {
  const portText = env.PORT ?? '3000';
  if (!/^\d+$/.test(portText) || Number(portText) > 65535) {
    throw new Error('PORT 必須是 0 到 65535 的整數。');
  }
  if (env.DATABASE_PATH !== undefined && !env.DATABASE_PATH.trim()) {
    throw new Error('DATABASE_PATH 不可為空白。');
  }
  return {
    // 不接受環境變數覆寫為公開網路介面。
    host: '127.0.0.1',
    port: Number(portText),
    databasePath: resolve(projectRoot, env.DATABASE_PATH ?? 'data/classroom.sqlite3'),
  };
}
