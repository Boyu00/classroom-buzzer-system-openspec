import { startServer } from '../src/server.js';
import { temporaryDatabase } from './helpers.js';

export const testPassword = 'test-only-secret-密碼';

export async function httpFixture(t) {
  let runtime;
  t.after(() => runtime?.close());
  const filename = temporaryDatabase(t);
  runtime = await startServer({ host: '127.0.0.1', port: 0, databasePath: filename });
  return { runtime, filename, url: `http://127.0.0.1:${runtime.server.address().port}` };
}

export async function httpClient(url) {
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

export async function teacherClient(url) {
  const teacher = await httpClient(url);
  await teacher.refresh();
  const result = await teacher.post('/api/teacher/setup', { password: testPassword });
  if (result.status !== 200) throw new Error('無法建立測試教師。');
  return teacher;
}

// 僅在自動測試建立題目，不是產品匯入功能，也不代表完成真實 Sheets 驗收。
export async function fixtureQuestion(runtime, id) {
  await runtime.store.write(id, (db) => {
    db.prepare("INSERT INTO units VALUES (?, 'fixture-unit', 'SINGLE', 0)").run(id);
    db.prepare("INSERT INTO questions VALUES (?, 'fixture-unit', '4', 0, 'fixture-sheet', 0, 2, 5, '{{Q:4}}', 'fixture-structure')").run(id);
  });
}
