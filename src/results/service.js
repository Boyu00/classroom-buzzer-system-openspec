import { HttpError } from '../http-error.js';
import { readSubmission, readUnits } from '../submissions/read-model.js';

// 呼叫端須持有同活動序列化交易；排名與 CLOSED 由呼叫端一起提交。
export function finalizeResults(db, activity) {
  const wins = new Map(db.prepare('SELECT group_id FROM groups WHERE activity_id = ?').all(activity.activity_id).map((g) => [g.group_id, 0]));
  const insert = db.prepare('INSERT INTO results VALUES (?, ?, ?, ?, ?)');
  for (const unit of readUnits(db, activity.activity_id)) {
    const submissions = db.prepare('SELECT * FROM submissions WHERE activity_id = ? AND unit_id = ? ORDER BY accepted_order').all(activity.activity_id, unit.unitId);
    for (const submission of submissions) {
      const count = db.prepare('SELECT count(*) AS n FROM submission_answers WHERE submission_id = ?').get(submission.submission_id).n;
      if (count !== unit.questions.length || count === 0) throw new HttpError(409, 'INCOMPLETE_SUBMISSION', '受理紀錄不完整，活動尚未結束。');
    }
    if (activity.mode === 'FAIR') submissions.sort((a, b) => wins.get(a.group_id) - wins.get(b.group_id) || a.accepted_order - b.accepted_order);
    submissions.forEach((s, index) => insert.run(activity.activity_id, unit.unitId, s.submission_id, index + 1, index === 0 ? 1 : 0));
    if (submissions.length) wins.set(submissions[0].group_id, wins.get(submissions[0].group_id) + 1);
  }
}

export function readResults(db, activity) {
  return {
    activityId: activity.activity_id, mode: activity.mode, state: activity.state,
    units: readUnits(db, activity.activity_id).map((unit) => {
      const submissions = db.prepare(`SELECT s.* FROM submissions s JOIN results r ON r.submission_id = s.submission_id
        WHERE s.activity_id = ? AND s.unit_id = ? ORDER BY r.rank`).all(activity.activity_id, unit.unitId)
        .map((s) => readSubmission(db, s, { includeOrder: true, includeGroup: true, includeRank: true }));
      return { ...unit, submissions, winnerSubmissionId: submissions[0]?.submissionId ?? null };
    }),
  };
}

export function createResultService(store, auth) {
  return {
    results(token, activityId) {
      return store.read((db) => {
        const session = auth.requireSession(token, db);
        if (session.role !== 'TEACHER' && !(session.role === 'STUDENT' && session.activity_id === activityId)) {
          throw new HttpError(session.role === 'ANONYMOUS' ? 401 : 403, 'ACTIVITY_FORBIDDEN', '無法存取此活動。');
        }
        const activity = db.prepare('SELECT * FROM activities WHERE activity_id = ?').get(activityId);
        if (!activity) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', '找不到活動。');
        if (activity.state !== 'CLOSED') throw new HttpError(409, 'RESULTS_NOT_READY', '活動結束後才可檢視結果。');
        return { data: readResults(db, activity) };
      });
    },
  };
}
