import { Router } from 'express';
import { HttpError } from '../http-error.js';
import { readResults } from '../results/service.js';
import { buildResultsCsv } from './csv.js';
import { parseMarker } from '../import/marker.js';

// 只有教師、且活動 CLOSED 才能下載。路徑 results.csv 已列入 auth/http.js 的 teacherPath，服務層再檢查一次。
export function createExportHttp(store, access) {
  const router = Router();
  router.get('/activities/:id/results.csv', (req, res) => {
    const csv = store.read((db) => {
      access.auth.requireTeacher(req.sessionToken, db);
      const activity = db.prepare('SELECT * FROM activities WHERE activity_id = ?').get(req.params.id);
      if (!activity) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', '找不到活動。');
      if (activity.state !== 'CLOSED') throw new HttpError(409, 'RESULTS_NOT_READY', '活動結束後才可下載 CSV。');
      const results = readResults(db, activity);
      // 只在 CSV 層加上保存的題組代號，不改 JSON 結果／學生快照或內部 unitId。
      for (const unit of results.units) {
        const markers = db.prepare('SELECT original_marker FROM questions WHERE activity_id = ? AND unit_id = ? ORDER BY question_order')
          .all(activity.activity_id, unit.unitId).map((q) => parseMarker(q.original_marker));
        if (markers.some((m, i) => !m?.ok || m.questionId !== unit.questions[i].questionId)
          || (unit.type === 'GROUP' && (!markers[0]?.groupCode || markers.some((m) => m.groupCode !== markers[0].groupCode)))
          || (unit.type === 'SINGLE' && markers.some((m) => m.groupCode !== null))) {
          throw new HttpError(409, 'EXPORT_MAPPING_INVALID', '保存的題號或題組標記不完整，無法產生 CSV。');
        }
        if (unit.type === 'GROUP') unit.groupCode = markers[0].groupCode;
      }
      return buildResultsCsv(results);
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
