import { randomUUID } from 'node:crypto';
import { HttpError } from '../http-error.js';
import { readSubmission } from './read-model.js';

export function createSubmissionService(store, auth, { now = () => new Date().toISOString() } = {}) {
  return {
    submit(token, activityId, body) {
      return store.write(activityId, (db) => {
        const session = auth.requireSession(token, db);
        if (session.role !== 'STUDENT' || session.activity_id !== activityId) {
          throw new HttpError(session.role === 'ANONYMOUS' ? 401 : 403, 'STUDENT_REQUIRED', '請使用已加入此活動的學生工作階段。');
        }
        const activity = db.prepare('SELECT * FROM activities WHERE activity_id = ?').get(activityId);
        const unitId = body?.unitId;
        const unit = typeof unitId === 'string' && db.prepare('SELECT * FROM units WHERE activity_id = ? AND unit_id = ?').get(activityId, unitId);
        if (!unit) throw new HttpError(404, 'UNIT_NOT_FOUND', '找不到作答單位。');
        const existing = db.prepare('SELECT * FROM submissions WHERE activity_id = ? AND unit_id = ? AND group_id = ?')
          .get(activityId, unitId, session.group_id);
        // 已受理即為不可變紀錄；即使原成功回覆遺失、重送內容改變或已結束，仍回傳原紀錄。
        if (existing) return { data: readSubmission(db, existing, { includeOrder: activity.state === 'CLOSED', includeRank: activity.state === 'CLOSED' }) };
        if (activity.state !== 'OPEN') throw new HttpError(409, 'INVALID_PHASE', '目前無法送出答案。');
        const questions = db.prepare('SELECT question_id FROM questions WHERE activity_id = ? AND unit_id = ? ORDER BY question_order').all(activityId, unitId);
        if ((unit.type === 'SINGLE' && questions.length !== 1) || (unit.type === 'GROUP' && questions.length < 2)) {
          throw new HttpError(409, 'UNIT_NOT_READY', '題目設定尚未完成。');
        }
        const answers = body?.answers;
        const ids = new Set(questions.map((q) => q.question_id));
        const seen = new Set();
        if (!Array.isArray(answers) || answers.length !== questions.length || answers.some((a) => {
          if (!a || !ids.has(a.questionId) || seen.has(a.questionId)) return true;
          seen.add(a.questionId);
          return typeof a.text !== 'string' || !a.text.isWellFormed() || a.text.trim().length === 0 || [...a.text].length > 1000;
        })) throw new HttpError(400, 'INVALID_ANSWERS', '請完整填寫此作答單位，每題需為 1～1,000 個 Unicode 字元且不得全空白。');
        const order = activity.next_accepted_order;
        if (!Number.isSafeInteger(order) || order >= Number.MAX_SAFE_INTEGER) throw new Error('受理序號超出可用範圍');
        const id = randomUUID();
        db.prepare('INSERT INTO submissions VALUES (?, ?, ?, ?, ?, ?)').run(id, activityId, unitId, session.group_id, now(), order);
        const insert = db.prepare('INSERT INTO submission_answers VALUES (?, ?, ?, ?, ?)');
        for (const a of answers) insert.run(id, activityId, unitId, a.questionId, a.text);
        db.prepare('UPDATE activities SET next_accepted_order = next_accepted_order + 1 WHERE activity_id = ?').run(activityId);
        return { data: readSubmission(db, db.prepare('SELECT * FROM submissions WHERE submission_id = ?').get(id)) };
      });
    },
  };
}
