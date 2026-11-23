import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarker } from '../src/import/marker.js';
import { parseSheets, a1 } from '../src/import/parser.js';

// 自動測試用的工作表資料；產品匯入一律來自真實 Sheets（#13）。
function sheet(title, sheetId, placements = [], { merges = [], rows = 20, columns = 6, spreadsheetId = 'book' } = {}) {
  const cells = Array.from({ length: rows }, () => Array(columns).fill(''));
  for (const [row, column, text] of placements) cells[row][column] = text;
  return { spreadsheetId, sheetId, title, rowCount: rows, columnCount: columns, cells, merges };
}
const ids = (result) => result.units.map((u) => u.questions.map((q) => q.questionId));

test('標記：單題、題組、前後空白與識別字字元集', () => {
  assert.deepEqual(parseMarker('{{Q:1}}'), { ok: true, questionId: '1', groupCode: null, marker: '{{Q:1}}', raw: '{{Q:1}}' });
  assert.deepEqual(parseMarker('  {{Q:2|G:A}} \n'),
    { ok: true, questionId: '2', groupCode: 'A', marker: '{{Q:2|G:A}}', raw: '  {{Q:2|G:A}} \n' });
  assert.equal(parseMarker('{{Q:a.b_c-9}}').ok, true);
  assert.equal(parseMarker('一般文字'), null);
  assert.equal(parseMarker(''), null);
  assert.equal(parseMarker(42), null);
});

test('標記：以 {{ 開頭卻不合法者必須回報，不能默默忽略', () => {
  for (const bad of ['{{Q:}}', '{{Q:1|g:A}}', '{{Q:1|G:}}', '{{Q:1}} 多餘', '{{q:1}}', '{{Q:一}}', '{{Q:1|G:A|X}}', '{{Q:1 2}}', '{{}}']) {
    assert.equal(parseMarker(bad)?.ok, false, bad);
  }
});

test('AC-02：題號 1、4、9 不連續，保留原題號且映射跟著新格位', () => {
  const result = parseSheets([sheet('第一週', 11, [[2, 1, '{{Q:1}}'], [7, 3, '{{Q:4}}'], [12, 2, '{{Q:9}}']])]);
  assert.equal(result.ok, true);
  assert.deepEqual(ids(result), [['1'], ['4'], ['9']]);
  assert.deepEqual(result.summary, { questionCount: 3, unitCount: 3 });
  const q4 = result.units[1].questions[0];
  assert.deepEqual([q4.sheetId, q4.rowIndex, q4.columnIndex, q4.originalMarker], [11, 7, 3, '{{Q:4}}']);
  assert.equal(q4.location, '第一週!D8');
});

test('AC-02：同樣題目換格位，映射與結構指紋隨之改變，沒有寫死座標', () => {
  const first = parseSheets([sheet('S', 1, [[0, 0, '{{Q:1}}'], [1, 0, '{{Q:4}}']])]);
  const moved = parseSheets([sheet('S', 1, [[5, 2, '{{Q:1}}'], [9, 4, '{{Q:4}}']])]);
  assert.equal(first.ok && moved.ok, true);
  assert.deepEqual(ids(first), ids(moved));
  assert.notDeepEqual(first.units[0].questions[0].rowIndex, moved.units[0].questions[0].rowIndex);
  assert.notEqual(first.structureFingerprint, moved.structureFingerprint);
  assert.match(first.structureFingerprint, /^[a-f0-9]{64}$/);
});

test('結構指紋對相同結構穩定，對標題、尺寸、合併範圍的改變敏感', () => {
  const base = () => sheet('S', 1, [[0, 0, '{{Q:1}}']], { merges: [{ startRow: 5, endRow: 6, startCol: 0, endCol: 2 }] });
  const fp = (s) => parseSheets([s]).structureFingerprint;
  assert.equal(fp(base()), fp(base()));
  assert.notEqual(fp(base()), fp({ ...base(), title: 'T' }));
  assert.notEqual(fp(base()), fp({ ...base(), rowCount: 21 }));
  assert.notEqual(fp(base()), fp({ ...base(), merges: [] }));
});

test('原格值含前後空白與換行時解析成功，originalMarker 逐字保留完整原值', () => {
  const raw = ['  {{Q:1}} \n', '\t{{Q:2|G:X}}', '{{Q:3|G:X}}\r\n', '{{Q:4}}'];
  const result = parseSheets([sheet('S', 1, raw.map((text, row) => [row, 0, text]))]);
  assert.equal(result.ok, true);
  const markers = result.units.flatMap((u) => u.questions.map((q) => [q.questionId, q.originalMarker]));
  assert.deepEqual(markers, [['1', raw[0]], ['2', raw[1]], ['3', raw[2]], ['4', raw[3]]]);
});

test('原格只有前後空白改變時，結構指紋也跟著改變（避免寫回核對漏判）', () => {
  const fp = (text) => parseSheets([sheet('S', 1, [[0, 0, text]])]).structureFingerprint;
  const plain = fp('{{Q:1}}');
  assert.notEqual(fp('  {{Q:1}} \n'), plain);
  assert.notEqual(fp('{{Q:1}} '), plain);
  assert.notEqual(fp(' {{Q:1}}'), fp('{{Q:1}} '));
  assert.equal(fp('{{Q:1}}'), plain);
});

test('AC-17：兩單題加分散三題題組，得到 5 題 3 單位，順序依首成員位置固定', () => {
  const result = parseSheets([
    sheet('A', 1, [[1, 0, '{{Q:1}}'], [3, 0, '{{Q:2|G:X}}'], [6, 1, '{{Q:5}}']]),
    sheet('B', 2, [[0, 0, '{{Q:3|G:X}}'], [4, 2, '{{Q:4|G:X}}']]),
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, { questionCount: 5, unitCount: 3 });
  assert.deepEqual(result.units.map((u) => [u.unitKey, u.type, u.order]), [['S:1', 'SINGLE', 0], ['G:X', 'GROUP', 1], ['S:5', 'SINGLE', 2]]);
  assert.deepEqual(ids(result), [['1'], ['2', '3', '4'], ['5']]);
  assert.deepEqual(result.units[1].questions.map((q) => [q.order, q.sheetId]), [[0, 1], [1, 2], [2, 2]]);
});

test('掃描順序：同列先欄後列，工作表依教師選擇順序而非 sheetId', () => {
  const a = sheet('A', 1, [[0, 3, '{{Q:b}}'], [0, 1, '{{Q:a}}'], [1, 0, '{{Q:c}}']]);
  const b = sheet('B', 2, [[0, 0, '{{Q:d}}']]);
  assert.deepEqual(ids(parseSheets([a, b])), [['a'], ['b'], ['c'], ['d']]);
  assert.deepEqual(ids(parseSheets([b, a])), [['d'], ['a'], ['b'], ['c']]);
});

test('題組代號與單題題號不會互相撞名', () => {
  const result = parseSheets([sheet('S', 1, [[0, 0, '{{Q:A}}'], [1, 0, '{{Q:1|G:A}}'], [2, 0, '{{Q:2|G:A}}']])]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.units.map((u) => u.unitKey), ['S:A', 'G:A']);
});

test('AC-03：零題被拒絕', () => {
  for (const sheets of [[], [sheet('空白', 1)], [sheet('文字', 1, [[0, 0, '標題'], [1, 1, '作答區']])]]) {
    const result = parseSheets(sheets);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((e) => e.code), ['NO_QUESTIONS']);
  }
});

test('AC-03：重複題號（含跨工作表）被拒絕並指出位置', () => {
  const result = parseSheets([sheet('A', 1, [[0, 0, '{{Q:1}}']]), sheet('B', 2, [[3, 1, '{{Q:1|G:X}}'], [4, 1, '{{Q:2|G:X}}']])]);
  assert.equal(result.ok, false);
  const [error] = result.errors;
  assert.equal(error.code, 'DUPLICATE_QUESTION_ID');
  assert.equal(error.location, 'B!B4');
  assert.match(error.message, /A!A1/);
});

test('AC-03：非法標記被拒絕', () => {
  const result = parseSheets([sheet('S', 1, [[0, 0, '{{Q:1}}'], [1, 0, '{{Q:2|g:A}}']])]);
  assert.deepEqual(result.errors.map((e) => [e.code, e.location]), [['INVALID_MARKER', 'S!A2']]);
});

test('AC-03：單一成員題組被拒絕', () => {
  const result = parseSheets([sheet('S', 1, [[0, 0, '{{Q:1|G:A}}'], [1, 0, '{{Q:2}}'], [2, 0, '{{Q:3|G:B}}'], [3, 0, '{{Q:4|G:B}}']])]);
  assert.deepEqual(result.errors.map((e) => [e.code, e.location]), [['SINGLE_MEMBER_GROUP', 'S!A1']]);
});

test('AC-03：合併儲存格內的答案格被拒絕，單格範圍外不受影響', () => {
  const merges = [{ startRow: 2, endRow: 3, startCol: 1, endCol: 3 }];
  const bad = parseSheets([sheet('S', 1, [[2, 1, '{{Q:1}}'], [5, 1, '{{Q:2}}']], { merges })]);
  assert.deepEqual(bad.errors.map((e) => [e.code, e.location]), [['MERGED_ANSWER_CELL', 'S!B3']]);
  assert.match(bad.errors[0].message, /取消.*合併/, '訊息要告訴老師如何處理');
  const fine = parseSheets([sheet('S', 1, [[3, 1, '{{Q:1}}']], { merges })]);
  assert.equal(fine.ok, true);
});

test('AC-03：一次回報全部錯誤，且失敗時不回傳任何部分結果', () => {
  const result = parseSheets([sheet('S', 1, [[0, 0, '{{Q:1}}'], [1, 0, '{{Q:1}}'], [2, 0, '{{bad}}'], [3, 0, '{{Q:3|G:Z}}']])]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.code).sort(), ['DUPLICATE_QUESTION_ID', 'INVALID_MARKER', 'SINGLE_MEMBER_GROUP']);
  assert.equal('units' in result, false);
});

test('重複選擇同一張工作表被拒絕', () => {
  const s = sheet('S', 1, [[0, 0, '{{Q:1}}']]);
  assert.deepEqual(parseSheets([s, s]).errors.map((e) => e.code), ['DUPLICATE_SHEET']);
});

test('資料不整齊或非字串儲存格不會讓解析器崩潰', () => {
  const result = parseSheets([{ spreadsheetId: 'b', sheetId: 1, title: 'S', rowCount: 3, columnCount: 3,
    cells: [[null, 7, undefined, '{{Q:1}}'], undefined, ['{{Q:2}}']], merges: undefined }]);
  assert.equal(result.ok, true);
  assert.deepEqual(ids(result), [['1'], ['2']]);
});

test('A1 座標轉換', () => {
  assert.equal(a1(0, 0), 'A1');
  assert.equal(a1(9, 25), 'Z10');
  assert.equal(a1(0, 26), 'AA1');
  assert.equal(a1(2, 701), 'ZZ3');
  assert.equal(a1(0, 702), 'AAA1');
});
