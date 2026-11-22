import test from 'node:test';
import assert from 'node:assert/strict';
import { httpFixture, httpClient, teacherClient } from './http-helpers.js';
import { HttpError } from '../src/http-error.js';

// 這些測試使用「有狀態的假 Sheets」：它真的保存格子內容，所以可以驗證寫入後哪些格變了、哪些沒變。
// 它不代表真實線上驗收（AC-12、AC-13、AC-17 仍需在真實 Google Sheets 上人工驗收）。
function makeBook() {
  const blank = () => Array.from({ length: 20 }, () => Array(6).fill(''));
  const sheet = (sheetId, title, placements) => {
    const cells = blank();
    for (const [row, column, text] of placements) cells[row][column] = text;
    return { sheetId, title, rowCount: 20, columnCount: 6, cells, merges: [] };
  };
  const book = {
    sheets: new Map([
      [1, sheet(1, 'A', [[0, 3, '說明文字'], [1, 0, '{{Q:1}}'], [3, 0, '{{Q:2|G:X}}'], [6, 1, '{{Q:5}}'], [8, 2, '其他內容']])],
      [2, sheet(2, 'B', [[0, 0, '{{Q:3|G:X}}'], [4, 2, '{{Q:4|G:X}}'], [5, 5, '旁註']])],
    ]),
    reads: 0, writes: [], mode: 'ok', readsDown: false, gate: null, serviceAccountEmail: 'sa@example.iam.gserviceaccount.com',
    async readSheets({ sheetIds }) {
      this.reads += 1;
      if (this.readsDown) throw new HttpError(502, 'SHEETS_UNAVAILABLE', '逾時');
      return sheetIds.map((id) => {
        const s = this.sheets.get(id);
        if (!s) throw new HttpError(400, 'INVALID_SHEET_SELECTION', '所選工作表不存在。');
        return { spreadsheetId: 'book', ...structuredClone(s) };
      });
    },
    async writeCells({ cells }) {
      this.writes.push(structuredClone(cells));
      if (this.gate) await this.gate;
      const apply = (list) => { for (const c of list) this.sheets.get(c.sheetId).cells[c.rowIndex][c.columnIndex] = c.value; };
      if (this.mode === 'denied') throw new HttpError(403, 'SHEETS_PERMISSION_DENIED', '沒有權限');
      if (this.mode === 'timeoutNoApply') throw new HttpError(502, 'SHEETS_UNAVAILABLE', '逾時');
      if (this.mode === 'timeoutAfterApply') { apply(cells); throw new HttpError(502, 'SHEETS_UNAVAILABLE', '逾時'); }
      if (this.mode === 'timeoutAfterApplyBlind') { apply(cells); this.readsDown = true; throw new HttpError(502, 'SHEETS_UNAVAILABLE', '逾時'); }
      if (this.mode === 'timeoutNoApplyBlind') { this.readsDown = true; throw new HttpError(502, 'SHEETS_UNAVAILABLE', '逾時'); }
      if (this.mode === 'partial') { apply(cells.slice(0, 1)); throw new HttpError(502, 'SHEETS_UNAVAILABLE', '逾時'); }
      apply(cells);
      return { updatedCells: cells.length };
    },
    snapshot() { return structuredClone([...this.sheets.entries()]); },
    cell(sheetId, row, column) { return this.sheets.get(sheetId).cells[row][column]; },
  };
  return book;
}

const GROUP_ANSWERS = { 2: '=1+1', 3: '+SUM(A1:A2)', 4: '第三格\n含換行' };
const WIN_SINGLE = '中文答案\n第二行';

async function setup(t, { close = true } = {}) {
  const book = makeBook();
  const fixture = await httpFixture(t, { sheetsGateway: book });
  const teacher = await teacherClient(fixture.url);
  const activity = (await teacher.post('/api/activities', { mode: 'SPEED' })).result.data;
  const id = activity.activityId;
  const base = `/api/activities/${id}`;
  const preview = await teacher.post(`${base}/import/preview`, { spreadsheet: 'book-id-12345678901234567890', sheetIds: [1, 2] });
  assert.equal(preview.status, 200);
  assert.equal((await teacher.post(`${base}/import/confirm`, { previewToken: preview.result.data.previewToken })).status, 200);
  const groups = [];
  for (const name of ['甲組', '乙組']) {
    const student = await httpClient(fixture.url);
    await student.refresh();
    assert.equal((await student.post('/api/join', { joinCode: activity.joinCode, groupName: name })).status, 200);
    groups.push(student);
  }
  const rows = (sql, ...args) => fixture.runtime.store.read((db) => db.prepare(sql).all(...args));
  const units = rows('SELECT unit_id, type FROM units WHERE activity_id = ? ORDER BY unit_order', id);
  assert.deepEqual(units.map((u) => u.type), ['SINGLE', 'GROUP', 'SINGLE']);
  if (close) {
    assert.equal((await teacher.post(`${base}/open`, {})).status, 200);
    // 單題 1 由甲組勝出；題組 X 由乙組勝出（甲組較晚）；單題 5 無人作答。
    assert.equal((await groups[0].post(`${base}/submissions`, { unitId: units[0].unit_id, answers: [{ questionId: '1', text: WIN_SINGLE }] })).status, 200);
    assert.equal((await groups[1].post(`${base}/submissions`, { unitId: units[1].unit_id, answers: ['2', '3', '4'].map((q) => ({ questionId: q, text: GROUP_ANSWERS[q] })) })).status, 200);
    assert.equal((await groups[0].post(`${base}/submissions`, { unitId: units[1].unit_id, answers: ['2', '3', '4'].map((q) => ({ questionId: q, text: '落敗' + q })) })).status, 200);
    assert.equal((await teacher.post(`${base}/close`, { confirmed: true })).status, 200);
  }
  const write = (body = { confirmedPaused: true }) => teacher.post(`${base}/export/write`, body);
  const previewExport = () => teacher.post(`${base}/export/preview`, {});
  return { ...fixture, book, teacher, groups, id, base, units, rows, write, previewExport };
}

const TARGETS = [[1, 1, 0, WIN_SINGLE], [1, 3, 0, GROUP_ANSWERS[2]], [2, 0, 0, GROUP_ANSWERS[3]], [2, 4, 2, GROUP_ANSWERS[4]]];
const statuses = (view) => Object.fromEntries(view.items.map((i) => [i.questionId, i.status]));

test('預覽：列出題號、勝出組、答案與原目標；不寫入、不改狀態；無人作答與落敗答案不寫', async (t) => {
  const s = await setup(t);
  const before = s.book.snapshot();
  const { status, result } = await s.previewExport();
  assert.equal(status, 200);
  const { data } = result;
  assert.equal(data.canWrite, true);
  assert.equal(data.structureOk, true);
  assert.deepEqual(data.summary, { willWrite: 4, alreadyWritten: 0, noWinner: 1, conflicts: 0 });
  assert.deepEqual(data.units.map((u) => [u.type, u.winnerGroupName]), [['SINGLE', '甲組'], ['GROUP', '乙組'], ['SINGLE', null]]);
  assert.deepEqual(data.units[1].questions.map((q) => [q.questionId, q.answer, q.target.location, q.status]),
    [['2', GROUP_ANSWERS[2], 'A!A4', 'WILL_WRITE'], ['3', GROUP_ANSWERS[3], 'B!A1', 'WILL_WRITE'], ['4', GROUP_ANSWERS[4], 'B!C5', 'WILL_WRITE']]);
  assert.deepEqual([data.units[2].questions[0].answer, data.units[2].questions[0].status], [null, 'NO_WINNER']);
  assert.equal(data.serviceAccountEmail, s.book.serviceAccountEmail);
  assert.deepEqual(s.book.snapshot(), before);
  assert.equal(s.book.writes.length, 0);
  assert.equal(s.rows('SELECT * FROM exports').length, 0, '預覽不留下匯出紀錄');
});

test('權限與狀態：未登入、學生拒絕；未結束不可預覽或寫回；未確認暫停編輯不寫入', async (t) => {
  const s = await setup(t);
  const anonymous = await httpClient(s.url);
  await anonymous.refresh();
  for (const path of ['export/preview', 'export/write']) {
    assert.equal((await anonymous.post(`${s.base}/${path}`, { confirmedPaused: true })).status, 401);
    assert.equal((await s.groups[0].post(`${s.base}/${path}`, { confirmedPaused: true })).status, 403);
  }
  assert.equal((await s.groups[0].request(`${s.base}/exports`)).status, 403);
  for (const body of [{}, { confirmedPaused: 'true' }, { confirmedPaused: false }, []]) {
    const r = await s.write(body);
    assert.deepEqual([r.status, r.result.error.code], [400, 'EXPORT_CONFIRMATION_REQUIRED']);
  }
  assert.equal(s.book.writes.length, 0);

  const open = await setup(t, { close: false });
  for (const r of [await open.previewExport(), await open.write()]) assert.deepEqual([r.status, r.result.error.code], [409, 'INVALID_PHASE']);
  assert.equal(open.book.reads, 1, '只有匯入時讀過 Sheets');
});

test('AC-12／AC-17：RAW 寫回中文、換行、公式開頭；題組各格更新；無人作答與其他內容不變；回讀核對後記錄成功', async (t) => {
  const s = await setup(t);
  const before = s.book.snapshot();
  const { status, result } = await s.write();
  assert.equal(status, 200);
  assert.equal(result.data.status, 'SUCCEEDED');
  assert.deepEqual(statuses(result.data), { 1: 'SUCCEEDED', 2: 'SUCCEEDED', 3: 'SUCCEEDED', 4: 'SUCCEEDED' });
  assert.ok(result.data.items.every((i) => i.verifiedAt));

  for (const [sheetId, row, column, text] of TARGETS) assert.equal(s.book.cell(sheetId, row, column), text);
  // 除了四個目標格，整份試算表（含無人作答的 Q:5、說明與旁註）必須完全相同。
  const expected = structuredClone(before);
  for (const [sheetId, row, column, text] of TARGETS) expected.find(([id]) => id === sheetId)[1].cells[row][column] = text;
  assert.deepEqual(s.book.snapshot(), expected);
  assert.equal(s.book.cell(1, 6, 1), '{{Q:5}}');
  assert.equal(s.book.writes.length, 1, '一次批次寫入');
  assert.equal(s.book.writes[0].length, 4);
  const [exported] = s.rows('SELECT * FROM exports');
  assert.equal(exported.status, 'SUCCEEDED');
  const items = s.rows('SELECT question_id, expected_before, intended_answer, status FROM export_items ORDER BY question_id');
  assert.deepEqual(items.map((i) => [i.question_id, i.expected_before, i.status]), [['1', '{{Q:1}}', 'SUCCEEDED'], ['2', '{{Q:2|G:X}}', 'SUCCEEDED'], ['3', '{{Q:3|G:X}}', 'SUCCEEDED'], ['4', '{{Q:4|G:X}}', 'SUCCEEDED']]);
});

test('重複匯出：已確認寫入的內容被識別，不再寫入，仍回報成功', async (t) => {
  const s = await setup(t);
  assert.equal((await s.write()).status, 200);
  const snapshot = s.book.snapshot();
  const again = await s.write();
  assert.equal(again.status, 200);
  assert.equal(again.result.data.status, 'SUCCEEDED');
  assert.equal(s.book.writes.length, 1, '第二次不呼叫寫入');
  assert.deepEqual(s.book.snapshot(), snapshot);
  const preview = (await s.previewExport()).result.data;
  assert.deepEqual([preview.canWrite, preview.summary.alreadyWritten, preview.summary.willWrite], [true, 4, 0]);
  assert.equal(s.rows('SELECT * FROM exports').length, 2);
});

test('AC-13：匯入後移動、刪除、改寫、結構改變都在寫入前被偵測，停止且不寫任何一格', async (t) => {
  const mutations = {
    '標記被移動到別格': (b) => { const s = b.sheets.get(1); s.cells[1][1] = s.cells[1][0]; s.cells[1][0] = ''; },
    '標記被刪除': (b) => { b.sheets.get(2).cells[4][2] = ''; },
    '標記被改寫': (b) => { b.sheets.get(1).cells[3][0] = '老師改過的文字'; },
    '沒有答案的 Q:5 被改寫': (b) => { b.sheets.get(1).cells[6][1] = '被改過'; },
    '上方插入一列（列數改變、標記下移）': (b) => { const s = b.sheets.get(1); s.cells.unshift(Array(6).fill('')); s.rowCount += 1; },
    '工作表改名': (b) => { b.sheets.get(2).title = '改名了'; },
    '工作表被刪除': (b) => { b.sheets.delete(2); },
    '合併儲存格改變': (b) => { b.sheets.get(1).merges.push({ startRow: 10, endRow: 12, startCol: 0, endCol: 2 }); },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const s = await setup(t);
    mutate(s.book);
    const snapshot = s.book.snapshot();
    const preview = await s.previewExport();
    assert.equal(preview.status, 200, name);
    assert.equal(preview.result.data.canWrite, false, name);

    const { status, result } = await s.write();
    assert.deepEqual([status, result.error.code], [409, 'EXPORT_CONFLICT'], name);
    assert.match(result.error.message, /重新匯入/, name);
    assert.equal(result.error.details.status, 'CONFLICT', name);
    assert.equal(s.book.writes.length, 0, `${name}：不得寫入任何格`);
    assert.deepEqual(s.book.snapshot(), snapshot, name);
    assert.equal(s.rows('SELECT status FROM exports')[0].status, 'CONFLICT', name);
  }
});

test('結構恢復原狀後可重新寫回（不需重新匯入）', async (t) => {
  const s = await setup(t);
  const original = s.book.sheets.get(2).title;
  s.book.sheets.get(2).title = '暫時改名';
  assert.equal((await s.write()).status, 409);
  s.book.sheets.get(2).title = original;
  const ok = await s.write();
  assert.equal(ok.status, 200);
  assert.equal(ok.result.data.status, 'SUCCEEDED');
});

test('寫入逾時但實際已套用：先回讀核對，確認內容相同後才記為成功', async (t) => {
  const s = await setup(t);
  s.book.mode = 'timeoutAfterApply';
  const r = await s.write();
  assert.equal(r.status, 200);
  assert.equal(r.result.data.status, 'SUCCEEDED');
  for (const [sheetId, row, column, text] of TARGETS) assert.equal(s.book.cell(sheetId, row, column), text);
});

test('寫入逾時且確實未寫入：回讀確認沒變，標記失敗（非成功），內容不變，重試成功', async (t) => {
  const s = await setup(t);
  const before = s.book.snapshot();
  s.book.mode = 'timeoutNoApply';
  const r = await s.write();
  assert.equal(r.status, 502);
  assert.equal(r.result.error.details.status, 'FAILED');
  assert.ok(r.result.error.details.items.every((i) => i.status === 'FAILED'));
  assert.deepEqual(s.book.snapshot(), before);

  s.book.mode = 'ok';
  const retry = await s.write();
  assert.equal(retry.status, 200);
  assert.deepEqual(s.rows('SELECT status FROM exports ORDER BY created_at, rowid').map((e) => e.status), ['FAILED', 'SUCCEEDED']);
});

test('寫入逾時又無法回讀：標為待核對（不是成功也不是失敗）；之後重試先回讀，已寫入者不再重寫', async (t) => {
  const s = await setup(t);
  s.book.mode = 'timeoutAfterApplyBlind';
  const r = await s.write();
  assert.deepEqual([r.status, r.result.error.code], [502, 'EXPORT_PENDING_VERIFICATION']);
  assert.equal(r.result.error.details.status, 'PENDING_VERIFICATION');
  assert.ok(r.result.error.details.items.every((i) => i.status === 'PENDING_VERIFICATION'));

  s.book.readsDown = false;
  s.book.mode = 'ok';
  const retry = await s.write();
  assert.equal(retry.status, 200);
  assert.equal(retry.result.data.status, 'SUCCEEDED');
  assert.equal(s.book.writes.length, 1, '回讀確認已寫入，不重複寫入');
  const exportId = s.rows('SELECT export_id FROM exports ORDER BY created_at, rowid')[0].export_id;
  const first = await s.teacher.request(`${s.base}/exports/${exportId}`);
  assert.equal(first.result.data.status, 'PENDING_VERIFICATION', '舊紀錄保留當時實況');
});

test('待核對後確實沒寫入：重試會寫入；待核對後被外部改成不同內容：衝突停止，不覆寫', async (t) => {
  const notWritten = await setup(t);
  notWritten.book.mode = 'timeoutNoApplyBlind';
  assert.equal((await notWritten.write()).result.error.code, 'EXPORT_PENDING_VERIFICATION');
  notWritten.book.readsDown = false;
  notWritten.book.mode = 'ok';
  assert.equal((await notWritten.write()).status, 200);
  assert.equal(notWritten.book.cell(1, 1, 0), WIN_SINGLE);

  const edited = await setup(t);
  edited.book.mode = 'timeoutAfterApplyBlind';
  assert.equal((await edited.write()).result.error.code, 'EXPORT_PENDING_VERIFICATION');
  edited.book.readsDown = false;
  edited.book.mode = 'ok';
  edited.book.sheets.get(1).cells[1][0] = '老師手動輸入的不同內容';
  const retry = await edited.write();
  assert.deepEqual([retry.status, retry.result.error.code], [409, 'EXPORT_CONFLICT']);
  assert.equal(edited.book.cell(1, 1, 0), '老師手動輸入的不同內容', '外部修改不被覆寫');
  assert.equal(retry.result.error.details.items.find((i) => i.questionId === '1').status, 'CONFLICT');
});

test('部分套用：回讀逐格核對，已寫與未寫各自如實記錄，不回報整批成功；重試只補寫未完成者', async (t) => {
  const s = await setup(t);
  s.book.mode = 'partial';
  const r = await s.write();
  assert.equal(r.status, 502);
  const view = r.result.error.details;
  assert.equal(view.status, 'FAILED');
  assert.deepEqual(statuses(view), { 1: 'SUCCEEDED', 2: 'FAILED', 3: 'FAILED', 4: 'FAILED' });
  assert.equal(s.book.cell(1, 1, 0), WIN_SINGLE);
  assert.equal(s.book.cell(1, 3, 0), '{{Q:2|G:X}}');

  s.book.mode = 'ok';
  const retry = await s.write();
  assert.equal(retry.status, 200);
  assert.equal(s.book.writes.at(-1).length, 3, '只補寫三格');
  for (const [sheetId, row, column, text] of TARGETS) assert.equal(s.book.cell(sheetId, row, column), text);
});

test('權限不足：Google 明確拒絕，標記失敗並回報原錯誤碼；補權限後重試成功', async (t) => {
  const s = await setup(t);
  const before = s.book.snapshot();
  s.book.mode = 'denied';
  const r = await s.write();
  assert.deepEqual([r.status, r.result.error.code], [403, 'SHEETS_PERMISSION_DENIED']);
  assert.equal(r.result.error.details.status, 'FAILED');
  assert.deepEqual(s.book.snapshot(), before);
  s.book.mode = 'ok';
  assert.equal((await s.write()).status, 200);
});

test('只因為格內剛好是同樣文字，不能當成已寫入：沒有成功紀錄就視為外部內容衝突', async (t) => {
  const s = await setup(t);
  s.book.sheets.get(1).cells[1][0] = WIN_SINGLE; // 有人手動輸入了和勝出答案一樣的文字
  const preview = (await s.previewExport()).result.data;
  assert.equal(preview.canWrite, false);
  const r = await s.write();
  assert.deepEqual([r.status, r.result.error.code], [409, 'EXPORT_CONFLICT']);
  assert.equal(s.book.writes.length, 0);
});

test('寫入前重讀失敗（Sheets 不可用）：不寫入、記為失敗並回報錯誤，之後可重試', async (t) => {
  const s = await setup(t);
  s.book.readsDown = true;
  const r = await s.write();
  assert.equal(r.status, 502);
  assert.equal(r.result.error.details.status, 'FAILED');
  assert.equal(s.book.writes.length, 0);
  s.book.readsDown = false;
  assert.equal((await s.write()).status, 200);
});

test('同一活動互斥：寫回進行中再次寫回被拒絕，完成後可再執行', async (t) => {
  const s = await setup(t);
  let release;
  s.book.gate = new Promise((resolve) => { release = resolve; });
  const first = s.write();
  while (s.book.writes.length === 0) await new Promise((r) => setTimeout(r, 10));
  const second = await s.write();
  assert.deepEqual([second.status, second.result.error.code], [409, 'EXPORT_IN_PROGRESS']);
  release();
  assert.equal((await first).status, 200);
  assert.equal(s.book.writes.length, 1);
  assert.equal((await s.write()).status, 200);
});

test('伺服器中斷留下的 WRITING 紀錄：顯示為待核對，下次寫回先轉為待核對並以回讀處理', async (t) => {
  const s = await setup(t);
  // 模擬上一次寫回在 Google 呼叫期間伺服器被中止：資料庫留下 WRITING／PENDING，線上其實已寫入。
  s.book.sheets.get(1).cells[1][0] = WIN_SINGLE;
  await s.runtime.store.write(s.id, (db) => {
    db.prepare("INSERT INTO exports VALUES ('stale-export', ?, 'WRITING', '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z')").run(s.id);
    const q = db.prepare('SELECT * FROM questions WHERE activity_id = ? AND question_id = ?').get(s.id, '1');
    db.prepare("INSERT INTO export_items VALUES ('stale-export', ?, '1', ?, ?, ?, ?, '{{Q:1}}', ?, 'PENDING', NULL, NULL)")
      .run(s.id, q.spreadsheet_id, q.sheet_id, q.row_index, q.column_index, WIN_SINGLE);
  });
  const view = await s.teacher.request(`${s.base}/exports/stale-export`);
  assert.equal(view.result.data.status, 'PENDING_VERIFICATION');
  assert.equal(view.result.data.items[0].status, 'PENDING_VERIFICATION');

  const r = await s.write();
  assert.equal(r.status, 200, '第 1 題線上已是預期內容且有待核對紀錄：回讀確認即可，不衝突');
  assert.equal(s.book.writes.length, 1);
  assert.equal(s.book.writes[0].length, 3, '只寫其餘三格，第 1 題不重寫');
  assert.equal(s.rows("SELECT status FROM exports WHERE export_id = 'stale-export'")[0].status, 'PENDING_VERIFICATION');
});

test('匯出紀錄查詢：只有該活動的教師可讀；列表依時間新到舊；找不到回 404', async (t) => {
  const s = await setup(t);
  s.book.mode = 'timeoutNoApply';
  await s.write();
  s.book.mode = 'ok';
  const ok = await s.write();
  const list = await s.teacher.request(`${s.base}/exports`);
  assert.deepEqual(list.result.data.exports.map((e) => e.status), ['SUCCEEDED', 'FAILED']);
  assert.equal((await s.teacher.request(`${s.base}/exports/${ok.result.data.exportId}`)).status, 200);
  assert.equal((await s.teacher.request(`${s.base}/exports/missing`)).status, 404);
  assert.equal((await s.groups[0].request(`${s.base}/exports/${ok.result.data.exportId}`)).status, 403);
});

test('確認匯入時保存選取的工作表與順序；重新匯入會替換', async (t) => {
  const s = await setup(t, { close: false });
  assert.deepEqual(s.rows('SELECT spreadsheet_id, sheet_ids_json FROM import_sources').map((r) => [r.spreadsheet_id, r.sheet_ids_json]), [['book', '[1,2]']]);
  const again = await s.teacher.post(`${s.base}/import/preview`, { spreadsheet: 'book-id-12345678901234567890', sheetIds: [2, 1] });
  assert.equal((await s.teacher.post(`${s.base}/import/confirm`, { previewToken: again.result.data.previewToken })).status, 200);
  assert.deepEqual(s.rows('SELECT sheet_ids_json FROM import_sources').map((r) => r.sheet_ids_json), ['[2,1]']);
});

test('選取順序為 [2,1] 時結構重驗與寫回仍正確（指紋依選取順序）', async (t) => {
  const s = await setup(t, { close: false });
  const again = await s.teacher.post(`${s.base}/import/preview`, { spreadsheet: 'book-id-12345678901234567890', sheetIds: [2, 1] });
  assert.equal((await s.teacher.post(`${s.base}/import/confirm`, { previewToken: again.result.data.previewToken })).status, 200);
  const units = s.rows('SELECT unit_id, type FROM units WHERE activity_id = ? ORDER BY unit_order', s.id);
  assert.deepEqual(units.map((u) => u.type), ['GROUP', 'SINGLE', 'SINGLE'], '先掃描工作表 B，題組 X 的首成員在前');
  const order = s.rows('SELECT question_id FROM questions WHERE activity_id = ? AND unit_id = ? ORDER BY question_order', s.id, units[0].unit_id).map((q) => q.question_id);
  assert.deepEqual(order, ['3', '4', '2']);
  assert.equal((await s.teacher.post(`${s.base}/open`, {})).status, 200);
  const submit = await s.groups[0].post(`${s.base}/submissions`, { unitId: units[0].unit_id, answers: order.map((q) => ({ questionId: q, text: `答${q}` })) });
  assert.equal(submit.status, 200);
  assert.equal((await s.teacher.post(`${s.base}/close`, { confirmed: true })).status, 200);
  const r = await s.write();
  assert.equal(r.status, 200);
  assert.deepEqual([s.book.cell(2, 0, 0), s.book.cell(2, 4, 2), s.book.cell(1, 3, 0)], ['答3', '答4', '答2']);
  assert.equal(s.book.cell(1, 1, 0), '{{Q:1}}', '無人作答的單題不變');
});
