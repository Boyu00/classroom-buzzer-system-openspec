import { watchActivity } from '/activity-stream.js';
import { el, mount } from './dom.js';
import * as model from './model.js';

// 結果頁：老師與已加入該活動的學生，在活動結束後查看固定結果。
// 路徑 /results.html?activityId=… 與學生頁約定相同。所有文字經 el() 以文字節點加入。
const root = document.querySelector('#content');
const statusLine = document.querySelector('#connection-status');
const activityId = model.activityIdFrom(window.location.search);
let session = null;
let stream = null;

async function getJson(path, method = 'GET') {
  let response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    const error = new Error('無法連線到服務，請確認服務已啟動後重新整理。');
    error.status = 0;
    throw error;
  }
  let payload = null;
  try { payload = await response.json(); } catch { /* 非 JSON */ }
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? '無法取得結果。');
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload?.data ?? {};
}

function backLinks() {
  return el('p', { class: 'links' },
    session?.role === 'TEACHER' ? el('a', { href: '/teacher.html' }, '回教師控制台') : null,
    session?.role === 'STUDENT' ? el('a', { href: '/student.html' }, '回學生作答頁') : null,
    session?.role === 'ANONYMOUS' ? [el('a', { href: '/teacher.html' }, '教師登入'), el('a', { href: '/student.html' }, '學生頁')] : null);
}

function notice(title, message, kind) {
  mount(root, el('section', { class: `notice ${kind}`, role: kind === 'error' || kind === 'forbidden' ? 'alert' : 'status' },
    el('h2', {}, title), el('p', {}, message), backLinks()));
}

const TITLES = { identity: '需要確認身分', forbidden: '無法查看', notfound: '找不到活動', waiting: '活動尚未結束', error: '無法取得結果' };

function answerList(answers) {
  return el('ul', { class: 'answers' }, answers.map((a) => el('li', {},
    el('span', { class: 'qid' }, `題 ${a.questionId}`), el('span', { class: 'text' }, a.text))));
}

function renderResults(results) {
  statusLine.textContent = ''; // 結果已固定，不再需要連線狀態（例如「已停止活動同步」）。
  const units = model.resultUnits(results, session?.role === 'STUDENT' ? session.groupId : null);
  mount(root,
    el('section', { class: 'summary-box' },
      el('h2', {}, `結果（${model.MODE_LABEL[results.mode] ?? results.mode}）`),
      el('p', { class: 'hint' }, '結果已固定，不會再變動。受理順序是伺服器實際收到答案的先後；最終順位依模式規則在活動結束時計算。'),
      session?.role === 'STUDENT' ? el('p', { class: 'hint' }, '標示「你們這組」的是你自己的組別。') : null,
      el('div', { class: 'links' }, csvSlot, backLinks())),
    units.map(({ unit, rows, noAnswer, winnerName }) => el('article', { class: 'unit' },
      el('h3', {}, `第 ${unit.order + 1} 單位（${model.TYPE_LABEL[unit.type] ?? unit.type}）題 ${model.questionIds(unit)}`),
      noAnswer
        ? el('p', { class: 'no-answer' }, '無人作答')
        : [el('p', { class: 'winner-line' }, `勝出組別：${winnerName ?? '—'}`),
          el('table', {},
            el('caption', {}, `第 ${unit.order + 1} 單位的最終順位`),
            el('thead', {}, el('tr', {}, ['順位', '組別', '受理順序', '答案'].map((h) => el('th', { scope: 'col' }, h)))),
            el('tbody', {}, rows.map((row) => el('tr', { class: [row.isWinner ? 'winner' : '', row.isOwn ? 'own' : ''].join(' ').trim() || null },
              el('td', {}, String(row.rank)),
              el('th', { scope: 'row' }, row.groupName,
                row.isWinner ? el('span', { class: 'badge' }, '勝出') : null,
                row.isOwn ? el('span', { class: 'badge own-badge' }, '你們這組') : null),
              el('td', {}, String(row.acceptedOrder)),
              el('td', {}, answerList(row.answers))))))])));
  probeCsv();
}

// 老師才會看到 CSV 下載；以 HEAD 探測端點存在且回傳 CSV 時才顯示，避免出現會導向錯誤的連結。
const csvSlot = el('span', { class: 'csv-slot' });
async function probeCsv() {
  if (session?.role !== 'TEACHER') return;
  try {
    const response = await fetch(`/api/activities/${encodeURIComponent(activityId)}/results.csv`, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
    if (response.ok && response.headers.get('content-type')?.includes('text/csv')) {
      mount(csvSlot, el('a', { href: `/api/activities/${encodeURIComponent(activityId)}/results.csv`, download: '' }, '下載 CSV'));
    }
  } catch { /* 沒有 CSV 端點時不顯示連結 */ }
}

function waitForClose() {
  stream?.close();
  stream = watchActivity({
    activityId, statusElement: statusLine,
    onSnapshot: (snapshot) => {
      // 結束後的快照就是固定結果（與 results API 同一份），收到後改顯示結果並停止同步。
      if (snapshot.state === 'CLOSED') { stream?.close(); stream = null; renderResults(snapshot); }
    },
    onConnection: (state) => { if (state === 'unauthorized') notice(TITLES.identity, '工作階段已失效，請重新確認身分。', 'identity'); },
  });
}

async function start() {
  if (!activityId) {
    notice('缺少活動', '網址需要包含 activityId，請從教師控制台或學生作答頁的連結進入。', 'notfound');
    return;
  }
  try {
    session = await getJson('/api/session');
  } catch (error) {
    notice(TITLES.error, error.message, 'error');
    return;
  }
  if (session.role === 'ANONYMOUS') { notice(TITLES.identity, model.describeFailure({ status: 401 }).message, 'identity'); return; }
  try {
    renderResults(await getJson(`/api/activities/${encodeURIComponent(activityId)}/results`));
  } catch (error) {
    const failure = model.describeFailure(error);
    notice(TITLES[failure.kind], failure.message, failure.kind);
    if (failure.kind === 'waiting') waitForClose();
  }
}

window.addEventListener('pagehide', () => stream?.close(), { once: true });
start();
