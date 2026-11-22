import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSheetsGateway, openSheetsGateway } from '../src/sheets/gateway.js';
import { loadCredentials } from '../src/sheets/credentials.js';
import { parseSpreadsheetRef } from '../src/sheets/spreadsheet-id.js';
import { parseSheets } from '../src/import/parser.js';
import { httpFixture, teacherClient } from './http-helpers.js';
import { removeTestDirectory } from './helpers.js';

// 這些測試只使用本機假的 Sheets 伺服器與假金鑰，不連網，也不代表 AC-01／AC-03 的真實驗收。
const ID = 'a'.repeat(44);
const EMAIL = 'fake-account@fake-project.iam.gserviceaccount.com';
const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nTOP-SECRET-TEST-MATERIAL\n-----END PRIVATE KEY-----\n';
const TOKEN = 'test-access-token-123';

const props = (sheetId, title, extra = {}) => ({ properties: { sheetId, title, index: sheetId, sheetType: 'GRID', gridProperties: { rowCount: 20, columnCount: 6 }, ...extra } });
const META = {
  spreadsheetId: ID, properties: { title: '測試試算表' },
  // sheetId 0 依 API 慣例被省略；另含一張圖表工作表。
  sheets: [{ properties: { title: '第一頁', index: 0, sheetType: 'GRID', gridProperties: { rowCount: 20, columnCount: 6 } } }, props(5, '第二頁'),
    { properties: { sheetId: 9, title: '圖表', index: 2, sheetType: 'OBJECT' } }],
};
const cell = (formattedValue) => (formattedValue === undefined ? {} : { formattedValue });
const DATA = {
  // API 依試算表原順序回傳（第一頁在前），與請求順序（5、0）相反。
  sheets: [
    { properties: { title: '第一頁', gridProperties: { rowCount: 20, columnCount: 6 } },
      merges: [{ endRowIndex: 3, endColumnIndex: 2 }, { sheetId: 0, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 1, endColumnIndex: 4 }],
      data: [{ rowData: [{ values: [cell('{{Q:1}}')] }, {}, { values: [cell(), cell('{{Q:2|G:X}}')] }] }] },
    { properties: { sheetId: 5, title: '第二頁', gridProperties: { rowCount: 20, columnCount: 6 } },
      data: [{ startRow: 4, startColumn: 2, rowData: [{ values: [cell('{{Q:3|G:X}}'), cell('一般文字')] }] }] },
  ],
};

async function fakeSheets(t, handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const record = { method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : undefined };
      requests.push(record);
      const result = handler(record, res) ?? { status: 200, json: record.url.includes(':getByDataFilter') ? DATA : META };
      if (result === 'hang') return;
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.json === undefined ? 'not json' : JSON.stringify(result.json));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}

const gatewayFor = (baseUrl, extra = {}) => createSheetsGateway({
  credentials: { client_email: EMAIL, private_key: FAKE_KEY }, baseUrl, getAccessToken: async () => TOKEN, ...extra,
});
const rejects = (promise) => promise.then(() => assert.fail('應該被拒絕'), (error) => error);

test('網址與 ID 解析：只接受純 ID 或 docs.google.com 的 https 試算表網址', () => {
  assert.equal(parseSpreadsheetRef(ID), ID);
  assert.equal(parseSpreadsheetRef(`  ${ID}  `), ID);
  for (const url of [`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`, `https://docs.google.com/spreadsheets/d/${ID}`,
    `https://docs.google.com/spreadsheets/u/1/d/${ID}/edit?usp=sharing`]) assert.equal(parseSpreadsheetRef(url), ID, url);
  for (const bad of [undefined, null, 5, '', 'short', `http://docs.google.com/spreadsheets/d/${ID}/edit`,
    `https://evil.example.com/spreadsheets/d/${ID}/edit`, `https://docs.google.com.evil.com/spreadsheets/d/${ID}`,
    `https://docs.google.com/document/d/${ID}/edit`, `javascript:alert(1)//spreadsheets/d/${ID}`,
    'https://docs.google.com/spreadsheets/d/short/edit', `${ID}/../x`, `${ID}?x=1`]) assert.equal(parseSpreadsheetRef(bad), null, String(bad));
});

test('listSheets：Bearer token、欄位遮罩、省略的 sheetId 0、略過非表格工作表、ID 需編碼', async (t) => {
  const fake = await fakeSheets(t, () => undefined);
  const listing = await gatewayFor(fake.baseUrl).listSheets({ spreadsheet: `https://docs.google.com/spreadsheets/d/${ID}/edit` });
  assert.deepEqual(listing, { spreadsheetId: ID, title: '測試試算表', sheets: [{ sheetId: 0, title: '第一頁', index: 0 }, { sheetId: 5, title: '第二頁', index: 5 }] });
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].auth, `Bearer ${TOKEN}`);
  assert.equal(fake.requests[0].method, 'GET');
  assert.ok(fake.requests[0].url.startsWith(`/spreadsheets/${ID}?fields=`));
  assert.equal(decodeURIComponent(fake.requests[0].url).includes('includeGridData'), false);
});

test('readSheets：依選擇順序重排、稀疏資料與偏移、補預設 0 的合併索引，且可直接交給解析器', async (t) => {
  const fake = await fakeSheets(t, () => undefined);
  const sheets = await gatewayFor(fake.baseUrl).readSheets({ spreadsheet: ID, sheetIds: [5, 0] });

  assert.deepEqual(sheets.map((s) => [s.sheetId, s.title, s.spreadsheetId]), [[5, '第二頁', ID], [0, '第一頁', ID]]);
  assert.equal(sheets[0].cells[4][2], '{{Q:3|G:X}}');
  assert.equal(sheets[0].cells[4][3], '一般文字');
  assert.equal(sheets[0].cells[4][0], '', '偏移前的欄位補空字串');
  assert.deepEqual([sheets[1].cells[0][0], sheets[1].cells[2][1], sheets[1].cells[1]], ['{{Q:1}}', '{{Q:2|G:X}}', []]);
  assert.deepEqual(sheets[1].merges, [{ startRow: 0, endRow: 3, startCol: 0, endCol: 2 }, { startRow: 7, endRow: 8, startCol: 1, endCol: 4 }]);
  assert.deepEqual([sheets[1].rowCount, sheets[1].columnCount], [20, 6]);

  const dataRequest = fake.requests.find((r) => r.url.includes(':getByDataFilter'));
  assert.equal(dataRequest.method, 'POST');
  assert.deepEqual(dataRequest.body, { dataFilters: [{ gridRange: { sheetId: 5 } }, { gridRange: { sheetId: 0 } }], includeGridData: true });

});

test('readSheets 與解析器銜接：合併範圍會被解析器偵測；移除合併後，掃描順序跟著選擇順序', async (t) => {
  const fake = await fakeSheets(t, () => undefined);
  const gateway = gatewayFor(fake.baseUrl);
  // 第一頁合併範圍涵蓋列 0～2、欄 0～1：Q:1（A1）與 Q:2（B3）都在其中被拒絕，
  // 題組 X 因此只剩第二頁的 Q:3，一併回報單一成員；全部錯誤一次回報。
  const merged = parseSheets(await gateway.readSheets({ spreadsheet: ID, sheetIds: [5, 0] }));
  assert.equal(merged.ok, false);
  assert.deepEqual(merged.errors.map((e) => [e.code, e.location]),
    [['MERGED_ANSWER_CELL', '第一頁!A1'], ['MERGED_ANSWER_CELL', '第一頁!B3'], ['SINGLE_MEMBER_GROUP', '第二頁!C5']]);

  const unmerged = (order) => gateway.readSheets({ spreadsheet: ID, sheetIds: order })
    .then((sheets) => parseSheets(sheets.map((s) => ({ ...s, merges: [] }))));
  const second = await unmerged([5, 0]);
  const first = await unmerged([0, 5]);
  assert.equal(second.ok && first.ok, true);
  // 題組 X 的首成員位置決定單位順序：[5,0] 先掃第二頁（Q:3），[0,5] 先掃第一頁（Q:1）。
  assert.deepEqual(second.units.map((u) => u.unitKey), ['G:X', 'S:1']);
  assert.deepEqual(first.units.map((u) => u.unitKey), ['S:1', 'G:X']);
  assert.deepEqual(second.units[0].questions.map((q) => q.questionId), ['3', '2']);
});

test('選擇不存在或非表格的工作表：回 400，且不呼叫資料端點', async (t) => {
  const fake = await fakeSheets(t, () => undefined);
  const gateway = gatewayFor(fake.baseUrl);
  for (const sheetIds of [[0, 99], [9], [], undefined]) {
    const error = await rejects(gateway.readSheets({ spreadsheet: ID, sheetIds }));
    assert.deepEqual([error.status, error.code], [400, 'INVALID_SHEET_SELECTION']);
  }
  assert.equal(fake.requests.some((r) => r.url.includes(':getByDataFilter')), false);
  const invalid = await rejects(gateway.readSheets({ spreadsheet: 'not-a-sheet', sheetIds: [0] }));
  assert.equal(invalid.code, 'INVALID_SPREADSHEET');
  assert.equal(fake.requests.length, 4, '無效網址不發出任何請求');
});

test('過大的工作表範圍被拒絕', async (t) => {
  const huge = { ...META, sheets: [props(0, '巨大', { gridProperties: { rowCount: 100000, columnCount: 100 } })] };
  const fake = await fakeSheets(t, () => ({ status: 200, json: huge }));
  const error = await rejects(gatewayFor(fake.baseUrl).readSheets({ spreadsheet: ID, sheetIds: [0] }));
  assert.deepEqual([error.status, error.code], [400, 'SHEET_TOO_LARGE']);
});

test('AC-03：Google 錯誤對應成明確錯誤碼，且訊息不含 token、私鑰', async (t) => {
  const cases = [
    [{ status: 403, json: { error: { status: 'PERMISSION_DENIED', message: 'The caller does not have permission' } } }, 403, 'SHEETS_PERMISSION_DENIED'],
    [{ status: 403, json: { error: { details: [{ reason: 'SERVICE_DISABLED' }] } } }, 503, 'SHEETS_API_DISABLED'],
    [{ status: 403, json: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } }, 503, 'SHEETS_RATE_LIMITED'],
    [{ status: 404, json: { error: { status: 'NOT_FOUND' } } }, 404, 'SPREADSHEET_NOT_FOUND'],
    [{ status: 429, json: { error: {} } }, 503, 'SHEETS_RATE_LIMITED'],
    [{ status: 401, json: { error: {} } }, 503, 'SHEETS_AUTH_FAILED'],
    [{ status: 400, json: { error: {} } }, 400, 'SHEETS_REQUEST_REJECTED'],
    [{ status: 500, json: { error: { message: 'internal detail' } } }, 502, 'SHEETS_UNAVAILABLE'],
    [{ status: 503 }, 502, 'SHEETS_UNAVAILABLE'],
    [{ status: 200 }, 502, 'SHEETS_UNAVAILABLE'],
  ];
  for (const [response, status, code] of cases) {
    const fake = await fakeSheets(t, () => response);
    const error = await rejects(gatewayFor(fake.baseUrl).listSheets({ spreadsheet: ID }));
    assert.deepEqual([error.status, error.code], [status, code], JSON.stringify(response));
    const text = JSON.stringify({ message: error.message, code: error.code, details: error.details });
    for (const secret of [TOKEN, 'TOP-SECRET', 'PRIVATE KEY', 'internal detail']) assert.equal(text.includes(secret), false, secret);
  }
  const denied = await fakeSheets(t, () => ({ status: 403, json: { error: {} } }));
  const error = await rejects(gatewayFor(denied.baseUrl).listSheets({ spreadsheet: ID }));
  assert.ok(error.message.includes(EMAIL), '權限不足時要告訴老師該分享給哪個服務帳戶');
});

test('AC-03：斷網與逾時回 502 並明示，不洩漏內部細節', async (t) => {
  const closed = await fakeSheets(t, () => undefined);
  const offline = gatewayFor(closed.baseUrl.replace(/:\d+$/, ':1'));
  const refused = await rejects(offline.listSheets({ spreadsheet: ID }));
  assert.deepEqual([refused.status, refused.code], [502, 'SHEETS_UNAVAILABLE']);

  const slow = await fakeSheets(t, () => 'hang');
  const timedOut = await rejects(gatewayFor(slow.baseUrl, { timeoutMs: 50 }).listSheets({ spreadsheet: ID }));
  assert.deepEqual([timedOut.status, timedOut.code], [502, 'SHEETS_UNAVAILABLE']);
  assert.equal(timedOut.message.includes('127.0.0.1'), false);
});

test('取得 token 失敗：金鑰無效回 503 SHEETS_AUTH_FAILED，其他情況回 502', async (t) => {
  const fake = await fakeSheets(t, () => undefined);
  const failWith = (error) => gatewayFor(fake.baseUrl, { getAccessToken: async () => { throw error; } });
  const invalidGrant = await rejects(failWith(Object.assign(new Error('invalid_grant: secret detail'), { response: { status: 400 } })).listSheets({ spreadsheet: ID }));
  assert.deepEqual([invalidGrant.status, invalidGrant.code], [503, 'SHEETS_AUTH_FAILED']);
  assert.equal(invalidGrant.message.includes('secret detail'), false);
  const network = await rejects(failWith(new Error('getaddrinfo ENOTFOUND')).listSheets({ spreadsheet: ID }));
  assert.deepEqual([network.status, network.code], [502, 'SHEETS_UNAVAILABLE']);
  assert.equal(fake.requests.length, 0, 'token 失敗時不呼叫 Sheets');
});

test('loadCredentials：有效金鑰只保留必要欄位；缺檔、壞 JSON、錯誤類型的訊息不含路徑或內容', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'classroom-creds-'));
  t.after(() => removeTestDirectory(directory));
  const write = (name, content) => { const path = join(directory, name); writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content)); return path; };
  const good = write('good.json', { type: 'service_account', client_email: EMAIL, private_key: FAKE_KEY, project_id: 'p', private_key_id: 'k' });
  assert.deepEqual(loadCredentials(good), { client_email: EMAIL, private_key: FAKE_KEY });

  const invalid = [join(directory, 'missing.json'), write('bad.json', '{ not json'),
    write('user.json', { type: 'authorized_user', client_email: EMAIL, private_key: FAKE_KEY }),
    write('nokey.json', { type: 'service_account', client_email: EMAIL }),
    write('nomail.json', { type: 'service_account', private_key: FAKE_KEY }),
    write('notkey.json', { type: 'service_account', client_email: EMAIL, private_key: 'TOP-SECRET-not-a-key' })];
  for (const path of invalid) {
    assert.throws(() => loadCredentials(path), (error) => {
      assert.equal(error.message.includes(directory), false, '訊息不得含路徑');
      assert.equal(error.message.includes('TOP-SECRET'), false, '訊息不得含檔案內容');
      return true;
    }, path);
  }
});

test('openSheetsGateway：未設定回 undefined；憑證無效只警告且警告不含路徑', (t) => {
  const warnings = [];
  const log = { warn: (message) => warnings.push(message) };
  assert.equal(openSheetsGateway(null, log), undefined);
  assert.equal(openSheetsGateway('C:/does/not/exist-secret-path.json', log), undefined);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].includes('exist-secret-path'), false);

  const directory = mkdtempSync(join(tmpdir(), 'classroom-creds-'));
  t.after(() => removeTestDirectory(directory));
  const path = join(directory, 'sa.json');
  writeFileSync(path, JSON.stringify({ type: 'service_account', client_email: EMAIL, private_key: FAKE_KEY }));
  assert.equal(openSheetsGateway(path, log).serviceAccountEmail, EMAIL);
});

test('HTTP：教師列出工作表、預覽、確認走完整流程；服務帳戶 email 會顯示給教師', async (t) => {
  const noMerge = { sheets: DATA.sheets.map((s) => ({ ...s, merges: [] })) };
  const fakeOk = await fakeSheets(t, (r) => (r.url.includes(':getByDataFilter') ? { status: 200, json: noMerge } : undefined));
  const fixture = await httpFixture(t, { sheetsGateway: gatewayFor(fakeOk.baseUrl) });
  const teacher = await teacherClient(fixture.url);
  const { result: { data: { activityId } } } = await teacher.post('/api/activities', { mode: 'SPEED' });
  const base = `/api/activities/${activityId}/import`;

  const listed = await teacher.post(`${base}/sheets`, { spreadsheet: `https://docs.google.com/spreadsheets/d/${ID}/edit` });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.result.data.sheets.map((s) => s.sheetId), [0, 5]);
  assert.equal(listed.result.data.serviceAccountEmail, EMAIL);

  const preview = await teacher.post(`${base}/preview`, { spreadsheet: ID, sheetIds: [5, 0] });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.result.data.summary, { questionCount: 3, unitCount: 2 });
  // 選擇順序 [5, 0]：題組 X 的首成員是第二頁 C5，再接第一頁 B3；單題 Q:1 在第一頁 A1。
  assert.deepEqual(preview.result.data.units.map((u) => u.questions.map((q) => q.location)), [['第二頁!C5', '第一頁!B3'], ['第一頁!A1']]);
  const confirmed = await teacher.post(`${base}/confirm`, { previewToken: preview.result.data.previewToken });
  assert.equal(confirmed.status, 200);
  const stored = fixture.runtime.store.read((db) => db.prepare('SELECT question_id, sheet_id, row_index, column_index, spreadsheet_id FROM questions ORDER BY question_id').all());
  assert.deepEqual(stored.map((q) => [q.question_id, q.sheet_id, q.row_index, q.column_index, q.spreadsheet_id]),
    [['1', 0, 0, 0, ID], ['2', 0, 2, 1, ID], ['3', 5, 4, 2, ID]]);
});

test('HTTP：未登入不能列出工作表；沒有 gateway 回 503；無效網址回 400', async (t) => {
  const bare = await httpFixture(t);
  const teacher = await teacherClient(bare.url);
  const { result: { data: { activityId } } } = await teacher.post('/api/activities', {});
  const path = `/api/activities/${activityId}/import/sheets`;
  assert.deepEqual((await teacher.post(path, { spreadsheet: ID })).result.error.code, 'SHEETS_NOT_CONFIGURED');

  const fake = await fakeSheets(t, () => undefined);
  const configured = await httpFixture(t, { sheetsGateway: gatewayFor(fake.baseUrl) });
  const owner = await teacherClient(configured.url);
  const created = (await owner.post('/api/activities', {})).result.data.activityId;
  const listPath = `/api/activities/${created}/import/sheets`;
  assert.equal((await owner.post(listPath, { spreadsheet: 'nope' })).result.error.code, 'INVALID_SPREADSHEET');
  assert.equal((await owner.post(listPath, {})).result.error.code, 'INVALID_SPREADSHEET');
  assert.equal(fake.requests.length, 0);

  const anonymous = await fetch(`${configured.url}${listPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: configured.url }, body: '{}' });
  assert.ok([401, 403].includes(anonymous.status));
});

/* ---------- 回歸（review #33）：取得 token 也要有期限 ---------- */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('回歸（review #33）：取得 token 卡住時，在設定期限內以 SHEETS_UNAVAILABLE 結束，且不呼叫 Sheets', async (t) => {
  const fake = await fakeSheets(t, () => undefined);
  const hung = gatewayFor(fake.baseUrl, { timeoutMs: 30, getAccessToken: () => new Promise(() => {}) });
  for (const call of [() => hung.listSheets({ spreadsheet: ID }), () => hung.readSheets({ spreadsheet: ID, sheetIds: [0] })]) {
    const started = Date.now();
    const error = await rejects(call());
    assert.ok(Date.now() - started < 1000, `應在期限附近結束，實際 ${Date.now() - started}ms`);
    assert.deepEqual([error.status, error.code], [502, 'SHEETS_UNAVAILABLE']);
    assert.match(error.message, /逾時/);
    for (const secret of [TOKEN, 'TOP-SECRET', 'PRIVATE KEY']) assert.equal(error.message.includes(secret), false);
  }
  assert.equal(fake.requests.length, 0, '授權沒完成就不應呼叫 Sheets');
});

test('授權卡住時共用同一個進行中的請求，逾時後才重新嘗試（不在背景無限累積）', async (t) => {
  const fake = await fakeSheets(t, () => undefined);
  let attempts = 0;
  const gateway = gatewayFor(fake.baseUrl, { timeoutMs: 40, getAccessToken: () => { attempts += 1; return new Promise(() => {}); } });
  const [a, b, c] = await Promise.all([
    rejects(gateway.listSheets({ spreadsheet: ID })), rejects(gateway.listSheets({ spreadsheet: ID })),
    rejects(gateway.readSheets({ spreadsheet: ID, sheetIds: [0] })),
  ]);
  assert.deepEqual([a.code, b.code, c.code], ['SHEETS_UNAVAILABLE', 'SHEETS_UNAVAILABLE', 'SHEETS_UNAVAILABLE']);
  assert.equal(attempts, 1, '同時進行的操作共用一個授權請求');
  await pause(80);
  await rejects(gateway.listSheets({ spreadsheet: ID }));
  assert.equal(attempts, 2, '期限過後才允許重新嘗試');
  assert.equal(fake.requests.length, 0);
});

test('首次授權失敗不會被快取；之後恢復即可正常使用', async (t) => {
  const fake = await fakeSheets(t, () => undefined);
  let attempts = 0;
  const gateway = gatewayFor(fake.baseUrl, { getAccessToken: async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('invalid_grant: secret detail'), { response: { status: 400 } });
    return TOKEN;
  } });
  const first = await rejects(gateway.listSheets({ spreadsheet: ID }));
  assert.deepEqual([first.status, first.code], [503, 'SHEETS_AUTH_FAILED']);
  assert.equal(first.message.includes('secret detail'), false);
  assert.equal(fake.requests.length, 0);
  assert.equal((await gateway.listSheets({ spreadsheet: ID })).sheets.length, 2);
  assert.equal(fake.requests.length, 1);
});

test('已取得過 token 後，更新失敗會明確回報、不呼叫 Sheets，恢復後可再用', async (t) => {
  const fake = await fakeSheets(t, () => undefined);
  let attempts = 0;
  const gateway = gatewayFor(fake.baseUrl, { getAccessToken: async () => {
    attempts += 1;
    if (attempts === 2) throw new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com');
    return TOKEN;
  } });
  assert.equal((await gateway.listSheets({ spreadsheet: ID })).sheets.length, 2);
  assert.equal(fake.requests.length, 1);
  const refresh = await rejects(gateway.listSheets({ spreadsheet: ID }));
  assert.deepEqual([refresh.status, refresh.code], [502, 'SHEETS_UNAVAILABLE']);
  assert.equal(refresh.message.includes('ENOTFOUND'), false);
  assert.equal(fake.requests.length, 1, '更新失敗時沒有新的 Sheets 請求');
  assert.equal((await gateway.listSheets({ spreadsheet: ID })).sheets.length, 2);
  assert.equal(fake.requests.length, 2);
});

test('授權較慢但在期限內完成時正常運作，計時器不會讓程序卡住', async (t) => {
  const fake = await fakeSheets(t, () => undefined);
  const gateway = gatewayFor(fake.baseUrl, { timeoutMs: 500, getAccessToken: async () => { await pause(20); return TOKEN; } });
  assert.equal((await gateway.listSheets({ spreadsheet: ID })).title, '測試試算表');
  assert.equal(fake.requests[0].auth, `Bearer ${TOKEN}`);
});
