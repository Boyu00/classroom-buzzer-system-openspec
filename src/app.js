import express from 'express';
import { join } from 'node:path';
import { projectRoot } from './config.js';

export function createApp({ store }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    store.read((db) => db.prepare('SELECT 1').get());
    res.json({ data: { status: 'ok', stage: 'foundation', database: 'ok' } });
  });

  // 只公開 public，不能透過靜態路徑取得 SQLite、.env 或 repository 文件。
  app.use(express.static(join(projectRoot, 'public'), { dotfiles: 'deny' }));
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '找不到此頁面或功能尚未實作。' } });
  });
  app.use((error, _req, res, _next) => {
    const invalidJson = error.type === 'entity.parse.failed';
    const tooLarge = error.type === 'entity.too.large';
    res.status(invalidJson ? 400 : tooLarge ? 413 : 500).json({
      error: {
        code: invalidJson ? 'INVALID_JSON' : tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR',
        message: invalidJson ? 'JSON 格式錯誤。' : tooLarge ? '請求內容過大。' : '伺服器暫時無法處理請求。',
      },
    });
  });
  return app;
}
