import { watchActivity } from './activity-stream.js';

const errors = {
  GROUP_UNAVAILABLE: '無法以此組名加入，請換一個名稱；不能只靠組名接管原組。',
  INVALID_JOIN_CODE: '加入碼無效，請向老師確認。', ACTIVITY_NOT_FOUND: '找不到活動，請向老師確認加入碼。',
  INVALID_PHASE: '活動階段已改變，請確認最新活動與受理紀錄。',
  INVALID_ANSWERS: '請檢查所有答案：不可全空白，每題最多 1,000 字。',
  CSRF_REJECTED: '請重新確認身分與活動後再操作。',
};
const recovery = '工作階段已失效。原組別無法只靠組名恢復，請洽老師；重新確認後可加入其他允許加入的活動。';

export function mountStudentPage({ document, fetchImpl = globalThis.fetch, watch = watchActivity }) {
  const $ = (id) => document.getElementById(id);
  const cards = new Map();
  const pending = new Set();
  const accepted = new Map();
  let session;
  let snapshot;
  let stream;
  let connected = false;
  let valid = false;
  let disposed = false;
  let epoch = 0;
  let version = 0;
  let joining = false;
  let leaving = false;
  let resultCheck = false;
  let nextCard = 0;
  const active = (run) => !disposed && run === epoch;
  const base = () => `/api/activities/${encodeURIComponent(session.activityId)}`;
  const say = (text) => { $('page-error').textContent = text; };
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function invalidate() {
    epoch++;
    valid = false;
    connected = false;
    pending.clear();
    stream?.close();
    say(recovery);
    $('result-link').hidden = true;
    updateControls();
  }

  async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetchImpl(path, {
      method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrfToken ?? '' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.data) {
      const error = new Error('API request failed');
      error.status = response.status;
      error.code = payload.error?.code;
      throw error;
    }
    return payload.data;
  }
  function fail(error, fallback) {
    if (error.status === 401 || (error.status === 403 && error.code !== 'CSRF_REJECTED')) {
      invalidate();
      return recovery;
    }
    return errors[error.code] ?? fallback;
  }
  function updateControls() {
    $('join-fields').disabled = joining || leaving || session?.role !== 'ANONYMOUS' || !valid;
    const canLeave = session?.role === 'STUDENT' && snapshot?.state === 'PREPARING';
    $('leave-group').hidden = !canLeave;
    $('leave-help').hidden = !canLeave;
    $('leave-group').disabled = leaving || !valid || !connected;
    $('leave-group').textContent = leaving ? '正在確認退出…' : '退出組別並重新加入';
    $('refresh-session').disabled = leaving;
    $('refresh-activity').disabled = leaving;
    for (const [id, card] of cards) {
      const receipt = accepted.get(id);
      const locked = !valid || !connected || snapshot?.state !== 'OPEN' || pending.has(id) || !!receipt;
      card.fields.disabled = locked;
      card.fields.hidden = !!receipt;
      card.button.textContent = receipt ? '已受理，不可修改' : pending.has(id) ? '送出中，等待受理回覆…' : card.unit.type === 'GROUP' ? '整組一起送出' : '送出答案';
      card.state.textContent = receipt ? '已受理' : pending.has(id) ? '尚在確認受理' : snapshot?.state === 'CLOSED' ? '未受理，活動已結束' : '尚未受理';
      if (receipt) {
        card.receipt.replaceChildren(node('p', `受理時間：${receipt.acceptedAt}`));
        for (const answer of receipt.answers) card.receipt.append(node('p', `題號 ${answer.questionId}\n${answer.text}`));
        card.receipt.hidden = false;
        card.error.textContent = '';
      }
    }
  }
  function makeCard(unit, index) {
    const section = node('section');
    const heading = node('h2', unit.type === 'GROUP' ? `題組 · ${unit.questions.map((q) => q.questionId).join('、')}` : `題號 ${unit.questions[0].questionId}`);
    heading.id = `unit-heading-${index}`;
    section.setAttribute('aria-labelledby', heading.id);
    const form = node('form');
    const fields = node('fieldset');
    fields.append(node('legend', unit.type === 'GROUP' ? '所有成員填妥後一次送出' : '填寫你的答案'));
    const inputs = unit.questions.map((q, questionIndex) => {
      const input = node('textarea');
      input.id = `answer-${index}-${questionIndex}`;
      input.name = q.questionId;
      input.required = true;
      input.rows = 3;
      const label = node('label', `題號 ${q.questionId} 的答案`);
      label.setAttribute('for', input.id);
      const counter = node('p', '0 / 1,000 字', 'counter');
      counter.id = `${input.id}-help`;
      input.setAttribute('aria-describedby', counter.id);
      input.addEventListener('input', () => {
        counter.textContent = `${[...input.value].length} / 1,000 字`;
        input.removeAttribute('aria-invalid');
      });
      fields.append(label, input, counter);
      return { input, questionId: q.questionId };
    });
    const button = node('button', '送出答案');
    button.type = 'submit';
    fields.append(button);
    const state = node('p', '尚未受理', 'unit-state');
    state.setAttribute('role', 'status');
    const error = node('p', '', 'unit-error');
    error.setAttribute('role', 'alert');
    const receipt = node('div', undefined, 'receipt');
    receipt.hidden = true;
    form.append(fields);
    section.append(heading, state, form, error, receipt);
    const card = { section, unit, fields, inputs, button, state, error, receipt };
    form.addEventListener('submit', (event) => { event.preventDefault(); void submit(card); });
    return card;
  }
  async function resultEntry(run) {
    if (resultCheck) return;
    resultCheck = true;
    try {
      // B #16 的共用頁整合接點；頁面未存在時不提供會導向 404 的連結。
      const response = await fetchImpl('/results.html', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!active(run) || snapshot?.state !== 'CLOSED' || !valid) return;
      if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
        $('result-link').href = `/results.html?activityId=${encodeURIComponent(session.activityId)}`;
        $('result-link').hidden = false;
        $('result-status').textContent = '活動已結束，可查看各組保存結果。';
      }
    } catch { /* 保留明確的「結果頁待整合」文字。 */ }
  }
  function applySnapshot(data) {
    if (data.activityId !== session.activityId) return;
    const phases = { PREPARING: 0, OPEN: 1, CLOSED: 2 };
    if (!(data.state in phases) || phases[data.state] < (phases[snapshot?.state] ?? -1)) return;
    version++;
    snapshot = data;
    valid = true;
    if (data.groupName) session.groupName = data.groupName;
    const own = data.state === 'CLOSED'
      ? data.units.flatMap((u) => u.submissions.filter((s) => s.groupId === session.groupId)) : data.submissions;
    for (const receipt of own) accepted.set(receipt.unitId, receipt);
    $('activity-panel').hidden = false;
    $('join-panel').hidden = true;
    $('group-label').textContent = `目前組別：${session.groupName ?? own[0]?.groupName ?? '已加入的組別'}`;
    $('phase').textContent = { PREPARING: '準備中', OPEN: '搶答中', CLOSED: '已結束' }[data.state];
    $('mode-rule').textContent = data.mode === 'FAIR'
      ? '公平模式：結束時按單位順序，優先讓本場勝出次數較少的組別勝出；同次數按受理順序。題組只計一次勝出。'
      : '速度模式：每個單位依伺服器受理順序決定勝出，與學生裝置時間無關。';
    $('phase-help').textContent = { PREPARING: '已加入，請等待老師開啟搶答。', OPEN: '請依題號作答。每個單位只保留第一筆有效答案。', CLOSED: '活動已結束，不能再新增或修改答案。' }[data.state];
    const ids = new Set(data.units.map((u) => u.unitId));
    for (const [id, card] of cards) if (!ids.has(id)) { card.section.remove(); cards.delete(id); accepted.delete(id); }
    data.units.forEach((unit, index) => {
      let card = cards.get(unit.unitId);
      if (!card) { card = makeCard(unit, nextCard++); cards.set(unit.unitId, card); }
      // 相同快照不重建表單，保留尚未送出的原文、游標與鍵盤焦點。
      const current = $('units').children[index];
      if (current !== card.section) $('units').insertBefore(card.section, current ?? null);
    });
    $('result-panel').hidden = data.state !== 'CLOSED';
    if (data.state === 'CLOSED') void resultEntry(epoch);
    updateControls();
  }
  async function refreshActivity() {
    if (leaving) return;
    const run = epoch;
    const atVersion = version;
    try {
      const data = await request(`${base()}/snapshot`);
      if (!active(run)) return;
      // 讀取途中若 SSE 已有更新，不讓較舊 HTTP 快照蓋回最新狀態。
      if (atVersion === version) applySnapshot(data);
      say('');
    } catch (error) { if (active(run)) say(fail(error, '無法確認最新紀錄，請檢查連線後再試。')); }
  }
  async function enterActivity(run) {
    $('join-panel').hidden = true;
    $('activity-panel').hidden = false;
    await refreshActivity();
    if (!active(run) || !valid) return;
    stream = watch({ activityId: session.activityId, statusElement: $('connection-status'),
      onSnapshot: (data) => { if (active(run)) applySnapshot(data); },
      onConnection: (state) => {
        if (!active(run)) return;
        connected = state === 'connected';
        if (state === 'unauthorized') { invalidate(); return; }
        updateControls();
      },
    });
  }
  async function bootstrap() {
    if (leaving) return;
    const run = ++epoch;
    stream?.close();
    connected = false;
    valid = false;
    joining = false;
    session = undefined;
    snapshot = undefined;
    resultCheck = false;
    accepted.clear(); pending.clear(); cards.clear();
    $('units').replaceChildren();
    $('join-panel').hidden = true;
    $('activity-panel').hidden = true;
    $('result-link').hidden = true;
    $('result-status').textContent = '共用結果頁待整合；自己的受理紀錄保留在下方。';
    say('');
    $('connection-status').textContent = '正在確認工作階段。';
    updateControls();
    try {
      const data = await request('/api/session');
      if (!active(run)) return;
      session = data;
      valid = true;
      if (session.role === 'STUDENT') await enterActivity(run);
      else if (session.role === 'ANONYMOUS') {
        $('join-panel').hidden = false;
        $('connection-status').textContent = '尚未加入活動。請輸入加入碼與組名。';
      } else $('connection-status').textContent = '目前是教師身分。學生請使用另一個瀏覽器工作階段加入。';
      updateControls();
    } catch { if (active(run)) { say('無法連線服務，請確認服務啟動後重新確認身分與活動。'); $('connection-status').textContent = '連線中斷。'; } }
  }
  async function join(event) {
    event.preventDefault();
    if (joining || !valid || session?.role !== 'ANONYMOUS') return;
    const joinCode = $('join-code').value.trim().toUpperCase();
    const groupName = $('group-name').value.trim();
    if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(joinCode)) { say('請輸入有效的六碼加入碼。'); $('join-code').focus(); return; }
    if ([...groupName].length < 1 || [...groupName].length > 30) { say('組名去除前後空白後須為 1～30 字。'); $('group-name').focus(); return; }
    joining = true;
    updateControls();
    say('');
    const run = epoch;
    try {
      const data = await request('/api/join', { joinCode, groupName });
      if (!active(run)) return;
      session = { ...data, role: 'STUDENT' };
      await enterActivity(run);
      $('activity-title').focus();
    } catch (error) { if (active(run)) say(fail(error, '未能確認加入結果。請重新確認身分與活動，避免重複加入。')); }
    finally { if (active(run)) { joining = false; updateControls(); } }
  }
  async function submit(card) {
    const id = card.unit.unitId;
    if (pending.has(id) || accepted.has(id) || !valid || !connected || snapshot?.state !== 'OPEN') return;
    const answers = card.inputs.map(({ input, questionId }) => ({ questionId, text: input.value }));
    const invalid = card.inputs.find(({ input }) => !input.value.trim() || [...input.value].length > 1000 || !input.value.isWellFormed());
    if (invalid) {
      card.error.textContent = '請填妥全部答案，每題不可全空白，最多 1,000 字。';
      invalid.input.setAttribute('aria-invalid', 'true'); invalid.input.focus(); return;
    }
    const run = epoch;
    pending.add(id); card.error.textContent = ''; updateControls();
    try {
      const data = await request(`${base()}/submissions`, { unitId: id, answers });
      if (!active(run)) return;
      accepted.set(id, data);
    } catch (error) {
      if (active(run)) card.error.textContent = fail(error, '未收到受理回覆，尚未確認成功。請確認受理紀錄，或重試此單位；原稿仍留在本頁。');
    } finally { if (active(run)) { pending.delete(id); updateControls(); } }
  }
  async function leave() {
    if (leaving || !valid || !connected || session?.role !== 'STUDENT' || snapshot?.state !== 'PREPARING') return;
    const run = ++epoch;
    leaving = true;
    connected = false;
    stream?.close();
    updateControls();
    say('');
    let failure;
    try { await request('/api/student/leave', {}); }
    catch (error) { failure = error; }
    if (!active(run)) return;
    leaving = false;
    // 成功或回覆遺失都重新讀 session，避免猜測退出結果；舊 SSE／快照因 epoch 不同被忽略。
    const refreshing = bootstrap();
    const refreshed = epoch;
    await refreshing;
    if (!active(refreshed)) return;
    if (failure) say(errors[failure.code] ?? '未能確認退出結果。請依目前畫面操作；若連線失敗，請重新確認身分。');
    else if (valid && session?.role === 'ANONYMOUS') {
      $('connection-status').textContent = '已退出組別。請輸入加入碼與組名重新加入。';
      $('group-name').value = '';
      $('group-name').focus();
    }
  }
  const leaveGroup = () => { void leave(); };
  const refresh = () => { void bootstrap(); };
  const refreshRecords = () => { if (session?.role === 'STUDENT' && valid) void refreshActivity(); };
  $('join-form').addEventListener('submit', join);
  $('refresh-session').addEventListener('click', refresh);
  $('refresh-activity').addEventListener('click', refreshRecords);
  $('leave-group').addEventListener('click', leaveGroup);
  return { ready: bootstrap(), close() {
    disposed = true; epoch++; stream?.close();
    $('join-form').removeEventListener('submit', join);
    $('refresh-session').removeEventListener('click', refresh);
    $('refresh-activity').removeEventListener('click', refreshRecords);
    $('leave-group').removeEventListener('click', leaveGroup);
  } };
}
