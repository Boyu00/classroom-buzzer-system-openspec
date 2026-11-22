import { isAsyncFunction } from 'node:util/types';
import { openDatabase, transaction } from './database.js';
import { createWriteCoordinator } from './write-coordinator.js';

// 後續匯入、受理、結束都以 write(activityId, syncCallback) 共用此入口。
// 身分與狀態規則由後續服務在同一交易回呼內實作；此層不提供 HTTP 控制功能。
export function openStore(filename) {
  const db = openDatabase(filename);
  const writes = createWriteCoordinator();
  const listeners = new Set();
  let closing;
  function assertOpen() {
    if (closing) throw new Error('資料層正在關閉。');
  }
  return {
    read(work) {
      assertOpen();
      if (isAsyncFunction(work)) throw new TypeError('讀取回呼必須同步。');
      return work(db);
    },
    write(activityId, work) {
      assertOpen();
      return writes.run(activityId, () => {
        const result = transaction(db, work);
        // 僅通知已提交的變更，不攜帶資料；推播端須重新授權並建立各自快照。
        for (const listener of listeners) {
          try { listener(activityId); } catch { /* 通知失敗不得把已提交交易誤報為失敗。 */ }
        }
        return result;
      });
    },
    subscribe(listener) {
      assertOpen();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closing ??= writes.close().then(() => { listeners.clear(); db.close(); });
      return closing;
    },
  };
}
