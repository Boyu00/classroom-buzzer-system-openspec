import test from 'node:test';
import assert from 'node:assert/strict';
import { httpFixture, httpClient, teacherClient, testPassword, fixtureQuestion } from './http-helpers.js';

// 自動測試用的 gateway 替身；產品的真實 Sheets 讀取由 #13 提供，本測試不代表 AC-01。
function sheet(title, sheetId, placements = [], { merges = [] } = {}) {
  const cells = Array.from({ length: 20 }, () => Array(6).fill(''));
  for (const [row, column, text] of placements) cells[row][column] = text;
  return { spreadsheetId: 'book', sheetId, title, rowCount: 20, columnCount: 6, cells, merges };
}
const mixed = () => [
  sheet('A', 1, [[1, 0, '{{Q:1}}'], [3, 0, '{{Q:2|G:X}}'], [6, 1, '{{Q:5}}']]),
  sheet('B', 2, [[0, 0, '{{Q:3|G:X}}'], [4, 2, '{{Q:4|G:X}}']]),
];

async function setup(t, { sheets = mixed(), failWith } = {}) {
  const gateway = {
    calls: [],
    sheets,
    async readSheets(request) {
      this.calls.push(request);
      if (failWith) throw failWith;
      return this.sheets;
    },
  };
  const fixture = await httpFixture(t, { sheetsGateway: gateway });
  const teacher = await teacherClient(fixture.url);
  const created = await teacher.post('/api/activities', { mode: 'SPEED' });
  assert.equal(created.status, 200);
  const id = created.result.data.activityId;
  const preview = (body = { spreadsheet: 'book-id', sheetIds: [1, 2] }) => teacher.post(`/api/activities/${id}/import/preview`, body);
  const confirm = (previewToken) => teacher.post(`/api/activities/${id}/import/confirm`, { previewToken });
  const rows = (sql, ...args) => fixture.runtime.store.read((db) => db.prepare(sql).all(...args));
  return { ...fixture, gateway, teacher, id, preview, confirm, rows };
}

const snapshotOf = (s) => s.rows('SELECT unit_id, type, unit_order FROM units WHERE activity_id = ? ORDER BY unit_order', s.id);

test('未登入、學生不能預覽或確認；未設定 Sheets 存取時明確回 503', async (t) => {
  const s = await setup(t);
  const anonymous = await httpClient(s.url);
  await anonymous.refresh();
  for (const path of ['preview', 'confirm']) {
    const result = await anonymous.post(`/api/activities/${s.id}/import/${path}`, {});
    assert.equal(result.status, 401);
  }
  assert.equal(s.gateway.calls.length, 0);

  const bare = await httpFixture(t);
  const teacher = await teacherClient(bare.url);
  const { result: { data: { activityId } } } = await teacher.post('/api/activities', {});
  const missing = await teacher.post(`/api/activities/${activityId}/import/preview`, { spreadsheet: 'x', sheetIds: [1] });
  assert.equal(missing.status, 503);
  assert.equal(missing.result.error.code, 'SHEETS_NOT_CONFIGURED');
});

test('預覽回傳題號、題數、單位與原格位置，但不寫入題目；憑證只存 hash', async (t) => {
  const s = await setup(t);
  const { status, result } = await s.preview();
  assert.equal(status, 200);
  const { data } = result;
  assert.deepEqual(data.summary, { questionCount: 5, unitCount: 3 });
  assert.deepEqual(data.units.map((u) => [u.type, u.questions.map((q) => q.questionId)]), [['SINGLE', ['1']], ['GROUP', ['2', '3', '4']], ['SINGLE', ['5']]]);
  assert.deepEqual(data.units[1].questions.map((q) => q.location), ['A!A4', 'B!A1', 'B!C5']);
  assert.equal('structureFingerprint' in data, false);
  assert.deepEqual(s.gateway.calls, [{ spreadsheet: 'book-id', sheetIds: [1, 2] }]);

  assert.equal(snapshotOf(s).length, 0, '未確認不得替換');
  const [row] = s.rows('SELECT * FROM import_previews');
  assert.notEqual(row.token_hash, data.previewToken);
  assert.equal(JSON.stringify(row).includes(data.previewToken), false);
  assert.equal(row.import_revision, 0);
});

test('AC-02／AC-17：確認後整批寫入單位、題目與原格映射，之後可開啟活動', async (t) => {
  const s = await setup(t);
  const { result: { data: { previewToken } } } = await s.preview();
  const confirmed = await s.confirm(previewToken);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.result.data.importRevision, 1);

  assert.deepEqual(snapshotOf(s).map((u) => [u.type, u.unit_order]), [['SINGLE', 0], ['GROUP', 1], ['SINGLE', 2]]);
  const questions = s.rows(`SELECT q.question_id, q.question_order, u.unit_order, q.spreadsheet_id, q.sheet_id, q.row_index,
    q.column_index, q.original_marker, q.structure_fingerprint FROM questions q JOIN units u USING (activity_id, unit_id)
    WHERE q.activity_id = ? ORDER BY u.unit_order, q.question_order`, s.id);
  assert.deepEqual(questions.map((q) => [q.question_id, q.unit_order, q.question_order, q.sheet_id, q.row_index, q.column_index, q.original_marker]), [
    ['1', 0, 0, 1, 1, 0, '{{Q:1}}'], ['2', 1, 0, 1, 3, 0, '{{Q:2|G:X}}'], ['3', 1, 1, 2, 0, 0, '{{Q:3|G:X}}'],
    ['4', 1, 2, 2, 4, 2, '{{Q:4|G:X}}'], ['5', 2, 0, 1, 6, 1, '{{Q:5}}'],
  ]);
  assert.equal(new Set(questions.map((q) => q.structure_fingerprint)).size, 1);
  assert.equal(s.rows('SELECT * FROM import_previews').length, 0);
  assert.equal(s.rows('SELECT import_revision FROM activities')[0].import_revision, 1);

  const snapshot = await s.teacher.request(`/api/activities/${s.id}/snapshot`);
  assert.equal(snapshot.result.data.units.length, 3);
  const opened = await s.teacher.post(`/api/activities/${s.id}/open`, {});
  assert.equal(opened.status, 200);
});

test('重新匯入會完整取代舊的單位與題目，修訂號遞增', async (t) => {
  const s = await setup(t);
  await s.confirm((await s.preview()).result.data.previewToken);
  s.gateway.sheets = [sheet('新版', 9, [[7, 3, '{{Q:1}}'], [8, 3, '{{Q:4}}'], [9, 3, '{{Q:9}}']])];
  const second = await s.preview({ spreadsheet: 'book-id', sheetIds: [9] });
  assert.equal(second.result.data.importRevision, 1);
  await s.confirm(second.result.data.previewToken);
  assert.deepEqual(s.rows('SELECT question_id FROM questions ORDER BY question_id').map((q) => q.question_id), ['1', '4', '9']);
  assert.equal(snapshotOf(s).length, 3);
  assert.equal(s.rows('SELECT import_revision FROM activities')[0].import_revision, 2);
});

test('AC-03：不合法來源回 400 與全部錯誤位置，保留舊匯入且不留預覽', async (t) => {
  const s = await setup(t);
  await s.confirm((await s.preview()).result.data.previewToken);
  const before = s.rows('SELECT * FROM questions ORDER BY question_id');

  s.gateway.sheets = [sheet('壞', 3, [[0, 0, '{{Q:1}}'], [1, 0, '{{Q:1}}'], [2, 0, '{{oops}}'], [3, 0, '{{Q:3|G:Z}}']])];
  const bad = await s.preview({ spreadsheet: 'book-id', sheetIds: [3] });
  assert.equal(bad.status, 400);
  assert.equal(bad.result.error.code, 'IMPORT_INVALID');
  assert.deepEqual(bad.result.error.details.map((e) => e.code).sort(), ['DUPLICATE_QUESTION_ID', 'INVALID_MARKER', 'SINGLE_MEMBER_GROUP']);
  assert.ok(bad.result.error.details.every((e) => e.location.startsWith('壞!')));

  s.gateway.sheets = [sheet('空', 4)];
  const empty = await s.preview({ spreadsheet: 'book-id', sheetIds: [4] });
  assert.equal(empty.result.error.details[0].code, 'NO_QUESTIONS');

  assert.deepEqual(s.rows('SELECT * FROM questions ORDER BY question_id'), before);
  assert.equal(s.rows('SELECT * FROM import_previews').length, 0);
});

test('Sheets 讀取失敗回 502，不洩漏內部錯誤且保留舊匯入', async (t) => {
  const s = await setup(t);
  await s.confirm((await s.preview()).result.data.previewToken);
  const before = s.rows('SELECT * FROM questions ORDER BY question_id');
  s.gateway.readSheets = async () => { throw new Error('secret-key-path C:\\creds\\sa.json'); };
  const failed = await s.preview();
  assert.equal(failed.status, 502);
  assert.equal(failed.result.error.code, 'SHEETS_UNAVAILABLE');
  assert.equal(JSON.stringify(failed.result).includes('creds'), false);
  assert.deepEqual(s.rows('SELECT * FROM questions ORDER BY question_id'), before);
});

test('請求內容驗證：網址／ID 與工作表選擇', async (t) => {
  const s = await setup(t);
  const noBody = await s.teacher.post(`/api/activities/${s.id}/import/preview`);
  assert.equal(noBody.result.error.code, 'INVALID_SPREADSHEET');
  for (const body of [{}, { spreadsheet: '', sheetIds: [1] }, { spreadsheet: 5, sheetIds: [1] }]) {
    assert.equal((await s.preview(body)).result.error.code, 'INVALID_SPREADSHEET');
  }
  for (const sheetIds of [undefined, [], 'x', [1, 1], [-1], [1.5], ['1'], Array.from({ length: 51 }, (_, i) => i)]) {
    assert.equal((await s.preview({ spreadsheet: 'x', sheetIds })).result.error.code, 'INVALID_SHEET_SELECTION');
  }
  assert.equal(s.gateway.calls.length, 0);
});

test('確認：缺少、錯誤、他人的預覽憑證一律拒絕，不替換', async (t) => {
  const s = await setup(t);
  const { result: { data: { previewToken } } } = await s.preview();
  assert.equal((await s.confirm(undefined)).result.error.code, 'INVALID_PREVIEW_TOKEN');
  assert.equal((await s.confirm('not-a-token')).result.error.code, 'INVALID_PREVIEW_TOKEN');
  const unknown = await s.confirm('A'.repeat(43));
  assert.deepEqual([unknown.status, unknown.result.error.code], [409, 'PREVIEW_INVALID']);

  // 同一位老師的另一個登入 session 不能確認別的 session 產生的預覽。
  const other = await httpClient(s.url);
  await other.refresh();
  assert.equal((await other.post('/api/teacher/login', { password: testPassword })).status, 200);
  const foreign = await other.post(`/api/activities/${s.id}/import/confirm`, { previewToken });
  assert.deepEqual([foreign.status, foreign.result.error.code], [409, 'PREVIEW_INVALID']);
  assert.equal(snapshotOf(s).length, 0);
  assert.equal((await s.confirm(previewToken)).status, 200);
});

test('新預覽讓舊預覽失效；修訂號不符與逾時也拒絕', async (t) => {
  const s = await setup(t);
  const first = (await s.preview()).result.data.previewToken;
  const second = (await s.preview()).result.data.previewToken;
  assert.equal((await s.confirm(first)).result.error.code, 'PREVIEW_INVALID');

  s.runtimeDb = s.runtime.store;
  await s.runtime.store.write(s.id, (db) => db.prepare('UPDATE activities SET import_revision = 5 WHERE activity_id = ?').run(s.id));
  const stale = await s.confirm(second);
  assert.deepEqual([stale.status, stale.result.error.code], [409, 'PREVIEW_STALE']);

  const fresh = (await s.preview()).result.data.previewToken;
  await s.runtime.store.write(s.id, (db) => db.prepare("UPDATE import_previews SET expires_at = '2000-01-01T00:00:00.000Z'").run());
  assert.equal((await s.confirm(fresh)).result.error.code, 'PREVIEW_INVALID');
  assert.equal(snapshotOf(s).length, 0);
});

test('活動開啟後，預覽與使用舊預覽確認都被拒絕，單位順序與映射不變', async (t) => {
  const s = await setup(t);
  await s.confirm((await s.preview()).result.data.previewToken);
  const pending = (await s.preview()).result.data.previewToken;
  assert.equal((await s.teacher.post(`/api/activities/${s.id}/open`, {})).status, 200);
  const before = s.rows('SELECT * FROM questions ORDER BY question_id');

  const late = await s.confirm(pending);
  assert.deepEqual([late.status, late.result.error.code], [409, 'INVALID_PHASE']);
  const again = await s.preview();
  assert.deepEqual([again.status, again.result.error.code], [409, 'INVALID_PHASE']);
  assert.deepEqual(s.rows('SELECT * FROM questions ORDER BY question_id'), before);
});

test('確認途中失敗時整批回滾：舊匯入完整保留，修訂號不變', async (t) => {
  const s = await setup(t);
  await s.confirm((await s.preview()).result.data.previewToken);
  const before = s.rows('SELECT * FROM questions ORDER BY question_id');
  const beforeUnits = snapshotOf(s);

  // 測試專用觸發器：寫入特定題號時中途失敗。
  await s.runtime.store.write(s.id, (db) => db.exec(
    "CREATE TRIGGER boom BEFORE INSERT ON questions WHEN NEW.question_id = 'boom' BEGIN SELECT RAISE(ABORT, 'forced failure'); END"));
  s.gateway.sheets = [sheet('S', 7, [[0, 0, '{{Q:1}}'], [1, 0, '{{Q:boom}}']])];
  const preview = await s.preview({ spreadsheet: 'book-id', sheetIds: [7] });
  assert.equal(preview.status, 200);
  const failed = await s.confirm(preview.result.data.previewToken);
  assert.equal(failed.status, 500);
  assert.equal(JSON.stringify(failed.result).includes('forced'), false);

  assert.deepEqual(s.rows('SELECT * FROM questions ORDER BY question_id'), before);
  assert.deepEqual(snapshotOf(s), beforeUnits);
  assert.equal(s.rows('SELECT import_revision FROM activities')[0].import_revision, 1);
});

test('不存在的活動回 404；fixture 建立的題目不受預覽影響', async (t) => {
  const s = await setup(t);
  const missing = await s.teacher.post('/api/activities/nope/import/preview', { spreadsheet: 'x', sheetIds: [1] });
  assert.deepEqual([missing.status, missing.result.error.code], [404, 'ACTIVITY_NOT_FOUND']);
  await fixtureQuestion(s.runtime, s.id);
  await s.preview();
  assert.equal(s.rows('SELECT question_id FROM questions').length, 1);
});

test('整合：匯入的題目可直接開啟、兩組學生送出（含題組）、結束後結果沿用匯入的單位順序', async (t) => {
  const s = await setup(t);
  const { result: { data: { joinCode } } } = await s.teacher.request(`/api/activities/${s.id}/snapshot`);
  await s.confirm((await s.preview()).result.data.previewToken);

  const students = [];
  for (const name of ['甲組', '乙組']) {
    const student = await httpClient(s.url);
    await student.refresh();
    assert.equal((await student.post('/api/join', { joinCode, groupName: name })).status, 200);
    students.push(student);
  }
  assert.equal((await s.teacher.post(`/api/activities/${s.id}/open`, {})).status, 200);

  // 學生快照只看到單位與題號，不含任何來源映射。
  const view = (await students[0].request(`/api/activities/${s.id}/snapshot`)).result.data;
  assert.deepEqual(view.units.map((u) => u.questions.map((q) => q.questionId)), [['1'], ['2', '3', '4'], ['5']]);
  assert.equal(JSON.stringify(view).includes('book'), false);
  assert.equal(JSON.stringify(view).includes('rowIndex'), false);

  const [single, group, last] = view.units;
  const send = (student, unit, text) => student.post(`/api/activities/${s.id}/submissions`,
    { unitId: unit.unitId, answers: unit.questions.map((q) => ({ questionId: q.questionId, text: `${text}${q.questionId}` })) });
  assert.equal((await send(students[0], single, '甲')).status, 200);
  assert.equal((await send(students[1], group, '乙')).status, 200);
  assert.equal((await send(students[0], group, '甲')).status, 200);
  assert.equal((await send(students[1], last, '乙')).status, 200);

  assert.equal((await s.teacher.post(`/api/activities/${s.id}/close`, { confirmed: true })).status, 200);
  const results = (await s.teacher.request(`/api/activities/${s.id}/results`)).result.data;
  assert.deepEqual(results.units.map((u) => u.order), [0, 1, 2]);
  assert.deepEqual(results.units.map((u) => u.submissions.map((x) => x.groupName)), [['甲組'], ['乙組', '甲組'], ['乙組']]);
  assert.deepEqual(results.units[1].submissions[0].answers.map((a) => a.questionId), ['2', '3', '4']);
  assert.equal(results.units[1].submissions[0].isWinner, true);

  // 結束後的原格映射仍在資料庫中，供 #17 寫回使用，且與匯入時一致。
  const mapping = s.rows('SELECT question_id, sheet_id, row_index, column_index FROM questions WHERE activity_id = ? ORDER BY question_id', s.id);
  assert.deepEqual(mapping.map((q) => [q.question_id, q.sheet_id, q.row_index, q.column_index]),
    [['1', 1, 1, 0], ['2', 1, 3, 0], ['3', 2, 0, 0], ['4', 2, 4, 2], ['5', 1, 6, 1]]);
});
