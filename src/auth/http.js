import { Router } from 'express';
import { createAuthService, readCookie, SESSION_COOKIE } from './service.js';
import { HttpError } from '../http-error.js';

function validateHost(req) {
  const port = req.socket.localPort;
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...(port === 80 ? ['127.0.0.1', 'localhost'] : [])]);
  if (!hosts.has(req.headers.host)) throw new HttpError(403, 'ORIGIN_REJECTED', '請使用本機服務網址。');
}

export function createAuthHttp(store) {
  const auth = createAuthService(store);
  const router = Router();
  function cookie(req) { return readCookie(req.headers.cookie); }
  function send(res, result) {
    if (result.cookie) {
      res.cookie(SESSION_COOKIE, result.cookie.token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: result.cookie.maxAge });
    }
    res.json({ data: { ...result.data, ...(result.cookie ? { csrfToken: result.cookie.csrfToken } : {}) } });
  }
  function guard(req, res, next) {
    validateHost(req);
    res.set('Cache-Control', 'no-store');
    req.sessionToken = cookie(req);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, 'ORIGIN_REJECTED', '來源驗證失敗。');
      auth.checkCsrf(req.sessionToken, req.get('X-CSRF-Token'));
    }
    next();
  }
  function teacherOnly(req, _res, next) {
    auth.requireTeacher(req.sessionToken);
    next();
  }
  router.get('/session', async (req, res) => send(res, await auth.getSession(req.sessionToken)));
  router.post('/teacher/setup', async (req, res) => send(res, await auth.setup(req.sessionToken, req.body?.password)));
  router.post('/teacher/login', async (req, res) => send(res, await auth.login(req.sessionToken, req.body?.password)));
  router.post('/logout', async (req, res) => send(res, await auth.logout(req.sessionToken)));
  // 共用命名空間的未來教師路由也必須先驗證；尚未實作者仍回 404，不回報假成功。
  router.use('/teacher', teacherOnly);
  router.post('/activities', teacherOnly);
  router.use('/activities/:id', (req, res, next) => {
    const teacherPath = /^\/(?:mode|open|close|import(?:\/|$)|export(?:\/|$)|exports(?:\/|$)|results\.csv$)/;
    if (teacherPath.test(req.path)) return teacherOnly(req, res, next);
    next();
  });
  return { auth, guard, router, teacherOnly, send };
}
