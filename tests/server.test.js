import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { temporaryDatabase } from './helpers.js';

test('服務僅綁 loopback，提供狀態頁與資料庫健康檢查，不公開本機檔案', async (t) => {
  let runtime;
  t.after(() => runtime?.close());
  runtime = await startServer({ host: '127.0.0.1', port: 0, databasePath: temporaryDatabase(t) });
  assert.equal(runtime.server.address().address, '127.0.0.1');
  const url = `http://127.0.0.1:${runtime.server.address().port}`;
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /student.html/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-powered-by'), null);
  const health = await fetch(`${url}/api/health`);
  assert.deepEqual(await health.json(), { data: { status: 'ok', stage: 'foundation', database: 'ok' } });
  for (const path of ['/.env', '/data/classroom.sqlite3', '/spec.md', '/api/activities']) {
    const response = await fetch(`${url}${path}`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
  const invalid = await fetch(`${url}/api/activities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_JSON');
});

test('設定不能綁公開介面，無效 port／空資料庫路徑會拒絕', async () => {
  assert.equal(loadConfig({ HOST: '0.0.0.0' }).host, '127.0.0.1');
  assert.equal(loadConfig({ PORT: '3001' }).port, 3001);
  for (const value of ['-1', '65536', '3.1', '', 'abc']) {
    assert.throws(() => loadConfig({ PORT: value }), /PORT/);
  }
  assert.throws(() => loadConfig({ DATABASE_PATH: ' ' }), /DATABASE_PATH/);
  await assert.rejects(startServer({ host: '0.0.0.0', port: 0, databasePath: ':memory:' }), /127.0.0.1/);
});
