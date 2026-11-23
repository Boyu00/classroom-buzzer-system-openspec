// 不碰 DOM 的純邏輯；畫面在 main.js。結果頁供老師與「已加入該活動的學生」在活動結束後查看固定結果。
export const MODE_LABEL = { SPEED: '速度模式', FAIR: '公平模式' };
export const TYPE_LABEL = { SINGLE: '單題', GROUP: '題組' };

export const questionIds = (unit) => (unit.questions ?? []).map((q) => q.questionId).join('、');

/**
 * 每個單位依最終順位排列各組的受理答案；沒有人作答的單位明示 noAnswer。
 * ownGroupId 用來標示學生自己的組別（老師沒有）。
 */
export function resultUnits(results, ownGroupId = null) {
  return [...(results?.units ?? [])].sort((a, b) => a.order - b.order).map((unit) => {
    const rows = [...(unit.submissions ?? [])].sort((a, b) => a.rank - b.rank).map((s) => ({
      rank: s.rank, groupId: s.groupId, groupName: s.groupName, acceptedOrder: s.acceptedOrder,
      isWinner: Boolean(s.isWinner), isOwn: ownGroupId !== null && s.groupId === ownGroupId,
      answers: [...(s.answers ?? [])],
    }));
    const winner = rows.find((r) => r.isWinner) ?? null;
    return { unit, rows, noAnswer: rows.length === 0, winnerName: winner?.groupName ?? null };
  });
}

/**
 * 把取得結果時的失敗轉成給使用者看的說明與狀態。
 * kind：identity（需要身分）、forbidden（無權限）、notfound、waiting（活動尚未結束）、error。
 */
export function describeFailure(error) {
  const status = error?.status;
  if (status === 401) return { kind: 'identity', message: '請先以教師身分登入，或使用已加入此活動的學生瀏覽器開啟。' };
  if (status === 403) return { kind: 'forbidden', message: '這個瀏覽器的身分沒有權限查看此活動的結果。學生只能查看自己已加入的活動。' };
  if (status === 404) return { kind: 'notfound', message: '找不到這個活動，請確認網址。' };
  if (status === 409 && error?.code === 'RESULTS_NOT_READY') return { kind: 'waiting', message: '活動尚未結束。結束後這裡會自動顯示結果。' };
  return { kind: 'error', message: error?.message || '無法取得結果，請稍後再試。' };
}

/** 從網址取出活動 ID；缺少或過長視為無效。 */
export function activityIdFrom(search) {
  const id = new URLSearchParams(search).get('activityId');
  return id && id.length <= 100 ? id : null;
}
