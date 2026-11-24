import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../public/teacher/model.js';
import { createSnapshotGate } from '../public/teacher/snapshot-gate.js';
import { createExportController } from '../public/teacher/export-controller.js';

// 寫回面板的回歸測試（review #40）：以可控制回應順序的假 API 驗證「回覆必須綁定原活動與畫面世代」，
// 以及提示文案不得在可能已寫入時宣稱 Google Sheets 沒有被修改。

const t5 = (name, fn) => test(name, { timeout: 5000 }, fn);
const flush = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// 每個 API 呼叫都記錄下來，由測試決定何時、以什麼回覆它。
function fakeApi() {
  const calls = [];
  const call = (method) => (path, body) => {
    const pending = deferred();
    calls.push({ method, path, body, ...pending });
    return pending.promise;
  };
  return { calls, api: { get: call('GET'), post: call('POST') }, last: () => calls.at(-1), find: (path) => calls.filter((c) => c.path.endsWith(path)) };
}

const preview = (answer, extra = {}) => ({ canWrite: true, structureOk: true, summary: { willWrite: 1, alreadyWritten: 0, noWinner: 0, conflicts: 0 }, units: [{ order: 0, type: 'SINGLE', winnerGroupName: 'X', questions: [{ questionId: '1', answer, status: 'WILL_WRITE', target: { location: 'S!A1' } }] }], ...extra });
const view = (status, items) => ({ exportId: 'e', status, createdAt: '2026-11-24T00:00:00.000Z', items });
const item = (status, errorCode) => ({ questionId: 'q', status, target: { sheetId: 0, rowIndex: 0, columnIndex: 0 }, ...(errorCode ? { errorCode } : {}) });

function setup() {
  const gate = createSnapshotGate();
  const fake = fakeApi();
  const changes = [];
  const controller = createExportController({ api: fake.api, gate, onChange: (state) => changes.push(structuredClone(state)) });
  // 與 main.js 相同：切換活動時先 attach，再 reset。
  const switchTo = (id) => { gate.attach(id); controller.reset(); };
  return { gate, fake, changes, controller, switchTo };
}

t5('延遲的預覽在切換活動後才抵達：不顯示在新活動，也不會成為可寫回的預覽', async () => {
  const { fake, controller, switchTo } = setup();
  switchTo('A');
  const pending = controller.preview();
  assert.equal(fake.last().path, '/api/activities/A/export/preview');
  switchTo('B'); // 老師切換到活動 B，面板清空
  fake.last().resolve(preview('A 的答案'));
  assert.equal(await pending, null);
  assert.equal(controller.state.preview, null, 'B 的畫面不得出現 A 的預覽');
  assert.equal(controller.state.previewScope, null);
});

t5('預覽綁定原活動：預覽後若活動已不同，寫回不送出任何請求（不會把 A 的確認當成 B 的）', async () => {
  const { gate, fake, controller, switchTo } = setup();
  switchTo('A');
  const pending = controller.preview();
  fake.last().resolve(preview('A 的答案'));
  await pending;
  controller.setPaused(true);
  // 模擬 A 的錯誤：切換活動但沒有清除面板狀態，仍不得對 B 送出寫回。
  gate.attach('B');
  const before = fake.calls.length;
  const outcome = await controller.write();
  assert.deepEqual(outcome, { ok: false, stale: true });
  assert.equal(fake.calls.length, before, '沒有送出寫回請求');
  assert.equal(controller.state.preview, null);
  assert.equal(controller.state.confirmedPaused, false);
});

t5('寫回一定使用預覽當下的活動，並且需要預覽通過與確認暫停編輯', async () => {
  const { fake, controller, switchTo } = setup();
  switchTo('A');
  let pending = controller.preview();
  fake.last().resolve(preview('答案'));
  await pending;
  const before = fake.calls.length;
  assert.deepEqual(await controller.write(), { ok: false, stale: true }, '未勾選確認不能寫回');
  assert.equal(fake.calls.length, before);

  pending = controller.preview();
  fake.last().resolve(preview('答案'));
  await pending;
  controller.setPaused(true);
  const writing = controller.write();
  const request = fake.last();
  assert.equal(request.path, '/api/activities/A/export/write');
  assert.deepEqual(request.body, { confirmedPaused: true });
  request.resolve(view('SUCCEEDED', [item('SUCCEEDED')]));
  await flush();
  assert.equal(fake.last().path, '/api/activities/A/exports', '寫回結束後重新載入該活動的紀錄');
  fake.last().resolve({ exports: [view('SUCCEEDED', [item('SUCCEEDED')])] });
  assert.deepEqual(await writing, { ok: true, stale: false });
  assert.equal(controller.state.preview, null, '寫回後清除預覽');
  assert.equal(controller.state.confirmedPaused, false, '寫回後清除暫停確認');
  assert.equal(controller.state.latest.status, 'SUCCEEDED');
});

t5('預覽有衝突（canWrite=false）時不能寫回', async () => {
  const { fake, controller, switchTo } = setup();
  switchTo('A');
  const pending = controller.preview();
  fake.last().resolve(preview('x', { canWrite: false }));
  await pending;
  controller.setPaused(true);
  const before = fake.calls.length;
  assert.deepEqual(await controller.write(), { ok: false, stale: true });
  assert.equal(fake.calls.length, before);
});

t5('延遲的匯出紀錄在切換活動後才抵達：丟棄，不覆蓋新活動的面板', async () => {
  const { fake, controller, switchTo } = setup();
  switchTo('A');
  const loading = controller.load();
  assert.equal(fake.last().path, '/api/activities/A/exports');
  switchTo('B');
  fake.last().resolve({ exports: [view('SUCCEEDED', [item('SUCCEEDED')]), view('FAILED', [item('FAILED')])] });
  assert.equal(await loading, false);
  assert.deepEqual(controller.state.history, []);
  assert.equal(controller.state.latest, null);
  assert.equal(controller.state.loadedFor, null, '新活動仍會重新載入自己的紀錄');
});

t5('延遲的寫回回覆在切換活動後才抵達：不更新畫面、不算成功、不為新活動載入舊紀錄', async () => {
  const { fake, controller, switchTo } = setup();
  switchTo('A');
  let pending = controller.preview();
  fake.last().resolve(preview('答案'));
  await pending;
  controller.setPaused(true);
  const writing = controller.write();
  const request = fake.last();
  switchTo('B');
  const callsAfterSwitch = fake.calls.length;
  request.resolve(view('SUCCEEDED', [item('SUCCEEDED')]));
  assert.deepEqual(await writing, { ok: false, stale: true }, '呼叫端據此不顯示成功提示');
  assert.equal(controller.state.latest, null, 'B 的畫面不得出現 A 的寫回結果');
  assert.equal(fake.calls.length, callsAfterSwitch, '舊回覆不會觸發任何新請求');
});

t5('延遲的寫回「失敗」回覆在切換後抵達：錯誤不顯示在新畫面（回傳 stale 而不是拋出）', async () => {
  const { fake, controller, switchTo } = setup();
  switchTo('A');
  const previewing = controller.preview();
  fake.last().resolve(preview('答案'));
  await previewing;
  controller.setPaused(true);
  const writing = controller.write();
  const request = fake.last();
  switchTo('B');
  request.reject(Object.assign(new Error('寫回失敗'), { details: view('CONFLICT', [item('CONFLICT', 'CELL_CHANGED')]) }));
  assert.deepEqual(await writing, { ok: false, stale: true });
  assert.equal(controller.state.latest, null);
});

t5('登出後舊回覆一律丟棄；重新登入同一個活動也不接受登出前的請求', async () => {
  const { gate, fake, controller } = setup();
  gate.attach('A');
  controller.reset();
  const pendingPreview = controller.preview();
  const previewRequest = fake.last();
  gate.detach(); // 登出
  controller.reset();
  previewRequest.resolve(preview('舊答案'));
  assert.equal(await pendingPreview, null);
  assert.equal(controller.state.preview, null);

  gate.attach('A'); // 重新登入後再次監看同一個活動
  controller.reset();
  const pendingLoad = controller.load();
  const loadRequest = fake.last();
  gate.detach();
  gate.attach('A'); // 再登出登入一次
  controller.reset();
  loadRequest.resolve({ exports: [view('SUCCEEDED', [item('SUCCEEDED')])] });
  assert.equal(await pendingLoad, false);
  assert.deepEqual(controller.state.history, []);
});

t5('同一種操作只接受最後一次：先送出的舊預覽較晚抵達時被丟棄', async () => {
  const { fake, controller, switchTo } = setup();
  switchTo('A');
  const first = controller.preview();
  const firstRequest = fake.last();
  const second = controller.preview();
  const secondRequest = fake.last();
  secondRequest.resolve(preview('新答案'));
  await second;
  firstRequest.resolve(preview('舊答案'));
  assert.equal(await first, null);
  assert.equal(controller.state.preview.units[0].questions[0].answer, '新答案');
});

t5('寫回失敗（衝突／待核對／部分失敗）：保留逐題實況並照常拋出錯誤，不顯示成功', async () => {
  const { fake, controller, switchTo } = setup();
  switchTo('A');
  const previewing = controller.preview();
  fake.last().resolve(preview('答案'));
  await previewing;
  controller.setPaused(true);
  const writing = controller.write();
  const failure = Object.assign(new Error('寫入已送出，但回讀發現來源被改動'), { details: view('CONFLICT', [item('CONFLICT', 'STRUCTURE_CHANGED_AFTER_WRITE')]) });
  fake.last().reject(failure);
  await flush();
  fake.last().resolve({ exports: [] }); // 失敗後同樣會重新載入紀錄；沒有紀錄時保留剛才的逐題實況
  await assert.rejects(writing, (error) => error === failure);
  assert.equal(controller.state.latest.status, 'CONFLICT');
  assert.equal(controller.state.preview, null);
  assert.equal(controller.state.confirmedPaused, false);
});

t5('舊活動的預覽錯誤在切換後抵達：不拋出，不在新畫面顯示警示', async () => {
  const { fake, controller, switchTo } = setup();
  switchTo('A');
  const pending = controller.preview();
  const request = fake.last();
  switchTo('B');
  request.reject(new Error('舊活動的錯誤'));
  assert.equal(await pending, null);
});

test('snapshot gate：current／same 判斷請求範圍（活動與世代都要相同）', () => {
  const gate = createSnapshotGate();
  assert.equal(gate.current(), null);
  assert.equal(gate.same(null), false);
  gate.attach('A');
  const scope = gate.current();
  assert.equal(gate.same(scope), true);
  gate.attach('B');
  assert.equal(gate.same(scope), false, '切換活動');
  gate.attach('A');
  assert.equal(gate.same(scope), false, '同一個活動但世代不同（登出再登入）');
  const fresh = gate.current();
  gate.detach();
  assert.equal(gate.same(fresh), false, '登出');
});

/* ---------- 提示文案：不得在可能已寫入時宣稱沒有修改 ---------- */
const NO_CHANGE_CLAIMS = /沒有被修改|沒有覆寫|沒有寫入任何格|未修改/;

t5('提示：部分格子已成功、其餘失敗時，不得宣稱 Google Sheets 沒有被修改', () => {
  const info = model.describeExport(view('FAILED', [item('SUCCEEDED'), item('FAILED')]));
  assert.match(info.headline, /1 \/ 2 格已核對成功/);
  assert.match(info.advice, /部分格子已寫入/);
  assert.doesNotMatch(info.advice, NO_CHANGE_CLAIMS);
});

t5('提示：寫入後結構改變（STRUCTURE_CHANGED_AFTER_WRITE）的衝突，說明部分格子可能已寫入', () => {
  const info = model.describeExport(view('CONFLICT', [item('CONFLICT', 'STRUCTURE_CHANGED_AFTER_WRITE'), item('CONFLICT', 'STRUCTURE_CHANGED_AFTER_WRITE')]));
  assert.equal(info.tone, 'bad');
  assert.match(info.advice, /部分格子可能已寫入/);
  assert.match(info.advice, /逐題核對/);
  assert.doesNotMatch(info.advice, NO_CHANGE_CLAIMS);
  // 寫後被外部改動、或已有成功格的衝突也一樣。
  for (const items of [[item('CONFLICT', 'CHANGED_EXTERNALLY')], [item('SUCCEEDED'), item('CONFLICT', 'CELL_CHANGED')], [item('PENDING_VERIFICATION'), item('CONFLICT', 'CELL_CHANGED')]]) {
    assert.doesNotMatch(model.describeExport(view('CONFLICT', items)).advice, NO_CHANGE_CLAIMS);
  }
});

t5('提示：寫入前就停止的衝突才可以說沒有寫入任何格', () => {
  const info = model.describeExport(view('CONFLICT', [item('CONFLICT', 'CELL_CHANGED'), item('PENDING')]));
  assert.match(info.advice, /寫入前就已停止/);
  assert.match(info.advice, /沒有寫入任何格/);
  assert.match(model.describeExport(view('CONFLICT', [item('CONFLICT', 'STRUCTURE_CHANGED')])).advice, /沒有寫入任何格/);
});

t5('提示：全部確認未寫入才說沒有寫入；有待核對或寫後錯誤碼時不保證', () => {
  assert.match(model.describeExport(view('FAILED', [item('FAILED', 'SHEETS_PERMISSION_DENIED'), item('FAILED', 'SHEETS_PERMISSION_DENIED')])).advice, /沒有寫入任何格/);
  assert.doesNotMatch(model.describeExport(view('FAILED', [item('FAILED'), item('PENDING_VERIFICATION', 'VERIFY_UNAVAILABLE')])).advice, NO_CHANGE_CLAIMS);
  assert.match(model.describeExport(view('FAILED', [item('FAILED', 'VERIFY_UNAVAILABLE')])).advice, /可能已寫入/);
  const pending = model.describeExport(view('PENDING_VERIFICATION', [item('PENDING_VERIFICATION')]));
  assert.match(pending.advice, /無法確認/);
  assert.doesNotMatch(pending.advice, NO_CHANGE_CLAIMS);
  assert.equal(model.describeExport(view('SUCCEEDED', [item('SUCCEEDED')])).advice, null);
});
