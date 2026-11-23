import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as model from '../public/results/model.js';
import { httpFixture } from './http-helpers.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (name) => readFileSync(join(publicDir, name), 'utf8');

/* ---------- 純邏輯 ---------- */
const sub = (groupId, groupName, acceptedOrder, rank, isWinner, answers = [{ questionId: 'q', text: 'a' }]) => ({ submissionId: `s-${groupId}`, groupId, groupName, acceptedOrder, rank, isWinner, answers });
const results = () => ({
  activityId: 'a', mode: 'FAIR', state: 'CLOSED',
  units: [
    { unitId: 'u2', type: 'SINGLE', order: 1, questions: [{ questionId: '9', order: 0 }], submissions: [] },
    { unitId: 'u1', type: 'GROUP', order: 0, questions: [{ questionId: '2', order: 0 }, { questionId: '3', order: 1 }], submissions: [
      sub('g2', '乙組', 1, 2, false), sub('g1', '甲組', 2, 1, true)] },
  ],
});

test('結果：單位依順序、各組依最終順位排列；勝出者與無人作答明示', () => {
  const [first, second] = model.resultUnits(results());
  assert.deepEqual([first.unit.unitId, second.unit.unitId], ['u1', 'u2'], '單位依 order 排序');
  assert.deepEqual(first.rows.map((r) => [r.rank, r.groupName, r.acceptedOrder, r.isWinner]), [[1, '甲組', 2, true], [2, '乙組', 1, false]],
    '順位與受理順序分開：順位 1 的受理順序是 2');
  assert.equal(first.winnerName, '甲組');
  assert.equal(first.noAnswer, false);
  assert.deepEqual([second.noAnswer, second.winnerName, second.rows.length], [true, null, 0]);
  assert.equal(model.questionIds(first.unit), '2、3');
});

test('結果：學生自己的組別會被標示，老師沒有；不修改傳入資料', () => {
  const input = results();
  const before = JSON.stringify(input);
  const asStudent = model.resultUnits(input, 'g2')[0].rows;
  assert.deepEqual(asStudent.map((r) => [r.groupName, r.isOwn]), [['甲組', false], ['乙組', true]]);
  const asTeacher = model.resultUnits(input).flatMap((u) => u.rows);
  assert.ok(asTeacher.every((r) => r.isOwn === false));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(model.resultUnits(null), []);
  assert.deepEqual(model.resultUnits({}), []);
});

test('取得結果失敗時，依狀態給出明確說明與分類', () => {
  const cases = [
    [{ status: 401 }, 'identity'], [{ status: 403 }, 'forbidden'], [{ status: 404 }, 'notfound'],
    [{ status: 409, code: 'RESULTS_NOT_READY' }, 'waiting'], [{ status: 409, code: 'OTHER' }, 'error'],
    [{ status: 500, message: '伺服器暫時無法處理請求。' }, 'error'], [{ status: 0, message: '無法連線' }, 'error'], [undefined, 'error'],
  ];
  for (const [error, kind] of cases) assert.equal(model.describeFailure(error).kind, kind, JSON.stringify(error));
  assert.equal(model.describeFailure({ status: 500, message: '伺服器暫時無法處理請求。' }).message, '伺服器暫時無法處理請求。');
  assert.ok(model.describeFailure({ status: 403 }).message.includes('沒有權限'));
  assert.ok(model.describeFailure({ status: 409, code: 'RESULTS_NOT_READY' }).message.includes('自動顯示'));
});

test('網址的 activityId：缺少、空白或過長視為無效', () => {
  assert.equal(model.activityIdFrom('?activityId=abc-123'), 'abc-123');
  assert.equal(model.activityIdFrom(''), null);
  assert.equal(model.activityIdFrom('?activityId='), null);
  assert.equal(model.activityIdFrom('?other=1'), null);
  assert.equal(model.activityIdFrom(`?activityId=${'x'.repeat(101)}`), null);
  assert.equal(model.activityIdFrom(`?activityId=${'x'.repeat(100)}`)?.length, 100);
});

/* ---------- 靜態安全：CSP 禁止內嵌腳本／樣式，AC-16 不得以 HTML 注入文字 ---------- */
const sources = () => ['results.html', 'results.css', ...readdirSync(join(publicDir, 'results')).map((f) => `results/${f}`)];

test('結果頁沒有內嵌腳本、內嵌樣式或內嵌事件處理，且不使用會解析 HTML 的 API', () => {
  const html = read('results.html');
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) assert.match(tag, /\ssrc="/, `script 必須是外部檔案：${tag}`);
  assert.equal(/<style\b/i.test(html), false);
  assert.equal(/\sstyle\s*=/i.test(html), false);
  assert.equal(/\son[a-z]+\s*=/i.test(html), false);
  assert.equal(/javascript:/i.test(html), false);
  const banned = [/\binnerHTML\b/, /\bouterHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function/, /\.setAttribute\(\s*['"]on/i, /\.setAttribute\(\s*['"]style/i, /\.style\b/, /javascript:/i];
  const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const file of sources().filter((f) => f.endsWith('.js'))) {
    const source = withoutComments(read(file));
    for (const pattern of banned) assert.equal(pattern.test(source), false, `${file} 不得含 ${pattern}`);
  }
});

test('結果頁所有模組匯入都能解析到實際檔案', () => {
  for (const file of sources().filter((f) => f.endsWith('.js'))) {
    for (const [, target] of read(file).matchAll(/from\s+'([^']+)'/g)) {
      const resolved = target.startsWith('/') ? join(publicDir, target) : join(publicDir, dirname(file), target);
      assert.equal(existsSync(resolved), true, `${file} 匯入 ${target} 找不到檔案`);
    }
  }
});

test('伺服器提供結果頁：GET／HEAD 皆回 text/html（A 的學生頁以 HEAD 探測），帶嚴格 CSP，模組與樣式可取得', async (t) => {
  const f = await httpFixture(t);
  const head = await fetch(`${f.url}/results.html`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /text\/html/);
  const page = await fetch(`${f.url}/results.html?activityId=abc`);
  assert.equal(page.status, 200);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.equal(csp.includes("'unsafe-inline'"), false);
  assert.match(await page.text(), /活動結果/);
  for (const path of ['/results/main.js', '/results/model.js', '/results/dom.js', '/activity-stream.js']) {
    const module = await fetch(`${f.url}${path}`);
    assert.equal(module.status, 200, path);
    assert.match(module.headers.get('content-type'), /javascript/, path);
  }
  assert.equal((await fetch(`${f.url}/results.css`)).status, 200);
});
