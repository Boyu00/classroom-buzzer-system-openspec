import { createHash } from 'node:crypto';
import { parseMarker } from './marker.js';

// 純函式：只處理已正規化的工作表資料，不呼叫 Google API，也不碰資料庫。
// sheets 依教師選擇順序排列，每張：
//   { spreadsheetId, sheetId, title, rowCount, columnCount,
//     cells: string[][]（0 起算 [列][欄]）,
//     merges: [{ startRow, endRow, startCol, endCol }]（半開區間，與 Sheets API 相同）}

export function columnLetters(index) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export const a1 = (row, column) => `${columnLetters(column)}${row + 1}`;

function inMerge(merges, row, column) {
  return merges.some((m) => row >= m.startRow && row < m.endRow && column >= m.startCol && column < m.endCol
    && (m.endRow - m.startRow) * (m.endCol - m.startCol) > 1);
}

// 匯出寫回時以相同規則重算結構指紋（題目座標取自資料庫、其餘取自線上現況）。
export function fingerprint(sheets, scanned) {
  const canonical = {
    sheets: sheets.map((s) => ({
      spreadsheetId: s.spreadsheetId, sheetId: s.sheetId, title: s.title,
      rowCount: s.rowCount, columnCount: s.columnCount,
      merges: [...(s.merges ?? [])]
        .map(({ startRow, endRow, startCol, endCol }) => [startRow, endRow, startCol, endCol])
        .sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1] || a[3] - b[3]),
    })),
    questions: scanned.map((q) => [q.questionId, q.spreadsheetId, q.sheetId, q.rowIndex, q.columnIndex, q.originalMarker]),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * @returns {{ok: true, units, summary, structureFingerprint}
 *         | {ok: false, errors: {code, message, location?}[]}}
 *   失敗時收集全部錯誤（含位置），讓教師一次修完；呼叫端不得保存任何部分結果。
 */
export function parseSheets(sheets) {
  const errors = [];
  const fail = (code, message, location) => errors.push({ code, message, ...(location ? { location } : {}) });

  const seenSheets = new Set();
  const scanned = [];
  const questionSites = new Map();

  for (const sheet of Array.isArray(sheets) ? sheets : []) {
    const sheetKey = `${sheet.spreadsheetId}\0${sheet.sheetId}`;
    if (seenSheets.has(sheetKey)) {
      fail('DUPLICATE_SHEET', `工作表「${sheet.title}」被重複選擇。`);
      continue;
    }
    seenSheets.add(sheetKey);
    const merges = sheet.merges ?? [];
    (sheet.cells ?? []).forEach((rowCells, row) => {
      (rowCells ?? []).forEach((value, column) => {
        const parsed = parseMarker(value);
        if (!parsed) return;
        const location = `${sheet.title}!${a1(row, column)}`;
        if (!parsed.ok) {
          fail('INVALID_MARKER', `標記格式不合法：${parsed.marker}`, location);
          return;
        }
        if (inMerge(merges, row, column)) {
          fail('MERGED_ANSWER_CELL', `答案格不可為合併儲存格：${parsed.marker}`, location);
          return;
        }
        if (questionSites.has(parsed.questionId)) {
          fail('DUPLICATE_QUESTION_ID', `題號 ${parsed.questionId} 重複，另一處在 ${questionSites.get(parsed.questionId)}。`, location);
          return;
        }
        questionSites.set(parsed.questionId, location);
        scanned.push({
          questionId: parsed.questionId, groupCode: parsed.groupCode, originalMarker: parsed.raw,
          spreadsheetId: sheet.spreadsheetId, sheetId: sheet.sheetId, rowIndex: row, columnIndex: column, location,
        });
      });
    });
  }

  // 單位依首成員的掃描位置排序（Map 保留插入順序）；題組以代號合併，可跨工作表。
  const unitMap = new Map();
  for (const q of scanned) {
    const key = q.groupCode === null ? `S:${q.questionId}` : `G:${q.groupCode}`;
    if (!unitMap.has(key)) unitMap.set(key, { unitKey: key, type: q.groupCode === null ? 'SINGLE' : 'GROUP', members: [] });
    unitMap.get(key).members.push(q);
  }
  for (const unit of unitMap.values()) {
    if (unit.type === 'GROUP' && unit.members.length < 2) {
      fail('SINGLE_MEMBER_GROUP', `題組 ${unit.unitKey.slice(2)} 至少需要兩題。`, unit.members[0].location);
    }
  }
  if (scanned.length === 0 && errors.length === 0) fail('NO_QUESTIONS', '所選工作表中沒有任何題目標記。');
  if (errors.length > 0) return { ok: false, errors };

  const units = [...unitMap.values()].map((unit, order) => ({
    unitKey: unit.unitKey,
    type: unit.type,
    order,
    questions: unit.members.map((q, questionOrder) => ({
      questionId: q.questionId, order: questionOrder,
      spreadsheetId: q.spreadsheetId, sheetId: q.sheetId, rowIndex: q.rowIndex, columnIndex: q.columnIndex,
      originalMarker: q.originalMarker, location: q.location,
    })),
  }));
  return {
    ok: true,
    units,
    summary: { questionCount: scanned.length, unitCount: units.length },
    structureFingerprint: fingerprint(sheets, scanned),
  };
}
