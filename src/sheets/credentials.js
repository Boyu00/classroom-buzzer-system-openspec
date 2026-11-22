import { readFileSync } from 'node:fs';

/**
 * 讀取 repository 外的服務帳戶 JSON 金鑰。錯誤訊息刻意不含路徑與檔案內容，避免洩漏機密。
 * @returns {{ client_email: string, private_key: string }}
 */
export function loadCredentials(path) {
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('無法讀取服務帳戶憑證檔。');
  }
  if (json?.type !== 'service_account' || typeof json.client_email !== 'string' || !json.client_email
    || typeof json.private_key !== 'string' || !json.private_key.includes('PRIVATE KEY')) {
    throw new Error('憑證檔不是有效的服務帳戶金鑰。');
  }
  // 只取需要的欄位，其餘不保留在記憶體中的物件裡。
  return { client_email: json.client_email, private_key: json.private_key };
}
