const ID = /^[A-Za-z0-9_-]{20,}$/;

/**
 * 從教師輸入取出試算表 ID；只接受純 ID 或 https://docs.google.com/spreadsheets/d/<ID>/... 網址。
 * 只送出擷取到的 ID，不會轉發任意網址。
 * @returns {string | null}
 */
export function parseSpreadsheetRef(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (ID.test(text)) return text;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null;
  const match = /^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname);
  return match && ID.test(match[1]) ? match[1] : null;
}
