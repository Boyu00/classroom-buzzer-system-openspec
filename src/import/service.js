import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpError } from '../http-error.js';
import { parseSheets } from './parser.js';

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_SHEETS = 50;
const hashToken = (text) => createHash('sha256').update(text).digest('hex');

function getActivity(db, id) {
  const row = db.prepare('SELECT * FROM activities WHERE activity_id = ?').get(id);
  if (!row) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', '找不到活動。');
  return row;
}

function requirePreparing(activity) {
  if (activity.state !== 'PREPARING') {
    throw new HttpError(409, 'INVALID_PHASE', '活動已開啟或結束，無法修改匯入。');
  }
}

function validateRequest(body) {
  const spreadsheet = typeof body?.spreadsheet === 'string' ? body.spreadsheet.trim() : '';
  if (!spreadsheet || spreadsheet.length > 2048) {
    throw new HttpError(400, 'INVALID_SPREADSHEET', '請提供 Google Sheets 網址或 ID。');
  }
  const sheetIds = body?.sheetIds;
  if (!Array.isArray(sheetIds) || sheetIds.length < 1 || sheetIds.length > MAX_SHEETS
    || !sheetIds.every((id) => Number.isSafeInteger(id) && id >= 0) || new Set(sheetIds).size !== sheetIds.length) {
    throw new HttpError(400, 'INVALID_SHEET_SELECTION', `請依序選擇 1～${MAX_SHEETS} 張不重複的工作表。`);
  }
  return { spreadsheet, sheetIds };
}

// 預覽給教師看的格式：不含結構指紋與後端專用資料。
function previewView(parsed) {
  return {
    summary: parsed.summary,
    units: parsed.units.map((unit) => ({
      type: unit.type,
      order: unit.order,
      questions: unit.questions.map((q) => ({
        questionId: q.questionId, order: q.order, location: q.location,
        sheetId: q.sheetId, rowIndex: q.rowIndex, columnIndex: q.columnIndex,
      })),
    })),
  };
}

/**
 * @param store A 的資料層；所有寫入走 store.write(activityId, 同步回呼)。
 * @param auth A 的身分服務。
 * @param gateway #13 的 Sheets gateway：readSheets({ spreadsheet, sheetIds }) → 正規化工作表陣列。
 */
export function createImportService(store, auth, gateway, { now = Date.now } = {}) {
  // 外部 API 在 SQLite 交易之外呼叫；失敗不動任何既有匯入，且不洩漏內部錯誤。
  async function callGateway(operation) {
    if (!gateway) throw new HttpError(503, 'SHEETS_NOT_CONFIGURED', '尚未設定 Google Sheets 存取。');
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'SHEETS_UNAVAILABLE', '無法讀取 Google Sheets，請確認授權與網路後再試。');
    }
  }

  return {
    // 讓教師依序選擇工作表；同時回報服務帳戶 email，提示要把試算表分享給誰。
    async listSheets(token, activityId, body) {
      auth.requireTeacher(token);
      const activity = store.read((db) => getActivity(db, activityId));
      requirePreparing(activity);
      const spreadsheet = typeof body?.spreadsheet === 'string' ? body.spreadsheet.trim() : '';
      if (!spreadsheet || spreadsheet.length > 2048) {
        throw new HttpError(400, 'INVALID_SPREADSHEET', '請提供 Google Sheets 網址或 ID。');
      }
      const listing = await callGateway(() => gateway.listSheets({ spreadsheet }));
      return { data: { ...listing, serviceAccountEmail: gateway.serviceAccountEmail } };
    },

    async preview(token, activityId, body) {
      auth.requireTeacher(token);
      const request = validateRequest(body);
      const activity = store.read((db) => getActivity(db, activityId));
      requirePreparing(activity);
      const sheets = await callGateway(() => gateway.readSheets(request));

      const parsed = parseSheets(sheets);
      if (!parsed.ok) {
        throw new HttpError(400, 'IMPORT_INVALID', '匯入內容不合法，請修正試算表後重新預覽。', parsed.errors);
      }

      const previewToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now() + PREVIEW_TTL_MS).toISOString();
      return store.write(activityId, (db) => {
        const teacher = auth.requireTeacher(token, db);
        const current = getActivity(db, activityId);
        requirePreparing(current);
        db.prepare('DELETE FROM import_previews WHERE expires_at <= ?').run(new Date(now()).toISOString());
        // 每個活動只保留最新預覽，較舊的預覽自動失效。
        db.prepare('DELETE FROM import_previews WHERE activity_id = ?').run(activityId);
        db.prepare(`INSERT INTO import_previews
          (preview_id, token_hash, activity_id, teacher_session_id, import_revision, parsed_json, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          randomUUID(), hashToken(previewToken), activityId, teacher.session_id, current.import_revision,
          JSON.stringify({ units: parsed.units, summary: parsed.summary, structureFingerprint: parsed.structureFingerprint }),
          new Date(now()).toISOString(), expiresAt,
        );
        return { data: { previewToken, expiresAt, importRevision: current.import_revision, ...previewView(parsed) } };
      });
    },

    async confirm(token, activityId, previewToken) {
      auth.requireTeacher(token);
      if (typeof previewToken !== 'string' || !TOKEN_PATTERN.test(previewToken)) {
        throw new HttpError(400, 'INVALID_PREVIEW_TOKEN', '請提供有效的預覽憑證。');
      }
      return store.write(activityId, (db) => {
        const teacher = auth.requireTeacher(token, db);
        const activity = getActivity(db, activityId);
        requirePreparing(activity);
        const preview = db.prepare('SELECT * FROM import_previews WHERE token_hash = ? AND activity_id = ?')
          .get(hashToken(previewToken), activityId);
        if (!preview || preview.teacher_session_id !== teacher.session_id || preview.expires_at <= new Date(now()).toISOString()) {
          throw new HttpError(409, 'PREVIEW_INVALID', '預覽已失效，請重新預覽後再確認。');
        }
        if (preview.import_revision !== activity.import_revision) {
          throw new HttpError(409, 'PREVIEW_STALE', '匯入內容已變更，請重新預覽後再確認。');
        }

        const parsed = JSON.parse(preview.parsed_json);
        // 整批替換：任何一步失敗，共用交易回滾，舊匯入完整保留。
        db.prepare('DELETE FROM questions WHERE activity_id = ?').run(activityId);
        db.prepare('DELETE FROM units WHERE activity_id = ?').run(activityId);
        const insertUnit = db.prepare('INSERT INTO units VALUES (?, ?, ?, ?)');
        const insertQuestion = db.prepare('INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const unit of parsed.units) {
          const unitId = randomUUID();
          insertUnit.run(activityId, unitId, unit.type, unit.order);
          for (const q of unit.questions) {
            insertQuestion.run(activityId, unitId, q.questionId, q.order, q.spreadsheetId, q.sheetId,
              q.rowIndex, q.columnIndex, q.originalMarker, parsed.structureFingerprint);
          }
        }
        const revision = activity.import_revision + 1;
        db.prepare('UPDATE activities SET import_revision = ? WHERE activity_id = ?').run(revision, activityId);
        db.prepare('DELETE FROM import_previews WHERE activity_id = ?').run(activityId);
        return { data: { importRevision: revision, ...previewView(parsed) } };
      });
    },
  };
}
