import { mountStudentPage } from './student-page.js';

const page = mountStudentPage({ document });
window.addEventListener('pagehide', () => page.close());
// 瀏覽器從 back/forward cache 還原時，重新驗證 Cookie 與活動。
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
