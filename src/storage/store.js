import { isAsyncFunction } from 'node:util/types';
import { openDatabase, transaction } from './database.js';
import { createWriteCoordinator } from './write-coordinator.js';

// 後續匯入、受理、結束都以 write(activityId, syncCallback) 共用此入口。
// 身分與狀態規則由後續服務在同一交易回呼內實作；此層不提供 HTTP 控制功能。
export function openStore(filename) {
  const db = openDatabase(filename);
  const writes = createWriteCoordinator();
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
      return writes.run(activityId, () => transaction(db, work));
    },
    close() {
      closing ??= writes.close().then(() => db.close());
      return closing;
    },
  };
}
