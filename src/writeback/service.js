import { randomUUID } from 'node:crypto';
import { HttpError } from '../http-error.js';
import { a1, fingerprint } from '../import/parser.js';

// FR-07：把 CLOSED 活動各單位的勝出答案寫回原 Google Sheets。
// 原則：寫入前重驗結構與原格內容；只用 RAW 更新勝出格；寫入後一定回讀逐格核對；
// 逾時或未知時標為待核對，絕不因為 HTTP 成功就宣稱完成；外部不同內容一律視為衝突並停止。

// Sheets 會把換行統一成 \n；兩邊都正規化後比較，避免 \r\n 造成誤判。
const normalize = (text) => String(text ?? '').replace(/\r\n?/g, '\n');
const same = (a, b) => normalize(a) === normalize(b);

// 這些錯誤代表 Google 明確拒絕，請求沒有生效；其餘（逾時、網路、5xx、格式錯誤）不知道有沒有寫入。
const DEFINITE_REJECTION = new Set([
  'SHEETS_PERMISSION_DENIED', 'SPREADSHEET_NOT_FOUND', 'SHEETS_REQUEST_REJECTED', 'SHEETS_RATE_LIMITED',
  'SHEETS_AUTH_FAILED', 'SHEETS_API_DISABLED', 'INVALID_WRITE',
]);
// 本系統曾經確認寫入（SUCCEEDED）或可能已寫入（PENDING_VERIFICATION）的題目，才可把「線上值等於答案」認定為自己的寫入。
// 這份證據只增不減：之後的批次即使在寫入前就讀取失敗或遇到結構衝突，也不能抹掉先前成功寫入的事實。

const REASONS = {
  STRUCTURE_CHANGED_AFTER_WRITE: '寫入後回讀發現工作表結構已改變，這一格可能已寫入；系統沒有再修改任何內容。請依逐題紀錄核對線上內容。',
  STRUCTURE_CHANGED: '工作表結構已變更（工作表被刪除、改名、增減列欄或合併範圍改變）。請恢復原結構，或另建活動重新匯入。',
  CELL_CHANGED: '原格內容已不是匯入時的標記（可能被移動、刪除或改寫）。請恢復原內容，或另建活動重新匯入。',
  CHANGED_EXTERNALLY: '寫入後回讀發現原格被其他內容取代，已停止，未再覆寫。',
  NOT_WRITTEN: '回讀確認此格沒有被寫入。',
  VERIFY_UNAVAILABLE: '無法確認此格是否已寫入，請稍後重試以回讀核對。',
};

function getActivity(db, activityId) {
  const activity = db.prepare('SELECT * FROM activities WHERE activity_id = ?').get(activityId);
  if (!activity) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', '找不到活動。');
  return activity;
}

function requireClosed(activity) {
  if (activity.state !== 'CLOSED') throw new HttpError(409, 'INVALID_PHASE', '活動結束後才能寫回 Google Sheets。');
}

// 取得寫回計畫：每題的原格座標、原標記，以及勝出組與答案（無人作答為 null）。
function loadPlan(db, activity) {
  const activityId = activity.activity_id;
  requireClosed(activity);
  const source = db.prepare('SELECT * FROM import_sources WHERE activity_id = ?').get(activityId);
  if (!source) throw new HttpError(409, 'EXPORT_SOURCE_MISSING', '找不到匯入來源紀錄，無法寫回；請重新建立活動並匯入。');
  const winners = new Map(db.prepare(`SELECT r.unit_id, s.submission_id, g.group_name
    FROM results r JOIN submissions s ON s.submission_id = r.submission_id
    JOIN groups g ON g.group_id = s.group_id
    WHERE r.activity_id = ? AND r.rank = 1`).all(activityId).map((w) => [w.unit_id, w]));
  const answers = new Map(db.prepare(`SELECT a.submission_id, a.question_id, a.answer FROM submission_answers a
    WHERE a.activity_id = ?`).all(activityId).map((a) => [`${a.submission_id}\0${a.question_id}`, a.answer]));
  const items = db.prepare(`SELECT q.*, u.unit_order, u.type FROM questions q JOIN units u
    ON u.activity_id = q.activity_id AND u.unit_id = q.unit_id
    WHERE q.activity_id = ? ORDER BY u.unit_order, q.question_order`).all(activityId).map((q) => {
    const winner = winners.get(q.unit_id);
    return {
      questionId: q.question_id, unitId: q.unit_id, unitOrder: q.unit_order, unitType: q.type, questionOrder: q.question_order,
      spreadsheetId: q.spreadsheet_id, sheetId: q.sheet_id, rowIndex: q.row_index, columnIndex: q.column_index,
      originalMarker: q.original_marker, winnerGroupName: winner?.group_name ?? null,
      answer: winner ? answers.get(`${winner.submission_id}\0${q.question_id}`) ?? null : null,
    };
  });
  // 曾確認寫入或可能已寫入的題目（見檔頭說明）；答案在 CLOSED 後固定，所以同題的預期內容不會變。
  const prior = new Set(db.prepare(`SELECT DISTINCT question_id FROM export_items
    WHERE activity_id = ? AND status IN ('SUCCEEDED', 'PENDING_VERIFICATION')`).all(activityId).map((r) => r.question_id));
  return {
    structureFingerprint: db.prepare('SELECT structure_fingerprint FROM questions WHERE activity_id = ? LIMIT 1').get(activityId)?.structure_fingerprint,
    source: { spreadsheetId: source.spreadsheet_id, sheetIds: JSON.parse(source.sheet_ids_json) },
    items, prior,
  };
}

// 把線上現況與計畫對照。結構以匯入時的指紋重算（題目座標取自資料庫，所以曾寫入的格不會讓結構誤判）。
function evaluate(plan, sheets) {
  const order = new Map(plan.source.sheetIds.map((id, index) => [id, index]));
  const known = plan.items.every((item) => order.has(item.sheetId));
  let structureOk = false;
  if (known) {
    const scanned = [...plan.items]
      .sort((a, b) => order.get(a.sheetId) - order.get(b.sheetId) || a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex)
      .map((i) => ({ questionId: i.questionId, spreadsheetId: i.spreadsheetId, sheetId: i.sheetId, rowIndex: i.rowIndex, columnIndex: i.columnIndex, originalMarker: i.originalMarker }));
    structureOk = fingerprint(sheets, scanned) === plan.structureFingerprint;
  }
  const items = plan.items.map((item) => {
    const sheet = sheets[order.get(item.sheetId)];
    const target = { sheetId: item.sheetId, rowIndex: item.rowIndex, columnIndex: item.columnIndex, location: `${sheet?.title ?? item.sheetId}!${a1(item.rowIndex, item.columnIndex)}` };
    const live = sheet?.cells?.[item.rowIndex]?.[item.columnIndex] ?? '';
    let verdict;
    let reason;
    if (!structureOk) {
      verdict = 'CONFLICT'; reason = 'STRUCTURE_CHANGED';
    } else if (item.answer === null) {
      verdict = same(live, item.originalMarker) ? 'SKIP' : 'CONFLICT';
      if (verdict === 'CONFLICT') reason = 'CELL_CHANGED';
    } else if (same(live, item.originalMarker)) {
      verdict = 'WRITE';
    } else if (same(live, item.answer) && plan.prior.has(item.questionId)) {
      verdict = 'DONE';
    } else {
      verdict = 'CONFLICT'; reason = 'CELL_CHANGED';
    }
    return { ...item, target, live, verdict, ...(reason ? { reason } : {}) };
  });
  return { structureOk, items };
}

const overallStatus = (itemStatuses) => {
  if (itemStatuses.includes('CONFLICT')) return 'CONFLICT';
  if (itemStatuses.includes('PENDING_VERIFICATION')) return 'PENDING_VERIFICATION';
  if (itemStatuses.some((s) => s === 'FAILED' || s === 'PENDING')) return 'FAILED';
  return 'SUCCEEDED';
};

function exportView(db, exportId, { writing = true } = {}) {
  const row = db.prepare('SELECT * FROM exports WHERE export_id = ?').get(exportId);
  if (!row) return null;
  // 這個程序沒有在寫的 WRITING 紀錄是中斷殘留：實況未知，顯示待核對。
  const stale = row.status === 'WRITING' && !writing;
  const items = db.prepare(`SELECT i.*, q.original_marker FROM export_items i JOIN questions q
    ON q.activity_id = i.activity_id AND q.question_id = i.question_id
    WHERE i.export_id = ? ORDER BY i.rowid`).all(exportId).map((i) => ({
    questionId: i.question_id,
    status: stale && i.status === 'PENDING' ? 'PENDING_VERIFICATION' : i.status,
    target: { sheetId: i.sheet_id, rowIndex: i.row_index, columnIndex: i.column_index },
    verifiedAt: i.verified_at, errorCode: i.error_code,
    ...(i.error_code && REASONS[i.error_code] ? { message: REASONS[i.error_code] } : {}),
  }));
  return { exportId: row.export_id, status: stale ? 'PENDING_VERIFICATION' : row.status, createdAt: row.created_at, updatedAt: row.updated_at, items };
}

function previewView(plan, evaluation, serviceAccountEmail) {
  const units = [];
  for (const item of evaluation.items) {
    let unit = units.at(-1);
    if (unit?.unitId !== item.unitId) {
      unit = { unitId: item.unitId, order: item.unitOrder, type: item.unitType, winnerGroupName: item.winnerGroupName, questions: [] };
      units.push(unit);
    }
    unit.questions.push({
      questionId: item.questionId, answer: item.answer, target: item.target,
      status: { WRITE: 'WILL_WRITE', DONE: 'ALREADY_WRITTEN', SKIP: 'NO_WINNER', CONFLICT: 'CONFLICT' }[item.verdict],
      ...(item.reason ? { reason: item.reason, message: REASONS[item.reason] } : {}),
    });
  }
  const canWrite = evaluation.structureOk && evaluation.items.every((i) => i.verdict !== 'CONFLICT');
  return {
    canWrite, structureOk: evaluation.structureOk, serviceAccountEmail, units,
    summary: {
      willWrite: evaluation.items.filter((i) => i.verdict === 'WRITE').length,
      alreadyWritten: evaluation.items.filter((i) => i.verdict === 'DONE').length,
      noWinner: evaluation.items.filter((i) => i.answer === null).length,
      conflicts: evaluation.items.filter((i) => i.verdict === 'CONFLICT').length,
    },
  };
}

/**
 * @param store A 的資料層。
 * @param auth A 的身分服務。
 * @param gateway #13 的 gateway，另需 writeCells。
 */
export function createWritebackService(store, auth, gateway, { now = () => new Date().toISOString() } = {}) {
  const running = new Set(); // 進行中的活動；同一活動同時只允許一個寫回。

  async function callGateway(operation) {
    if (!gateway) throw new HttpError(503, 'SHEETS_NOT_CONFIGURED', '尚未設定 Google Sheets 存取。');
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'SHEETS_UNAVAILABLE', '無法連線到 Google Sheets，請確認授權與網路後再試。');
    }
  }

  // 重讀選取的工作表；工作表被刪除代表結構已變，視為衝突而不是一般請求錯誤。
  async function readLive(plan) {
    try {
      return { sheets: await callGateway(() => gateway.readSheets({ spreadsheet: plan.source.spreadsheetId, sheetIds: plan.source.sheetIds })) };
    } catch (error) {
      if (error instanceof HttpError && error.code === 'INVALID_SHEET_SELECTION') return { deleted: true };
      throw error;
    }
  }

  const evaluateLive = (plan, live) => (live.deleted
    ? { structureOk: false, items: plan.items.map((item) => ({ ...item, target: { sheetId: item.sheetId, rowIndex: item.rowIndex, columnIndex: item.columnIndex, location: `${a1(item.rowIndex, item.columnIndex)}` }, live: '', verdict: 'CONFLICT', reason: 'STRUCTURE_CHANGED' })) }
    : evaluate(plan, live.sheets));

  function finalize(activityId, exportId, results, { forceStatus } = {}) {
    // results: Map questionId → { status, errorCode?, verified? }
    return store.write(activityId, (db) => {
      const at = now();
      const update = db.prepare('UPDATE export_items SET status = ?, verified_at = ?, error_code = ? WHERE export_id = ? AND question_id = ?');
      for (const [questionId, r] of results) update.run(r.status, r.status === 'SUCCEEDED' ? at : null, r.errorCode ?? null, exportId, questionId);
      const statuses = db.prepare('SELECT status FROM export_items WHERE export_id = ?').all(exportId).map((i) => i.status);
      const status = forceStatus ?? overallStatus(statuses);
      db.prepare('UPDATE exports SET status = ?, updated_at = ? WHERE export_id = ?').run(status, at, exportId);
      return exportView(db, exportId);
    });
  }

  // wroteAttempted：已經送出寫入。這時不能再說「沒有覆寫任何內容」，因為部分格子可能已寫入。
  function fail(view, writeError, { wroteAttempted = false } = {}) {
    const details = view;
    if (view.status === 'CONFLICT' && wroteAttempted) {
      return new HttpError(409, 'EXPORT_CONFLICT', '寫入已送出，但回讀發現來源 Sheets 被改動（內容或結構不同）。部分格子可能已寫入，系統沒有再修改任何內容；請依逐題紀錄核對線上內容，必要時恢復原狀後重試。', details);
    }
    if (view.status === 'CONFLICT') {
      return new HttpError(409, 'EXPORT_CONFLICT', '來源 Sheets 與匯入時不同，已停止寫回，未覆寫任何內容。請恢復原內容，或另建活動重新匯入。', details);
    }
    if (view.status === 'PENDING_VERIFICATION') {
      return new HttpError(502, 'EXPORT_PENDING_VERIFICATION', '無法確認 Google Sheets 是否已寫入，狀態為待核對；請稍後重試，系統會先回讀線上值。', details);
    }
    return new HttpError(writeError?.status ?? 502, writeError?.code ?? 'EXPORT_FAILED',
      writeError?.message ?? '寫回失敗，Google Sheets 沒有被修改；結果仍保留，可稍後重試。', details);
  }

  return {
    async preview(token, activityId) {
      auth.requireTeacher(token);
      const plan = store.read((db) => loadPlan(db, getActivity(db, activityId)));
      const live = await readLive(plan);
      return { data: previewView(plan, evaluateLive(plan, live), gateway?.serviceAccountEmail) };
    },

    async write(token, activityId, body) {
      auth.requireTeacher(token);
      if (body?.confirmedPaused !== true) {
        throw new HttpError(400, 'EXPORT_CONFIRMATION_REQUIRED', '請先確認已暫停其他人編輯此試算表，寫回完成後再恢復。');
      }
      if (!gateway) throw new HttpError(503, 'SHEETS_NOT_CONFIGURED', '尚未設定 Google Sheets 存取。');
      if (running.has(activityId)) throw new HttpError(409, 'EXPORT_IN_PROGRESS', '此活動正在寫回，請等待完成。');
      running.add(activityId);
      try {
        // A. 取得互斥、計畫與批次紀錄（先落地，崩潰後仍能追蹤）。Google 呼叫都在交易之外。
        const { plan, exportId } = await store.write(activityId, (db) => {
          auth.requireTeacher(token, db);
          const activity = getActivity(db, activityId);
          // 本程序沒有在寫，資料庫仍標示 WRITING 的是中斷殘留：實況未知，轉為待核對，之後以回讀處理。
          // 必須先轉換再取得計畫，讓計畫認得這些「可能已寫入」的格。
          const at = now();
          for (const stale of db.prepare("SELECT export_id FROM exports WHERE activity_id = ? AND status = 'WRITING'").all(activityId)) {
            db.prepare("UPDATE export_items SET status = 'PENDING_VERIFICATION' WHERE export_id = ? AND status = 'PENDING'").run(stale.export_id);
            db.prepare("UPDATE exports SET status = 'PENDING_VERIFICATION', updated_at = ? WHERE export_id = ?").run(at, stale.export_id);
          }
          const plan = loadPlan(db, activity);
          const exportId = randomUUID();
          db.prepare("INSERT INTO exports VALUES (?, ?, 'WRITING', ?, ?)").run(exportId, activityId, at, at);
          const insert = db.prepare("INSERT INTO export_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, NULL)");
          for (const item of plan.items.filter((i) => i.answer !== null)) {
            insert.run(exportId, activityId, item.questionId, item.spreadsheetId, item.sheetId, item.rowIndex, item.columnIndex, item.originalMarker, item.answer);
          }
          return { plan, exportId };
        });

        const results = new Map();
        const pendingAll = (status, errorCode) => {
          for (const item of plan.items.filter((i) => i.answer !== null)) {
            if (!results.has(item.questionId)) results.set(item.questionId, { status, errorCode });
          }
        };
        let attempted = false;
        let writeError;
        try {
          // B. 寫入前重新讀取：結構與原格內容任何不符都停止，且不寫任何一格。
          let live;
          try {
            live = await readLive(plan);
          } catch (error) {
            pendingAll('FAILED', error.code ?? 'SHEETS_UNAVAILABLE'); // 尚未寫入任何內容
            throw Object.assign(error, { alreadyRecorded: true });
          }
          const evaluation = evaluateLive(plan, live);
          const blocked = !evaluation.structureOk || evaluation.items.some((i) => i.verdict === 'CONFLICT');
          if (blocked) {
            for (const item of evaluation.items.filter((i) => i.answer !== null)) {
              if (item.verdict === 'CONFLICT') results.set(item.questionId, { status: 'CONFLICT', errorCode: item.reason });
            }
            // 衝突可能只出在沒有勝出答案的格上，所以批次狀態明確指定為 CONFLICT。
            throw fail(await finalize(activityId, exportId, results, { forceStatus: 'CONFLICT' }), undefined);
          }

          for (const item of evaluation.items.filter((i) => i.verdict === 'DONE')) results.set(item.questionId, { status: 'SUCCEEDED' });
          const toWrite = evaluation.items.filter((i) => i.verdict === 'WRITE');
          if (toWrite.length > 0) {
            // C. RAW 批次寫入。結果不明（逾時、網路、5xx）時不假設成功，也不假設失敗，交給回讀。
            attempted = true;
            try {
              await callGateway(() => gateway.writeCells({
                spreadsheet: plan.source.spreadsheetId,
                cells: toWrite.map((i) => ({ sheetId: i.sheetId, rowIndex: i.rowIndex, columnIndex: i.columnIndex, value: i.answer })),
              }));
            } catch (error) {
              writeError = error;
            }
            if (writeError && DEFINITE_REJECTION.has(writeError.code)) {
              for (const item of toWrite) results.set(item.questionId, { status: 'FAILED', errorCode: writeError.code });
            } else {
              // D. 回讀逐格核對：只有線上值等於預期答案才算成功。
              let after;
              try {
                after = await readLive(plan);
              } catch {
                after = null;
              }
              if (!after || after.deleted) {
                for (const item of toWrite) results.set(item.questionId, { status: 'PENDING_VERIFICATION', errorCode: writeError?.code ?? 'VERIFY_UNAVAILABLE' });
              } else {
                const written = new Set(toWrite.map((i) => i.questionId));
                const check = evaluate(plan, after.sheets);
                for (const item of check.items.filter((i) => written.has(i.questionId))) {
                  // 結構已變時座標不可信：即使文字相同也不能宣告成功。
                  if (!check.structureOk) results.set(item.questionId, { status: 'CONFLICT', errorCode: 'STRUCTURE_CHANGED_AFTER_WRITE' });
                  else if (same(item.live, item.answer)) results.set(item.questionId, { status: 'SUCCEEDED' });
                  else if (same(item.live, item.originalMarker)) results.set(item.questionId, { status: 'FAILED', errorCode: writeError?.code ?? 'NOT_WRITTEN' });
                  else results.set(item.questionId, { status: 'CONFLICT', errorCode: 'CHANGED_EXTERNALLY' });
                }
              }
            }
          }
        } catch (error) {
          if (error instanceof HttpError && error.code?.startsWith('EXPORT_')) throw error; // 已記錄的衝突
          if (!error?.alreadyRecorded) pendingAll(attempted ? 'PENDING_VERIFICATION' : 'FAILED', attempted ? 'VERIFY_UNAVAILABLE' : 'UNEXPECTED');
          const view = await finalize(activityId, exportId, results);
          throw fail(view, error instanceof HttpError ? error : undefined, { wroteAttempted: attempted });
        }

        const view = await finalize(activityId, exportId, results);
        if (view.status === 'SUCCEEDED') return { data: view };
        throw fail(view, writeError instanceof HttpError && DEFINITE_REJECTION.has(writeError.code) ? writeError : undefined, { wroteAttempted: attempted });
      } finally {
        running.delete(activityId);
      }
    },

    get(token, activityId, exportId) {
      auth.requireTeacher(token);
      return store.read((db) => {
        getActivity(db, activityId);
        const row = db.prepare('SELECT activity_id FROM exports WHERE export_id = ?').get(exportId);
        if (!row || row.activity_id !== activityId) throw new HttpError(404, 'EXPORT_NOT_FOUND', '找不到匯出紀錄。');
        return { data: exportView(db, exportId, { writing: running.has(activityId) }) };
      });
    },

    list(token, activityId) {
      auth.requireTeacher(token);
      return store.read((db) => {
        getActivity(db, activityId);
        const ids = db.prepare('SELECT export_id FROM exports WHERE activity_id = ? ORDER BY created_at DESC, rowid DESC').all(activityId);
        return { data: { exports: ids.map((r) => exportView(db, r.export_id, { writing: running.has(activityId) })) } };
      });
    },
  };
}
