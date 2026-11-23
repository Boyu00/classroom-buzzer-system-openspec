import test from 'node:test';
import assert from 'node:assert/strict';
import { httpFixture, httpClient, teacherClient } from './http-helpers.js';

test('教師找回自己的活動：未登入／學生拒絕，沒有活動回 null，未結束者優先，結束後仍可找回最近一場', async (t) => {
  const f = await httpFixture(t);
  const anonymous = await httpClient(f.url);
  await anonymous.refresh();
  assert.equal((await anonymous.request('/api/teacher/activity')).status, 401);

  const teacher = await teacherClient(f.url);
  const none = await teacher.request('/api/teacher/activity');
  assert.deepEqual([none.status, none.result.data], [200, { activity: null }]);

  const first = (await teacher.post('/api/activities', { mode: 'FAIR' })).result.data;
  const found = await teacher.request('/api/teacher/activity');
  assert.deepEqual(found.result.data, { activity: { activityId: first.activityId, mode: 'FAIR', state: 'PREPARING' } });
  assert.equal(JSON.stringify(found.result).includes(first.joinCode), false, '不洩漏加入碼等其他欄位');

  // 無題目不能開啟；用測試專用方式放入一題，走完整的結束流程後仍可找回該場，並可建立下一場。
  await f.runtime.store.write(first.activityId, (db) => {
    db.prepare("INSERT INTO units VALUES (?, 'u', 'SINGLE', 0)").run(first.activityId);
    db.prepare("INSERT INTO questions VALUES (?, 'u', '1', 0, 'x', 0, 0, 0, '{{Q:1}}', 'f')").run(first.activityId);
  });
  assert.equal((await teacher.post(`/api/activities/${first.activityId}/open`, {})).status, 200);
  assert.equal((await teacher.post(`/api/activities/${first.activityId}/close`, { confirmed: true })).status, 200);
  assert.deepEqual((await teacher.request('/api/teacher/activity')).result.data, { activity: { activityId: first.activityId, mode: 'FAIR', state: 'CLOSED' } });

  const second = (await teacher.post('/api/activities', { mode: 'SPEED' })).result.data;
  assert.deepEqual((await teacher.request('/api/teacher/activity')).result.data, { activity: { activityId: second.activityId, mode: 'SPEED', state: 'PREPARING' } });

  const student = await httpClient(f.url);
  await student.refresh();
  assert.equal((await student.post('/api/join', { joinCode: second.joinCode, groupName: '一組' })).status, 200);
  assert.equal((await student.request('/api/teacher/activity')).status, 403);
});
