import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { httpFixture, httpClient, teacherClient } from './http-helpers.js';
import { hashToken, readCookie } from '../src/auth/service.js';
import { startServer } from '../src/server.js';

// 工作表／題目僅供獨立自動測試，沒有產品假匯入端點。
async function fixture(t, { groups = 2, questions = 1, mode = 'SPEED', open = false } = {}) {
  const f = await httpFixture(t);
  const teacher = await teacherClient(f.url);
  const activity = (await teacher.post('/api/activities', { mode })).result.data;
  const base = `/api/activities/${activity.activityId}`;
  const students = [];
  for (let i = 0; i < groups; i++) {
    const student = await httpClient(f.url);
    await student.refresh();
    assert.equal((await student.post('/api/join', { joinCode: activity.joinCode, groupName: `測試組-${i}` })).status, 200);
    students.push(student);
  }
  await f.runtime.store.write(activity.activityId, (db) => {
    for (let i = 0; i < questions; i++) {
      db.prepare('INSERT INTO units VALUES (?, ?, ?, ?)').run(activity.activityId, `unit-${i}`, 'SINGLE', i);
      db.prepare('INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(activity.activityId, `unit-${i}`, `q${i}`, 0, 'private-sheet-secret', 88, i, 3, `{{Q:q${i}}}`, 'private-fingerprint');
    }
  });
  if (open) assert.equal((await teacher.post(`${base}/open`, {})).status, 200);
  return { ...f, activity, base, teacher, students };
}
const answer = (text = '自己答案', index = 0) => ({ unitId: `unit-${index}`, answers: [{ questionId: `q${index}`, text }] });
const noPrivateFields = (value) => {
  const encoded = JSON.stringify(value);
  for (const field of ['acceptedOrder', 'rank', 'isWinner', 'winnerSubmissionId', 'groups', 'joinCode', 'rankingStatus', 'spreadsheetId', 'sheetId', 'rowIndex', 'columnIndex', 'originalMarker', 'structureFingerprint', 'token', 'csrf']) {
    assert.ok(!encoded.includes(`"${field}"`), field);
  }
};

async function stream(t, url, cookie, headers = {}) {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { Cookie: cookie, ...headers }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const history = [];
  const waiters = new Set();
  let ended = false;
  const reader = response.body.getReader();
  const pump = (async () => {
    let buffer = '';
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (!raw.startsWith('event:')) continue;
          const event = raw.split('\n')[0].slice(7);
          const data = JSON.parse(raw.split('\n').find((line) => line.startsWith('data:')).slice(6));
          const frame = { event, ...data, raw };
          history.push(frame);
          for (const waiter of [...waiters]) {
            if (history.length > waiter.from && waiter.predicate(frame)) { waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(frame); }
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      ended = true;
      for (const waiter of waiters) { clearTimeout(waiter.timer); waiter.reject(new Error('SSE 已結束')); }
      waiters.clear();
    }
  })();
  // 立即接上 rejection handler，仍由 close 回傳錯誤讓測試失敗。
  void pump.catch(() => {});
  const connection = {
    history, response,
    get ended() { return ended; },
    next(predicate = (frame) => frame.event === 'snapshot', from = 0, timeout = 2000) {
      const found = history.slice(from).find(predicate);
      if (found) return Promise.resolve(found);
      if (ended) return Promise.reject(new Error('SSE 已結束'));
      return new Promise((resolve, reject) => {
        const waiter = { predicate, from, resolve, reject };
        waiter.timer = setTimeout(() => { waiters.delete(waiter); reject(new Error('等候 SSE 逾時')); }, timeout);
        waiters.add(waiter);
      });
    },
    async close() { controller.abort(); await pump; },
  };
  t.after(() => connection.close());
  return connection;
}
const openStream = (t, f, client, headers) => stream(t, f.url + f.base + '/events', client.cookie, headers);
const phase = (state) => (frame) => frame.event === 'snapshot' && frame.data.state === state;

test('準備中退出即時撤銷舊學生 SSE，教師更新名單，其他學生不收到他組資訊', async (t) => {
  const f = await fixture(t);
  const own = await openStream(t, f, f.students[0]);
  const other = await openStream(t, f, f.students[1]);
  const teacher = await openStream(t, f, f.teacher);
  await Promise.all([own.next(), other.next(), teacher.next()]);
  assert.equal((await f.students[0].post('/api/student/leave', {})).status, 200);
  await own.next(frame => frame.event === 'session-ended');
  const updated = await teacher.next(frame => frame.data?.groups?.length === 1);
  assert.equal(updated.data.groups[0].groupName, '測試組-1');
  assert.equal((await f.students[1].request(`${f.base}/snapshot`)).status, 200);
  assert.equal(other.history.filter(frame => frame.event === 'snapshot').length, 1);
});

test('SSE 先驗證身分與活動，拒絕跨活動、URL token、跨來源及 HEAD', async (t) => {
  const f = await fixture(t);
  const anon = await httpClient(f.url);
  await anon.refresh();
  assert.equal((await anon.request(`${f.base}/events`)).status, 401);
  assert.equal((await f.students[0].request('/api/activities/other/events')).status, 403);
  assert.equal((await f.teacher.request('/api/activities/other/events')).status, 404);
  for (const query of ['?token=pretend-secret', '?role=TEACHER', '?groupId=other']) {
    const r = await f.students[0].request(`${f.base}/events${query}`);
    assert.equal(r.status, 400);
    assert.ok(!JSON.stringify(r.result).includes('pretend-secret'));
  }
  for (const headers of [{ Origin: 'https://outside.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await f.students[0].request(`${f.base}/events`, { headers })).status, 403);
  }
  const head = await fetch(f.url + f.base + '/events', { method: 'HEAD', headers: { Cookie: f.teacher.cookie } });
  assert.equal(head.status, 405);
  const student = await openStream(t, f, f.students[0], { 'X-Role': 'TEACHER', 'Last-Event-ID': 'global-999' });
  noPrivateFields((await student.next()).data);
});

test('準備中加入只通知教師，模式／題號變更同步且不洩漏來源映射', async (t) => {
  const f = await fixture(t, { groups: 1 });
  const a = await openStream(t, f, f.students[0]);
  const teacher = await openStream(t, f, f.teacher);
  await Promise.all([a.next(), teacher.next()]);
  const before = a.history.length;
  const b = await httpClient(f.url);
  await b.refresh();
  await b.post('/api/join', { joinCode: f.activity.joinCode, groupName: '他組名單秘密' });
  await teacher.next((frame) => frame.data?.groups?.length === 2);
  await delay(80);
  assert.equal(a.history.length, before, '他組加入不能引發相同學生快照');
  await f.teacher.request(`${f.base}/mode`, { method: 'PATCH', body: { mode: 'FAIR' } });
  noPrivateFields((await a.next((frame) => frame.data?.mode === 'FAIR')).data);
  // 模擬 B 未來 confirm 透過共用交易提交；只測交易接點，不冒稱 Sheets 匯入。
  await f.runtime.store.write(f.activity.activityId, (db) => {
    db.prepare('INSERT INTO units VALUES (?, ?, ?, ?)').run(f.activity.activityId, 'added', 'SINGLE', 1);
    db.prepare('INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(f.activity.activityId, 'added', 'q-added', 0, 'private-sheet-secret', 88, 10, 3, '{{Q:q-added}}', 'private-fingerprint');
    db.prepare('UPDATE activities SET import_revision = import_revision + 1 WHERE activity_id = ?').run(f.activity.activityId);
  });
  const imported = await a.next((frame) => frame.data?.units.length === 2);
  noPrivateFields(imported.data);
  assert.equal(imported.data.units[1].questions[0].questionId, 'q-added');
});

test('OPEN 學生只收到自己的受理，教師見全部；CLOSED 才推完整保存結果', async (t) => {
  const f = await fixture(t, { mode: 'FAIR' });
  const [a, b] = f.students;
  const sa = await openStream(t, f, a);
  const sb = await openStream(t, f, b);
  const teacher = await openStream(t, f, f.teacher);
  await Promise.all([sa.next(), sb.next(), teacher.next()]);
  await f.teacher.post(`${f.base}/open`, {});
  await Promise.all([sa.next(phase('OPEN')), sb.next(phase('OPEN')), teacher.next(phase('OPEN'))]);
  const beforeA = sa.history.length;
  const bAnswer = '<script>他組答案秘密</script>\n=1+1';
  const acceptedB = (await b.post(`${f.base}/submissions`, answer(bAnswer))).result.data;
  await sb.next((frame) => frame.data?.submissions?.length === 1);
  const monitored = await teacher.next((frame) => frame.data?.submissions?.length === 1);
  assert.equal(monitored.data.submissions[0].acceptedOrder, 1);
  assert.equal(monitored.data.units[0].rankingStatus, 'PENDING_CLOSE');
  await delay(80);
  assert.equal(sa.history.length, beforeA, '他組送出不產生學生事件');
  const bad = await a.post(`${f.base}/submissions`, answer('　'));
  assert.equal(bad.status, 400);
  assert.ok(!JSON.stringify(bad.result).includes('他組'));
  await a.post(`${f.base}/submissions`, answer('自己的原文\n'));
  const own = await sa.next((frame) => frame.data?.submissions?.length === 1);
  assert.equal(own.data.submissions[0].answers[0].text, '自己的原文\n');
  await teacher.next((frame) => frame.data?.submissions?.length === 2);
  const beforeRetry = [sa.history.length, sb.history.length, teacher.history.length];
  assert.deepEqual((await b.post(`${f.base}/submissions`, answer('改寫'))).result.data, acceptedB);
  await delay(80);
  assert.deepEqual([sa.history.length, sb.history.length, teacher.history.length], beforeRetry);
  for (const frame of sa.history.filter((s) => s.data?.state !== 'CLOSED')) {
    noPrivateFields(frame.data);
    assert.ok(!frame.raw.includes('他組答案秘密'));
    assert.ok(!frame.raw.includes(acceptedB.submissionId));
    assert.ok(!frame.raw.includes('測試組-1'));
  }
  const snapshot = await a.request(`${f.base}/snapshot`);
  noPrivateFields(snapshot.result.data);
  assert.deepEqual(snapshot.result.data, own.data);
  await f.teacher.post(`${f.base}/close`, { confirmed: true });
  const closed = await sa.next(phase('CLOSED'));
  assert.deepEqual(closed.data, (await a.request(`${f.base}/results`)).result.data);
  assert.equal(closed.data.units[0].submissions.length, 2);
  assert.equal(closed.data.units[0].submissions[0].answers[0].text, bAnswer);
  await Promise.all([sb.next(phase('CLOSED')), teacher.next(phase('CLOSED'))]);
});

test('失敗交易不推播，結果保存中途故障仍 OPEN 且沒有部分結果事件', async (t) => {
  const f = await fixture(t, { open: true });
  for (const student of f.students) await student.post(`${f.base}/submissions`, answer());
  const teacher = await openStream(t, f, f.teacher);
  await teacher.next();
  const before = teacher.history.length;
  await assert.rejects(f.runtime.store.write(f.activity.activityId, (db) => {
    db.prepare("UPDATE activities SET mode = 'FAIR' WHERE activity_id = ?").run(f.activity.activityId);
    throw new Error('test-only failure');
  }), /test-only failure/);
  await f.runtime.store.write(f.activity.activityId, (db) => db.exec(`CREATE TRIGGER fail_result BEFORE INSERT ON results
    WHEN NEW.rank = 2 BEGIN SELECT RAISE(ABORT, 'test-only failure'); END`));
  assert.equal((await f.teacher.post(`${f.base}/close`, { confirmed: true })).status, 500);
  await delay(100);
  assert.equal(teacher.history.length, before);
  assert.equal((await f.teacher.request(`${f.base}/snapshot`)).result.data.state, 'OPEN');
  await f.runtime.store.write(f.activity.activityId, (db) => db.exec('DROP TRIGGER fail_result'));
  await f.teacher.post(`${f.base}/close`, { confirmed: true });
  assert.equal((await teacher.next(phase('CLOSED'))).data.units[0].submissions.length, 2);
});

test('斷線期間的變更以重連最新快照恢復，不依 Last-Event-ID 回放他組事件', async (t) => {
  const f = await fixture(t, { questions: 2, open: true });
  const first = await openStream(t, f, f.students[0]);
  await first.next();
  await first.close();
  await f.students[1].post(`${f.base}/submissions`, answer('他組秘密'));
  const accepted = (await f.students[0].post(`${f.base}/submissions`, answer())).result.data;
  const reconnected = await openStream(t, f, f.students[0], { 'Last-Event-ID': '999999999' });
  const latest = (await reconnected.next()).data;
  assert.equal(latest.state, 'OPEN');
  assert.equal(latest.submissions[0].submissionId, accepted.submissionId);
  noPrivateFields(latest);
  assert.ok(!JSON.stringify(latest).includes('他組秘密'));
});

test('登出立即撤銷既有 SSE，其他組與教師連線不受影響', async (t) => {
  const f = await fixture(t, { open: true });
  const a = await openStream(t, f, f.students[0]);
  const b = await openStream(t, f, f.students[1]);
  const teacher = await openStream(t, f, f.teacher);
  await Promise.all([a.next(), b.next(), teacher.next()]);
  await f.students[0].post('/api/logout', {});
  const ended = await a.next((frame) => frame.event === 'session-ended');
  assert.deepEqual(ended.error, { code: 'SESSION_ENDED', message: '工作階段已失效，請重新確認身分。' });
  assert.equal((await f.students[0].request(`${f.base}/snapshot`)).status, 401);
  await f.students[1].post(`${f.base}/submissions`, answer('B送出'));
  await Promise.all([b.next((frame) => frame.data?.submissions?.length === 1), teacher.next((frame) => frame.data?.submissions?.length === 1)]);
  assert.ok(!a.history.some((frame) => frame.raw.includes('B送出')));
  await f.teacher.post('/api/logout', {});
  await teacher.next((frame) => frame.event === 'session-ended');
});

test('沒有寫入時，到期的工作階段仍主動結束 SSE，不等待下一次活動事件', async (t) => {
  const f = await fixture(t);
  await f.runtime.store.write('global:authentication', (db) => db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
    .run(new Date(Date.now() + 900).toISOString(), hashToken(readCookie(f.students[0].cookie))));
  const student = await openStream(t, f, f.students[0]);
  await student.next();
  await student.next((frame) => frame.event === 'session-ended', 0, 2000);
  assert.equal((await f.students[0].request(`${f.base}/snapshot`)).status, 401);
});

test('到期計時器提早觸發時仍重新排程，不等 heartbeat 才撤銷工作階段', async (t) => {
  const f = await fixture(t);
  await f.runtime.store.write('global:authentication', (db) => db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
    .run(new Date(Date.now() + 900).toISOString(), hashToken(readCookie(f.students[0].cookie))));
  const realSetTimeout = globalThis.setTimeout;
  let firedEarly = false;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
    if (!firedEarly && ms > 500 && ms <= 900) {
      firedEarly = true;
      return realSetTimeout(callback, ms - 100, ...args);
    }
    return realSetTimeout(callback, ms, ...args);
  });
  const student = await openStream(t, f, f.students[0]);
  await student.next();
  await student.next((frame) => frame.event === 'session-ended', 0, 2000);
  assert.ok(firedEarly, '測試確實提前觸發到期計時器');
  assert.equal((await f.students[0].request(`${f.base}/snapshot`)).status, 401);
});

test('伺服器停止會結束 SSE；重啟以原 Cookie 恢復自己紀錄與最新階段', async (t) => {
  let restarted;
  t.after(() => restarted?.close());
  const f = await fixture(t, { open: true });
  const accepted = (await f.students[0].post(`${f.base}/submissions`, answer())).result.data;
  const old = await openStream(t, f, f.students[0]);
  await old.next();
  await f.runtime.close();
  await old.next((frame) => frame.event === 'stream-ended');
  restarted = await startServer({ host: '127.0.0.1', port: 0, databasePath: f.filename });
  const url = `http://127.0.0.1:${restarted.server.address().port}`;
  const restored = await stream(t, url + f.base + '/events', f.students[0].cookie);
  const snapshot = (await restored.next()).data;
  assert.equal(snapshot.state, 'OPEN');
  assert.equal(snapshot.submissions[0].submissionId, accepted.submissionId);
  noPrivateFields(snapshot);
  await restored.close();
  await restarted.close();
});

test('大於網路緩衝區的教師快照可完整接收，後續 CLOSED 仍可同步', async (t) => {
  const f = await fixture(t, { groups: 3, questions: 20, open: true });
  const requests = f.students.flatMap((student) => Array.from({ length: 20 }, (_, i) => student.post(`${f.base}/submissions`, answer('答'.repeat(1000), i))));
  assert.ok((await Promise.all(requests)).every((r) => r.status === 200));
  const teacher = await openStream(t, f, f.teacher);
  const first = await teacher.next();
  assert.ok(Buffer.byteLength(first.raw) > 65536);
  assert.equal(first.data.submissions.length, 60);
  await f.teacher.post(`${f.base}/close`, { confirmed: true });
  const closed = await teacher.next(phase('CLOSED'));
  assert.equal(closed.data.units.flatMap((u) => u.submissions).length, 60);
});

test('正常本機 1 師／10 組／20 題：階段推播與一般受理均在 2 秒內', async (t) => {
  const f = await fixture(t, { groups: 10, questions: 20 });
  const connections = [];
  for (const client of [f.teacher, ...f.students]) connections.push(await openStream(t, f, client));
  await Promise.all(connections.map((s) => s.next()));
  const openedAt = performance.now();
  await f.teacher.post(`${f.base}/open`, {});
  await Promise.all(connections.map((s) => s.next(phase('OPEN'))));
  const openMs = performance.now() - openedAt;
  assert.ok(openMs < 2000, `OPEN ${openMs}ms`);
  const durations = await Promise.all(f.students.map(async (student) => {
    const start = performance.now();
    assert.equal((await student.post(`${f.base}/submissions`, answer())).status, 200);
    return performance.now() - start;
  }));
  assert.ok(Math.max(...durations) < 2000);
  await Promise.all(connections.slice(1).map((s) => s.next((frame) => frame.data?.submissions?.length === 1)));
  const closedAt = performance.now();
  await f.teacher.post(`${f.base}/close`, { confirmed: true });
  await Promise.all(connections.map((s) => s.next(phase('CLOSED'))));
  const closeMs = performance.now() - closedAt;
  assert.ok(closeMs < 2000, `CLOSED ${closeMs}ms`);
  t.diagnostic(`本機自動測試：OPEN ${openMs.toFixed(1)}ms，最慢一般受理 ${Math.max(...durations).toFixed(1)}ms，CLOSED ${closeMs.toFixed(1)}ms；非真實 Sheets／人工驗收。`);
});

test('固定 heartbeat 不含活動數量、受理序號或身分資料', async (t) => {
  const f = await fixture(t);
  const student = await openStream(t, f, f.students[0]);
  await student.next();
  const heartbeat = await student.next((frame) => frame.event === 'heartbeat', 0, 17000);
  assert.equal(heartbeat.raw, 'event: heartbeat\ndata: {}');
});

test('SSE 建立後的內部錯誤只回通用結束事件，不暴露 SQL、來源或他組資料', async (t) => {
  const f = await fixture(t, { open: true });
  await f.students[1].post(`${f.base}/submissions`, answer('他組秘密'));
  const student = await openStream(t, f, f.students[0]);
  await student.next();
  // 只在測試資料庫模擬讀取故障；產品沒有故障開關。
  await f.runtime.store.write(f.activity.activityId, (db) => db.exec('ALTER TABLE questions RENAME TO test_only_broken_questions'));
  const ended = await student.next((frame) => frame.event === 'stream-ended');
  assert.deepEqual(ended.error, { code: 'STREAM_ENDED', message: '同步暫時中斷，請重新連線。' });
  for (const secret of ['他組秘密', 'SQL', 'test_only', 'private-sheet', 'private-fingerprint']) assert.ok(!ended.raw.includes(secret));
});
