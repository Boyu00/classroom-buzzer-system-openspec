import { Router } from 'express';
import { createActivityService } from './service.js';

export function createActivityHttp(store, access) {
  const service = createActivityService(store, access.auth);
  const router = Router();
  router.post('/activities', async (req, res) => access.send(res, await service.create(req.sessionToken, req.body?.mode)));
  router.post('/join', async (req, res) => access.send(res, await service.join(req.sessionToken, req.body?.joinCode, req.body?.groupName)));
  router.get('/activities/:id/snapshot', (req, res) => access.send(res, service.snapshot(req.sessionToken, req.params.id)));
  router.patch('/activities/:id/mode', async (req, res) => access.send(res, await service.setMode(req.sessionToken, req.params.id, req.body?.mode)));
  router.post('/activities/:id/open', async (req, res) => access.send(res, await service.open(req.sessionToken, req.params.id)));
  router.post('/activities/:id/close', async (req, res) => access.send(res, await service.close(req.sessionToken, req.params.id, req.body?.confirmed)));
  return router;
}
