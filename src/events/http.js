import { Router } from 'express';
import { createActivityService } from '../activities/service.js';
import { HttpError } from '../http-error.js';

const SESSION_ENDED = { error: { code: 'SESSION_ENDED', message: '工作階段已失效，請重新確認身分。' } };
const STREAM_ENDED = { error: { code: 'STREAM_ENDED', message: '同步暫時中斷，請重新連線。' } };

export function createEventHttp(store, access, { heartbeatMs = 15000 } = {}) {
  const router = Router();
  const activity = createActivityService(store, access.auth);
  const clients = new Set();
  let stopped = false;
  const frame = (event, value) => `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;

  router.get('/activities/:id/events', (req, res) => {
    if (stopped) throw new HttpError(503, 'STREAM_UNAVAILABLE', '同步服務正在關閉。');
    if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '同步連線僅接受 GET。');
    // Cookie 是唯一身分來源；不接受 URL 機密或可反射到事件的參數。
    if (req.originalUrl.includes('?')) throw new HttpError(400, 'INVALID_EVENT_QUERY', '同步連線不接受查詢參數。');
    if ((req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
      throw new HttpError(403, 'ORIGIN_REJECTED', '來源驗證失敗。');
    }
    const token = req.sessionToken;
    const session = access.auth.requireSession(token);
    const initial = activity.snapshot(token, req.params.id); // 驗證必須在送出 SSE headers 之前。
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    let previous;
    let closed = false;
    let heartbeat;
    let expiry;
    let slow;
    let blocked = false;
    let pending = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(expiry);
      clearTimeout(slow);
      clients.delete(client);
      res.off('close', cleanup);
      res.off('error', cleanup);
      res.off('drain', drain);
    };
    const end = (event, data) => {
      if (closed) return;
      try {
        if (blocked) res.destroy();
        else res.end(frame(event, data));
      } finally { cleanup(); }
    };
    const write = (event, data) => {
      if (closed || blocked) return;
      if (!res.write(frame(event, data))) {
        blocked = true;
        res.once('drain', drain);
        slow = setTimeout(() => { cleanup(); res.destroy(); }, 15000);
        slow.unref();
      }
    };
    const update = (snapshot) => {
      const encoded = JSON.stringify(snapshot);
      // 不發送內容相同的學生快照，避免事件時序透露其他組送出／加入數量。
      if (encoded !== previous) {
        // 慢連線只記「需要刷新」，不保存變更歷史；drain 後重新授權取最新快照。
        if (blocked) { pending = true; return; }
        previous = encoded;
        write('snapshot', snapshot);
      }
    };
    function drain() {
      blocked = false;
      clearTimeout(slow);
      if (pending) { pending = false; client.refresh(); }
    }
    const client = {
      activityId: req.params.id,
      refresh(isHeartbeat = false) {
        if (closed) return;
        try {
          update(activity.snapshot(token, req.params.id));
          if (isHeartbeat) write('heartbeat', {});
        } catch (error) {
          if (error instanceof HttpError && [401, 403].includes(error.status)) end('session-ended', SESSION_ENDED);
          else end('stream-ended', STREAM_ENDED);
        }
      },
      stop() { end('stream-ended', STREAM_ENDED); },
    };
    clients.add(client);
    res.on('close', cleanup);
    res.on('error', cleanup);
    update(initial);
    if (closed) return;
    heartbeat = setInterval(() => client.refresh(true), heartbeatMs);
    expiry = setTimeout(() => client.refresh(), Math.max(1, Date.parse(session.expires_at) - Date.now()));
    heartbeat.unref();
    expiry.unref();
  });

  const unsubscribe = store.subscribe((key) => {
    for (const client of clients) {
      if (key === client.activityId || key === 'global:authentication') client.refresh();
    }
  });
  return {
    router,
    close() {
      stopped = true;
      unsubscribe();
      for (const client of clients) client.stop();
    },
  };
}
