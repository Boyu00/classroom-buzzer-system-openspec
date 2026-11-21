export function readUnits(db, activityId) {
  return db.prepare('SELECT * FROM units WHERE activity_id = ? ORDER BY unit_order').all(activityId).map((unit) => ({
    unitId: unit.unit_id, type: unit.type, order: unit.unit_order,
    questions: db.prepare('SELECT question_id, question_order FROM questions WHERE activity_id = ? AND unit_id = ? ORDER BY question_order')
      .all(activityId, unit.unit_id).map((q) => ({ questionId: q.question_id, order: q.question_order })),
  }));
}

export function readSubmission(db, row, { includeOrder = false, includeGroup = false, includeRank = false } = {}) {
  const record = {
    submissionId: row.submission_id, unitId: row.unit_id, acceptedAt: row.accepted_at,
    answers: db.prepare(`SELECT a.question_id, a.answer FROM submission_answers a
      JOIN questions q ON q.activity_id = a.activity_id AND q.question_id = a.question_id
      WHERE a.submission_id = ? ORDER BY q.question_order`).all(row.submission_id)
      .map((a) => ({ questionId: a.question_id, text: a.answer })),
  };
  if (includeOrder) record.acceptedOrder = row.accepted_order;
  if (includeGroup) {
    record.groupId = row.group_id;
    record.groupName = db.prepare('SELECT group_name FROM groups WHERE group_id = ?').get(row.group_id).group_name;
  }
  if (includeRank) {
    const result = db.prepare('SELECT rank, is_winner FROM results WHERE submission_id = ?').get(row.submission_id);
    record.rank = result.rank;
    record.isWinner = Boolean(result.is_winner);
  }
  return record;
}
