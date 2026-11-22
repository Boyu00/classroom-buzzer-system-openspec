import { watchActivity } from './activity-stream.js';

const status = document.querySelector('#connection-status');
try {
  const response = await fetch('/api/session');
  const session = (await response.json()).data;
  if (response.ok && session.role === 'STUDENT') {
    const stream = watchActivity({ activityId: session.activityId, statusElement: status,
      onSnapshot: (snapshot) => {
        document.querySelector('#activity-status').textContent = `活動階段：${snapshot.state}；模式：${snapshot.mode}`;
      },
    });
    window.addEventListener('pagehide', () => stream.close(), { once: true });
  } else status.textContent = '尚未加入活動。完整操作頁面仍在準備中。';
} catch {
  status.textContent = '無法連線服務，請確認服務啟動後重新整理。';
}
