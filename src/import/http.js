import { Router } from 'express';
import { createImportService } from './service.js';

// 教師限定由 auth/http.js 的 teacherPath（import／export 等路徑）先行檢查，服務層再檢查一次。
export function createImportHttp(store, access, gateway) {
  const service = createImportService(store, access.auth, gateway);
  const router = Router();
  router.post('/activities/:id/import/sheets', async (req, res) =>
    access.send(res, await service.listSheets(req.sessionToken, req.params.id, req.body)));
  router.post('/activities/:id/import/preview', async (req, res) =>
    access.send(res, await service.preview(req.sessionToken, req.params.id, req.body)));
  router.post('/activities/:id/import/confirm', async (req, res) =>
    access.send(res, await service.confirm(req.sessionToken, req.params.id, req.body?.previewToken)));
  return router;
}
