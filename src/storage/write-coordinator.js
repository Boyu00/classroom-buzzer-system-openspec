export function createWriteCoordinator() {
  const pending = new Map();
  let accepting = true;
  return {
    run(activityId, work) {
      if (!accepting) return Promise.reject(new Error('資料層正在關閉。'));
      if (typeof activityId !== 'string' || !activityId) return Promise.reject(new TypeError('需要活動鎖識別碼。'));
      const previous = pending.get(activityId) ?? Promise.resolve();
      const result = previous.then(work);
      // 失敗不阻塞後續寫入，且呼叫者仍收到原始 rejection。
      const tail = result.then(() => {}, () => {});
      pending.set(activityId, tail);
      void tail.then(() => {
        if (pending.get(activityId) === tail) pending.delete(activityId);
      });
      return result;
    },
    async close() {
      accepting = false;
      await Promise.all(pending.values());
    },
  };
}
