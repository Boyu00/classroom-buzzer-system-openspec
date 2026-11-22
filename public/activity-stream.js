const labels = {
  connecting: '正在同步活動，請稍候。', connected: '活動已連線。',
  disconnected: '連線中斷，正在重新連線；尚未收到受理回覆的送出請先確認紀錄。',
  unauthorized: '工作階段已失效，請重新確認身分。', closed: '已停止活動同步。',
};

// A 學生頁與 B 教師頁共用；只有 snapshot 才代表狀態已同步，不能用連線成功判定作答受理。
export function watchActivity({ activityId, onSnapshot, onConnection = () => {}, statusElement,
  EventSourceClass = globalThis.EventSource, network = globalThis.window,
  schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout, silenceMs = 45000 }) {
  let source;
  let timer;
  let disposed = false;
  function status(value) {
    if (statusElement) {
      statusElement.textContent = labels[value];
      statusElement.setAttribute('role', 'status');
      statusElement.setAttribute('aria-live', 'polite');
    }
    onConnection(value);
  }
  function arm() {
    cancel(timer);
    timer = schedule(() => {
      if (disposed) return;
      source.close();
      status('disconnected');
      connect();
    }, silenceMs);
  }
  function connect() {
    source = new EventSourceClass(`/api/activities/${encodeURIComponent(activityId)}/events`);
    const current = source;
    const active = () => !disposed && current === source;
    source.addEventListener('open', () => { if (active()) { status('connecting'); arm(); } });
    source.addEventListener('snapshot', (event) => {
      if (!active()) return;
      let snapshot;
      try { snapshot = JSON.parse(event.data).data; } catch { current.close(); status('disconnected'); arm(); return; }
      if (!snapshot || snapshot.activityId !== activityId) { current.close(); status('disconnected'); arm(); return; }
      arm();
      onSnapshot(snapshot);
      if (active()) status('connected');
    });
    source.addEventListener('heartbeat', () => { if (active()) arm(); });
    source.addEventListener('error', () => { if (active()) { status('disconnected'); } });
    source.addEventListener('stream-ended', () => { if (active()) status('disconnected'); });
    source.addEventListener('session-ended', () => {
      if (!active()) return;
      dispose();
      status('unauthorized');
    });
    arm();
  }
  const offline = () => { if (!disposed) status('disconnected'); };
  const online = () => { if (!disposed) { source.close(); status('connecting'); connect(); } };
  function dispose() {
    disposed = true;
    cancel(timer);
    source.close();
    network?.removeEventListener('offline', offline);
    network?.removeEventListener('online', online);
  }
  network?.addEventListener('offline', offline);
  network?.addEventListener('online', online);
  status('connecting');
  connect();
  return { close() { if (!disposed) { dispose(); status('closed'); } } };
}
