import test from 'node:test';
import assert from 'node:assert/strict';
import { httpFixture, httpClient, teacherClient, fixtureQuestion } from './http-helpers.js';
import { createActivityService } from '../src/activities/service.js';
import { createAuthService } from '../src/auth/service.js';

async function setup(t) {
  const f = await httpFixture(t);
  const teacher = await teacherClient(f.url);
  const activity = (await teacher.post('/api/activities', {})).result.data;
  const base = `/api/activities/${activity.activityId}`;
  const students = [];
  for (const name of ['打錯的組名', '其他組']) {
    const client = await httpClient(f.url);
    await client.refresh();
    assert.equal((await client.post('/api/join', { joinCode: activity.joinCode, groupName: name })).status, 200);
    students.push(client);
  }
  await fixtureQuestion(f.runtime, activity.activityId);
  return { ...f, teacher, students, activity, base };
}

test('AC-25：準備中退出只移除本人、旋轉 Cookie／CSRF、撤銷舊權限並可重新加入', async (t) => {
  const f = await setup(t);
  const [a, b] = f.students;
  const oldCookie = a.cookie;
  const oldCsrf = a.csrf;
  const bBefore = (await b.request(`${f.base}/snapshot`)).result.data;
  const left = await a.post('/api/student/leave', { groupId: bBefore.groupId, activityId: 'forged' });
  assert.equal(left.status, 200);
  assert.equal(left.result.data.role, 'ANONYMOUS');
  assert.notEqual(a.cookie, oldCookie);
  assert.notEqual(a.csrf, oldCsrf);
  assert.equal((await a.refresh()).result.data.role, 'ANONYMOUS');
  assert.equal((await a.request(`${f.base}/snapshot`)).status, 401);
  assert.equal((await fetch(f.url + f.base + '/snapshot', { headers: { Cookie: oldCookie } })).status, 401);
  assert.equal((await fetch(f.url + f.base + '/events', { headers: { Cookie: oldCookie } })).status, 401);
  assert.deepEqual((await f.teacher.request(`${f.base}/snapshot`)).result.data.groups.map(g => g.groupName), ['其他組']);
  assert.deepEqual((await b.request(`${f.base}/snapshot`)).result.data, bBefore);
  const corrected = await a.post('/api/join', { joinCode: f.activity.joinCode, groupName: '更正組名' });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.result.data.groupName, '更正組名');
  const c = await httpClient(f.url); await c.refresh();
  assert.equal((await c.post('/api/join', { joinCode: f.activity.joinCode, groupName: '打錯的組名' })).status, 200, '舊組名已釋放');
});

test('AC-25：匿名／教師、錯誤 Origin 或 CSRF 不能退出，所有組別保留', async (t) => {
  const f = await setup(t);
  const a = f.students[0];
  const anon = await httpClient(f.url); await anon.refresh();
  assert.equal((await anon.post('/api/student/leave', {})).status, 403);
  assert.equal((await f.teacher.post('/api/student/leave', {})).status, 403);
  assert.equal((await a.post('/api/student/leave', {}, { Origin: 'http://evil.example' })).status, 403);
  assert.equal((await a.post('/api/student/leave', {}, { 'X-CSRF-Token': 'bad' })).status, 403);
  assert.equal((await fetch(f.url + '/api/student/leave', { method: 'POST', headers: { Origin: f.url } })).status, 401);
  assert.equal((await f.teacher.request(`${f.base}/snapshot`)).result.data.groups.length, 2);
  assert.equal((await a.refresh()).result.data.role, 'STUDENT');
});

test('AC-25：OPEN／CLOSED 拒絕退出，原工作階段、已受理答案與結果不變', async (t) => {
  const f = await setup(t); const a = f.students[0]; const cookie = a.cookie;
  await f.teacher.post(`${f.base}/open`, {});
  const submission = await a.post(`${f.base}/submissions`, { unitId: 'fixture-unit', answers: [{ questionId: '4', text: '原答案' }] });
  assert.equal(submission.status, 200);
  assert.equal((await a.post('/api/student/leave', {})).result.error.code, 'INVALID_PHASE');
  assert.equal(a.cookie, cookie);
  await f.teacher.post(`${f.base}/close`, { confirmed: true });
  const before = (await a.request(`${f.base}/results`)).result.data;
  assert.equal((await a.post('/api/student/leave', {})).status, 409);
  assert.equal(a.cookie, cookie);
  assert.deepEqual((await a.request(`${f.base}/results`)).result.data, before);
});

test('AC-25：刪除故障時組別與身分旋轉同時回滾', async (t) => {
  const f = await setup(t); const a = f.students[0]; const cookie = a.cookie; const csrf = a.csrf;
  await f.runtime.store.write(f.activity.activityId, db => db.exec("CREATE TRIGGER deny_group_delete BEFORE DELETE ON groups BEGIN SELECT RAISE(ABORT, 'test rollback'); END"));
  assert.equal((await a.post('/api/student/leave', {})).status, 500);
  assert.equal(a.cookie, cookie); assert.equal(a.csrf, csrf);
  assert.equal((await a.refresh()).result.data.role, 'STUDENT');
  assert.equal((await f.teacher.request(`${f.base}/snapshot`)).result.data.groups.length, 2);
});

for (const first of ['leave', 'open']) test(`AC-25：退出與開啟共用活動佇列，${first} 先執行`, async (t) => {
  const f = await setup(t);
  const service = createActivityService(f.runtime.store, createAuthService(f.runtime.store));
  const aToken = f.students[0].cookie.split('=')[1];
  const teacherToken = f.teacher.cookie.split('=')[1];
  const work = first === 'leave'
    ? [service.leave(aToken), service.open(teacherToken, f.activity.activityId)]
    : [service.open(teacherToken, f.activity.activityId), service.leave(aToken)];
  const outcomes = await Promise.allSettled(work);
  assert.equal(outcomes[0].status, 'fulfilled');
  const groups = (await f.teacher.request(`${f.base}/snapshot`)).result.data.groups;
  if (first === 'leave') {
    assert.equal(outcomes[1].status, 'fulfilled'); assert.equal(groups.length, 1);
  } else {
    assert.equal(outcomes[1].status, 'rejected'); assert.equal(outcomes[1].reason.code, 'INVALID_PHASE'); assert.equal(groups.length, 2);
  }
});
