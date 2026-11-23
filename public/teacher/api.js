export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// 同源 API 用戶端：自動帶 Cookie 與 CSRF token；setup／login／logout 後 token 會旋轉，
// 每次回應若含新的 csrfToken 就立即替換。
export function createApi({ fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  let csrfToken = '';
  async function call(method, path, body) {
    let response;
    try {
      response = await fetchImpl(path, {
        method,
        credentials: 'same-origin',
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', '無法連線到服務，請確認服務已啟動後再試。');
    }
    let payload = null;
    try { payload = await response.json(); } catch { /* 非 JSON 回應 */ }
    if (typeof payload?.data?.csrfToken === 'string') csrfToken = payload.data.csrfToken;
    if (!response.ok) {
      throw new ApiError(response.status, payload?.error?.code ?? 'UNKNOWN',
        payload?.error?.message ?? '操作失敗，請稍後再試。', payload?.error?.details);
    }
    return payload?.data ?? {};
  }
  return {
    get: (path) => call('GET', path),
    post: (path, body = {}) => call('POST', path, body),
    patch: (path, body = {}) => call('PATCH', path, body),
  };
}
