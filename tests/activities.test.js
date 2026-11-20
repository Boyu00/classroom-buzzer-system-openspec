import test from 'node:test';
import assert from 'node:assert/strict';
import { httpFixture, httpClient, teacherClient, fixtureQuestion, testPassword } from './http-helpers.js';

test('同一位本機老師含不同 session，只能有一個未結束活動', async (t) => {
  const { url, runtime } = await httpFixture(t);
  const a = await teacherClient(url);
  const b = await httpClient(url);
  await b.refresh();
  assert.equal((await b.post('/api/teacher/login', { password: testPassword })).status, 200);
  const results = await Promise.all([a.post('/api/activities', {}), b.post('/api/activities', { mode: 'FAIR' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const created = results.find((r) => r.status === 200).result.data;
  assert.match(created.joinCode, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(created.state, 'PREPARING');
  assert.equal(runtime.store.read((db) => db.prepare('SELECT count(*) AS n FROM activities').get().n), 1);
  await assert.rejects(runtime.store.write('extra', (db) => {
    const teacherId = db.prepare("SELECT session_id FROM sessions WHERE role = 'TEACHER' LIMIT 1").get().session_id;
    db.prepare("INSERT INTO activities (activity_id,join_code,teacher_session_id,created_at) VALUES ('extra','EXTRA',?,?)").run(teacherId, new Date().toISOString());
  }), /UNIQUE/);
});

test('組名 trim 與 Unicode 長度，禁止重複／接管／冒用角色', async (t) => {
  const { url } = await httpFixture(t);
  const teacher = await teacherClient(url);
  const activity = (await teacher.post('/api/activities', {})).result.data;
  const a = await httpClient(url);
  const b = await httpClient(url);
  await a.refresh();
  await b.refresh();
  const oldCookie = a.cookie;
  const joined = await a.post('/api/join', { joinCode: activity.joinCode.toLowerCase(), groupName: '  第一組  ', role: 'TEACHER' });
  assert.equal(joined.status, 200);
  assert.equal(joined.result.data.groupName, '第一組');
  assert.notEqual(a.cookie, oldCookie);
  assert.equal((await a.refresh()).result.data.role, 'STUDENT');
  assert.equal((await a.post('/api/activities', { role: 'TEACHER' })).status, 403);
  assert.equal((await b.post('/api/join', { joinCode: activity.joinCode, groupName: '第一組' })).status, 409);
  for (const name of ['', '   ', '😀'.repeat(31)]) {
    assert.equal((await b.post('/api/join', { joinCode: activity.joinCode, groupName: name })).status, 400);
  }
  assert.equal((await b.post('/api/join', { joinCode: 'OOOOOO', groupName: '第二組' })).status, 400);
  assert.equal((await b.post('/api/join', { joinCode: activity.joinCode, groupName: '😀'.repeat(30) })).status, 200);
  const repeat = await a.post('/api/join', { joinCode: activity.joinCode, groupName: '第一組' });
  assert.equal(repeat.result.data.groupId, joined.result.data.groupId);
  const snapshot = await a.request(`/api/activities/${activity.activityId}/snapshot`);
  assert.equal(snapshot.status, 200);
  assert.ok(!JSON.stringify(snapshot.result).includes('😀'));
  assert.ok(!('groups' in snapshot.result.data));
  assert.ok(!('joinCode' in snapshot.result.data));
});

test('同名組別並行加入只有一個成功，不留下額外 session 綁定', async (t) => {
  const { url, runtime } = await httpFixture(t);
  const teacher = await teacherClient(url);
  const activity = (await teacher.post('/api/activities', {})).result.data;
  const a = await httpClient(url);
  const b = await httpClient(url);
  await Promise.all([a.refresh(), b.refresh()]);
  const results = await Promise.all([a.post('/api/join', { joinCode: activity.joinCode, groupName: '同一組' }), b.post('/api/join', { joinCode: activity.joinCode, groupName: '同一組' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(runtime.store.read((db) => db.prepare('SELECT count(*) AS n FROM groups').get().n), 1);
  assert.equal(runtime.store.read((db) => db.prepare("SELECT count(*) AS n FROM sessions WHERE role = 'STUDENT'").get().n), 1);
});

test('狀態單向轉移、零題禁止開啟、模式鎖定、結束確認與既有組別重連', async (t) => {
  const { url, runtime } = await httpFixture(t);
  const teacher = await teacherClient(url);
  const activity = (await teacher.post('/api/activities', {})).result.data;
  const base = `/api/activities/${activity.activityId}`;
  const a = await httpClient(url);
  const b = await httpClient(url);
  await a.refresh();
  await b.refresh();
  await a.post('/api/join', { joinCode: activity.joinCode, groupName: '既有組' });
  const originalCookie = a.cookie;
  assert.equal((await teacher.post(`${base}/open`, {})).result.error.code, 'QUESTIONS_REQUIRED');
  assert.equal((await teacher.post(`${base}/close`, { confirmed: true })).status, 409);
  assert.equal((await teacher.request(`${base}/mode`, { method: 'PATCH', body: { mode: 'WRONG' } })).status, 400);
  assert.equal((await teacher.request(`${base}/mode`, { method: 'PATCH', body: { mode: 'FAIR' } })).status, 200);
  await fixtureQuestion(runtime, activity.activityId);
  assert.equal((await a.post(`${base}/open`, {})).status, 403);
  const opened = await teacher.post(`${base}/open`, {});
  assert.equal(opened.result.data.state, 'OPEN');
  assert.equal((await teacher.post(`${base}/open`, {})).status, 409);
  assert.equal((await teacher.request(`${base}/mode`, { method: 'PATCH', body: { mode: 'SPEED' } })).status, 409);
  assert.equal((await b.post('/api/join', { joinCode: activity.joinCode, groupName: '新組' })).status, 409);
  assert.equal((await a.refresh()).result.data.role, 'STUDENT');
  assert.equal(a.cookie, originalCookie);
  assert.equal((await a.post('/api/join', { joinCode: activity.joinCode, groupName: '既有組' })).status, 200);
  const snapshot = await a.request(`${base}/snapshot`);
  assert.equal(snapshot.result.data.mode, 'FAIR');
  assert.equal(snapshot.result.data.units[0].questions[0].questionId, '4');
  for (const confirmed of [undefined, false, 'true']) assert.equal((await teacher.post(`${base}/close`, { confirmed })).status, 400);
  assert.equal((await teacher.post(`${base}/close`, { confirmed: true })).result.data.state, 'CLOSED');
  assert.equal((await teacher.post(`${base}/close`, { confirmed: true })).status, 409);
  assert.equal((await teacher.post(`${base}/open`, {})).status, 409);
  assert.equal((await b.post('/api/join', { joinCode: activity.joinCode, groupName: '新組' })).status, 409);
  assert.equal((await a.request(`${base}/snapshot`)).result.data.state, 'CLOSED');
  const next = await teacher.post('/api/activities', {});
  assert.equal(next.status, 200);
  assert.notEqual(next.result.data.activityId, activity.activityId);
  assert.equal((await a.request(`/api/activities/${next.result.data.activityId}/snapshot`)).status, 403);
});

test('有受理答案時，在排名實作前不能假裝產生完整結束結果', async (t) => {
  const { url, runtime } = await httpFixture(t);
  const teacher = await teacherClient(url);
  const activity = (await teacher.post('/api/activities', {})).result.data;
  const student = await httpClient(url);
  await student.refresh();
  const group = (await student.post('/api/join', { joinCode: activity.joinCode, groupName: '測試' })).result.data;
  await fixtureQuestion(runtime, activity.activityId);
  await teacher.post(`/api/activities/${activity.activityId}/open`, {});
  await runtime.store.write(activity.activityId, (db) => db.prepare('INSERT INTO submissions VALUES (?, ?, ?, ?, ?, ?)')
    .run('fixture-submission', activity.activityId, 'fixture-unit', group.groupId, new Date().toISOString(), 1));
  const closing = await teacher.post(`/api/activities/${activity.activityId}/close`, { confirmed: true });
  assert.equal(closing.status, 409);
  assert.equal(closing.result.error.code, 'RESULT_FINALIZATION_PENDING');
  assert.equal((await teacher.request(`/api/activities/${activity.activityId}/snapshot`)).result.data.state, 'OPEN');
});
