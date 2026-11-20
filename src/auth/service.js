import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { hashPassword, verifyPassword } from './password.js';
import { HttpError } from '../http-error.js';

export const SESSION_COOKIE = 'classroom_session';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HOUR = 60 * 60 * 1000;
const AUTH_LOCK = 'global:authentication';
export const hashToken = (text) => createHash('sha256').update(text).digest('hex');
const csrfFor = (token) => hashToken(`csrf\0${token}`);

function credentials(role, now) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = csrfFor(token);
  const maxAge = role === 'TEACHER' ? 8 * HOUR : role === 'STUDENT' ? 24 * HOUR : HOUR;
  return { token, csrfToken, tokenHash: hashToken(token), csrfHash: hashToken(csrfToken), expiresAt: new Date(now + maxAge).toISOString(), maxAge };
}

export function readCookie(header = '') {
  const values = header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(SESSION_COOKIE.length + 1);
  return TOKEN_PATTERN.test(value) ? value : null;
}

export function createAuthService(store, { now = Date.now } = {}) {
  function readSession(token, db) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    const query = (connection) => connection.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?')
      .get(hashToken(token), new Date(now()).toISOString()) ?? null;
    return db ? query(db) : store.read(query);
  }

  function requireSession(token, db) {
    const session = readSession(token, db);
    if (!session) throw new HttpError(401, 'SESSION_REQUIRED', '工作階段已失效，請重新取得工作階段。');
    return session;
  }

  function requireTeacher(token, db) {
    const session = requireSession(token, db);
    if (session.role === 'ANONYMOUS') throw new HttpError(401, 'TEACHER_REQUIRED', '請先以教師密碼登入。');
    if (session.role !== 'TEACHER') throw new HttpError(403, 'TEACHER_REQUIRED', '此操作僅限老師使用。');
    return session;
  }

  function requireAnonymous(token, db) {
    const session = requireSession(token, db);
    if (session.role !== 'ANONYMOUS') throw new HttpError(403, 'ANONYMOUS_REQUIRED', '請先登出，再進行教師設定或登入。');
    return session;
  }

  function checkCsrf(token, supplied) {
    const session = requireSession(token);
    if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) {
      throw new HttpError(403, 'CSRF_REJECTED', '請求驗證失敗，請重新載入後再試。');
    }
    if (!timingSafeEqual(Buffer.from(hashToken(supplied), 'hex'), Buffer.from(session.csrf_hash, 'hex'))) {
      throw new HttpError(403, 'CSRF_REJECTED', '請求驗證失敗，請重新載入後再試。');
    }
    return session;
  }

  function configured(db) {
    if (!db) return store.read((connection) => configured(connection));
    return db.prepare('SELECT 1 FROM teacher_settings WHERE singleton_id = 1').get() !== undefined;
  }

  function rotate(db, sessionId, role) {
    const next = credentials(role, now());
    db.prepare('UPDATE sessions SET token_hash = ?, csrf_hash = ?, role = ?, activity_id = NULL, group_id = NULL, expires_at = ? WHERE session_id = ?')
      .run(next.tokenHash, next.csrfHash, role, next.expiresAt, sessionId);
    return next;
  }

  function sweepExpired(db) {
    // 被活動或匯入預覽引用的教師 session 保留紀錄，但到期後仍無驗證權限。
    db.prepare(`DELETE FROM sessions WHERE expires_at <= ?
      AND NOT EXISTS (SELECT 1 FROM activities WHERE teacher_session_id = sessions.session_id)
      AND NOT EXISTS (SELECT 1 FROM import_previews WHERE teacher_session_id = sessions.session_id)`)
      .run(new Date(now()).toISOString());
  }

  return {
    readSession, requireSession, requireTeacher, checkCsrf,
    bindStudent(token, db, activityId, groupId) {
      const session = requireAnonymous(token, db);
      const next = credentials('STUDENT', now());
      db.prepare("UPDATE sessions SET token_hash = ?, csrf_hash = ?, role = 'STUDENT', activity_id = ?, group_id = ?, expires_at = ? WHERE session_id = ?")
        .run(next.tokenHash, next.csrfHash, activityId, groupId, next.expiresAt, session.session_id);
      return next;
    },
    async getSession(token) {
      return store.write(AUTH_LOCK, (db) => {
        sweepExpired(db);
        let session = readSession(token, db);
        let fresh;
        if (!session) {
          fresh = credentials('ANONYMOUS', now());
          db.prepare(`INSERT INTO sessions (session_id, token_hash, csrf_hash, role, created_at, expires_at)
            VALUES (?, ?, ?, 'ANONYMOUS', ?, ?)`).run(randomUUID(), fresh.tokenHash, fresh.csrfHash, new Date(now()).toISOString(), fresh.expiresAt);
          token = fresh.token;
          session = readSession(token, db);
        }
        return {
          cookie: fresh,
          data: { role: session.role, csrfToken: csrfFor(token), teacherConfigured: configured(db), expiresAt: session.expires_at,
            ...(session.role === 'STUDENT' ? { activityId: session.activity_id, groupId: session.group_id } : {}) },
        };
      });
    },
    async setup(token, password) {
      requireAnonymous(token);
      if (configured()) throw new HttpError(409, 'ALREADY_CONFIGURED', '教師密碼已設定，請登入。');
      const passwordHash = await hashPassword(password);
      return store.write(AUTH_LOCK, (db) => {
        const session = requireAnonymous(token, db);
        if (configured(db)) throw new HttpError(409, 'ALREADY_CONFIGURED', '教師密碼已設定，請登入。');
        db.prepare('INSERT INTO teacher_settings VALUES (1, ?, ?)').run(passwordHash, new Date(now()).toISOString());
        return { cookie: rotate(db, session.session_id, 'TEACHER'), data: { role: 'TEACHER' } };
      });
    },
    async login(token, password) {
      requireAnonymous(token);
      const setting = store.read((db) => db.prepare('SELECT password_hash FROM teacher_settings WHERE singleton_id = 1').get());
      if (!setting) throw new HttpError(409, 'SETUP_REQUIRED', '請先完成初次教師密碼設定。');
      if (!await verifyPassword(password, setting.password_hash)) throw new HttpError(401, 'INVALID_CREDENTIALS', '教師密碼錯誤。');
      return store.write(AUTH_LOCK, (db) => {
        const session = requireAnonymous(token, db);
        return { cookie: rotate(db, session.session_id, 'TEACHER'), data: { role: 'TEACHER' } };
      });
    },
    async logout(token) {
      return store.write(AUTH_LOCK, (db) => {
        const session = requireSession(token, db);
        return { cookie: rotate(db, session.session_id, 'ANONYMOUS'), data: { role: 'ANONYMOUS' } };
      });
    },
  };
}
