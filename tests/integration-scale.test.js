import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { httpFixture, httpClient, teacherClient } from './http-helpers.js';

// 9.1／#20：1 位老師、10 組學生、20 題（15 個單位：10 個單題＋5 個兩題的題組）的整合驗證。
// 走真實 HTTP 與真實 SSE，題目以 B 的正式匯入流程匯入；只有 Google Sheets 是記憶體替身
// （不代表 AC-01／AC-03 的真實驗收）。兩種模式都跑，檢查同步時間、受理、隱私、排名、結束與 CSV。
const GROUPS = 10;
const SYNC_LIMIT_MS = 2000; // FR-03／FR-04：正常本機環境 2 秒內

function sheetsStub() {
  const make = (sheetId, title) => ({ spreadsheetId: 'scale-book', sheetId, title, rowCount: 60, columnCount: 6, cells: Array.from({ length: 60 }, () => Array(6).fill('')), merges: [] });
  const singles = make(1, '單題');
  for (let i = 1; i <= 10; i += 1) singles.cells[i * 2][1] = `{{Q:s${i}}}`;
  const groups = make(2, '題組');
  for (let g = 1; g <= 5; g += 1) {
    groups.cells[g * 4][1] = `{{Q:g${g}a|G:${g}}}`;
    groups.cells[g * 4 + 1][1] = `{{Q:g${g}b|G:${g}}}`;
  }
  return { async readSheets({ sheetIds }) { return [singles, groups].filter((s) => sheetIds.includes(s.sheetId)); } };
}

// 最小 SSE 讀取器：記錄每個快照與抵達時間，供同步時間量測。
async function openStream(t, url, cookie) {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { Cookie: cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  const frames = [];
  const waiters = new Set();
  const pump = (async () => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const dataLine = raw.split('\n').find((line) => line.startsWith('data:'));
          if (!raw.startsWith('event: snapshot') || !dataLine) continue;
          const frame = { at: performance.now(), raw, data: JSON.parse(dataLine.slice(6)).data };
          frames.push(frame);
          for (const waiter of [...waiters]) if (waiter.predicate(frame)) { waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(frame); }
        }
      }
    } catch { /* 連線被中止 */ }
  })();
  void pump;
  const stream = {
    frames,
    last: () => frames.at(-1)?.data,
    // 等到符合條件的快照（含已經收到的）；逾時就失敗。
    until(predicate, timeout = SYNC_LIMIT_MS + 3000) {
      const found = frames.find((f) => predicate(f.data));
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const waiter = { predicate: (f) => predicate(f.data), resolve };
        waiter.timer = setTimeout(() => { waiters.delete(waiter); reject(new Error('等候 SSE 快照逾時')); }, timeout);
        waiters.add(waiter);
      });
    },
    close: () => controller.abort(),
  };
  t.after(() => stream.close());
  return stream;
}

const answerFor = (group, unitIndex, questionId) => `G${group}｜U${unitIndex}｜${questionId}｜答案`;
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];

// 獨立計算期望順位：與實作無關，只用結果裡的受理序號。
function expectedRanking(mode, units) {
  const wins = new Map();
  return units.map((unit) => {
    const bySubmission = [...unit.submissions].sort((a, b) => a.acceptedOrder - b.acceptedOrder);
    if (mode === 'FAIR') bySubmission.sort((a, b) => (wins.get(a.groupName) ?? 0) - (wins.get(b.groupName) ?? 0) || a.acceptedOrder - b.acceptedOrder);
    if (bySubmission[0]) wins.set(bySubmission[0].groupName, (wins.get(bySubmission[0].groupName) ?? 0) + 1);
    return bySubmission.map((s) => s.groupName);
  });
}

for (const mode of ['SPEED', 'FAIR']) {
  test(`1 師／${GROUPS} 組／20 題（${mode}）：匯入、同步、受理、隱私、排名、結束與 CSV`, async (t) => {
    const fixture = await httpFixture(t, { sheetsGateway: sheetsStub() });
    const teacher = await teacherClient(fixture.url);
    const activity = (await teacher.post('/api/activities', { mode })).result.data;
    const base = `/api/activities/${activity.activityId}`;
    const metrics = {};

    // 1. 正式匯入流程：20 題、15 個單位
    const preview = await teacher.post(`${base}/import/preview`, { spreadsheet: 'a'.repeat(44), sheetIds: [1, 2] });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.result.data.summary, { questionCount: 20, unitCount: 15 });
    assert.equal((await teacher.post(`${base}/import/confirm`, { previewToken: preview.result.data.previewToken })).status, 200);

    // 2. 10 組加入，每組、老師各開一條 SSE
    const students = [];
    for (let g = 1; g <= GROUPS; g += 1) {
      const client = await httpClient(fixture.url);
      await client.refresh();
      assert.equal((await client.post('/api/join', { joinCode: activity.joinCode, groupName: `第${g}組` })).status, 200);
      students.push(client);
    }
    const teacherStream = await openStream(t, fixture.url + base + '/events', teacher.cookie);
    const studentStreams = [];
    for (const client of students) studentStreams.push(await openStream(t, fixture.url + base + '/events', client.cookie));
    await teacherStream.until((s) => s.groups?.length === GROUPS);
    check(metrics, '老師看到 10 組加入', teacherStream.last().groups.length === GROUPS);

    // 3. 開啟：11 條連線都要在 2 秒內看到 OPEN
    const openedAt = performance.now();
    assert.equal((await teacher.post(`${base}/open`, {})).status, 200);
    const openFrames = await Promise.all([teacherStream, ...studentStreams].map((s) => s.until((snap) => snap.state === 'OPEN')));
    metrics.openSyncMs = Math.max(...openFrames.map((f) => f.at)) - openedAt;
    assert.ok(metrics.openSyncMs < SYNC_LIMIT_MS, `開啟同步 ${metrics.openSyncMs.toFixed(0)} ms`);

    const unitList = teacherStream.last().units;
    assert.equal(unitList.length, 15);
    assert.equal(unitList.reduce((n, u) => n + u.questions.length, 0), 20);

    // 4. 受理：前 5 個單位 10 組同時送出（競爭），其餘單位依輪替順序逐組送出
    const latencies = [];
    const submit = async (client, group, unitIndex) => {
      const unit = unitList[unitIndex];
      const startedAt = performance.now();
      const response = await client.post(`${base}/submissions`, {
        unitId: unit.unitId,
        answers: unit.questions.map((q) => ({ questionId: q.questionId, text: answerFor(group, unitIndex, q.questionId) })),
      });
      latencies.push(performance.now() - startedAt);
      assert.equal(response.status, 200, `第${group}組單位 ${unitIndex}：${JSON.stringify(response.result)}`);
      return response.result.data;
    };
    const receipts = new Map();
    for (let u = 0; u < 5; u += 1) {
      await Promise.all(students.map(async (client, index) => receipts.set(`${index + 1}:${u}`, await submit(client, index + 1, u))));
    }
    for (let u = 5; u < 15; u += 1) {
      for (let k = 0; k < GROUPS; k += 1) {
        const index = (u + k) % GROUPS;
        receipts.set(`${index + 1}:${u}`, await submit(students[index], index + 1, u));
      }
    }
    assert.equal(receipts.size, GROUPS * 15);
    metrics.submitCount = latencies.length;
    metrics.submitP95Ms = percentile(latencies, 0.95);
    metrics.submitMaxMs = Math.max(...latencies);
    assert.ok(metrics.submitMaxMs < SYNC_LIMIT_MS, `最慢送出 ${metrics.submitMaxMs.toFixed(0)} ms`);

    // 重送同一單位：回傳原受理，不新增紀錄、不改序號
    const again = await submit(students[0], 1, 0);
    assert.equal(again.submissionId, receipts.get('1:0').submissionId);

    // 5. 同步：老師看到全部 150 筆；每組只看到自己的受理與答案
    const syncStartedAt = performance.now();
    await teacherStream.until((s) => s.submissions?.length === GROUPS * 15);
    metrics.teacherSyncAfterLastMs = Math.max(0, teacherStream.frames.find((f) => f.data.submissions?.length === GROUPS * 15).at - syncStartedAt);
    const orders = teacherStream.last().submissions.map((s) => s.acceptedOrder).sort((a, b) => a - b);
    assert.deepEqual(orders, Array.from({ length: GROUPS * 15 }, (_, i) => i + 1), '受理序號 1..150 連續且不重複');
    for (const [index, stream] of studentStreams.entries()) {
      const group = index + 1;
      await stream.until((s) => s.submissions?.length === 15 || s.units?.every?.((u) => u.submission) );
      const everything = stream.frames.map((f) => f.raw).join('\n');
      for (let other = 1; other <= GROUPS; other += 1) {
        if (other === group) continue;
        assert.ok(!everything.includes(`G${other}｜`), `第${group}組的連線不得出現第${other}組的答案`);
        assert.ok(!everything.includes(`第${other}組`), `第${group}組的連線不得出現第${other}組的名稱`);
      }
      assert.ok(everything.includes(`G${group}｜U0｜`), `第${group}組看得到自己的答案`);
      for (const secret of ['acceptedOrder', 'winnerSubmissionId', 'isWinner', 'rank', 'joinCode', 'spreadsheetId', 'originalMarker']) {
        assert.ok(!everything.includes(`"${secret}"`), `學生連線不得含 ${secret}`);
      }
    }

    // 6. 結束：所有連線 2 秒內看到 CLOSED，之後不能再送出
    const closedAt = performance.now();
    assert.equal((await teacher.post(`${base}/close`, { confirmed: true })).status, 200);
    const closedFrames = await Promise.all([teacherStream, ...studentStreams].map((s) => s.until((snap) => snap.state === 'CLOSED')));
    metrics.closeSyncMs = Math.max(...closedFrames.map((f) => f.at)) - closedAt;
    assert.ok(metrics.closeSyncMs < SYNC_LIMIT_MS, `結束同步 ${metrics.closeSyncMs.toFixed(0)} ms`);
    const late = await students[2].post(`${base}/submissions`, { unitId: unitList[0].unitId, answers: unitList[0].questions.map((q) => ({ questionId: q.questionId, text: '結束後' })) });
    assert.equal(late.status, 200, '結束前已受理的重送回傳原紀錄');
    assert.equal(late.result.data.submissionId, receipts.get('3:0').submissionId);

    // 7. 結果：教師與學生一致；順位與獨立計算相符；每單位 10 組都有紀錄
    const teacherResults = (await teacher.request(`${base}/results`)).result.data;
    const studentResults = (await students[4].request(`${base}/results`)).result.data;
    assert.deepEqual(studentResults, teacherResults, '教師與學生看到相同的固定結果');
    assert.equal(teacherResults.mode, mode);
    assert.equal(teacherResults.units.length, 15);
    const expected = expectedRanking(mode, teacherResults.units);
    teacherResults.units.forEach((unit, index) => {
      assert.equal(unit.submissions.length, GROUPS, `單位 ${index} 有 10 組`);
      assert.deepEqual(unit.submissions.map((s) => s.groupName), expected[index], `單位 ${index} 順位`);
      assert.deepEqual(unit.submissions.map((s) => s.rank), Array.from({ length: GROUPS }, (_, i) => i + 1));
      assert.equal(unit.submissions[0].isWinner, true);
      assert.equal(unit.submissions.filter((s) => s.isWinner).length, 1);
      for (const s of unit.submissions) {
        const group = Number(/第(\d+)組/.exec(s.groupName)[1]);
        assert.deepEqual(s.answers.map((a) => a.text), unit.questions.map((q) => answerFor(group, index, q.questionId)), '答案與該組送出的一致');
      }
    });
    if (mode === 'FAIR') {
      const winsByGroup = new Map();
      for (const unit of teacherResults.units) winsByGroup.set(unit.submissions[0].groupName, (winsByGroup.get(unit.submissions[0].groupName) ?? 0) + 1);
      const counts = [...winsByGroup.values()];
      assert.ok(Math.max(...counts) - Math.min(...counts, 0) <= 2, `公平模式勝出次數應平均：${JSON.stringify([...winsByGroup])}`);
      metrics.fairWins = `${Math.min(...counts)}～${Math.max(...counts)} 次（共 ${winsByGroup.size} 組得勝）`;
    }

    // 8. CSV：每筆受理按題展開 = 10 組 × 20 題 = 200 列
    const csv = await fetch(fixture.url + `${base}/results.csv`, { headers: { Cookie: teacher.cookie } });
    assert.equal(csv.status, 200);
    const bytes = new Uint8Array(await csv.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'UTF-8 BOM');
    const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
    const lines = text.split('\r\n').filter(Boolean);
    assert.equal(lines.length, 1 + GROUPS * 20, 'CSV 列數');
    assert.equal(lines[0], 'activity_id,mode,unit_id,question_id,group_name,answer,accepted_at,accepted_order,rank,is_winner');
    assert.equal((await students[0].request(`${base}/results.csv`)).status, 403, '學生不可下載 CSV');

    // 9. 資料庫一致性
    const counts = fixture.runtime.store.read((db) => ({
      submissions: db.prepare('SELECT count(*) AS n FROM submissions WHERE activity_id = ?').get(activity.activityId).n,
      answers: db.prepare('SELECT count(*) AS n FROM submission_answers WHERE activity_id = ?').get(activity.activityId).n,
      results: db.prepare('SELECT count(*) AS n FROM results WHERE activity_id = ?').get(activity.activityId).n,
      winners: db.prepare('SELECT count(*) AS n FROM results WHERE activity_id = ? AND is_winner = 1').get(activity.activityId).n,
    }));
    assert.deepEqual(counts, { submissions: 150, answers: 200, results: 150, winners: 15 });

    console.log(`[${mode}] 開啟同步 ${metrics.openSyncMs.toFixed(0)} ms；結束同步 ${metrics.closeSyncMs.toFixed(0)} ms；送出 ${metrics.submitCount} 筆（含 5 個單位 10 組同時送出）p95 ${metrics.submitP95Ms.toFixed(0)} ms、最慢 ${metrics.submitMaxMs.toFixed(0)} ms${metrics.fairWins ? `；公平模式勝出 ${metrics.fairWins}` : ''}`);
  });
}

// 測試用的小斷言：記錄後直接以 assert 判斷。
function check(_metrics, message, ok) { assert.ok(ok, message); }
