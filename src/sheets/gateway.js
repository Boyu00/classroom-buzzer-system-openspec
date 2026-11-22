import { JWT } from 'google-auth-library';
import { HttpError } from '../http-error.js';
import { loadCredentials } from './credentials.js';
import { parseSpreadsheetRef } from './spreadsheet-id.js';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_BASE_URL = 'https://sheets.googleapis.com/v4';
const DEFAULT_TIMEOUT_MS = 15_000;
// 保護本機記憶體：預設 1,000 列 × 26 欄 = 26,000 格；遠大於課堂用表。
const MAX_CELLS_PER_SHEET = 200_000;
const MAX_CELLS_TOTAL = 500_000;

const META_FIELDS = 'spreadsheetId,properties.title,sheets.properties(sheetId,title,index,sheetType,gridProperties(rowCount,columnCount))';
const DATA_FIELDS = 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),merges,data(startRow,startColumn,rowData(values(formattedValue))))';

function reasonsOf(body) {
  const error = body?.error;
  return [...(error?.details ?? []).map((d) => d?.reason), ...(error?.errors ?? []).map((e) => e?.reason)].filter(Boolean);
}

/**
 * Google Sheets gateway。回傳資料格式見 docs/import-api.md；錯誤一律轉成 HttpError，
 * 訊息不含金鑰、token 或憑證路徑。
 *
 * @param {object} options
 * @param {{client_email: string, private_key: string}} options.credentials
 * @param {string} [options.baseUrl] 測試用；預設為 Google Sheets API。
 * @param {() => Promise<string>} [options.getAccessToken] 測試用；預設以服務帳戶金鑰取得 token。
 */
export function createSheetsGateway({ credentials, baseUrl = DEFAULT_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS,
  getAccessToken, fetchImpl = fetch } = {}) {
  const serviceAccountEmail = credentials.client_email;
  let client;
  const tokenSource = getAccessToken ?? (async () => {
    // 服務帳戶金鑰直接用 JWT 用戶端；library 會快取並在到期前自動更新 token。
    // transporterOptions.timeout 讓底層授權請求在期限到時真的被取消，不會留在背景。
    client ??= new JWT({
      email: credentials.client_email, key: credentials.private_key, scopes: [SCOPE],
      transporterOptions: { timeout: timeoutMs },
    });
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('empty token');
    return token;
  });

  // 取得（或更新）token 也必須有期限，否則授權卡住時，教師畫面會一直等待而 fetch 逾時完全沒機會生效。
  // 同一時間只保留一個進行中的授權請求並共用；逾時後釋放，下一次操作才重新嘗試，
  // 避免卡住的請求在背景無限制累積。
  let inflight = null;
  function acquireToken() {
    if (!inflight) {
      const entry = {};
      const release = () => { clearTimeout(entry.timer); if (inflight === entry) inflight = null; };
      entry.attempt = tokenSource();
      entry.attempt.then(release, release);
      entry.timer = setTimeout(release, timeoutMs);
      entry.timer.unref?.();
      inflight = entry;
    }
    return inflight.attempt;
  }

  const TOKEN_TIMEOUT = Symbol('token-timeout');
  async function tokenWithDeadline() {
    let timer;
    const deadline = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(TOKEN_TIMEOUT), timeoutMs); });
    try {
      return await Promise.race([acquireToken(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(path, { method = 'GET', body } = {}) {
    let token;
    try {
      token = await tokenWithDeadline();
    } catch (error) {
      const status = error?.response?.status ?? error?.status;
      if (status === 400 || status === 401) {
        throw new HttpError(503, 'SHEETS_AUTH_FAILED', '服務帳戶授權失敗，請確認金鑰有效且未被停用。');
      }
      const message = error === TOKEN_TIMEOUT ? 'Google 授權服務回應逾時，請稍後再試。' : '無法連線到 Google 授權服務，請檢查網路後再試。';
      throw new HttpError(502, 'SHEETS_UNAVAILABLE', message);
    }

    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new HttpError(502, 'SHEETS_UNAVAILABLE', '無法連線到 Google Sheets，請檢查網路後再試。');
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch { /* 非 JSON 回應，依狀態碼處理 */ }
    if (response.ok) {
      if (!payload) throw new HttpError(502, 'SHEETS_UNAVAILABLE', 'Google Sheets 回應格式不正確。');
      return payload;
    }

    const reasons = reasonsOf(payload);
    const status = response.status;
    if (status === 429 || reasons.includes('rateLimitExceeded') || reasons.includes('RATE_LIMIT_EXCEEDED')) {
      throw new HttpError(503, 'SHEETS_RATE_LIMITED', 'Google Sheets 目前請求過多，請稍後再試。');
    }
    if (status === 403 && (reasons.includes('SERVICE_DISABLED') || reasons.includes('accessNotConfigured'))) {
      throw new HttpError(503, 'SHEETS_API_DISABLED', '尚未在 Google Cloud 專案啟用 Google Sheets API。');
    }
    if (status === 403) {
      throw new HttpError(403, 'SHEETS_PERMISSION_DENIED',
        `沒有權限讀取此試算表，請將它分享給服務帳戶 ${serviceAccountEmail}（寫回結果需要編輯者權限）。`);
    }
    if (status === 401) throw new HttpError(503, 'SHEETS_AUTH_FAILED', '服務帳戶授權失敗，請確認金鑰有效且未被停用。');
    if (status === 404) throw new HttpError(404, 'SPREADSHEET_NOT_FOUND', '找不到此試算表，請確認網址或 ID。');
    if (status === 400) throw new HttpError(400, 'SHEETS_REQUEST_REJECTED', 'Google Sheets 拒絕此請求，請確認試算表與工作表選擇。');
    throw new HttpError(502, 'SHEETS_UNAVAILABLE', 'Google Sheets 暫時無法使用，請稍後再試。');
  }

  function resolveId(spreadsheet) {
    const id = parseSpreadsheetRef(spreadsheet);
    if (!id) throw new HttpError(400, 'INVALID_SPREADSHEET', '請提供有效的 Google Sheets 網址或 ID。');
    return id;
  }

  // 只列出一般表格工作表；圖表等非表格工作表沒有儲存格可供標記。
  async function describe(id) {
    const meta = await request(`/spreadsheets/${encodeURIComponent(id)}?fields=${encodeURIComponent(META_FIELDS)}`);
    const sheets = (meta.sheets ?? [])
      .map((s) => s.properties ?? {})
      .filter((p) => (p.sheetType ?? 'GRID') === 'GRID')
      .map((p) => ({
        sheetId: p.sheetId ?? 0, title: p.title ?? '', index: p.index ?? 0,
        rowCount: p.gridProperties?.rowCount ?? 0, columnCount: p.gridProperties?.columnCount ?? 0,
      }));
    return { spreadsheetId: meta.spreadsheetId ?? id, title: meta.properties?.title ?? '', sheets };
  }

  return {
    serviceAccountEmail,

    async listSheets({ spreadsheet }) {
      const info = await describe(resolveId(spreadsheet));
      return {
        spreadsheetId: info.spreadsheetId, title: info.title,
        sheets: info.sheets.map(({ sheetId, title, index }) => ({ sheetId, title, index })),
      };
    },

    /** @returns 依 sheetIds 順序排列的工作表（API 以試算表原順序回傳，這裡重新排序）。 */
    async readSheets({ spreadsheet, sheetIds }) {
      const id = resolveId(spreadsheet);
      const info = await describe(id);
      const known = new Map(info.sheets.map((s) => [s.sheetId, s]));
      if (!Array.isArray(sheetIds) || sheetIds.length === 0 || sheetIds.some((sheetId) => !known.has(sheetId))) {
        throw new HttpError(400, 'INVALID_SHEET_SELECTION', '所選工作表不存在，或不是一般表格工作表。');
      }
      let total = 0;
      for (const sheetId of sheetIds) {
        const { rowCount, columnCount } = known.get(sheetId);
        total += rowCount * columnCount;
        if (rowCount * columnCount > MAX_CELLS_PER_SHEET || total > MAX_CELLS_TOTAL) {
          throw new HttpError(400, 'SHEET_TOO_LARGE', '所選工作表範圍過大，請改用較小的工作表。');
        }
      }

      const data = await request(`/spreadsheets/${encodeURIComponent(id)}:getByDataFilter?fields=${encodeURIComponent(DATA_FIELDS)}`, {
        method: 'POST',
        body: { dataFilters: sheetIds.map((sheetId) => ({ gridRange: { sheetId } })), includeGridData: true },
      });

      const byId = new Map();
      for (const sheet of data.sheets ?? []) {
        const properties = sheet.properties ?? {};
        const sheetId = properties.sheetId ?? 0;
        const cells = [];
        for (const block of sheet.data ?? []) {
          (block.rowData ?? []).forEach((rowData, rowOffset) => {
            const row = (block.startRow ?? 0) + rowOffset;
            (rowData?.values ?? []).forEach((cell, columnOffset) => {
              const text = cell?.formattedValue;
              if (typeof text !== 'string' || text === '') return;
              (cells[row] ??= [])[(block.startColumn ?? 0) + columnOffset] = text;
            });
          });
        }
        for (let row = 0; row < cells.length; row += 1) cells[row] = Array.from(cells[row] ?? [], (v) => v ?? '');
        byId.set(sheetId, {
          spreadsheetId: id, sheetId, title: properties.title ?? '',
          rowCount: properties.gridProperties?.rowCount ?? 0, columnCount: properties.gridProperties?.columnCount ?? 0,
          cells: Array.from(cells, (row) => row ?? []),
          // Sheets API 會省略值為 0 的索引，需補預設值。
          merges: (sheet.merges ?? []).map((m) => ({
            startRow: m.startRowIndex ?? 0, endRow: m.endRowIndex ?? 0, startCol: m.startColumnIndex ?? 0, endCol: m.endColumnIndex ?? 0,
          })),
        });
      }
      return sheetIds.map((sheetId) => {
        const sheet = byId.get(sheetId);
        if (!sheet) throw new HttpError(502, 'SHEETS_UNAVAILABLE', 'Google Sheets 回應缺少所選工作表。');
        return sheet;
      });
    },
  };
}

/** 啟動時使用：未設定回傳 undefined；憑證無效只警告（不含路徑或內容），匯入時會回報尚未設定。 */
export function openSheetsGateway(credentialsPath, log = console) {
  if (!credentialsPath) return undefined;
  try {
    return createSheetsGateway({ credentials: loadCredentials(credentialsPath) });
  } catch {
    log.warn('Google Sheets 憑證無法使用，匯入功能將回報尚未設定；請檢查 GOOGLE_APPLICATION_CREDENTIALS。');
    return undefined;
  }
}
