import { isStaleSnapshot } from './model.js';

// 決定「哪一份快照可以顯示」的純邏輯，不碰 DOM、網路或計時器，方便在 Node 以固定測試涵蓋回應順序。
// 教師頁同時有 SSE（即時）與操作後的 HTTP 快照（保險）兩個來源，回應抵達順序不保證：
// - 世代（epoch）：切換活動、登出、重新登入都會遞增，舊世代的任何回應一律丟棄。
// - SSE 優先：HTTP 請求期間若已收到 SSE 快照，丟棄該 HTTP 回應（SSE 每次狀態變更都會推送）。
// - 階段只前進：同一活動不接受較舊階段的快照（見 isStaleSnapshot）。
export function createSnapshotGate() {
  let epoch = 0;
  let seq = 0; // 目前世代已收到的 SSE 快照數
  let activityId = null;
  let snapshot = null;

  function accept(next) {
    if (isStaleSnapshot(snapshot, next)) return false;
    snapshot = next;
    return true;
  }

  return {
    get activityId() { return activityId; },
    get snapshot() { return snapshot; },

    /** 開始監看某活動；回傳此連線的世代憑證，SSE 回呼要帶著它。 */
    attach(id) {
      epoch += 1;
      seq = 0;
      activityId = id;
      snapshot = null;
      return epoch;
    },

    /** 登出或離開活動：所有進行中的回應都會失效。 */
    detach() {
      epoch += 1;
      seq = 0;
      activityId = null;
      snapshot = null;
    },

    /** SSE 送來快照。回傳 true 表示應顯示。 */
    pushed(token, next) {
      if (token !== epoch) return false;
      seq += 1;
      return accept(next);
    },

    /** 送出 HTTP 快照請求前呼叫；沒有監看中的活動回傳 null。 */
    beginFetch() {
      return activityId === null ? null : { id: activityId, epoch, seq };
    },

    /** HTTP 快照回應抵達。回傳 true 表示應顯示。 */
    fetched(ticket, next) {
      if (!ticket || ticket.epoch !== epoch || ticket.id !== activityId) return false;
      if (ticket.seq !== seq) return false;
      return accept(next);
    },
  };
}
