// 解析 Guided Notes 答案格標記：{{Q:題號}} 或 {{Q:題號|G:題組代號}}。
// 識別字限非空英數字、點、底線、連字號；大小寫區分（"1" 與 "01" 視為不同題號）。
const MARKER = /^\{\{Q:([A-Za-z0-9._-]+)(?:\|G:([A-Za-z0-9._-]+))?\}\}$/;

/**
 * @param {unknown} value 儲存格的完整文字
 * @returns {null | {ok: true, questionId: string, groupCode: string | null, marker: string}
 *                 | {ok: false, marker: string}}
 *   null：不是標記候選（一般內容，直接略過）。
 *   ok:false：以 {{ 開頭卻不合法；必須回報，不能默默少一題。
 */
export function parseMarker(value) {
  if (typeof value !== 'string') return null;
  const marker = value.trim();
  if (!marker.startsWith('{{')) return null;
  const match = MARKER.exec(marker);
  if (!match) return { ok: false, marker };
  return { ok: true, questionId: match[1], groupCode: match[2] ?? null, marker };
}
