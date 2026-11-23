import { Router } from 'express';

// /api/teacher/* 已由 auth/http.js 的 teacherOnly 保護；這裡仍在服務層再驗證一次。
export function createTeacherHttp(store, access) {
  const router = Router();
  // 教師重新整理頁面後，找回自己的活動：優先未結束者，否則最近一場已結束的活動；沒有則回 null。
  router.get('/teacher/activity', (req, res) => {
    access.auth.requireTeacher(req.sessionToken);
    const row = store.read((db) => db.prepare(
      "SELECT activity_id, mode, state FROM activities ORDER BY (state <> 'CLOSED') DESC, created_at DESC, rowid DESC LIMIT 1",
    ).get());
    access.send(res, { data: { activity: row ? { activityId: row.activity_id, mode: row.mode, state: row.state } : null } });
  });
  return router;
}
