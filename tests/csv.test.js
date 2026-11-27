import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResultsCsv, neutralizeFormula, escapeField, CSV_COLUMNS } from '../src/export/csv.js';
import { httpFixture, httpClient, teacherClient } from './http-helpers.js';

// 迷你 RFC 4180 解析器：只以 CRLF 作為列結尾，引號內的換行與逗號原樣保留。
// 用來把輸出解析回表格再比對，驗證轉義是否正確（而不是只比對字串）。
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (char === '"') quoted = false; else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; } else if (char === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; } else field += char;
  }
  assert.equal(quoted, false, '引號必須成對');
  assert.equal(field === '' && row.length === 0, true, '最後一列必須以 CRLF 結尾');
  return rows;
}
const BOM = '﻿';
const deepFreeze = (value) => { Object.values(value).forEach((v) => typeof v === 'object' && v !== null && deepFreeze(v)); return Object.freeze(value); };

/* ---------- 純函式 ---------- */
test('公式防護：去除前導空白後以 = + - @ 開頭，或有前導 tab／CR／LF 才加單引號', () => {
  const guarded = [['=1+1', "'=1+1"], ['+1', "'+1"], ['-1', "'-1"], ['@SUM(A1)', "'@SUM(A1)"], ['  =1', "'  =1"], [' \t +cmd', "' \t +cmd"],
    ['\t=1', "'\t=1"], ['\r=1', "'\r=1"], ['\nabc', "'\nabc"], ['\t普通文字', "'\t普通文字"], [' =1', "' =1"], ['　@x', "'　@x"],
    ['=HYPERLINK("http://x","y")', "'=HYPERLINK(\"http://x\",\"y\")"], ['- 條列文字', "'- 條列文字"]];
  for (const [input, expected] of guarded) assert.equal(neutralizeFormula(input), expected, JSON.stringify(input));
  const untouched = ['abc=1', '1+1', '中文答案', "'=1", 'a-b', 'email@example.com', '', '  普通', '"=1"', '＝全形'];
  for (const input of untouched) assert.equal(neutralizeFormula(input), input, JSON.stringify(input));
});

test('回歸（review #35）：前導空白「中」含 tab／CR／LF 也要防護，不只第一個字元', () => {
  // 空白＋控制字元＋普通文字：整段前導空白含 tab／CR／LF，必須加前綴。
  const guarded = [' \tabc', ' \n中文', '　\r普通', '  \t  普通答案', ' \n文字', ' \r\n 文字', '\t \t文字', ' \t=1', '\n\n普通'];
  for (const input of guarded) assert.equal(neutralizeFormula(input), `'${input}`, JSON.stringify(input));
  // 控制字元在文字「中間」不算前導，不得誤加；純空白也不算。
  const untouched = ['abc\tdef', 'abc\ndef', '普通 \t文字', 'a \t b', '  普通', '　普通', 'abc\r\n=1', '中文\n- 條列'];
  for (const input of untouched) assert.equal(neutralizeFormula(input), input, JSON.stringify(input));
  // 原有行為不變。
  assert.equal(neutralizeFormula('\tabc'), "'\tabc");
  assert.equal(neutralizeFormula('  =1'), "'  =1");
});

test('逃脫：逗號、雙引號、CR、LF 加引號並將雙引號加倍；其餘不加', () => {
  assert.equal(escapeField('plain'), 'plain');
  assert.equal(escapeField('a,b'), '"a,b"');
  assert.equal(escapeField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeField('line1\nline2'), '"line1\nline2"');
  assert.equal(escapeField('a\rb'), '"a\rb"');
  assert.equal(escapeField(null), '');
  assert.equal(escapeField(undefined), '');
  assert.equal(escapeField(0), '0');
  assert.equal(escapeField('中文，全形逗號不需引號'), '中文，全形逗號不需引號');
});

const sub = (submissionId, groupName, acceptedOrder, rank, isWinner, answers) => ({
  submissionId, groupName, groupId: groupName, acceptedAt: `2026-11-20T01:00:0${acceptedOrder}.123Z`, acceptedOrder, rank, isWinner, answers });
const results = () => ({
  activityId: 'act-1', mode: 'FAIR', state: 'CLOSED',
  // 刻意讓陣列順序與 order／rank 不同，驗證排序。
  units: [
    { unitId: 'u2', type: 'SINGLE', order: 1, questions: [{ questionId: '9', order: 0 }], winnerSubmissionId: null, submissions: [] },
    { unitId: 'u1', type: 'GROUP', groupCode: 'A', order: 0, questions: [{ questionId: '3', order: 0 }, { questionId: '2', order: 1 }], winnerSubmissionId: 's1', submissions: [
      sub('s2', '乙組', 1, 2, false, [{ questionId: '2', text: '乙-2' }, { questionId: '3', text: '乙-3' }]),
      sub('s1', '甲,組 "A"', 2, 1, true, [{ questionId: '2', text: '多行\n答案, 含 "引號"' }, { questionId: '3', text: '甲-3' }]),
    ] },
    { unitId: 'u4', type: 'GROUP', groupCode: 'B-2.1', order: 3, questions: [{ questionId: '8', order: 1 }, { questionId: '7', order: 0 }], winnerSubmissionId: null, submissions: [] },
    { unitId: 'u3', type: 'SINGLE', order: 2, questions: [{ questionId: '-5', order: 0 }], winnerSubmissionId: 's3', submissions: [
      sub('s3', '=cmd|calc', 3, 1, true, [{ questionId: '-5', text: ' =1+1' }]),
    ] },
  ],
});

test('AC-19：BOM、固定欄位、CRLF；依單位順序、最終順位、組內題序排序，題組共用序號與順位', () => {
  const text = buildResultsCsv(results());
  assert.equal(text.startsWith(BOM), true);
  assert.equal(text.endsWith('\r\n'), true);
  const rows = parseCsv(text.slice(1));
  assert.deepEqual(rows[0], ['activity_id', 'mode', 'unit_id', 'question_id', 'group_name', 'answer', 'accepted_at', 'accepted_order', 'rank', 'is_winner']);
  assert.deepEqual(rows[0], CSV_COLUMNS);
  assert.ok(rows.every((row) => row.length === 10), '每列 10 欄');
});

test('AC-19：排序與展開的完整預期（逐列比對）', () => {
  const rows = parseCsv(buildResultsCsv(results()).slice(1)).slice(1);
  // 單位 u1（order 0）：順位 1 的甲組先，再乙組；組內依題序（題 3 的 order 0 在題 2 之前）。
  // 單位 u2（order 1）：無人作答。單位 u3（order 2）：單題。單位 u4（order 3）：無人作答，依題序 7 再 8。
  assert.deepEqual(rows.map((r) => [r[2], r[3], r[4], r[7], r[8], r[9]]), [
    ['G:A', '3', '甲,組 "A"', '2', '1', 'true'], ['G:A', '2', '甲,組 "A"', '2', '1', 'true'],
    ['G:A', '3', '乙組', '1', '2', 'false'], ['G:A', '2', '乙組', '1', '2', 'false'],
    ['Q:9', '9', '', '', '', 'false'],
    ['Q:-5', "'-5", "'=cmd|calc", '3', '1', 'true'],
    ['G:B-2.1', '7', '', '', '', 'false'], ['G:B-2.1', '8', '', '', '', 'false'],
  ]);
  assert.deepEqual(rows[0].slice(0, 2), ['act-1', 'FAIR']);
});

test('AC-19：中文、引號、逗號、換行逐字還原；時間為 UTC ISO 8601', () => {
  const rows = parseCsv(buildResultsCsv(results()).slice(1)).slice(1);
  const jia = rows.filter((r) => r[4] === '甲,組 "A"');
  assert.equal(jia.length, 2);
  assert.deepEqual(jia.map((r) => r[5]), ['甲-3', '多行\n答案, 含 "引號"']);
  assert.ok(rows.filter((r) => r[6]).every((r) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r[6])));
});

test('AC-19：無人作答題每題仍一列，組別、答案、時間、序號、順位留空，is_winner 為 false', () => {
  const rows = parseCsv(buildResultsCsv(results()).slice(1)).slice(1);
  const empty = rows.filter((r) => r[2] === 'Q:9' || r[2] === 'G:B-2.1');
  assert.equal(empty.length, 3, '題組 u4 有 2 題，各一列；u2 一列');
  for (const r of empty) assert.deepEqual([r[4], r[5], r[6], r[7], r[8], r[9]], ['', '', '', '', '', 'false']);
});

test('AC-20：組名、答案、題號含公式開頭或前導控制字元時加防護前綴，輸入物件不被修改', () => {
  const input = deepFreeze(results());
  const before = JSON.stringify(input);
  const rows = parseCsv(buildResultsCsv(input).slice(1)).slice(1);
  const risky = rows.find((r) => r[2] === 'Q:-5');
  assert.equal(risky[3], "'-5", 'question_id');
  assert.equal(risky[4], "'=cmd|calc", 'group_name');
  assert.equal(risky[5], "' =1+1", 'answer（前導空白後為 =）');
  assert.equal(JSON.stringify(input), before, '原資料不變');
  // 系統產生的欄位不加前綴。
  assert.ok(rows.every((r) => !r[0].startsWith("'") && !r[1].startsWith("'") && !r[2].startsWith("'") && !r[6].startsWith("'")));
});

test('沒有任何單位時仍輸出 BOM 與標題列', () => {
  const text = buildResultsCsv({ activityId: 'a', mode: 'SPEED', state: 'CLOSED', units: [] });
  assert.equal(text, `${BOM}${CSV_COLUMNS.join(',')}\r\n`);
});

test('AC-26：缺少或非法題組代號不可退回內部 ID／G:undefined', () => {
  for (const groupCode of [undefined, '', 'A|B']) {
    assert.throws(() => buildResultsCsv({ activityId: 'a', mode: 'SPEED', units: [
      { unitId: 'private-uuid', type: 'GROUP', groupCode, order: 0, questions: [{ questionId: '7a', order: 0 }], submissions: [] },
    ] }), /缺少合法/);
  }
});

test('AC-26（HTTP）：既有活動從保存標記還原題組代號，不改 JSON ID；映射損壞明確拒絕', async (t) => {
  const f = await closedActivity(t);
  await f.teacher.post(`${f.base}/open`, {});
  await f.teacher.post(`${f.base}/close`, { confirmed: true });
  const original = (await f.teacher.request(`${f.base}/results`)).result.data;
  const response = await fetch(f.url + f.base + '/results.csv', { headers: { Cookie: f.teacher.cookie } });
  assert.equal(response.status, 200);
  // fetch.text() 會去除 BOM；使用相同解析器驗證無人作答題組仍共用 G:X。
  const rows = parseCsv((await response.text()).replace(/^\uFEFF/, '')).slice(1);
  assert.deepEqual(rows.map(row => row[2]), ['Q:1', 'G:X', 'G:X', 'Q:4']);
  assert.deepEqual((await f.teacher.request(`${f.base}/results`)).result.data, original);
  assert.deepEqual(original.units.map(u => u.unitId), ['single', 'group', 'empty']);
  await f.runtime.store.write(f.activity.activityId, db => db.prepare("UPDATE questions SET original_marker = '{{Q:3|G:OTHER}}' WHERE activity_id = ? AND question_id = '3'").run(f.activity.activityId));
  const invalid = await f.teacher.request(`${f.base}/results.csv`);
  assert.equal(invalid.status, 409);
  assert.equal(invalid.result.error.code, 'EXPORT_MAPPING_INVALID');
});

/* ---------- HTTP：權限、狀態、標頭與位元組 ---------- */
async function closedActivity(t) {
  const f = await httpFixture(t);
  const teacher = await teacherClient(f.url);
  const activity = (await teacher.post('/api/activities', { mode: 'SPEED' })).result.data;
  const base = `/api/activities/${activity.activityId}`;
  // 測試專用：直接放入題目（產品由匯入功能建立）。
  await f.runtime.store.write(activity.activityId, (db) => {
    const unit = db.prepare('INSERT INTO units VALUES (?, ?, ?, ?)');
    const question = db.prepare('INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    unit.run(activity.activityId, 'single', 'SINGLE', 0);
    question.run(activity.activityId, 'single', '1', 0, 'fixture', 0, 0, 0, '{{Q:1}}', 'fixture');
    unit.run(activity.activityId, 'group', 'GROUP', 1);
    question.run(activity.activityId, 'group', '2', 0, 'fixture', 0, 1, 0, '{{Q:2|G:X}}', 'fixture');
    question.run(activity.activityId, 'group', '3', 1, 'fixture', 0, 2, 0, '{{Q:3|G:X}}', 'fixture');
    unit.run(activity.activityId, 'empty', 'SINGLE', 2);
    question.run(activity.activityId, 'empty', '4', 0, 'fixture', 0, 3, 0, '{{Q:4}}', 'fixture');
  });
  const students = [];
  for (const name of ['甲,組', '=HYPERLINK("x")']) {
    const student = await httpClient(f.url);
    await student.refresh();
    assert.equal((await student.post('/api/join', { joinCode: activity.joinCode, groupName: name })).status, 200);
    students.push(student);
  }
  return { ...f, teacher, students, activity, base };
}
const submit = (student, base, unitId, answers) => student.post(`${base}/submissions`, { unitId, answers });

test('AC-19／AC-20（HTTP）：教師結束後下載，標頭、BOM 位元組、CRLF 與內容和固定結果一致；資料庫原值不變', async (t) => {
  const f = await closedActivity(t);
  const [a, b] = f.students;
  assert.equal((await f.teacher.post(`${f.base}/open`, {})).status, 200);
  assert.equal((await submit(a, f.base, 'single', [{ questionId: '1', text: '=1+1' }])).status, 200);
  assert.equal((await submit(b, f.base, 'group', [{ questionId: '2', text: '第一行\n第二行, "引號"' }, { questionId: '3', text: '\t+cmd' }])).status, 200);
  assert.equal((await f.teacher.post(`${f.base}/close`, { confirmed: true })).status, 200);

  const res = await fetch(`${f.url}${f.base}/results.csv`, { headers: { Cookie: f.teacher.cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="classroom-results-[0-9a-f]{8}\.csv"$/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'UTF-8 BOM 位元組');
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  assert.equal(text.startsWith('﻿'), true);

  const rows = parseCsv(text.slice(1));
  assert.deepEqual(rows[0], CSV_COLUMNS);
  const data = rows.slice(1);
  // 單題一列、題組兩題兩列（依題序）、無人作答的單位仍一列。
  assert.deepEqual(data.map((r) => [r[2], r[3]]), [['Q:1', '1'], ['G:X', '2'], ['G:X', '3'], ['Q:4', '4']]);
  const results = (await f.teacher.request(`${f.base}/results`)).result.data;
  assert.ok(data.every((r) => r[0] === f.activity.activityId && r[1] === 'SPEED'));

  // 與 results API（固定結果）逐筆對照：防護前綴以外，內容完全一致。
  const unguard = (value) => (value.startsWith("'") ? value.slice(1) : value);
  for (const unit of results.units) {
    for (const submission of unit.submissions) {
      for (const answer of submission.answers) {
        const row = data.find((r) => r[3] === answer.questionId && unguard(r[4]) === submission.groupName);
        assert.ok(row, `${unit.unitId}/${answer.questionId}`);
        assert.equal(unguard(row[5]), answer.text);
        assert.deepEqual([row[6], Number(row[7]), Number(row[8]), row[9]], [submission.acceptedAt, submission.acceptedOrder, submission.rank, String(submission.isWinner)]);
      }
    }
  }
  const empty = data.find((r) => r[2] === 'Q:4');
  assert.deepEqual([empty[4], empty[5], empty[6], empty[7], empty[8], empty[9]], ['', '', '', '', '', 'false']);

  // 防護只影響輸出：結果 API 與資料庫仍是原文。
  assert.equal(results.units.find((u) => u.unitId === 'single').submissions[0].answers[0].text, '=1+1');
  const guarded = data.find((r) => r[2] === 'Q:1');
  assert.equal(guarded[5], "'=1+1");
  const groupRow = data.find((r) => r[2] === 'G:X' && r[3] === '3');
  assert.deepEqual([groupRow[4], groupRow[5]], [`'=HYPERLINK("x")`, "'\t+cmd"], '組名與答案都有前導防護');
  assert.equal(data.find((r) => r[2] === 'G:X' && r[3] === '2')[5], '第一行\n第二行, "引號"', '一般內容不加前綴，換行與引號還原');
  const stored = f.runtime.store.read((db) => db.prepare('SELECT answer FROM submission_answers ORDER BY answer').all().map((x) => x.answer));
  assert.deepEqual(stored, ['\t+cmd', '=1+1', '第一行\n第二行, "引號"']);
  assert.equal(text.includes('\r\n'), true);
  assert.equal(text.replaceAll('\r\n', '').includes('\r'), false, '沒有落單的 CR');
});

test('權限與狀態：學生、匿名被拒；未結束回 409；找不到活動回 404；多次下載內容相同', async (t) => {
  const f = await closedActivity(t);
  const url = `${f.url}${f.base}/results.csv`;
  const asStudent = await fetch(url, { headers: { Cookie: f.students[0].cookie } });
  assert.equal(asStudent.status, 403);
  assert.equal((await asStudent.text()).includes('classroom-results'), false);
  const anonymous = await httpClient(f.url);
  await anonymous.refresh();
  assert.equal((await fetch(url, { headers: { Cookie: anonymous.cookie } })).status, 401);
  assert.equal((await fetch(url)).status, 401, '沒有 Cookie');

  const early = await fetch(url, { headers: { Cookie: f.teacher.cookie } });
  assert.equal(early.status, 409, '準備中');
  assert.equal((await early.json()).error.code, 'RESULTS_NOT_READY');
  assert.equal((await f.teacher.post(`${f.base}/open`, {})).status, 200);
  assert.equal((await fetch(url, { headers: { Cookie: f.teacher.cookie } })).status, 409, '搶答中');

  assert.equal((await f.teacher.post(`${f.base}/close`, { confirmed: true })).status, 200);
  const missing = await fetch(`${f.url}/api/activities/nope/results.csv`, { headers: { Cookie: f.teacher.cookie } });
  assert.equal(missing.status, 404);
  const first = await (await fetch(url, { headers: { Cookie: f.teacher.cookie } })).text();
  const second = await (await fetch(url, { headers: { Cookie: f.teacher.cookie } })).text();
  assert.equal(first, second);
  assert.equal((await fetch(url, { headers: { Cookie: f.students[0].cookie } })).status, 403, '結束後學生仍不可下載');
});
