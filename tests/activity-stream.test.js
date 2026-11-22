import test from 'node:test';
import assert from 'node:assert/strict';
import { watchActivity } from '../public/activity-stream.js';

function fixture({ onSnapshot } = {}) {
  const sources = [];
  class Source {
    constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; sources.push(this); }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    emit(type, data) { this.listeners.get(type)?.({ data: JSON.stringify(data) }); }
    close() { this.closed = true; }
  }
  const timers = new Map();
  let timerId = 0;
  const schedule = (fn) => { timers.set(++timerId, fn); return timerId; };
  const cancel = (id) => timers.delete(id);
  const tick = () => { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); };
  const states = [];
  const snapshots = [];
  const statusElement = { textContent: '', attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } };
  const network = new EventTarget();
  const watcher = watchActivity({ activityId: 'activity', EventSourceClass: Source, schedule, cancel, network, statusElement,
    onConnection: (s) => states.push(s), onSnapshot: (s) => { snapshots.push(s); onSnapshot?.(s); },
  });
  const snapshot = { data: { activityId: 'activity', state: 'OPEN', mode: 'SPEED', submissions: [] } };
  return { sources, timers, tick, states, snapshots, watcher, network, statusElement, snapshot };
}

test('瀏覽器共用模組只有收到最新 snapshot 才顯示已連線，不將 open 當成送出成功', () => {
  const f = fixture();
  const source = f.sources[0];
  assert.equal(source.url, '/api/activities/activity/events');
  source.emit('open');
  assert.equal(f.states.at(-1), 'connecting');
  assert.equal(f.snapshots.length, 0);
  source.emit('snapshot', f.snapshot);
  assert.equal(f.states.at(-1), 'connected');
  assert.deepEqual(f.snapshots, [f.snapshot.data]);
  assert.equal(f.statusElement.attributes.role, 'status');
  assert.equal(f.statusElement.attributes['aria-live'], 'polite');
  source.emit('error');
  assert.equal(f.states.at(-1), 'disconnected');
  assert.match(f.statusElement.textContent, /未收到受理回覆/);
  source.emit('open');
  assert.equal(f.states.at(-1), 'connecting');
  source.emit('snapshot', { data: { ...f.snapshot.data, state: 'CLOSED' } });
  assert.equal(f.snapshots.at(-1).state, 'CLOSED');
  f.watcher.close();
});

test('heartbeat 重設靜默計時；無回應則重建連線，忽略舊連線事件', () => {
  const f = fixture();
  const old = f.sources[0];
  const originalTimer = [...f.timers.keys()][0];
  old.emit('heartbeat', {});
  assert.ok(!f.timers.has(originalTimer));
  assert.equal(f.timers.size, 1);
  f.tick();
  assert.equal(old.closed, true);
  assert.equal(f.sources.length, 2);
  old.emit('snapshot', f.snapshot);
  assert.equal(f.snapshots.length, 0);
  f.sources[1].emit('snapshot', f.snapshot);
  assert.equal(f.snapshots.length, 1);
  f.watcher.close();
  assert.equal(f.timers.size, 0);
});

test('工作階段失效會停止重連並顯示明確提示，舊事件不改變畫面', () => {
  const f = fixture();
  const source = f.sources[0];
  source.emit('session-ended', { error: { code: 'SESSION_ENDED' } });
  assert.equal(f.states.at(-1), 'unauthorized');
  assert.match(f.statusElement.textContent, /工作階段已失效/);
  assert.equal(source.closed, true);
  assert.equal(f.timers.size, 0);
  source.emit('snapshot', f.snapshot);
  f.network.dispatchEvent(new Event('online'));
  assert.equal(f.snapshots.length, 0);
  assert.equal(f.sources.length, 1);
});

test('離線明示、上線重連；主動關閉清理事件與計時器', () => {
  const f = fixture();
  f.network.dispatchEvent(new Event('offline'));
  assert.equal(f.states.at(-1), 'disconnected');
  f.network.dispatchEvent(new Event('online'));
  assert.equal(f.states.at(-1), 'connecting');
  assert.equal(f.sources.length, 2);
  assert.equal(f.sources[0].closed, true);
  f.watcher.close();
  f.watcher.close();
  assert.equal(f.states.at(-1), 'closed');
  assert.equal(f.sources[1].closed, true);
  assert.equal(f.timers.size, 0);
  f.network.dispatchEvent(new Event('online'));
  assert.equal(f.sources.length, 2);
});

test('無效或跨活動 snapshot 不渲染，斷線後可重建取得正確快照', () => {
  const f = fixture();
  f.sources[0].emit('snapshot', { data: { ...f.snapshot.data, activityId: 'other' } });
  assert.equal(f.snapshots.length, 0);
  assert.equal(f.states.at(-1), 'disconnected');
  f.tick();
  f.sources[1].emit('snapshot', f.snapshot);
  assert.equal(f.states.at(-1), 'connected');
  f.watcher.close();
});

test('結果頁收到 CLOSED 後主動關閉連線，不會再被標示為已連線', () => {
  const f = fixture({ onSnapshot: () => f.watcher.close() });
  f.sources[0].emit('snapshot', { data: { ...f.snapshot.data, state: 'CLOSED' } });
  assert.equal(f.states.at(-1), 'closed');
  assert.equal(f.sources[0].closed, true);
  assert.equal(f.timers.size, 0);
});
