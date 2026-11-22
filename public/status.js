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
  } else status.textContent = '學生可前往搶答頁，使用加入碼與組名加入活動。';
} catch {
  status.textContent = '無法連線服務，請確認服務啟動後重新整理。';
}
