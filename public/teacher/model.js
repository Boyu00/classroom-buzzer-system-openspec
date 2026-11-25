// 不碰 DOM 的純邏輯，方便在 Node 測試；畫面在 main.js。
export const STATE_LABEL = { PREPARING: '準備中', OPEN: '搶答中', CLOSED: '已結束' };
export const MODE_LABEL = { SPEED: '速度模式', FAIR: '公平模式' };
export const TYPE_LABEL = { SINGLE: '單題', GROUP: '題組' };

export function screenFor(session) {
  if (!session) return 'loading';
  if (session.role === 'TEACHER') return 'dashboard';
  if (session.role === 'STUDENT') return 'student';
  return session.teacherConfigured ? 'login' : 'setup';
}

const length = (text) => [...text].length;

// 與後端一致：8～128 個 Unicode 字元、不可全為空白；初次設定需再輸入一次確認。
export function validatePassword(password, confirm) {
  if (typeof password !== 'string' || !password.trim() || length(password) < 8 || length(password) > 128) {
    return '密碼需為 8～128 個字元，不可全為空白。';
  }
  if (confirm !== undefined && confirm !== password) return '兩次輸入的密碼不一致。';
  return null;
}

/** 把 ApiError 轉成顯示用文字：{ message, lines }，lines 為逐項錯誤（解析失敗時含位置）。 */
export function describeError(error) {
  const message = error?.message || '操作失敗，請稍後再試。';
  const lines = Array.isArray(error?.details)
    ? error.details.map((item) => `${item.location ? `${item.location}：` : ''}${item.message}`)
    : [];
  return { message, lines };
}

// 依「點選順序」維護選取的工作表；掃描順序就是這個順序（影響題號順序與單位順序）。
export const toggleSelected = (selected, sheetId) => (
  selected.includes(sheetId) ? selected.filter((id) => id !== sheetId) : [...selected, sheetId]);

export function moveSelected(selected, sheetId, delta) {
  const from = selected.indexOf(sheetId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= selected.length) return selected;
  const next = [...selected];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export const unitCount = (snapshot) => snapshot?.units?.length ?? 0;
export const questionCount = (snapshot) => (snapshot?.units ?? []).reduce((sum, unit) => sum + (unit.questions?.length ?? 0), 0);
export const canOpen = (snapshot) => snapshot?.state === 'PREPARING' && unitCount(snapshot) > 0;
export const questionIds = (unit) => (unit.questions ?? []).map((q) => q.questionId).join('、');

/**
 * 教師監看：每個單位列出已送出（依受理序號）與尚未送出的組別。
 * 速度模式標示暫定勝出者；公平模式勝出欄顯示「結束時計算」。
 */
export function monitorUnits(snapshot) {
  const groups = snapshot?.groups ?? [];
  const submissions = snapshot?.submissions ?? [];
  const fair = snapshot?.mode === 'FAIR';
  return (snapshot?.units ?? []).map((unit) => {
    const accepted = submissions.filter((s) => s.unitId === unit.unitId).sort((a, b) => a.acceptedOrder - b.acceptedOrder);
    const sent = new Set(accepted.map((s) => s.groupId));
    const rows = [
      ...accepted.map((s) => ({
        kind: 'submitted', groupName: s.groupName, acceptedOrder: s.acceptedOrder, answers: s.answers ?? [],
        provisionalWinner: !fair && unit.winnerSubmissionId === s.submissionId,
      })),
      ...groups.filter((g) => !sent.has(g.groupId)).map((g) => ({ kind: 'pending', groupName: g.groupName })),
    ];
    const winner = accepted.find((s) => s.submissionId === unit.winnerSubmissionId);
    return {
      unit, rows, submittedCount: accepted.length,
      winnerLabel: fair ? '勝出者：結束時計算' : winner ? `暫定勝出：${winner.groupName}` : '尚無人送出',
    };
  });
}

/** 結束後的固定結果（與 results API 同一份）：每單位依最終順位排列；無人作答明示。 */
export function resultUnits(snapshot) {
  return (snapshot?.units ?? []).map((unit) => {
    const rows = [...(unit.submissions ?? [])].sort((a, b) => a.rank - b.rank).map((s) => ({
      rank: s.rank, groupName: s.groupName, acceptedOrder: s.acceptedOrder, isWinner: Boolean(s.isWinner), answers: s.answers ?? [],
    }));
    return { unit, rows, noAnswer: rows.length === 0 };
  });
}

/* ---------- 寫回原 Google Sheets（#17／#18） ---------- */
export const EXPORT_STATUS_LABEL = {
  SUCCEEDED: '已寫入並核對', FAILED: '失敗（確認未寫入）', PENDING_VERIFICATION: '待核對（不確定是否已寫入）',
  CONFLICT: '衝突（已停止）', PENDING: '未執行', WRITING: '寫入中', PREVIEW: '預覽',
};
export const PREVIEW_STATUS_LABEL = {
  WILL_WRITE: '將寫入', ALREADY_WRITTEN: '已寫入（先前已核對）', NO_WINNER: '無人作答，不變更', CONFLICT: '衝突',
};

function columnLetters(index) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * 目標格顯示：優先用預覽帶來的位置；歷史紀錄沒有名稱時，用同一活動預覽學到的工作表名稱（titles: {sheetId: 名稱}），
 * 都沒有才顯示工作表 ID。
 */
export function cellLabel(target, titles) {
  if (!target) return '';
  if (target.location) return target.location;
  const cell = `${columnLetters(target.columnIndex)}${target.rowIndex + 1}`;
  const title = titles?.[target.sheetId];
  return title ? `${title}!${cell}` : `工作表 ${target.sheetId}！${cell}`;
}

/** 從預覽（位置形如「學習單!G5」）學到 sheetId → 工作表名稱。 */
export function sheetTitlesFrom(preview) {
  const titles = {};
  for (const unit of preview?.units ?? []) {
    for (const q of unit.questions ?? []) {
      const at = q.target?.location?.lastIndexOf('!') ?? -1;
      if (at > 0) titles[q.target.sheetId] = q.target.location.slice(0, at);
    }
  }
  return titles;
}

export function exportCounts(view) {
  const counts = {};
  for (const item of view?.items ?? []) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

// 寫入已送出後才發生的錯誤碼：這些情況不能保證 Google Sheets 沒有被修改。
const POST_WRITE_CODES = new Set(['STRUCTURE_CHANGED_AFTER_WRITE', 'CHANGED_EXTERNALLY', 'VERIFY_UNAVAILABLE']);

/**
 * 依逐題狀態與錯誤碼產生處理建議；無法確定時明說「可能已寫入」，絕不保證未修改。
 * 批次狀態只是摘要：FAILED 批次可能含已成功的格子，CONFLICT 也可能發生在寫入之後。
 */
function adviceFor(view, counts) {
  const items = view.items ?? [];
  const succeeded = counts.SUCCEEDED ?? 0;
  const pending = counts.PENDING_VERIFICATION ?? 0;
  const afterWrite = items.some((item) => POST_WRITE_CODES.has(item.errorCode));
  switch (view.status) {
    case 'SUCCEEDED':
      return null;
    case 'FAILED':
      if (succeeded > 0) return '部分格子已寫入並核對成功，其餘失敗。請依下表逐題核對線上內容；排除原因（例如分享為「編輯者」、網路）後可重試，已成功的不會重複寫入。';
      if (pending > 0 || afterWrite) return '寫入結果不完整，部分格子可能已寫入。請依下表逐題核對線上內容，再重試。';
      return '這次沒有寫入任何格（Google 明確拒絕、回讀確認未寫入，或寫入前就失敗）。結果仍保留；排除原因（例如分享為「編輯者」、網路）後可重試。';
    case 'PENDING_VERIFICATION':
      return '無法確認 Google Sheets 是否已寫入。請按「重試寫回」，系統會先回讀線上內容核對，已寫入的不會重複寫入。';
    case 'CONFLICT':
      if (succeeded > 0 || pending > 0 || afterWrite) return '寫入已送出，但回讀發現來源被改動（內容或結構不同）。部分格子可能已寫入；系統沒有再修改任何內容。請依下表逐題核對線上內容，必要時恢復原狀後重試。';
      return '來源與匯入時不同，寫入前就已停止，這次沒有寫入任何格。請恢復原內容，或另建活動重新匯入。';
    case 'WRITING':
      return '寫入進行中，請稍候。';
    default:
      return null;
  }
}
const TONE = { SUCCEEDED: 'ok', FAILED: 'bad', PENDING_VERIFICATION: 'warn', CONFLICT: 'bad', WRITING: 'warn' };

/** 一次匯出的整體說明；絕不把部分失敗說成成功。 */
export function describeExport(view) {
  if (!view) return null;
  const counts = exportCounts(view);
  const total = view.items?.length ?? 0;
  const done = counts.SUCCEEDED ?? 0;
  const headline = view.status === 'SUCCEEDED'
    ? (total ? `全部 ${total} 格已寫入並回讀核對。` : '沒有需要寫入的答案。')
    : `${done} / ${total} 格已核對成功。`;
  return { headline, tone: TONE[view.status] ?? 'warn', advice: adviceFor(view, counts), counts };
}

/** 可寫回的條件：預覽通過、老師確認暫停編輯，且沒有進行中的操作。 */
export const canWriteBack = (preview, confirmedPaused) => Boolean(preview?.canWrite && confirmedPaused);

/** 最近一次匯出尚未完成時，按鈕顯示「重試」。 */
export const writeLabel = (latest) => (latest && latest.status !== 'SUCCEEDED' ? '重試寫回' : '寫回 Google Sheets');

/* ---------- 快照順序 ---------- */
const PHASE_RANK = { PREPARING: 0, OPEN: 1, CLOSED: 2 };

/**
 * 同一活動內階段只會前進。收到較舊階段的快照（例如已經看到 CLOSED 之後才抵達的 OPEN）要丟棄；
 * 不同活動或尚無快照時一律接受（切換活動由呼叫端的世代檢查處理）。
 */
export function isStaleSnapshot(current, next) {
  if (!current || !next || current.activityId !== next.activityId) return false;
  return (PHASE_RANK[next.state] ?? -1) < (PHASE_RANK[current.state] ?? -1);
}
