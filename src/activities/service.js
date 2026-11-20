import { randomInt, randomUUID } from 'node:crypto';
import { HttpError } from '../http-error.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const timestamp = () => new Date().toISOString();
function view(activity) {
  return { activityId: activity.activity_id, mode: activity.mode, state: activity.state };
}
function getActivity(db, id) {
  const row = db.prepare('SELECT * FROM activities WHERE activity_id = ?').get(id);
  if (!row) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', '找不到活動。');
  return row;
}
function validMode(mode) {
  if (!['SPEED', 'FAIR'].includes(mode)) throw new HttpError(400, 'INVALID_MODE', '模式必須是 SPEED 或 FAIR。');
}
function requirePreparing(activity) {
  if (activity.state !== 'PREPARING') throw new HttpError(409, 'INVALID_PHASE', '活動已開啟或結束，無法進行此操作。');
}

export function createActivityService(store, auth) {
  return {
    async create(token, mode = 'SPEED') {
      auth.requireTeacher(token);
      validMode(mode);
      return store.write('global:activities', (db) => {
        const teacher = auth.requireTeacher(token, db);
        if (db.prepare("SELECT 1 FROM activities WHERE state <> 'CLOSED'").get()) {
          throw new HttpError(409, 'ACTIVITY_ALREADY_ACTIVE', '請先結束目前活動，再建立新活動。');
        }
        let code;
        do { code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); }
        while (db.prepare('SELECT 1 FROM activities WHERE join_code = ?').get(code));
        const id = randomUUID();
        db.prepare('INSERT INTO activities (activity_id, join_code, teacher_session_id, mode, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, code, teacher.session_id, mode, timestamp());
        return { data: { ...view(getActivity(db, id)), joinCode: code } };
      });
    },
    async join(token, joinCode, groupName) {
      auth.requireSession(token);
      if (typeof joinCode !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(joinCode.trim().toUpperCase())) {
        throw new HttpError(400, 'INVALID_JOIN_CODE', '請輸入有效的六碼加入碼。');
      }
      const name = typeof groupName === 'string' ? groupName.trim() : '';
      if ([...name].length < 1 || [...name].length > 30) throw new HttpError(400, 'INVALID_GROUP_NAME', '組名去除前後空白後需為 1～30 個字元。');
      const code = joinCode.trim().toUpperCase();
      const selected = store.read((db) => db.prepare('SELECT activity_id FROM activities WHERE join_code = ?').get(code));
      if (!selected) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', '找不到活動。');
      return store.write(selected.activity_id, (db) => {
        const session = auth.requireSession(token, db);
        const activity = getActivity(db, selected.activity_id);
        if (session.role === 'STUDENT') {
          const own = db.prepare('SELECT group_name FROM groups WHERE activity_id = ? AND group_id = ?').get(session.activity_id, session.group_id);
          if (session.activity_id === activity.activity_id && own?.group_name === name) {
            return { data: { ...view(activity), groupId: session.group_id, groupName: own.group_name } };
          }
          throw new HttpError(403, 'GROUP_SESSION_BOUND', '此工作階段已加入組別，請使用原工作階段繼續活動。');
        }
        if (session.role !== 'ANONYMOUS') throw new HttpError(403, 'STUDENT_SESSION_REQUIRED', '學生請使用獨立瀏覽器工作階段加入。');
        requirePreparing(activity);
        if (db.prepare('SELECT 1 FROM groups WHERE activity_id = ? AND group_name = ?').get(activity.activity_id, name)) {
          throw new HttpError(409, 'GROUP_UNAVAILABLE', '無法以此組名加入；既有組別請使用原工作階段。');
        }
        const groupId = randomUUID();
        db.prepare('INSERT INTO groups VALUES (?, ?, ?, ?)').run(groupId, activity.activity_id, name, timestamp());
        const cookie = auth.bindStudent(token, db, activity.activity_id, groupId);
        return { cookie, data: { ...view(activity), groupId, groupName: name } };
      });
    },
    snapshot(token, id) {
      return store.read((db) => {
        const session = auth.requireSession(token, db);
        if (session.role !== 'TEACHER' && !(session.role === 'STUDENT' && session.activity_id === id)) {
          throw new HttpError(session.role === 'ANONYMOUS' ? 401 : 403, 'ACTIVITY_FORBIDDEN', '無法存取此活動。');
        }
        const activity = getActivity(db, id);
        const units = db.prepare('SELECT unit_id, type, unit_order FROM units WHERE activity_id = ? ORDER BY unit_order').all(id).map((unit) => ({
          unitId: unit.unit_id, type: unit.type, order: unit.unit_order,
          questions: db.prepare('SELECT question_id, question_order FROM questions WHERE activity_id = ? AND unit_id = ? ORDER BY question_order')
            .all(id, unit.unit_id).map((q) => ({ questionId: q.question_id, order: q.question_order })),
        }));
        const base = { ...view(activity), units };
        if (session.role === 'TEACHER') {
          return { data: { ...base, joinCode: activity.join_code, groups: db.prepare('SELECT group_id AS groupId, group_name AS groupName FROM groups WHERE activity_id = ? ORDER BY created_at, group_id').all(id) } };
        }
        const own = db.prepare('SELECT group_name FROM groups WHERE activity_id = ? AND group_id = ?').get(id, session.group_id);
        return { data: { ...base, groupId: session.group_id, groupName: own.group_name } };
      });
    },
    async setMode(token, id, mode) {
      auth.requireTeacher(token);
      validMode(mode);
      return store.write(id, (db) => {
        auth.requireTeacher(token, db);
        requirePreparing(getActivity(db, id));
        db.prepare('UPDATE activities SET mode = ? WHERE activity_id = ?').run(mode, id);
        return { data: view(getActivity(db, id)) };
      });
    },
    async open(token, id) {
      auth.requireTeacher(token);
      return store.write(id, (db) => {
        auth.requireTeacher(token, db);
        requirePreparing(getActivity(db, id));
        if (!db.prepare('SELECT 1 FROM questions WHERE activity_id = ?').get(id)) throw new HttpError(409, 'QUESTIONS_REQUIRED', '至少確認匯入一題後才可開啟。');
        db.prepare("UPDATE activities SET state = 'OPEN', opened_at = ? WHERE activity_id = ?").run(timestamp(), id);
        return { data: view(getActivity(db, id)) };
      });
    },
    async close(token, id, confirmed) {
      auth.requireTeacher(token);
      if (confirmed !== true) throw new HttpError(400, 'CONFIRMATION_REQUIRED', '請確認要結束活動。');
      return store.write(id, (db) => {
        auth.requireTeacher(token, db);
        const activity = getActivity(db, id);
        if (activity.state !== 'OPEN') throw new HttpError(409, 'INVALID_PHASE', '只有搶答中的活動可結束。');
        // tasks 3.4 的完整結果原子保存依原規劃在 5.3 接入；現在不能以空結果掩蓋已受理答案。
        if (db.prepare('SELECT 1 FROM submissions WHERE activity_id = ?').get(id)) throw new HttpError(409, 'RESULT_FINALIZATION_PENDING', '完整結果計算尚待後續實作，未結束活動。');
        db.prepare("UPDATE activities SET state = 'CLOSED', closed_at = ? WHERE activity_id = ?").run(timestamp(), id);
        return { data: view(getActivity(db, id)) };
      });
    },
  };
}
