import { Router } from 'express';
import { createWritebackService } from './service.js';

// 教師限定由 auth/http.js 的 teacherPath（export／exports 路徑）先行檢查，服務層再檢查一次。
export function createWritebackHttp(store, access, gateway) {
  const service = createWritebackService(store, access.auth, gateway);
  const router = Router();
  router.post('/activities/:id/export/preview', async (req, res) =>
    access.send(res, await service.preview(req.sessionToken, req.params.id)));
  router.post('/activities/:id/export/write', async (req, res) =>
    access.send(res, await service.write(req.sessionToken, req.params.id, req.body)));
  router.get('/activities/:id/exports', (req, res) =>
    access.send(res, service.list(req.sessionToken, req.params.id)));
  router.get('/activities/:id/exports/:exportId', (req, res) =>
    access.send(res, service.get(req.sessionToken, req.params.id, req.params.exportId)));
  return router;
}
