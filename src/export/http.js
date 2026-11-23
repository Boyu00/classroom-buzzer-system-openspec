import { Router } from 'express';
import { HttpError } from '../http-error.js';
import { readResults } from '../results/service.js';
import { buildResultsCsv } from './csv.js';

// 只有教師、且活動 CLOSED 才能下載。路徑 results.csv 已列入 auth/http.js 的 teacherPath，服務層再檢查一次。
export function createExportHttp(store, access) {
  const router = Router();
  router.get('/activities/:id/results.csv', (req, res) => {
    const csv = store.read((db) => {
      access.auth.requireTeacher(req.sessionToken, db);
      const activity = db.prepare('SELECT * FROM activities WHERE activity_id = ?').get(req.params.id);
      if (!activity) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', '找不到活動。');
      if (activity.state !== 'CLOSED') throw new HttpError(409, 'RESULTS_NOT_READY', '活動結束後才可下載 CSV。');
      return buildResultsCsv(readResults(db, activity));
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="classroom-results-${req.params.id.slice(0, 8)}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(csv);
  });
  return router;
}
