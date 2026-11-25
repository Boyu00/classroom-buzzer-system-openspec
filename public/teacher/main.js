import { watchActivity } from '/activity-stream.js';
import { createApi } from './api.js';
import { el, mount } from './dom.js';
import * as model from './model.js';
import { createSnapshotGate } from './snapshot-gate.js';
import { createExportController } from './export-controller.js';

// 教師控制台。所有文字（組名、答案、試算表內容）一律經 el() 以文字節點加入，不使用 innerHTML。
const app = document.querySelector('#app');
const alertBox = document.querySelector('#alert');
const noticeBox = document.querySelector('#notice');
const api = createApi();

let stream = null;
let snapshot = null;
let activityId = null;
// 決定哪一份快照可以顯示（世代、SSE 優先、階段只前進），規則與測試見 snapshot-gate.js。
const gate = createSnapshotGate();
// 寫回面板的狀態與請求（綁定活動與畫面世代）；狀態變動時重畫面板。
const exportCtl = createExportController({ api, gate, onChange: () => renderExport() });
let refs = {};
const importState = { spreadsheet: '', sheets: [], selected: [], email: '', title: '', preview: null };

/* ---------- 共用：提示、忙碌狀態、錯誤 ---------- */
function clearMessages() {
  alertBox.hidden = true;
  mount(alertBox);
  noticeBox.hidden = true;
  mount(noticeBox);
}

function showAlert(error) {
  const { message, lines } = model.describeError(error);
  mount(alertBox, el('strong', {}, message), lines.length ? el('ul', {}, lines.map((line) => el('li', {}, line))) : null);
  alertBox.hidden = false;
  alertBox.scrollIntoView?.({ block: 'nearest' });
}

function showNotice(text) {
  mount(noticeBox, text);
  noticeBox.hidden = false;
}

const SESSION_LOST = new Set(['SESSION_REQUIRED', 'TEACHER_REQUIRED']);
function handleError(error) {
  showAlert(error);
  if (error?.status === 401 && SESSION_LOST.has(error.code)) start();
}

// 執行一項操作：期間停用按鈕並標示 aria-busy，錯誤統一顯示。
async function run(button, task) {
  clearMessages();
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  try {
    await task();
  } catch (error) {
    handleError(error);
  } finally {
    if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}

const button = (label, attrs = {}, onclick) => el('button', { type: 'button', ...attrs, onclick }, label);

/* ---------- 啟動與畫面切換 ---------- */
function detach() {
  gate.detach();
  exportCtl.reset();
  stream?.close();
  stream = null;
  snapshot = null;
  activityId = null;
}

async function start() {
  detach();
  let session;
  try {
    session = await api.get('/api/session');
  } catch (error) {
    mount(app, pageHeader(false), el('p', {}, '無法連線到服務，請確認服務已啟動後重新整理頁面。'));
    showAlert(error);
    return;
  }
  const screen = model.screenFor(session);
  if (screen === 'setup' || screen === 'login') authScreen(screen);
  else if (screen === 'student') studentScreen();
  else await dashboard();
  app.focus({ preventScroll: true });
}

function pageHeader(withLogout) {
  return el('header', { class: 'page-header' },
    el('div', {}, el('p', { class: 'eyebrow' }, '課堂搶答系統'), el('h1', {}, '教師控制台')),
    withLogout ? button('登出', { class: 'secondary' }, (event) => run(event.currentTarget, async () => {
      detach();
      await api.post('/api/logout');
      await start();
    })) : null);
}

function studentScreen() {
  mount(app, pageHeader(false), el('section', {},
    el('h2', {}, '此瀏覽器已加入學生組別'),
    el('p', {}, '同一個瀏覽器工作階段不能同時當學生與老師。請改用另一個瀏覽器、瀏覽器設定檔或無痕視窗開啟教師頁。'),
    el('p', {}, '為避免該組無法重新加入，這裡不提供登出。')));
}

function authScreen(kind) {
  const setup = kind === 'setup';
  const password = el('input', { id: 'password', type: 'password', required: true, maxlength: 128, autocomplete: setup ? 'new-password' : 'current-password' });
  const confirm = setup ? el('input', { id: 'confirm', type: 'password', required: true, maxlength: 128, autocomplete: 'new-password' }) : null;
  const submit = el('button', { type: 'submit' }, setup ? '設定教師密碼' : '登入');
  const form = el('form', {
    class: 'stack',
    onsubmit: (event) => {
      event.preventDefault();
      run(submit, async () => {
        const problem = setup ? model.validatePassword(password.value, confirm.value) : (password.value ? null : '請輸入密碼。');
        if (problem) throw new Error(problem);
        await api.post(setup ? '/api/teacher/setup' : '/api/teacher/login', { password: password.value });
        password.value = '';
        if (confirm) confirm.value = '';
        await start();
      });
    },
  },
  // 供瀏覽器與密碼管理員辨識這是教師帳號的密碼表單；不影響畫面。
  el('input', { type: 'text', name: 'username', value: 'teacher', autocomplete: 'username', hidden: true, 'aria-hidden': 'true', tabindex: '-1' }),
  el('label', { for: 'password' }, setup ? '設定教師密碼（8～128 個字元）' : '教師密碼'), password,
  confirm ? [el('label', { for: 'confirm' }, '再輸入一次密碼'), confirm] : null,
  submit);
  mount(app, pageHeader(false), el('section', { 'aria-labelledby': 'auth-title' },
    el('h2', { id: 'auth-title' }, setup ? '初次設定教師密碼' : '教師登入'),
    setup ? el('p', {}, '這是本機單一教師密碼，不是帳號註冊。設定後無法在此重設，請妥善記住。') : el('p', {}, '請輸入教師密碼以控制活動。'),
    form));
}

/* ---------- 教師控制台 ---------- */
async function dashboard() {
  refs = {
    status: el('p', { id: 'connection-status', class: 'connection', role: 'status', 'aria-live': 'polite' }, '尚未連線。'),
    create: el('section', { 'aria-labelledby': 'create-title', hidden: true }),
    activity: el('section', { 'aria-labelledby': 'activity-title', hidden: true }),
    import: el('section', { 'aria-labelledby': 'import-title', hidden: true }),
    monitor: el('section', { 'aria-labelledby': 'monitor-title', hidden: true }),
    export: el('section', { 'aria-labelledby': 'export-title', hidden: true }),
    dialog: buildCloseDialog(),
  };
  // 建立活動放在最後：結束後老師先看結果，沒有活動時則只會看到建立面板。
  mount(app, pageHeader(true), refs.status, refs.activity, refs.import, refs.monitor, refs.export, refs.create, refs.dialog);
  buildCreatePanel();
  buildImportPanel();
  try {
    const { activity } = await api.get('/api/teacher/activity');
    if (activity) attach(activity.activityId);
    else { refs.status.textContent = '尚未建立活動。'; renderAll(); }
  } catch (error) {
    handleError(error);
  }
}

function attach(id) {
  const token = gate.attach(id);
  exportCtl.reset();
  stream?.close();
  activityId = id;
  snapshot = null;
  stream = watchActivity({
    activityId: id,
    statusElement: refs.status,
    onSnapshot: (next) => { if (gate.pushed(token, next)) applySnapshot(next); },
    onConnection: (state) => {
      if (state === 'unauthorized') { showAlert({ message: '工作階段已失效，請重新登入。' }); start(); }
    },
  });
}
window.addEventListener('pagehide', () => stream?.close(), { once: true });

function applySnapshot(next) {
  snapshot = next;
  renderAll();
}

// SSE 之外的保險：操作成功後主動抓一次最新快照，避免連線暫時中斷時畫面停在舊狀態。
async function refresh() {
  const ticket = gate.beginFetch();
  if (!ticket) return;
  const next = await api.get(`/api/activities/${encodeURIComponent(ticket.id)}/snapshot`);
  if (gate.fetched(ticket, next)) applySnapshot(next);
}

function renderAll() {
  const state = snapshot?.state;
  refs.create.hidden = Boolean(activityId) && state !== 'CLOSED';
  refs.activity.hidden = !snapshot;
  refs.import.hidden = state !== 'PREPARING';
  refs.monitor.hidden = !snapshot;
  refs.export.hidden = state !== 'CLOSED';
  if (snapshot) { renderActivity(); renderMonitor(); }
  if (state === 'CLOSED') exportCtl.ensureLoaded();
}

function modeRadios(current, name, onChange) {
  return el('fieldset', { class: 'modes' },
    el('legend', {}, '搶答模式'),
    ['SPEED', 'FAIR'].map((value) => el('label', { class: 'choice' },
      el('input', { type: 'radio', name, value, checked: current === value, onchange: (event) => onChange(event.currentTarget.value) }),
      el('span', {}, model.MODE_LABEL[value], el('small', {}, value === 'SPEED' ? '最快送出者勝出，搶答中顯示暫定勝出者。' : '結束時依勝出次數與受理順序計算，搶答中不顯示勝出者。')))));
}

function buildCreatePanel() {
  let chosen = 'SPEED';
  const create = button('建立新活動', {}, (event) => run(event.currentTarget, async () => {
    const created = await api.post('/api/activities', { mode: chosen });
    importState.sheets = [];
    importState.selected = [];
    importState.preview = null;
    attach(created.activityId);
  }));
  mount(refs.create, 
    el('h2', { id: 'create-title' }, '建立活動'),
    el('p', {}, '建立後會產生六碼加入碼，學生用加入碼與組名加入。同時只能有一個未結束的活動。'),
    modeRadios(chosen, 'create-mode', (value) => { chosen = value; }), create);
}

function buildCloseDialog() {
  const dialog = el('dialog', { 'aria-labelledby': 'close-title' },
    el('form', { method: 'dialog', class: 'stack' },
      el('h2', { id: 'close-title' }, '確定要結束活動？'),
      el('p', {}, '結束後學生無法再送出答案，順位與結果會固定，無法復原。'),
      el('div', { class: 'actions' },
        el('button', { value: 'cancel', class: 'secondary' }, '取消'),
        el('button', { value: 'confirm', class: 'danger' }, '確認結束'))));
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'confirm') return;
    run(null, async () => {
      await api.post(`/api/activities/${encodeURIComponent(activityId)}/close`, { confirmed: true });
      await refresh();
    });
  });
  return dialog;
}

function fact(label, value) {
  return [el('dt', {}, label), el('dd', {}, value)];
}

// 結束後的相關連結（結果頁、CSV）。結果頁與 CSV 是獨立功能，端點不存在時不能出現會導向錯誤的連結，
// 所以用 HEAD 探測端點存在且型別正確才顯示；每個活動只探測一次。
const linkProbes = new Map();
async function probe(path, contentType) {
  try {
    const response = await fetch(path, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
    return response.ok && (response.headers.get('content-type') ?? '').includes(contentType);
  } catch {
    return false;
  }
}

function closedLinks(id) {
  const encoded = encodeURIComponent(id);
  if (!linkProbes.has(id)) linkProbes.set(id, Promise.all([probe('/results.html', 'text/html'), probe(`/api/activities/${encoded}/results.csv`, 'text/csv')]));
  const slot = el('span', { id: 'closed-links', class: 'links' });
  linkProbes.get(id).then(([hasResults, hasCsv]) => {
    if (!slot.isConnected) return;
    mount(slot,
      hasResults ? el('a', { href: `/results.html?activityId=${encoded}` }, '查看結果頁') : null,
      hasCsv ? el('a', { href: `/api/activities/${encoded}/results.csv`, download: '' }, '下載 CSV') : null);
  });
  return slot;
}

function renderActivity() {
  const s = snapshot;
  const state = s.state;
  const groups = s.groups ?? [];
  const controls = [];
  if (state === 'PREPARING') {
    const openable = model.canOpen(s);
    controls.push(
      button('開啟搶答', { 'aria-describedby': 'open-hint', disabled: !openable }, (event) => run(event.currentTarget, async () => {
        await api.post(`/api/activities/${encodeURIComponent(activityId)}/open`);
        await refresh();
      })),
      el('span', { id: 'open-hint', class: 'hint' }, openable ? '開啟後會鎖定題目、單位順序與模式，並禁止新組加入。' : '請先匯入至少一題才能開啟。'));
  } else if (state === 'OPEN') {
    controls.push(button('結束活動', { class: 'danger' }, () => { refs.dialog.returnValue = ''; refs.dialog.showModal(); }));
  } else if (state === 'CLOSED') {
    controls.push(closedLinks(activityId));
  }
  mount(refs.activity, 
    el('h2', { id: 'activity-title' }, '活動'),
    state === 'CLOSED' ? null : el('div', { class: 'join' },
      el('span', { class: 'label' }, '加入碼'),
      el('strong', { class: 'code', 'aria-label': `加入碼 ${(s.joinCode ?? '').split('').join(' ')}` }, s.joinCode),
      el('span', { class: 'hint' }, '學生輸入加入碼與組名加入；開啟後不再接受新組。')),
    el('dl', { class: 'facts' },
      fact('階段', model.STATE_LABEL[state]), fact('模式', model.MODE_LABEL[s.mode]),
      fact('題目', `${model.unitCount(s)} 個單位、${model.questionCount(s)} 題`),
      state === 'CLOSED' ? null : fact('已加入組別', `${groups.length} 組`)),
    state === 'PREPARING' ? modeRadios(s.mode, 'activity-mode', (value) => run(null, async () => {
      await api.patch(`/api/activities/${encodeURIComponent(activityId)}/mode`, { mode: value });
      await refresh();
    })) : null,
    groups.length ? el('ul', { class: 'chips', 'aria-label': '已加入的組別' }, groups.map((g) => el('li', {}, g.groupName))) : null,
    el('div', { class: 'actions' }, controls));
}

/* ---------- 匯入題目 ---------- */
function buildImportPanel() {
  const input = el('input', {
    id: 'spreadsheet', type: 'text', autocomplete: 'off', spellcheck: 'false', value: importState.spreadsheet,
    placeholder: 'https://docs.google.com/spreadsheets/d/…',
    oninput: (event) => { importState.spreadsheet = event.currentTarget.value; },
  });
  const load = el('button', { type: 'submit' }, '讀取工作表');
  refs.sheets = el('div', { id: 'sheet-list' });
  refs.preview = el('div', { id: 'preview' });
  mount(refs.import, 
    el('h2', { id: 'import-title' }, '匯入題目'),
    el('p', {}, '貼上試算表網址或 ID，讀取工作表後依序選擇，再預覽並確認。題目直接從線上 Google Sheets 讀取。'),
    el('form', {
      class: 'inline-form',
      onsubmit: (event) => {
        event.preventDefault();
        run(load, async () => {
          const data = await api.post(`/api/activities/${encodeURIComponent(activityId)}/import/sheets`, { spreadsheet: importState.spreadsheet });
          Object.assign(importState, { sheets: data.sheets, title: data.title, email: data.serviceAccountEmail, selected: [], preview: null });
          renderSheets();
          renderPreview();
        });
      },
    }, el('label', { for: 'spreadsheet' }, '試算表網址或 ID'), input, load),
    refs.sheets, refs.preview);
  renderSheets();
  renderPreview();
}

function renderSheets() {
  const { sheets, selected, email, title } = importState;
  if (!sheets.length) { mount(refs.sheets); return; }
  const rebuild = () => { importState.preview = null; renderSheets(); renderPreview(); };
  const items = sheets.map((sheet) => {
    const position = selected.indexOf(sheet.sheetId) + 1;
    return el('li', {},
      el('label', { class: 'choice' },
        el('input', { type: 'checkbox', checked: position > 0, onchange: () => { importState.selected = model.toggleSelected(importState.selected, sheet.sheetId); rebuild(); } }),
        el('span', {}, sheet.title)),
      position ? el('span', { class: 'order' }, `掃描順序 ${position}`) : null,
      position ? button('上移', { class: 'secondary small', 'aria-label': `上移 ${sheet.title}`, disabled: position === 1 },
        () => { importState.selected = model.moveSelected(importState.selected, sheet.sheetId, -1); rebuild(); }) : null,
      position ? button('下移', { class: 'secondary small', 'aria-label': `下移 ${sheet.title}`, disabled: position === selected.length },
        () => { importState.selected = model.moveSelected(importState.selected, sheet.sheetId, 1); rebuild(); }) : null);
  });
  const previewBtn = el('button', { type: 'button', disabled: selected.length === 0 }, '預覽匯入');
  previewBtn.addEventListener('click', () => run(previewBtn, async () => {
    importState.preview = null;
    renderPreview();
    importState.preview = await api.post(`/api/activities/${encodeURIComponent(activityId)}/import/preview`,
      { spreadsheet: importState.spreadsheet, sheetIds: importState.selected });
    renderPreview();
  }));
  mount(refs.sheets, el('fieldset', {},
    el('legend', {}, `「${title}」的工作表：依勾選順序掃描`),
    el('ul', { class: 'sheet-items' }, items),
    el('p', { class: 'hint' }, `若讀取失敗，請確認已把試算表分享給服務帳戶：${email}`),
    previewBtn));
}

function renderPreview() {
  const preview = importState.preview;
  if (!preview) { mount(refs.preview); return; }
  const existing = model.unitCount(snapshot);
  const confirm = el('button', { type: 'button' }, '確認匯入');
  confirm.addEventListener('click', () => run(confirm, async () => {
    const result = await api.post(`/api/activities/${encodeURIComponent(activityId)}/import/confirm`, { previewToken: preview.previewToken });
    importState.preview = null;
    renderPreview();
    showNotice(`已匯入 ${preview.summary.questionCount} 題、${preview.summary.unitCount} 個單位（匯入版本 ${result.importRevision}）。`);
    await refresh();
  }));
  mount(refs.preview, el('div', { class: 'preview-box' },
    el('h3', {}, '匯入預覽'),
    el('p', {}, `共 ${preview.summary.questionCount} 題、${preview.summary.unitCount} 個單位。`),
    el('table', {},
      el('caption', {}, '題號與原格位置'),
      el('thead', {}, el('tr', {}, ['單位', '類型', '題號（工作表!儲存格）'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, preview.units.map((unit) => el('tr', {},
        el('th', { scope: 'row' }, `第 ${unit.order + 1} 單位`),
        el('td', {}, model.TYPE_LABEL[unit.type]),
        el('td', {}, unit.questions.map((q) => `${q.questionId}（${q.location}）`).join('、')))))),
    existing ? el('p', { class: 'hint' }, `確認後會取代目前已匯入的 ${existing} 個單位。`) : null,
    confirm));
}

/* ---------- 監看與結果 ---------- */
function answerList(answers) {
  return el('ul', { class: 'answers' }, answers.map((a) => el('li', {}, el('span', { class: 'qid' }, `題 ${a.questionId}`), el('span', { class: 'text' }, a.text))));
}

function renderMonitor() {
  const s = snapshot;
  if (s.state === 'PREPARING') {
    mount(refs.monitor, el('h2', { id: 'monitor-title' }, '已匯入的題目'),
      model.unitCount(s) ? el('ol', { class: 'unit-list' }, s.units.map((unit) =>
        el('li', {}, `${model.TYPE_LABEL[unit.type]}：題 ${model.questionIds(unit)}`)))
        : el('p', {}, '尚未匯入題目。請在上方匯入並確認。'));
    return;
  }
  if (s.state === 'OPEN') {
    mount(refs.monitor, el('h2', { id: 'monitor-title' }, '即時監看'),
      el('p', { class: 'hint' }, '只顯示已送出的答案，不追蹤學生尚未送出的草稿。'),
      model.monitorUnits(s).map(({ unit, rows, submittedCount, winnerLabel }) => el('article', { class: 'unit' },
        el('h3', {}, `第 ${unit.order + 1} 單位（${model.TYPE_LABEL[unit.type]}）題 ${model.questionIds(unit)}`),
        el('p', { class: 'summary' }, `已送出 ${submittedCount} / ${(s.groups ?? []).length} 組　${winnerLabel}`),
        rows.length ? el('table', {},
          el('caption', {}, `第 ${unit.order + 1} 單位各組送出狀態`),
          el('thead', {}, el('tr', {}, ['受理順序', '組別', '答案'].map((h) => el('th', { scope: 'col' }, h)))),
          el('tbody', {}, rows.map((row) => row.kind === 'submitted'
            ? el('tr', { class: row.provisionalWinner ? 'winner' : null },
              el('td', {}, String(row.acceptedOrder)), el('th', { scope: 'row' }, row.groupName,
                row.provisionalWinner ? el('span', { class: 'badge' }, '暫定勝出') : null), el('td', {}, answerList(row.answers)))
            : el('tr', { class: 'pending' }, el('td', {}, '—'), el('th', { scope: 'row' }, row.groupName), el('td', {}, '尚未送出'))))) : el('p', {}, '目前沒有組別。'))));
    return;
  }
  mount(refs.monitor, el('h2', { id: 'monitor-title' }, `結果（${model.MODE_LABEL[s.mode]}）`),
    el('p', { class: 'hint' }, '結果已固定。受理順序與最終順位分開保存。'),
    model.resultUnits(s).map(({ unit, rows, noAnswer }) => el('article', { class: 'unit' },
      el('h3', {}, `第 ${unit.order + 1} 單位（${model.TYPE_LABEL[unit.type]}）題 ${model.questionIds(unit)}`),
      noAnswer ? el('p', { class: 'summary' }, '無人作答') : el('table', {},
        el('caption', {}, `第 ${unit.order + 1} 單位的最終順位`),
        el('thead', {}, el('tr', {}, ['順位', '組別', '受理順序', '答案'].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, rows.map((row) => el('tr', { class: row.isWinner ? 'winner' : null },
          el('td', {}, String(row.rank)),
          el('th', { scope: 'row' }, row.groupName, row.isWinner ? el('span', { class: 'badge' }, '勝出') : null),
          el('td', {}, String(row.acceptedOrder)), el('td', {}, answerList(row.answers)))))))));
}

/* ---------- 寫回原 Google Sheets ---------- */
// 狀態與請求流程在 export-controller.js（綁定活動與畫面世代）；這裡只負責畫面。
const EXPORT_LABELS = model.EXPORT_STATUS_LABEL;

const statusBadge = (status) => el('span', { class: `badge status-${status.toLowerCase()}` }, EXPORT_LABELS[status] ?? status);

function exportItemsTable(items, caption, titles) {
  return el('table', { class: 'export-table' },
    el('caption', {}, caption),
    el('thead', {}, el('tr', {}, ['題號', '目標格', '狀態', '說明'].map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, items.map((item) => el('tr', {},
      el('th', { scope: 'row' }, item.questionId),
      el('td', {}, model.cellLabel(item.target, titles)),
      el('td', {}, statusBadge(item.status)),
      el('td', {}, item.message ?? (item.errorCode ? `錯誤代碼：${item.errorCode}` : ''))))));
}

function renderExportResult(view, titles) {
  const info = model.describeExport(view);
  if (!info) return null;
  return el('div', { class: `export-result ${info.tone}`, role: 'status' },
    el('h3', {}, '最近一次寫回'),
    el('p', {}, statusBadge(view.status), ' ', info.headline),
    info.advice ? el('p', { class: 'hint' }, info.advice) : null,
    view.items.length ? exportItemsTable(view.items, '逐題寫回實況', titles) : null);
}

function renderExportPreview(preview) {
  if (!preview) return null;
  const { summary } = preview;
  return el('div', { class: 'preview-box' },
    el('h3', {}, '寫回預覽'),
    el('p', {}, `將寫入 ${summary.willWrite} 格；先前已寫入 ${summary.alreadyWritten} 格；無人作答 ${summary.noWinner} 題（不變更）；衝突 ${summary.conflicts} 格。`),
    preview.canWrite ? null : el('p', { class: 'hint bad', role: 'alert' },
      preview.structureOk ? '部分原格內容與匯入時不同，已停止。請恢復原內容，或另建活動重新匯入。'
        : '試算表結構與匯入時不同（工作表被刪除、改名、增減列欄或合併範圍改變），已停止。請恢復原結構，或另建活動重新匯入。'),
    preview.units.map((unit) => el('article', { class: 'unit' },
      el('h4', {}, `第 ${unit.order + 1} 單位（${model.TYPE_LABEL[unit.type]}）${unit.winnerGroupName ? `　勝出：${unit.winnerGroupName}` : '　無人作答'}`),
      el('table', { class: 'export-table' },
        el('caption', {}, `第 ${unit.order + 1} 單位的寫回內容`),
        el('thead', {}, el('tr', {}, ['題號', '目標格', '狀態', '寫入答案'].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, unit.questions.map((q) => el('tr', { class: q.status === 'CONFLICT' ? 'pending' : null },
          el('th', { scope: 'row' }, q.questionId),
          el('td', {}, model.cellLabel(q.target)),
          el('td', {}, model.PREVIEW_STATUS_LABEL[q.status] ?? q.status, q.message ? el('small', {}, ` ${q.message}`) : null),
          el('td', { class: 'wide-cell' }, q.answer === null ? '—' : el('span', { class: 'text' }, q.answer)))))))));
}

function renderExport() {
  if (!refs.export) return;
  const { preview, latest, history, confirmedPaused, sheetTitles } = exportCtl.state;
  const previewBtn = button('預覽寫回', {}, (event) => run(event.currentTarget, () => exportCtl.preview()));
  const paused = el('input', {
    id: 'export-paused', type: 'checkbox', checked: confirmedPaused,
    onchange: (event) => { exportCtl.setPaused(event.currentTarget.checked); document.querySelector('#export-paused')?.focus(); },
  });
  const writeBtn = button(model.writeLabel(latest), { id: 'export-write', disabled: !model.canWriteBack(preview, confirmedPaused), 'aria-describedby': 'export-hint' },
    (event) => run(event.currentTarget, async () => {
      const outcome = await exportCtl.write();
      // 活動已切換或預覽已失效時 stale 為 true：舊回覆不得在新畫面顯示成功。
      if (outcome.ok) showNotice('已全部寫入原 Google Sheets，並逐格回讀核對。');
    }));
  mount(refs.export,
    el('h2', { id: 'export-title' }, '寫回原 Google Sheets'),
    el('p', {}, '把各單位勝出組的答案寫回匯入時的原格，只更新答案格的內容（純文字，公式開頭也不會變成公式），其他內容與格式不變；無人作答的格不變。服務帳戶需是該試算表的「編輯者」。'),
    el('p', { class: 'hint' }, '注意：寫回後，原格的 {{Q:…}} 標記會被答案取代。之後若要用同一份試算表重新匯入，請先把標記貼回去，或另外複製一份範本。'),
    el('div', { class: 'actions' }, previewBtn),
    renderExportPreview(preview),
    preview ? el('div', { class: 'stack wide-stack' },
      el('label', { class: 'choice', for: 'export-paused' }, paused, el('span', {}, '我已請其他人暫停編輯此試算表，寫回完成後我會再恢復。')),
      el('p', { id: 'export-hint', class: 'hint' }, preview.canWrite
        ? (confirmedPaused ? '寫入後系統會逐格回讀核對，全部相符才會顯示成功。' : '請先勾選上方確認。')
        : '預覽有衝突，無法寫回。'),
      el('div', { class: 'actions' }, writeBtn))
      : (latest && latest.status !== 'SUCCEEDED' ? el('p', { class: 'hint' }, '上次寫回未完成。請先重新預覽，確認後可重試。') : null),
    renderExportResult(latest, sheetTitles),
    history.length > 1 ? el('details', {},
      el('summary', {}, `匯出紀錄（共 ${history.length} 次）`),
      el('table', {},
        el('caption', {}, '所有寫回紀錄，新到舊'),
        el('thead', {}, el('tr', {}, ['時間', '狀態', '各格實況'].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, history.map((entry) => el('tr', {},
          el('td', {}, new Date(entry.createdAt).toLocaleString('zh-TW')),
          el('td', {}, statusBadge(entry.status)),
          el('td', {}, Object.entries(model.exportCounts(entry)).map(([status, n]) => `${EXPORT_LABELS[status] ?? status} ${n}`).join('、') || '無需寫入')))))) : null);
}

start();
