import express from 'express';
import { join } from 'node:path';
import { projectRoot } from './config.js';
import { createAuthHttp } from './auth/http.js';
import { HttpError } from './http-error.js';
import { createActivityHttp } from './activities/http.js';
import { createEventHttp } from './events/http.js';
import { createImportHttp } from './import/http.js';
import { createExportHttp } from './export/http.js';

export function createApp({ store, sheetsGateway }) {
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
  const access = createAuthHttp(store);
  app.use('/api', access.guard);
  app.use('/api', access.router);
  app.use('/api', createActivityHttp(store, access));
  const events = createEventHttp(store, access);
  app.use('/api', events.router);
  app.locals.closeEvents = () => events.close();
  app.use('/api', createImportHttp(store, access, sheetsGateway));
  app.use('/api', createExportHttp(store, access));

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
    const known = error instanceof HttpError;
    res.status(known ? error.status : invalidJson ? 400 : tooLarge ? 413 : 500).json({
      error: {
        code: known ? error.code : invalidJson ? 'INVALID_JSON' : tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR',
        ...(known && error.details !== undefined ? { details: error.details } : {}),
        message: known ? error.message : invalidJson ? 'JSON 格式錯誤。' : tooLarge ? '請求內容過大。' : '伺服器暫時無法處理請求。',
      },
    });
  });
  return app;
}
