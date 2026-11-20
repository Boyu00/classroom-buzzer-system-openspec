import test from 'node:test';
import assert from 'node:assert/strict';
import { httpFixture, httpClient, teacherClient } from './http-helpers.js';
import { createAuthService, readCookie } from '../src/auth/service.js';
import { createSubmissionService } from '../src/submissions/service.js';
import { createActivityService } from '../src/activities/service.js';
import { startServer } from '../src/server.js';

// 題目 fixture 僅用於自動測試，未提供產品端假匯入功能。
async function fixture(t, mode = 'SPEED', { open = true } = {}) {
  const f = await httpFixture(t);
  const teacher = await teacherClient(f.url);
  const activity = (await teacher.post('/api/activities', { mode })).result.data;
  const students = [];
  for (const name of ['A組', 'B組', 'C組']) {
    const student = await httpClient(f.url);
    await student.refresh();
    const joined = await student.post('/api/join', { joinCode: activity.joinCode, groupName: name });
    assert.equal(joined.status, 200);
    students.push(student);
  }
  await f.runtime.store.write(activity.activityId, (db) => {
    const insertUnit = db.prepare('INSERT INTO units VALUES (?, ?, ?, ?)');
    const insertQuestion = db.prepare('INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    let row = 0;
    for (const [order, [id, type, ids]] of [['single', 'SINGLE', ['4']], ['group', 'GROUP', ['7', '9', '12']], ['empty', 'SINGLE', ['20']], ['last', 'SINGLE', ['25']]].entries()) {
      insertUnit.run(activity.activityId, id, type, order);
      ids.forEach((q, index) => insertQuestion.run(activity.activityId, id, q, index, 'fixture-sheet', 0, row++, 1, `{{Q:${q}}}`, 'fixture'));
    }
  });
  const base = `/api/activities/${activity.activityId}`;
  if (open) assert.equal((await teacher.post(`${base}/open`, {})).status, 200);
  const auth = createAuthService(f.runtime.store);
  const submit = createSubmissionService(f.runtime.store, auth, { now: () => '2026-11-20T01:00:00.000Z' });
  const control = createActivityService(f.runtime.store, auth);
  return { ...f, teacher, students, activity, base, auth, submit, control };
}
const answer = (unitId = 'single', text = '答案') => ({ unitId, answers: [{ questionId: unitId === 'last' ? '25' : '4', text }] });
const groupAnswer = (text = '題組答案') => ({ unitId: 'group', answers: ['12', '7', '9'].map((questionId) => ({ questionId, text: text + questionId })) });
const token = (client) => readCookie(client.cookie);
function counts(f) {
  return f.runtime.store.read((db) => ({
    submissions: db.prepare('SELECT count(*) AS n FROM submissions').get().n,
    answers: db.prepare('SELECT count(*) AS n FROM submission_answers').get().n,
    next: db.prepare('SELECT next_accepted_order AS n FROM activities WHERE activity_id = ?').get(f.activity.activityId).n,
    results: db.prepare('SELECT count(*) AS n FROM results').get().n,
  }));
}

test('受理驗證空白、Unicode 上限、無效題號／重複題號及工作階段，失敗不配置序號', async (t) => {
  const f = await fixture(t);
  const [a] = f.students;
  for (const text of ['', ' \r\n\t　', '😀'.repeat(1001), '\ud800', null, 2]) {
    const result = await a.post(`${f.base}/submissions`, answer('single', text));
    assert.equal(result.status, 400);
    assert.equal(result.result.error.code, 'INVALID_ANSWERS');
  }
  assert.equal((await a.post(`${f.base}/submissions`, null)).status, 400);
  for (const body of [{}, { unitId: '7', answers: [] }, { unitId: 'not-imported', answers: [] }]) {
    assert.equal((await a.post(`${f.base}/submissions`, body)).status, 404);
  }
  for (const answers of [[], [{ questionId: '999', text: '答' }], [{ questionId: 4, text: '答' }], [{ questionId: '4', text: '答' }, { questionId: '4', text: '改' }]]) {
    assert.equal((await a.post(`${f.base}/submissions`, { unitId: 'single', answers })).status, 400);
  }
  const anon = await httpClient(f.url);
  await anon.refresh();
  assert.equal((await anon.post(`${f.base}/submissions`, answer())).status, 401);
  assert.equal((await f.teacher.post(`${f.base}/submissions`, answer())).status, 403);
  assert.equal((await a.post('/api/activities/other/submissions', answer())).status, 403);
  assert.equal((await a.post(`${f.base}/submissions`, answer(), { 'X-CSRF-Token': '' })).status, 403);
  assert.deepEqual(counts(f), { submissions: 0, answers: 0, next: 1, results: 0 });
  assert.equal((await a.post(`${f.base}/submissions`, answer('single', '😀'.repeat(1000)))).status, 200);
  assert.equal(counts(f).next, 2);
});

test('保留原答案、以 session 決定組別；並行重試及改答案回傳第一次紀錄', async (t) => {
  const f = await fixture(t);
  const [a, b] = f.students;
  const original = '  中文\r\n=SUM(1,2)\n<script>alert(1)</script>  ';
  const forgedGroup = (await b.request(`${f.base}/snapshot`)).result.data.groupId;
  const body = { ...answer('single', original), groupId: forgedGroup, acceptedOrder: -1, acceptedAt: '1900-01-01', role: 'TEACHER' };
  const replies = await Promise.all(Array.from({ length: 12 }, () => a.post(`${f.base}/submissions`, body)));
  assert.ok(replies.every((r) => r.status === 200));
  assert.equal(new Set(replies.map((r) => r.result.data.submissionId)).size, 1);
  const first = replies[0].result.data;
  assert.equal(first.answers[0].text, original);
  assert.ok(!('acceptedOrder' in first));
  assert.deepEqual((await a.post(`${f.base}/submissions`, { unitId: 'single', answers: [] })).result.data, first);
  assert.deepEqual(counts(f), { submissions: 1, answers: 1, next: 2, results: 0 });
  const snapshot = (await f.teacher.request(`${f.base}/snapshot`)).result.data;
  assert.notEqual(snapshot.submissions[0].groupId, forgedGroup);
  assert.equal(snapshot.submissions[0].acceptedOrder, 1);
  assert.equal(snapshot.units[0].winnerSubmissionId, first.submissionId);
});

test('相同伺服器時間戳並行送出，仍依唯一序號而非時間／客戶端值排序', async (t) => {
  const f = await fixture(t);
  await Promise.all(f.students.map((student) => f.submit.submit(token(student), f.activity.activityId, answer())));
  const rows = f.runtime.store.read((db) => db.prepare('SELECT * FROM submissions ORDER BY accepted_order').all());
  assert.deepEqual(rows.map((s) => s.accepted_order), [1, 2, 3]);
  assert.equal(new Set(rows.map((s) => s.accepted_at)).size, 1);
  assert.equal(counts(f).next, 4);
});

test('題組缺題、多題、重複、單題繞送或任何空白皆整批拒絕；有效題組只用一筆序號', async (t) => {
  const f = await fixture(t);
  const [a] = f.students;
  const correct = groupAnswer();
  const variants = [correct.answers.slice(1), [...correct.answers, { questionId: '4', text: '多題' }], correct.answers.map(() => ({ questionId: '7', text: '重複' })),
    [{ questionId: '7', text: '單題繞送' }], correct.answers.map((a, i) => i === 1 ? { ...a, text: '　' } : a),
    correct.answers.map((a, i) => i === 1 ? { ...a, text: '😀'.repeat(1001) } : a)];
  for (const answers of variants) {
    assert.equal((await a.post(`${f.base}/submissions`, { unitId: 'group', answers })).status, 400);
    assert.deepEqual(counts(f), { submissions: 0, answers: 0, next: 1, results: 0 });
  }
  const accepted = await a.post(`${f.base}/submissions`, correct);
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.result.data.answers.map((a) => a.questionId), ['7', '9', '12']);
  assert.deepEqual(counts(f), { submissions: 1, answers: 3, next: 2, results: 0 });
  const retry = await a.post(`${f.base}/submissions`, { unitId: 'group', answers: [{ questionId: '7', text: '改' }] });
  assert.deepEqual(retry.result.data, accepted.result.data);
});

test('題組保存第二題時故障，答案、受理與序號全部回滾，重試無缺號', async (t) => {
  const f = await fixture(t);
  await f.runtime.store.write(f.activity.activityId, (db) => db.exec(`CREATE TRIGGER fail_answer BEFORE INSERT ON submission_answers
    WHEN NEW.question_id = '7' BEGIN SELECT RAISE(ABORT, 'test-only fault'); END`));
  const failed = await f.students[0].post(`${f.base}/submissions`, groupAnswer());
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.result, { error: { code: 'INTERNAL_ERROR', message: '伺服器暫時無法處理請求。' } });
  assert.deepEqual(counts(f), { submissions: 0, answers: 0, next: 1, results: 0 });
  await f.runtime.store.write(f.activity.activityId, (db) => db.exec('DROP TRIGGER fail_answer'));
  assert.equal((await f.students[0].post(`${f.base}/submissions`, groupAnswer())).status, 200);
  assert.deepEqual(counts(f), { submissions: 1, answers: 3, next: 2, results: 0 });
});

test('PREPARING 不受理；依同活動佇列先送出再結束，結果完整且 CLOSED 重試不覆寫', async (t) => {
  const f = await fixture(t, 'SPEED', { open: false });
  const [a, b] = f.students;
  assert.equal((await a.post(`${f.base}/submissions`, answer())).status, 409);
  await f.teacher.post(`${f.base}/open`, {});
  const acceptedPromise = f.submit.submit(token(a), f.activity.activityId, answer());
  const closedPromise = f.control.close(token(f.teacher), f.activity.activityId, true);
  const [accepted, closed] = await Promise.all([acceptedPromise, closedPromise]);
  assert.equal(closed.data.state, 'CLOSED');
  const result = (await a.request(`${f.base}/results`)).result.data;
  assert.equal(result.units[0].submissions[0].submissionId, accepted.data.submissionId);
  const retry = await a.post(`${f.base}/submissions`, answer('single', '修改'));
  assert.equal(retry.status, 200);
  assert.equal(retry.result.data.answers[0].text, '答案');
  assert.equal(retry.result.data.rank, 1);
  assert.equal((await a.post(`${f.base}/submissions`, groupAnswer())).status, 409);
  assert.equal((await b.post(`${f.base}/submissions`, answer())).status, 409);
  assert.deepEqual(counts(f), { submissions: 1, answers: 1, next: 2, results: 1 });
});

test('同活動佇列先結束再送出，不會新增受理或留下部分答案', async (t) => {
  const f = await fixture(t);
  const closed = f.control.close(token(f.teacher), f.activity.activityId, true);
  const submitted = f.submit.submit(token(f.students[0]), f.activity.activityId, groupAnswer());
  const results = await Promise.allSettled([closed, submitted]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].reason.code, 'INVALID_PHASE');
  assert.deepEqual(counts(f), { submissions: 0, answers: 0, next: 1, results: 0 });
});

test('HTTP 結束與送出競態只有完整受理或完整拒絕兩種結果', async (t) => {
  const f = await fixture(t);
  const [submitted, closed] = await Promise.all([
    f.students[0].post(`${f.base}/submissions`, groupAnswer()), f.teacher.post(`${f.base}/close`, { confirmed: true }),
  ]);
  assert.equal(closed.status, 200);
  assert.ok([200, 409].includes(submitted.status));
  const n = submitted.status === 200 ? 1 : 0;
  assert.deepEqual(counts(f), { submissions: n, answers: 3 * n, next: n + 1, results: n });
});

test('結束前學生 API 只回自己，沒有他組資訊、全場序號、數量或暫定勝出者', async (t) => {
  const f = await fixture(t, 'FAIR');
  const [a, b] = f.students;
  const other = (await b.post(`${f.base}/submissions`, answer('single', '他組秘密答案'))).result.data;
  await a.post(`${f.base}/submissions`, groupAnswer('自己的'));
  const snapshot = (await a.request(`${f.base}/snapshot`)).result.data;
  const encoded = JSON.stringify(snapshot);
  for (const forbidden of ['B組', '他組秘密答案', other.submissionId, 'acceptedOrder', 'rank', 'isWinner', 'winnerSubmissionId', 'spreadsheet', 'joinCode', 'groups']) {
    assert.ok(!encoded.includes(forbidden), forbidden);
  }
  assert.equal(snapshot.submissions.length, 1);
  const notReady = await a.request(`${f.base}/results`);
  assert.equal(notReady.status, 409);
  assert.ok(!JSON.stringify(notReady.result).includes('他組'));
  const monitor = (await f.teacher.request(`${f.base}/snapshot`)).result.data;
  assert.equal(monitor.submissions.length, 2);
  assert.equal(monitor.units[0].rankingStatus, 'PENDING_CLOSE');
  assert.equal(monitor.units[0].winnerSubmissionId, null);
});

test('SPEED 每單位獨立排序、完整順位與無人作答，教師及既有學生共用固定結果', async (t) => {
  const f = await fixture(t);
  const [a, b, c] = f.students;
  for (const [student, body] of [[a, answer()], [b, answer()], [c, answer()], [b, groupAnswer()], [a, groupAnswer()]]) {
    assert.equal((await student.post(`${f.base}/submissions`, body)).status, 200);
  }
  assert.equal((await f.teacher.post(`${f.base}/close`, { confirmed: true })).status, 200);
  const result = (await f.teacher.request(`${f.base}/results`)).result.data;
  assert.equal(result.mode, 'SPEED');
  assert.deepEqual(result.units[0].submissions.map((s) => [s.groupName, s.rank, s.isWinner]), [['A組', 1, true], ['B組', 2, false], ['C組', 3, false]]);
  assert.equal(result.units[1].submissions[0].groupName, 'B組');
  assert.equal(result.units[1].submissions[0].answers.length, 3);
  assert.equal(result.units[2].winnerSubmissionId, null);
  assert.deepEqual(result.units[2].submissions, []);
  assert.deepEqual((await a.request(`${f.base}/results`)).result.data, result);
  assert.deepEqual((await c.request(`${f.base}/snapshot`)).result.data, result);
  assert.deepEqual((await f.teacher.request(`${f.base}/results`)).result.data, result);
  const anon = await httpClient(f.url);
  await anon.refresh();
  assert.equal((await anon.request(`${f.base}/results`)).status, 401);
  assert.equal((await anon.post('/api/join', { joinCode: f.activity.joinCode, groupName: 'D組' })).status, 409);
  const next = (await f.teacher.post('/api/activities', {})).result.data;
  assert.equal((await a.request(`/api/activities/${next.activityId}/results`)).status, 403);
});

test('FAIR 依固定單位順序與此前勝次，保留原受理序號及所有非勝出順位', async (t) => {
  const f = await fixture(t, 'FAIR');
  const [a, b, c] = f.students;
  // 故意先送後面的單位，不能依送達先後取代單位順序。
  for (const [student, body] of [[a, groupAnswer()], [b, groupAnswer()], [c, groupAnswer()], [a, answer()], [b, answer()], [c, answer()]]) {
    await f.submit.submit(token(student), f.activity.activityId, body);
  }
  await f.teacher.post(`${f.base}/close`, { confirmed: true });
  const result = (await a.request(`${f.base}/results`)).result.data;
  assert.deepEqual(result.units[0].submissions.map((s) => s.groupName), ['A組', 'B組', 'C組']);
  assert.deepEqual(result.units[1].submissions.map((s) => [s.groupName, s.acceptedOrder, s.rank]), [['B組', 2, 1], ['C組', 3, 2], ['A組', 1, 3]]);
  assert.equal(result.units[1].submissions[0].isWinner, true);
});

test('FAIR 題組只計一次、空單位不加勝次，同勝次以受理序號排序', async (t) => {
  const f = await fixture(t, 'FAIR');
  const [a, b, c] = f.students;
  // B、C、A 的勝次將為 1、1、0；最後單位 C 比 B 早，A 最晚。
  // 若錯把 C 的三題算三次勝出，最後 B、C 順位就會相反。
  for (const [student, body] of [[b, answer()], [c, groupAnswer()], [b, groupAnswer()], [c, answer('last')], [b, answer('last')], [a, answer('last')]]) {
    await f.submit.submit(token(student), f.activity.activityId, body);
  }
  await f.teacher.post(`${f.base}/close`, { confirmed: true });
  const result = (await a.request(`${f.base}/results`)).result.data;
  assert.equal(result.units[0].submissions[0].groupName, 'B組');
  assert.equal(result.units[1].submissions[0].groupName, 'C組');
  assert.equal(result.units[2].winnerSubmissionId, null);
  assert.deepEqual(result.units[3].submissions.map((s) => s.groupName), ['A組', 'C組', 'B組']);
});

test('結果保存中途故障，整批 results 與 CLOSED 回滾；修復重試後結果固定', async (t) => {
  const f = await fixture(t, 'FAIR');
  await f.students[0].post(`${f.base}/submissions`, answer());
  await f.students[1].post(`${f.base}/submissions`, answer());
  await f.runtime.store.write(f.activity.activityId, (db) => db.exec(`CREATE TRIGGER fail_result BEFORE INSERT ON results
    WHEN NEW.rank = 2 BEGIN SELECT RAISE(ABORT, 'test-only result fault'); END`));
  assert.equal((await f.teacher.post(`${f.base}/close`, { confirmed: true })).status, 500);
  assert.equal((await f.teacher.request(`${f.base}/snapshot`)).result.data.state, 'OPEN');
  assert.equal(counts(f).results, 0);
  await f.runtime.store.write(f.activity.activityId, (db) => db.exec('DROP TRIGGER fail_result'));
  assert.equal((await f.teacher.post(`${f.base}/close`, { confirmed: true })).status, 200);
  assert.equal(counts(f).results, 2);
  assert.equal((await f.teacher.request(`${f.base}/mode`, { method: 'PATCH', body: { mode: 'SPEED' } })).status, 409);
  assert.equal((await f.teacher.post(`${f.base}/close`, { confirmed: true })).status, 409);
  assert.equal(counts(f).results, 2);
});

test('OPEN 與 CLOSED 重啟後保持原 session、已受理答案、去重、模式及保存排名', async (t) => {
  let restarted;
  t.after(() => restarted?.close());
  const f = await fixture(t, 'FAIR');
  const [a, b] = f.students;
  const first = (await a.post(`${f.base}/submissions`, answer())).result.data;
  await f.runtime.close();
  restarted = await startServer({ host: '127.0.0.1', port: 0, databasePath: f.filename });
  const auth = createAuthService(restarted.store);
  const submissionService = createSubmissionService(restarted.store, auth);
  const activityService = createActivityService(restarted.store, auth);
  assert.deepEqual((await submissionService.submit(token(a), f.activity.activityId, answer('single', '改'))).data, first);
  await submissionService.submit(token(b), f.activity.activityId, answer());
  await submissionService.submit(token(a), f.activity.activityId, groupAnswer());
  await submissionService.submit(token(b), f.activity.activityId, groupAnswer());
  await activityService.close(token(f.teacher), f.activity.activityId, true);
  const before = activityService.snapshot(token(a), f.activity.activityId).data;
  await restarted.close();
  restarted = await startServer({ host: '127.0.0.1', port: 0, databasePath: f.filename });
  const url = `http://127.0.0.1:${restarted.server.address().port}`;
  const response = await fetch(`${url}${f.base}/results`, { headers: { Cookie: a.cookie } });
  assert.equal(response.status, 200);
  const after = (await response.json()).data;
  assert.deepEqual(after, before);
  assert.equal(after.mode, 'FAIR');
  assert.equal(after.units[1].submissions[0].groupName, 'B組');
  await restarted.close();
});
