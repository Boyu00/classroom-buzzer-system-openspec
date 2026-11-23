import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { mountStudentPage } from '../public/student-page.js';
import { httpFixture, teacherClient } from './http-helpers.js';

const html = readFileSync(new URL('../public/student.html', import.meta.url), 'utf8');
const units = [
  { unitId: 'single', type: 'SINGLE', order: 0, questions: [{ questionId: '4', order: 0 }] },
  { unitId: 'group', type: 'GROUP', order: 1, questions: [{ questionId: '1', order: 0 }, { questionId: '9', order: 1 }] },
];
const student = { role: 'STUDENT', activityId: 'activity', groupId: 'own', csrfToken: 'csrf' };
const snapshot = (extra = {}) => ({ activityId: 'activity', state: 'OPEN', mode: 'FAIR', groupId: 'own', groupName: '自己的組', units, submissions: [], ...extra });
const receipt = (unitId = 'single', text = '原文\n') => ({ unitId, submissionId: `receipt-${unitId}`, acceptedAt: '2026-11-22T00:00:00.000Z', answers: unitId === 'single' ? [{ questionId: '4', text }] : [{ questionId: '1', text }, { questionId: '9', text: '另一題' }] });
const json = (data, status = 200) => new Response(JSON.stringify(status === 200 ? { data } : { error: data }), { status, headers: { 'Content-Type': 'application/json' } });
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await delay(10); }
  assert.fail('等待頁面狀態逾時');
}
function dom() {
  const { document, window } = parseHTML(html);
  return { document, $: (id) => document.getElementById(id),
    submit: (form) => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) };
}
function watchHarness() {
  const subscriptions = [];
  const watch = (options) => { subscriptions.push(options); return { close() {} }; };
  return { watch, subscriptions,
    send(data) { subscriptions.at(-1).onSnapshot(data); subscriptions.at(-1).onConnection('connected'); },
    connection(state) { subscriptions.at(-1).onConnection(state); },
  };
}
async function fixture(t, { identity = student, initial = snapshot(), handle } = {}) {
  const view = dom(); const harness = watchHarness(); const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, ...options });
    const override = handle?.(path, options);
    if (override !== undefined) return override;
    if (path === '/api/session') return json(identity);
    if (path.endsWith('/snapshot')) return json(initial);
    if (path === '/results.html') return new Response('', { status: 404 });
    if (path.endsWith('/submissions')) { const body = JSON.parse(options.body); return json({ ...receipt(body.unitId), answers: body.answers }); }
    throw new Error(`Unexpected test request: ${path}`);
  };
  const page = mountStudentPage({ document: view.document, fetchImpl, watch: harness.watch });
  t.after(() => page.close()); await page.ready;
  return { ...view, ...harness, page, calls };
}
const cardForm = (f, index = 0) => f.$('units').querySelectorAll('form')[index];
const fill = (f, index, values) => { const inputs = cardForm(f, index).querySelectorAll('textarea'); values.forEach((value, i) => { inputs[i].value = value; }); };

test('匿名加入：驗證六碼與 Unicode 組名、trim，旋轉 CSRF 後恢復等待畫面', async (t) => {
  const f = await fixture(t, { identity: { role: 'ANONYMOUS', csrfToken: 'before' },
    initial: snapshot({ state: 'PREPARING' }), handle: (path, options) => {
      if (path === '/api/join') { assert.deepEqual(JSON.parse(options.body), { joinCode: 'ABC234', groupName: '😀'.repeat(30) }); assert.equal(options.headers['X-CSRF-Token'], 'before'); return json({ ...student, csrfToken: 'after' }); }
    } });
  assert.equal(f.$('join-panel').hidden, false);
  f.$('join-code').value = 'BAD'; f.$('group-name').value = '😀'.repeat(31); f.submit(f.$('join-form'));
  assert.equal(f.calls.filter((c) => c.path === '/api/join').length, 0);
  f.$('join-code').value = 'abc234'; f.submit(f.$('join-form'));
  assert.match(f.$('page-error').textContent, /1～30/);
  f.$('group-name').value = ` ${'😀'.repeat(30)} `; f.submit(f.$('join-form'));
  await until(() => f.subscriptions.length === 1);
  assert.equal(f.$('join-panel').hidden, true); assert.match(f.$('phase-help').textContent, /等待老師/);
  f.send(snapshot()); fill(f, 0, ['答案']); f.submit(cardForm(f));
  await until(() => f.calls.some((c) => c.path.endsWith('/submissions')));
  assert.equal(f.calls.at(-1).headers['X-CSRF-Token'], 'after');
});

test('準備中與離線不能送出；快照同步保留草稿、原 textarea 及欄位標籤', async (t) => {
  const f = await fixture(t, { initial: snapshot({ state: 'PREPARING' }) });
  assert.equal(cardForm(f).querySelector('fieldset').disabled, true);
  f.send(snapshot()); fill(f, 0, ['  草稿\n']);
  const input = cardForm(f).querySelector('textarea');
  assert.equal(f.document.querySelector(`label[for="${input.id}"]`).textContent, '題號 4 的答案');
  f.send(snapshot()); assert.equal(cardForm(f).querySelector('textarea'), input); assert.equal(input.value, '  草稿\n');
  f.connection('disconnected'); f.submit(cardForm(f));
  assert.equal(f.calls.filter((c) => c.path.endsWith('/submissions')).length, 0);
});

test('題組全成員驗證、1,000 emoji 字數邊界，原文換行一起送出', async (t) => {
  const f = await fixture(t); f.send(snapshot());
  fill(f, 1, ['一題', '　']); f.submit(cardForm(f, 1));
  assert.match(f.document.querySelectorAll('.unit-error')[1].textContent, /全部/);
  fill(f, 1, ['😀'.repeat(1001), '二題']); f.submit(cardForm(f, 1));
  assert.equal(f.calls.some((c) => c.path.endsWith('/submissions')), false);
  const original = '😀'.repeat(998) + '\n ';
  fill(f, 1, [original, '  中文\n=1+1  ']); f.submit(cardForm(f, 1));
  await until(() => !f.document.querySelectorAll('.receipt')[1].hidden);
  const submitted = JSON.parse(f.calls.find((c) => c.path.endsWith('/submissions')).body);
  assert.deepEqual(submitted, { unitId: 'group', answers: [{ questionId: '1', text: original }, { questionId: '9', text: '  中文\n=1+1  ' }] });
});

test('雙擊只發一筆；HTTP 未回覆不誤報成功；收到受理後顯示原文並鎖定', async (t) => {
  let resolve;
  const pending = new Promise((r) => { resolve = r; });
  const f = await fixture(t, { handle: (path) => path.endsWith('/submissions') ? pending : undefined });
  f.send(snapshot()); fill(f, 0, ['<script>alert(1)</script>\n=1+1']);
  f.submit(cardForm(f)); f.submit(cardForm(f));
  assert.equal(f.calls.filter((c) => c.path.endsWith('/submissions')).length, 1);
  assert.match(f.document.querySelector('.unit-state').textContent, /尚在確認/);
  assert.equal(f.document.querySelector('.receipt').hidden, true);
  resolve(json(receipt('single', '<script>alert(1)</script>\n=1+1')));
  await until(() => !f.document.querySelector('.receipt').hidden);
  assert.equal(f.document.querySelector('.receipt script'), null);
  assert.match(f.document.querySelector('.receipt').textContent, /<script>alert\(1\)<\/script>\n=1\+1/);
  assert.equal(cardForm(f).querySelector('fieldset').disabled, true);
});

test('回覆遺失保留草稿與不確定提示；查快照確認伺服器的原受理', async (t) => {
  let stored = false;
  const f = await fixture(t, { handle: (path) => {
    if (path.endsWith('/submissions')) { stored = true; return Promise.reject(new Error('private backend detail')); }
    if (stored && path.endsWith('/snapshot')) return json(snapshot({ submissions: [receipt()] }));
  } });
  f.send(snapshot()); fill(f, 0, ['原文\n']); f.submit(cardForm(f));
  await until(() => f.document.querySelector('.unit-error').textContent.includes('未收到受理回覆'));
  assert.equal(f.document.querySelector('.receipt').hidden, true);
  assert.equal(cardForm(f).querySelector('textarea').value, '原文\n');
  assert.ok(!f.document.body.textContent.includes('private backend detail'));
  f.$('refresh-activity').click();
  await until(() => !f.document.querySelector('.receipt').hidden);
  assert.match(f.document.querySelector('.receipt').textContent, /原文\n/);
});

test('工作階段失效後忽略已在途的 HTTP 快照，不以舊回覆恢復作答', async (t) => {
  let hold = false; let resolve;
  const f = await fixture(t, { handle: (path) => hold && path.endsWith('/snapshot') ? new Promise((r) => { resolve = r; }) : undefined });
  f.send(snapshot()); hold = true; f.$('refresh-activity').click();
  f.connection('unauthorized'); resolve(json(snapshot())); await delay(10);
  assert.match(f.$('page-error').textContent, /無法只靠組名恢復/);
  assert.equal(cardForm(f).querySelector('fieldset').disabled, true);
  f.send(snapshot()); assert.equal(cardForm(f).querySelector('fieldset').disabled, true);
});

test('較舊 HTTP 快照不蓋回 SSE，CLOSED 保留自己的受理且結果頁未存在時明示待整合', async (t) => {
  let hold = false; let resolve;
  const f = await fixture(t, { handle: (path) => hold && path.endsWith('/snapshot') ? new Promise((r) => { resolve = r; }) : undefined });
  f.send(snapshot()); hold = true; f.$('refresh-activity').click();
  const closed = { activityId: 'activity', state: 'CLOSED', mode: 'FAIR', units: units.map((u) => ({ ...u, submissions: u.unitId === 'single' ? [{ ...receipt(), groupId: 'own' }, { ...receipt('single', '他組完整答案'), groupId: 'other' }] : [] })) };
  f.send(closed); resolve(json(snapshot())); await delay(10);
  assert.equal(f.$('phase').textContent, '已結束');
  assert.match(f.$('result-status').textContent, /待整合/);
  assert.equal(f.$('result-link').hidden, true);
  assert.ok(!f.document.body.textContent.includes('他組完整答案'));
  assert.match(f.document.querySelector('.receipt').textContent, /原文/);
});

test('B 共用結果頁存在才提供帶 activityId 的結果入口；未結束不探測', async (t) => {
  const f = await fixture(t, { handle: (path) => path === '/results.html' ? new Response('', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : undefined });
  assert.equal(f.calls.some((c) => c.path === '/results.html'), false);
  f.send({ activityId: 'activity', state: 'CLOSED', mode: 'SPEED', units: units.map((u) => ({ ...u, submissions: [] })) });
  await until(() => !f.$('result-link').hidden);
  assert.equal(f.$('result-link').getAttribute('href'), '/results.html?activityId=activity');
});

test('教師身分不能誤加入；初始化斷網會提供重試且不開放表單', async (t) => {
  const teacher = await fixture(t, { identity: { role: 'TEACHER', csrfToken: 'teacher' } });
  assert.equal(teacher.$('join-panel').hidden, true); assert.match(teacher.$('connection-status').textContent, /教師身分/);
  const offline = await fixture(t, { handle: () => Promise.reject(new Error('offline detail')) });
  assert.match(offline.$('page-error').textContent, /無法連線/);
  assert.equal(offline.$('join-panel').hidden, true);
});

test('同名組被拒絕時有明確提示，不能以名稱接管；錯誤不反射後端細節', async (t) => {
  const f = await fixture(t, { identity: { role: 'ANONYMOUS', csrfToken: 'csrf' },
    handle: (path) => path === '/api/join' ? json({ code: 'GROUP_UNAVAILABLE', message: 'private group list' }, 409) : undefined });
  f.$('join-code').value = 'ABC234'; f.$('group-name').value = '同名組'; f.submit(f.$('join-form'));
  await until(() => f.$('page-error').textContent.includes('不能只靠組名接管'));
  assert.equal(f.$('join-panel').hidden, false);
  assert.ok(!f.document.body.textContent.includes('private group list'));
});

// DOM 驅動真正 HTTP API，兩個獨立 Cookie jar；題目僅在暫存 DB 建立，不代表真實 Sheets 驗收。
async function realPage(t, url) {
  const view = dom(); const harness = watchHarness(); let cookie;
  const fetchImpl = async (path, options) => {
    const response = await fetch(url + path, { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}), ...(options.method === 'POST' ? { Origin: url } : {}) } });
    const next = response.headers.get('set-cookie'); if (next) cookie = next.split(';')[0]; return response;
  };
  const page = mountStudentPage({ document: view.document, fetchImpl, watch: harness.watch }); t.after(() => page.close()); await page.ready;
  const sync = async (activityId) => { const response = await fetchImpl(`/api/activities/${activityId}/snapshot`, { method: 'GET' }); const data = (await response.json()).data; harness.send(data); return data; };
  return { ...view, ...harness, page, fetchImpl, sync };
}
test('兩組 DOM 工作階段加入、單題／題組送出、刷新恢復、FAIR 結果及隱私整合', async (t) => {
  const f = await httpFixture(t); const teacher = await teacherClient(f.url);
  const activity = (await teacher.post('/api/activities', { mode: 'FAIR' })).result.data;
  await f.runtime.store.write(activity.activityId, (db) => {
    for (const unit of units) {
      db.prepare('INSERT INTO units VALUES (?, ?, ?, ?)').run(activity.activityId, unit.unitId, unit.type, unit.order);
      for (const q of unit.questions) db.prepare('INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(activity.activityId, unit.unitId, q.questionId, q.order, 'test-only', 0, q.order, unit.order, `{{Q:${q.questionId}}}`, 'test-only-fingerprint');
    }
  });
  const a = await realPage(t, f.url); const b = await realPage(t, f.url);
  for (const [page, name] of [[a, 'A組'], [b, 'B組']]) {
    page.$('join-code').value = activity.joinCode; page.$('group-name').value = name; page.submit(page.$('join-form'));
    await until(() => page.subscriptions.length === 1);
  }
  await teacher.post(`/api/activities/${activity.activityId}/open`, {});
  await a.sync(activity.activityId); await b.sync(activity.activityId);
  for (const [page, label] of [[a, 'A秘密'], [b, 'B秘密']]) {
    fill(page, 0, [label]); page.submit(cardForm(page));
    await until(() => !page.document.querySelector('.receipt').hidden);
    fill(page, 1, [label + '1', label + '9']); page.submit(cardForm(page, 1));
    await until(() => !page.document.querySelectorAll('.receipt')[1].hidden);
  }
  await a.sync(activity.activityId); await b.sync(activity.activityId);
  assert.ok(!a.document.body.textContent.includes('B秘密')); assert.ok(!b.document.body.textContent.includes('A秘密'));
  const refreshed = dom(); const refreshedHarness = watchHarness();
  const page = mountStudentPage({ document: refreshed.document, fetchImpl: a.fetchImpl, watch: refreshedHarness.watch }); t.after(() => page.close()); await page.ready;
  assert.match(refreshed.document.querySelector('.receipt').textContent, /A秘密/);
  assert.equal(refreshed.$('join-panel').hidden, true);
  await teacher.post(`/api/activities/${activity.activityId}/close`, { confirmed: true });
  const results = await a.sync(activity.activityId); await b.sync(activity.activityId);
  assert.equal(results.units[0].submissions[0].groupName, 'A組');
  assert.equal(results.units[1].submissions[0].groupName, 'B組');
  assert.equal(a.$('phase').textContent, '已結束');
  // 結果頁（B #16）已存在：學生頁以 HEAD 探測成功後才提供入口，探測是非同步的，必須等它完成再斷言。
  await until(() => !a.$('result-link').hidden);
  assert.equal(a.$('result-link').getAttribute('href'), `/results.html?activityId=${activity.activityId}`);
  assert.match(a.$('result-status').textContent, /可查看各組保存結果/);
  assert.doesNotMatch(a.$('result-status').textContent, /待整合/);
  // 結果頁不存在時仍顯示「待整合」且沒有連結，由上方「較舊 HTTP 快照不蓋回 SSE…」測試以 404 模擬覆蓋。
});
