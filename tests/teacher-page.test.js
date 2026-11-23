import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as model from '../public/teacher/model.js';
import { createSnapshotGate } from '../public/teacher/snapshot-gate.js';
import { createApi, ApiError } from '../public/teacher/api.js';
import { httpFixture } from './http-helpers.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (name) => readFileSync(join(publicDir, name), 'utf8');

/* ---------- 純邏輯 ---------- */
test('screenFor：依角色與是否已設定密碼決定畫面', () => {
  assert.equal(model.screenFor(null), 'loading');
  assert.equal(model.screenFor({ role: 'ANONYMOUS', teacherConfigured: false }), 'setup');
  assert.equal(model.screenFor({ role: 'ANONYMOUS', teacherConfigured: true }), 'login');
  assert.equal(model.screenFor({ role: 'TEACHER', teacherConfigured: true }), 'dashboard');
  assert.equal(model.screenFor({ role: 'STUDENT', teacherConfigured: true }), 'student');
});

test('validatePassword：與後端一致（8～128 個 Unicode 字元、不可全空白、需確認）', () => {
  assert.equal(model.validatePassword('12345678'), null);
  assert.equal(model.validatePassword('密碼密碼密碼密碼'), null);
  assert.equal(model.validatePassword('😀'.repeat(8)), null, '以 code point 計算長度');
  assert.equal(model.validatePassword('😀'.repeat(7)) !== null, true);
  for (const bad of ['', '1234567', '        ', 'x'.repeat(129), undefined, 12345678]) assert.notEqual(model.validatePassword(bad), null, String(bad));
  assert.equal(model.validatePassword('x'.repeat(128)), null);
  assert.equal(model.validatePassword('password1', 'password2'), '兩次輸入的密碼不一致。');
  assert.equal(model.validatePassword('password1', 'password1'), null);
});

test('describeError：逐項列出解析錯誤與位置', () => {
  const error = new ApiError(400, 'IMPORT_INVALID', '匯入內容不合法。', [
    { code: 'INVALID_MARKER', message: '標記格式不合法：{{x}}', location: '第一頁!A2' }, { code: 'NO_QUESTIONS', message: '沒有題目' }]);
  assert.deepEqual(model.describeError(error), { message: '匯入內容不合法。', lines: ['第一頁!A2：標記格式不合法：{{x}}', '沒有題目'] });
  assert.deepEqual(model.describeError(new Error('x')), { message: 'x', lines: [] });
  assert.equal(model.describeError(undefined).message.length > 0, true);
});

test('工作表選取：依點選順序，可取消與上下移動', () => {
  let selected = [];
  selected = model.toggleSelected(selected, 5);
  selected = model.toggleSelected(selected, 0);
  selected = model.toggleSelected(selected, 9);
  assert.deepEqual(selected, [5, 0, 9]);
  assert.deepEqual(model.moveSelected(selected, 9, -1), [5, 9, 0]);
  assert.deepEqual(model.moveSelected(selected, 5, 1), [0, 5, 9]);
  assert.deepEqual(model.moveSelected(selected, 5, -1), selected, '最前面不能再上移');
  assert.deepEqual(model.moveSelected(selected, 9, 1), selected, '最後面不能再下移');
  assert.deepEqual(model.moveSelected(selected, 77, 1), selected, '未選取者不動');
  assert.deepEqual(model.toggleSelected(selected, 0), [5, 9]);
  assert.deepEqual(selected, [5, 0, 9], '不修改原陣列');
});

test('canOpen 與題數統計：沒有題目不能開啟，只有準備中可開啟', () => {
  const units = [{ questions: [{ questionId: '1' }] }, { questions: [{ questionId: '2' }, { questionId: '3' }] }];
  assert.equal(model.canOpen({ state: 'PREPARING', units }), true);
  assert.equal(model.canOpen({ state: 'PREPARING', units: [] }), false);
  assert.equal(model.canOpen({ state: 'OPEN', units }), false);
  assert.equal(model.canOpen(null), false);
  assert.deepEqual([model.unitCount({ units }), model.questionCount({ units })], [2, 3]);
  assert.equal(model.questionIds(units[1]), '2、3');
});

const groups = [{ groupId: 'g1', groupName: '甲組' }, { groupId: 'g2', groupName: '乙組' }, { groupId: 'g3', groupName: '丙組' }];
const sub = (submissionId, unitId, groupId, groupName, acceptedOrder, text) => ({ submissionId, unitId, groupId, groupName, acceptedOrder, answers: [{ questionId: 'q', text }] });

test('監看（速度模式）：依受理序號排列、標示暫定勝出者、未送出的組別列在後面', () => {
  const snapshot = {
    mode: 'SPEED', groups,
    units: [{ unitId: 'u1', order: 0, winnerSubmissionId: 's2' }, { unitId: 'u2', order: 1, winnerSubmissionId: null }],
    submissions: [sub('s1', 'u1', 'g1', '甲組', 2, 'b'), sub('s2', 'u1', 'g2', '乙組', 1, 'a')],
  };
  const [first, second] = model.monitorUnits(snapshot);
  assert.deepEqual(first.rows.map((r) => [r.kind, r.groupName, r.acceptedOrder, r.provisionalWinner]), [
    ['submitted', '乙組', 1, true], ['submitted', '甲組', 2, false], ['pending', '丙組', undefined, undefined]]);
  assert.equal(first.winnerLabel, '暫定勝出：乙組');
  assert.equal(first.submittedCount, 2);
  assert.equal(second.winnerLabel, '尚無人送出');
  assert.deepEqual(second.rows.map((r) => r.kind), ['pending', 'pending', 'pending']);
});

test('監看（公平模式）：勝出欄顯示「結束時計算」，不標暫定勝出者', () => {
  const snapshot = { mode: 'FAIR', groups, units: [{ unitId: 'u1', order: 0, winnerSubmissionId: null }], submissions: [sub('s1', 'u1', 'g1', '甲組', 1, 'a')] };
  const [only] = model.monitorUnits(snapshot);
  assert.equal(only.winnerLabel, '勝出者：結束時計算');
  assert.equal(only.rows[0].provisionalWinner, false);
});

test('結果：依最終順位排列，無人作答明示', () => {
  const snapshot = { units: [
    { unitId: 'u1', submissions: [{ rank: 2, groupName: '乙組', acceptedOrder: 1, isWinner: false, answers: [] }, { rank: 1, groupName: '甲組', acceptedOrder: 2, isWinner: true, answers: [] }] },
    { unitId: 'u2', submissions: [] }] };
  const [first, second] = model.resultUnits(snapshot);
  assert.deepEqual(first.rows.map((r) => [r.rank, r.groupName, r.isWinner]), [[1, '甲組', true], [2, '乙組', false]]);
  assert.equal(first.noAnswer, false);
  assert.equal(second.noAnswer, true);
});

/* ---------- API 包裝 ---------- */
const response = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('createApi：帶同源 Cookie、變更請求帶最新 CSRF token，token 旋轉後立即替換', async () => {
  const calls = [];
  const replies = [response(200, { data: { csrfToken: 'one', role: 'ANONYMOUS' } }), response(200, { data: { role: 'TEACHER', csrfToken: 'two' } }), response(200, { data: {} })];
  const api = createApi({ fetchImpl: async (path, init) => { calls.push([path, init]); return replies.shift(); } });
  await api.get('/api/session');
  await api.post('/api/teacher/login', { password: 'x' });
  await api.patch('/api/activities/a/mode', { mode: 'FAIR' });
  assert.deepEqual(calls[0][1].headers, {});
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(calls[1][1].headers['X-CSRF-Token'], 'one');
  assert.equal(calls[2][1].headers['X-CSRF-Token'], 'two', '登入後 token 已旋轉');
  assert.equal(calls[1][1].body, JSON.stringify({ password: 'x' }));
  assert.equal(calls[2][1].method, 'PATCH');
});

test('createApi：錯誤保留狀態碼、錯誤碼與逐項細節；斷網與非 JSON 回應有明確訊息', async () => {
  const fail = createApi({ fetchImpl: async () => response(400, { error: { code: 'IMPORT_INVALID', message: '不合法', details: [{ message: 'm', location: 'S!A1' }] } }) });
  await assert.rejects(fail.post('/x'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.deepEqual([error.status, error.code, error.message, error.details], [400, 'IMPORT_INVALID', '不合法', [{ message: 'm', location: 'S!A1' }]]);
    return true;
  });
  const offline = createApi({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(offline.get('/x'), (error) => error.code === 'NETWORK' && error.status === 0 && !error.message.includes('fetch failed'));
  const html = createApi({ fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } }) });
  await assert.rejects(html.get('/x'), (error) => error.status === 502 && error.code === 'UNKNOWN');
});

/* ---------- 靜態安全：CSP 禁止內嵌腳本／樣式，AC-16 不得以 HTML 注入文字 ---------- */
const teacherSources = () => ['teacher.html', 'teacher.css', ...readdirSync(join(publicDir, 'teacher')).map((f) => `teacher/${f}`)];

test('教師頁沒有內嵌腳本、內嵌樣式或內嵌事件處理，且不使用會解析 HTML 的 API', () => {
  const html = read('teacher.html');
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) assert.match(tag, /\ssrc="/, `script 必須是外部檔案：${tag}`);
  assert.equal(/<script\b[^>]*>\s*\S/i.test(html.replace(/<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/gi, '')), false);
  assert.equal(/<style\b/i.test(html), false);
  assert.equal(/\sstyle\s*=/i.test(html), false);
  assert.equal(/\son[a-z]+\s*=/i.test(html), false);
  assert.equal(/javascript:/i.test(html), false);
  const banned = [/\binnerHTML\b/, /\bouterHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function/, /\.setAttribute\(\s*['"]on/i, /\.setAttribute\(\s*['"]style/i, /\.style\b/, /javascript:/i];
  // 只略過整行註解與區塊註解；行尾註解仍會被檢查，避免把違規寫法藏在同一行。
  const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const file of teacherSources().filter((f) => f.endsWith('.js'))) {
    const source = withoutComments(read(file));
    for (const pattern of banned) assert.equal(pattern.test(source), false, `${file} 不得含 ${pattern}`);
  }
  assert.equal(/innerHTML/.test(withoutComments('x.innerHTML = y')), true, '檢查本身要能抓到違規寫法');
  assert.equal(/innerHTML/.test(withoutComments('// 不使用 innerHTML\nconst a = 1;')), false);
});

test('教師頁所有模組匯入都能解析到實際檔案', () => {
  for (const file of teacherSources().filter((f) => f.endsWith('.js'))) {
    for (const [, target] of read(file).matchAll(/from\s+'([^']+)'/g)) {
      const resolved = target.startsWith('/') ? join(publicDir, target) : join(publicDir, dirname(file), target);
      assert.equal(existsSync(resolved), true, `${file} 匯入 ${target} 找不到檔案`);
    }
  }
});

test('伺服器提供教師頁與模組，帶嚴格 CSP；首頁有教師入口', async (t) => {
  const f = await httpFixture(t);
  const page = await fetch(`${f.url}/teacher.html`);
  assert.equal(page.status, 200);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.equal(csp.includes("'unsafe-inline'"), false);
  assert.match(await page.text(), /教師控制台/);
  for (const path of ['/teacher/main.js', '/teacher/api.js', '/teacher/model.js', '/teacher/dom.js', '/activity-stream.js']) {
    const module = await fetch(`${f.url}${path}`);
    assert.equal(module.status, 200, path);
    assert.match(module.headers.get('content-type'), /javascript/, path);
  }
  assert.equal((await fetch(`${f.url}/teacher.css`)).status, 200);
  assert.match(await (await fetch(`${f.url}/`)).text(), /href="\/teacher\.html"/);
});

test('寫回：目標格顯示（有名稱用名稱，否則以工作表 ID 與 A1，跨 26 欄正確）', () => {
  assert.equal(model.cellLabel({ location: '第二頁!C2' }), '第二頁!C2');
  assert.equal(model.cellLabel({ sheetId: 7, rowIndex: 4, columnIndex: 6 }), '工作表 7！G5');
  assert.equal(model.cellLabel({ sheetId: 0, rowIndex: 0, columnIndex: 26 }), '工作表 0！AA1');
  assert.equal(model.cellLabel(undefined), '');
});

test('寫回：describeExport 不把部分失敗、待核對或衝突說成成功', () => {
  const item = (status) => ({ questionId: 'q', status });
  const ok = model.describeExport({ status: 'SUCCEEDED', items: [item('SUCCEEDED'), item('SUCCEEDED')] });
  assert.deepEqual([ok.tone, ok.advice], ['ok', null]);
  assert.match(ok.headline, /全部 2 格已寫入並回讀核對/);
  assert.match(model.describeExport({ status: 'SUCCEEDED', items: [] }).headline, /沒有需要寫入/);

  const partial = model.describeExport({ status: 'FAILED', items: [item('SUCCEEDED'), item('FAILED')] });
  assert.equal(partial.tone, 'bad');
  assert.match(partial.headline, /1 \/ 2 格已核對成功/);
  assert.doesNotMatch(partial.headline, /全部/);

  const pending = model.describeExport({ status: 'PENDING_VERIFICATION', items: [item('PENDING_VERIFICATION')] });
  assert.equal(pending.tone, 'warn');
  assert.match(pending.advice, /回讀/);

  const conflict = model.describeExport({ status: 'CONFLICT', items: [item('CONFLICT'), item('PENDING')] });
  assert.equal(conflict.tone, 'bad');
  assert.match(conflict.advice, /沒有覆寫/);
  assert.equal(model.describeExport(null), null);
  assert.deepEqual(model.exportCounts({ items: [item('SUCCEEDED'), item('FAILED'), item('FAILED')] }), { SUCCEEDED: 1, FAILED: 2 });
});

test('寫回：按鈕條件需預覽通過且老師確認；未完成的上次紀錄顯示「重試」', () => {
  assert.equal(model.canWriteBack({ canWrite: true }, true), true);
  assert.equal(model.canWriteBack({ canWrite: true }, false), false);
  assert.equal(model.canWriteBack({ canWrite: false }, true), false);
  assert.equal(model.canWriteBack(null, true), false);
  assert.equal(model.writeLabel(null), '寫回 Google Sheets');
  assert.equal(model.writeLabel({ status: 'SUCCEEDED' }), '寫回 Google Sheets');
  for (const status of ['FAILED', 'PENDING_VERIFICATION', 'CONFLICT']) assert.equal(model.writeLabel({ status }), '重試寫回', status);
  for (const key of ['SUCCEEDED', 'FAILED', 'PENDING_VERIFICATION', 'CONFLICT', 'PENDING']) assert.ok(model.EXPORT_STATUS_LABEL[key], key);
  for (const key of ['WILL_WRITE', 'ALREADY_WRITTEN', 'NO_WINNER', 'CONFLICT']) assert.ok(model.PREVIEW_STATUS_LABEL[key], key);

test('isStaleSnapshot：同一活動階段只前進；較舊階段的快照視為過期，不同活動或首次快照一律接受', () => {
  const snap = (activityId, state) => ({ activityId, state });
  assert.equal(model.isStaleSnapshot(snap('a', 'CLOSED'), snap('a', 'OPEN')), true, 'CLOSED 後到的 OPEN');
  assert.equal(model.isStaleSnapshot(snap('a', 'CLOSED'), snap('a', 'PREPARING')), true);
  assert.equal(model.isStaleSnapshot(snap('a', 'OPEN'), snap('a', 'PREPARING')), true);
  assert.equal(model.isStaleSnapshot(snap('a', 'OPEN'), snap('a', 'OPEN')), false, '同階段（內容更新）要接受');
  assert.equal(model.isStaleSnapshot(snap('a', 'OPEN'), snap('a', 'CLOSED')), false);
  assert.equal(model.isStaleSnapshot(snap('a', 'PREPARING'), snap('a', 'OPEN')), false);
  assert.equal(model.isStaleSnapshot(snap('a', 'CLOSED'), snap('b', 'PREPARING')), false, '不同活動由世代檢查處理');
  assert.equal(model.isStaleSnapshot(null, snap('a', 'OPEN')), false);
  assert.equal(model.isStaleSnapshot(snap('a', 'OPEN'), null), false);
  assert.equal(model.isStaleSnapshot(snap('a', 'OPEN'), snap('a', 'UNKNOWN')), true, '未知階段不可覆蓋已知階段');
});

/* ---------- 快照閘門（review #37）：固定的回應順序測試，不需要瀏覽器 ---------- */
const snap = (activityId, state, extra = {}) => ({ activityId, state, ...extra });

test('閘門：CLOSED 的 SSE 先到、舊 OPEN 的 HTTP 後到，不能退回 OPEN', () => {
  const gate = createSnapshotGate();
  const token = gate.attach('a');
  assert.equal(gate.pushed(token, snap('a', 'PREPARING')), true);
  const ticket = gate.beginFetch(); // 開啟後主動抓快照
  assert.equal(gate.pushed(token, snap('a', 'CLOSED')), true);
  assert.equal(gate.fetched(ticket, snap('a', 'OPEN')), false, '請求期間 SSE 已送來較新快照');
  assert.equal(gate.snapshot.state, 'CLOSED');
});

test('閘門：沒有 SSE 時 HTTP 快照照常接受（SSE 中斷時的保險仍有效）', () => {
  const gate = createSnapshotGate();
  gate.attach('a');
  const ticket = gate.beginFetch();
  assert.equal(gate.fetched(ticket, snap('a', 'OPEN')), true);
  assert.equal(gate.snapshot.state, 'OPEN');
});

test('閘門：階段只前進；較舊階段的 HTTP 與 SSE 快照都被擋下，同階段內容更新照常接受', () => {
  const gate = createSnapshotGate();
  const token = gate.attach('a');
  gate.pushed(token, snap('a', 'CLOSED', { v: 1 }));
  assert.equal(gate.pushed(token, snap('a', 'OPEN')), false, 'SSE 也不能倒退');
  assert.equal(gate.fetched(gate.beginFetch(), snap('a', 'OPEN')), false);
  assert.equal(gate.pushed(token, snap('a', 'CLOSED', { v: 2 })), true);
  assert.equal(gate.snapshot.v, 2);
});

test('閘門：切換活動後，舊活動的 HTTP 與 SSE 回應一律丟棄', () => {
  const gate = createSnapshotGate();
  const oldToken = gate.attach('a');
  gate.pushed(oldToken, snap('a', 'OPEN'));
  const oldTicket = gate.beginFetch();
  const newToken = gate.attach('b');
  assert.equal(gate.fetched(oldTicket, snap('a', 'OPEN')), false, '舊活動的 HTTP 回應');
  assert.equal(gate.pushed(oldToken, snap('a', 'CLOSED')), false, '舊連線的 SSE 回呼');
  assert.equal(gate.snapshot, null, '新活動尚未收到任何快照，不能殘留舊資料');
  assert.equal(gate.pushed(newToken, snap('b', 'PREPARING')), true);
  assert.equal(gate.activityId, 'b');
});

test('閘門：登出後舊回應不恢復快照；重新登入同一活動也不接受登出前的請求', () => {
  const gate = createSnapshotGate();
  const token = gate.attach('a');
  gate.pushed(token, snap('a', 'OPEN'));
  const ticket = gate.beginFetch();
  gate.detach();
  assert.equal(gate.snapshot, null);
  assert.equal(gate.activityId, null);
  assert.equal(gate.fetched(ticket, snap('a', 'OPEN')), false, '登出後的 HTTP 回應');
  assert.equal(gate.pushed(token, snap('a', 'OPEN')), false, '登出後的 SSE 回呼');
  assert.equal(gate.beginFetch(), null, '沒有監看中的活動就不送請求');

  const second = gate.attach('a'); // 重新登入後再次監看同一個活動
  assert.equal(gate.fetched(ticket, snap('a', 'CLOSED')), false, '登出前送出的請求仍屬舊世代');
  assert.equal(gate.pushed(token, snap('a', 'CLOSED')), false);
  assert.equal(gate.pushed(second, snap('a', 'OPEN')), true);
});

test('閘門：同階段較新的 SSE 內容不會被延遲抵達的 HTTP 回應蓋回', () => {
  const gate = createSnapshotGate();
  const token = gate.attach('a');
  gate.pushed(token, snap('a', 'OPEN', { groups: 1 }));
  const ticket = gate.beginFetch();
  gate.pushed(token, snap('a', 'OPEN', { groups: 3 }));
  assert.equal(gate.fetched(ticket, snap('a', 'OPEN', { groups: 2 })), false);
  assert.equal(gate.snapshot.groups, 3);
});
