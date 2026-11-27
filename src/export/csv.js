// 結果 CSV（FR-09、AC-19、AC-20）。純函式：輸入是 A 的 readResults() 格式，不碰資料庫，
// 結果與順位一律沿用已保存的固定結果，不另算排名。
export const CSV_COLUMNS = ['activity_id', 'mode', 'unit_id', 'question_id', 'group_name', 'answer', 'accepted_at', 'accepted_order', 'rank', 'is_winner'];
const BOM = '﻿';
const EOL = '\r\n';

// 公式注入防護：去除前導空白後以 = + - @ 開頭，或前導空白中含 tab／CR／LF 時，在內容前加單引號。
// 檢查的是「整段前導空白」，不只第一個字元（例如「空白＋tab＋文字」也要防護）；
// 文字中間才出現的 tab／換行不算前導。只改輸出，不改資料庫原值。
const LEADING_WHITESPACE = /^\s*/;
const CONTROL_CHARACTER = /[\t\r\n]/;
const FORMULA_START = /^[=+\-@]/;
export function neutralizeFormula(value) {
  const text = String(value);
  const leading = LEADING_WHITESPACE.exec(text)[0];
  return CONTROL_CHARACTER.test(leading) || FORMULA_START.test(text.slice(leading.length)) ? `'${text}` : text;
}

// RFC 4180：含逗號、雙引號、CR 或 LF 的欄位加雙引號，內部雙引號加倍。
export function escapeField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * 每筆受理依題展開為多列；排序為單位順序、最終順位、組內題序。
 * 無人作答的單位，每題仍一列：組別、答案、時間、受理序號與順位留空，is_winner 為 false。
 * 使用者輸入欄位（組名、答案、題號）加公式防護；其餘為系統產生的值。
 */
export function buildResultsCsv(results) {
  const rows = [];
  const exportId = (unit) => {
    const code = unit.type === 'GROUP' ? unit.groupCode : unit.questions[0]?.questionId;
    if (!['SINGLE', 'GROUP'].includes(unit.type) || typeof code !== 'string' || !/^[A-Za-z0-9._-]+$/.test(code)) {
      throw new Error('CSV 單位缺少合法的題號或題組代號。');
    }
    return `${unit.type === 'GROUP' ? 'G' : 'Q'}:${code}`;
  };
  const base = (unit, questionId) => [results.activityId, results.mode, exportId(unit), neutralizeFormula(questionId)];
  for (const unit of [...results.units].sort((a, b) => a.order - b.order)) {
    const submissions = [...(unit.submissions ?? [])].sort((a, b) => a.rank - b.rank);
    if (submissions.length === 0) {
      for (const question of [...unit.questions].sort((a, b) => a.order - b.order)) {
        rows.push([...base(unit, question.questionId), '', '', '', '', '', 'false']);
      }
      continue;
    }
    const questionOrder = new Map(unit.questions.map((q) => [q.questionId, q.order]));
    for (const submission of submissions) {
      const answers = [...submission.answers].sort((a, b) => (questionOrder.get(a.questionId) ?? 0) - (questionOrder.get(b.questionId) ?? 0));
      for (const answer of answers) {
        rows.push([...base(unit, answer.questionId), neutralizeFormula(submission.groupName), neutralizeFormula(answer.text),
          submission.acceptedAt, submission.acceptedOrder, submission.rank, submission.isWinner ? 'true' : 'false']);
      }
    }
  }
  return BOM + [CSV_COLUMNS, ...rows].map((row) => row.map(escapeField).join(',')).join(EOL) + EOL;
}
