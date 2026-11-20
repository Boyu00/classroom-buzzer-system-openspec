import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';
import { openStore } from '../src/storage/store.js';
import { createAuthService, hashToken, readCookie, SESSION_COOKIE } from '../src/auth/service.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { temporaryDatabase, seedActivity } from './helpers.js';

const password = 'test-only-secret-密碼';

async function fixture(t) {
  let runtime;
  t.after(() => runtime?.close());
  const filename = temporaryDatabase(t);
  runtime = await startServer({ host: '127.0.0.1', port: 0, databasePath: filename });
  return { runtime, filename, url: `http://127.0.0.1:${runtime.server.address().port}` };
}

async function client(url) {
  let cookie;
  let csrf;
  return {
    get cookie() { return cookie; },
    get csrf() { return csrf; },
    async request(path, { method = 'GET', body, headers = {} } = {}) {
      const response = await fetch(url + path, {
        method,
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: url, 'X-CSRF-Token': csrf ?? '', 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const result = await response.json();
      if (result.data?.csrfToken) csrf = result.data.csrfToken;
      return { status: response.status, result, response };
    },
    async refresh() { return this.request('/api/session'); },
    async post(path, body, headers) { return this.request(path, { method: 'POST', body, headers }); },
  };
}

test('密碼採獨立 salt 的雜湊，錯密碼與異常 hash 不通過', async () => {
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong-password', first), false);
  assert.equal(await verifyPassword(password, 'corrupted'), false);
  for (const invalid of ['', '       ', 'short', null, '密'.repeat(129)]) await assert.rejects(hashPassword(invalid), { code: 'INVALID_PASSWORD' });
});

test('session 不可猜測、Cookie 旗標、CSRF 重載穩定，回應不洩漏 hash', async (t) => {
  const { url, runtime } = await fixture(t);
  const a = await client(url);
  const first = await a.refresh();
  assert.equal(first.status, 200);
  assert.equal(first.result.data.role, 'ANONYMOUS');
  assert.equal(first.result.data.teacherConfigured, false);
  assert.match(a.cookie, /^classroom_session=[A-Za-z0-9_-]{43}$/);
  assert.match(first.response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(first.response.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal(first.response.headers.get('cache-control'), 'no-store');
  const originalCookie = a.cookie;
  const originalCsrf = a.csrf;
  await a.refresh();
  assert.equal(a.cookie, originalCookie);
  assert.equal(a.csrf, originalCsrf);
  const stored = runtime.store.read((db) => db.prepare('SELECT * FROM sessions').get());
  assert.notEqual(stored.token_hash, readCookie(a.cookie));
  assert.notEqual(stored.csrf_hash, a.csrf);
  assert.ok(!JSON.stringify(first.result).includes(stored.token_hash));
  assert.equal(readCookie('classroom_session=guess'), null);
  assert.equal(readCookie(`${a.cookie}; ${a.cookie}`), null);
});

test('缺設定提示、初次設定登入、session 旋轉、禁止重設與登出', async (t) => {
  const { url, runtime } = await fixture(t);
  const teacher = await client(url);
  const outsider = await client(url);
  await teacher.refresh();
  await outsider.refresh();
  assert.equal((await teacher.post('/api/teacher/login', { password })).result.error.code, 'SETUP_REQUIRED');
  const oldCookie = teacher.cookie;
  const setup = await teacher.post('/api/teacher/setup', { password });
  assert.equal(setup.status, 200);
  assert.equal(setup.result.data.role, 'TEACHER');
  assert.notEqual(teacher.cookie, oldCookie);
  const stale = await fetch(`${url}/api/teacher/monitor`, { headers: { Cookie: oldCookie } });
  assert.equal(stale.status, 401);
  const me = await teacher.refresh();
  assert.equal(me.result.data.teacherConfigured, true);
  assert.equal(me.result.data.role, 'TEACHER');
  assert.equal((await outsider.post('/api/teacher/setup', { password: 'replacement-password' })).status, 409);
  const invalid = await outsider.post('/api/teacher/login', { password: 'wrong-password' });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.result.error.code, 'INVALID_CREDENTIALS');
  const hash = runtime.store.read((db) => db.prepare('SELECT password_hash FROM teacher_settings').get().password_hash);
  assert.ok(!hash.includes(password));
  const login = await outsider.post('/api/teacher/login', { password });
  assert.equal(login.result.data.role, 'TEACHER');
  await outsider.refresh();
  const validCookie = outsider.cookie;
  assert.equal((await outsider.post('/api/logout', {})).status, 200);
  assert.notEqual(outsider.cookie, validCookie);
  assert.equal((await outsider.refresh()).result.data.role, 'ANONYMOUS');
  assert.equal((await outsider.post('/api/activities', {})).status, 401);
  assert.equal((await fetch(`${url}/api/teacher/monitor`, { headers: { Cookie: validCookie } })).status, 401);
});

test('缺 Origin、跨來源、錯埠、偽造 Host、缺／錯 CSRF 不會設定密碼', async (t) => {
  const { url, runtime } = await fixture(t);
  const visitor = await client(url);
  await visitor.refresh();
  for (const headers of [
    { Origin: '' }, { Origin: 'https://evil.example' }, { Origin: 'null' },
    { Origin: 'http://127.0.0.1:1' }, { 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'a'.repeat(64) },
    { Host: 'evil.example', Origin: 'http://evil.example' },
  ]) {
    const response = await visitor.post('/api/teacher/setup', { password }, headers);
    assert.equal(response.status, 403);
  }
  assert.equal(runtime.store.read((db) => db.prepare('SELECT count(*) AS n FROM teacher_settings').get().n), 0);
  assert.equal((await visitor.post('/api/teacher/setup', { password })).status, 200);
});

test('並行初次設定只有一個成功，不能覆寫第一個密碼', async (t) => {
  const { url } = await fixture(t);
  const a = await client(url);
  const b = await client(url);
  await Promise.all([a.refresh(), b.refresh()]);
  const results = await Promise.all([a.post('/api/teacher/setup', { password }), b.post('/api/teacher/setup', { password: 'other-test-password' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});

test('學生不能升級成老師或呼叫教師操作，客戶端 role 不可信', async (t) => {
  const { url, runtime } = await fixture(t);
  const student = await client(url);
  await student.refresh();
  await runtime.store.write('activity', (db) => {
    seedActivity(db);
    db.prepare("UPDATE sessions SET role = 'STUDENT', activity_id = 'activity', group_id = 'a' WHERE token_hash = ?").run(hashToken(readCookie(student.cookie)));
  });
  const snapshot = await student.refresh();
  assert.equal(snapshot.result.data.role, 'STUDENT');
  for (const path of ['/api/activities', '/api/activities/activity/open', '/api/activities/activity/import/preview', '/api/activities/activity/export/write', '/api/teacher/setup', '/api/teacher/login']) {
    const denied = await student.post(path, { password, role: 'TEACHER' });
    assert.equal(denied.status, 403, path);
    assert.ok(!JSON.stringify(denied.result).includes('測試組'));
  }
  assert.equal((await student.request('/api/activities/activity/results.csv')).status, 403);
});

test('session 與教師雜湊重啟後保留；到期時拒絕，清理不破壞活動外鍵', async (t) => {
  const filename = temporaryDatabase(t);
  let time = Date.parse('2026-11-20T00:00:00.000Z');
  let store = openStore(filename);
  let auth = createAuthService(store, { now: () => time });
  const initial = await auth.getSession(null);
  const teacher = await auth.setup(initial.cookie.token, password);
  const teacherId = auth.requireTeacher(teacher.cookie.token).session_id;
  await store.write('test', (db) => db.prepare("INSERT INTO activities (activity_id,join_code,teacher_session_id,created_at) VALUES ('kept','KEPT',?,?)").run(teacherId, new Date(time).toISOString()));
  await store.close();
  store = openStore(filename);
  try {
    auth = createAuthService(store, { now: () => time });
    assert.equal(auth.requireTeacher(teacher.cookie.token).role, 'TEACHER');
    const restored = await auth.getSession(teacher.cookie.token);
    assert.equal(restored.data.role, 'TEACHER');
    time += 9 * 60 * 60 * 1000;
    assert.throws(() => auth.requireTeacher(teacher.cookie.token), { code: 'SESSION_REQUIRED' });
    const replacement = await auth.getSession(teacher.cookie.token);
    assert.equal(replacement.data.role, 'ANONYMOUS');
    assert.equal(store.read((db) => db.prepare('SELECT count(*) AS n FROM activities').get().n), 1);
    assert.deepEqual(store.read((db) => db.prepare('PRAGMA foreign_key_check').all()), []);
    const rows = store.read((db) => db.prepare('SELECT count(*) AS n FROM sessions WHERE session_id = ?').get(teacherId));
    assert.equal(rows.n, 1);
    assert.equal(readCookie(`${SESSION_COOKIE}=${replacement.cookie.token}`), replacement.cookie.token);
  } finally {
    await store.close();
  }
});
