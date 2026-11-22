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

/** 目標格顯示：有工作表名稱（預覽）就用名稱，否則顯示工作表 ID。 */
export function cellLabel(target) {
  if (!target) return '';
  if (target.location) return target.location;
  return `工作表 ${target.sheetId}！${columnLetters(target.columnIndex)}${target.rowIndex + 1}`;
}

export function exportCounts(view) {
  const counts = {};
  for (const item of view?.items ?? []) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

const ADVICE = {
  SUCCEEDED: null,
  FAILED: '結果仍保留，Google Sheets 沒有被修改。排除原因（例如分享為「編輯者」、網路）後可重試。',
  PENDING_VERIFICATION: '無法確認 Google Sheets 是否已寫入。請按「重試寫回」，系統會先回讀線上內容核對，已寫入的不會重複寫入。',
  CONFLICT: '來源與匯入時不同，已停止且沒有覆寫任何內容。請恢復原內容，或另建活動重新匯入。',
  WRITING: '寫入進行中，請稍候。',
};
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
  return { headline, tone: TONE[view.status] ?? 'warn', advice: ADVICE[view.status] ?? null, counts };
}

/** 可寫回的條件：預覽通過、老師確認暫停編輯，且沒有進行中的操作。 */
export const canWriteBack = (preview, confirmedPaused) => Boolean(preview?.canWrite && confirmedPaused);

/** 最近一次匯出尚未完成時，按鈕顯示「重試」。 */
export const writeLabel = (latest) => (latest && latest.status !== 'SUCCEEDED' ? '重試寫回' : '寫回 Google Sheets');
