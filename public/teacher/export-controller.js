// 寫回面板的狀態與請求流程（不碰 DOM，方便在 Node 以可控制的回應順序測試）。
//
// 規則（review #40）：
// - 每個請求在送出前擷取「活動＋畫面世代」（gate.current()），回應、錯誤、finally 更新狀態前都要比對；
//   切換活動、登出或重新登入後抵達的舊回覆一律丟棄，不更新畫面、不顯示成功提示。
// - 同一種操作只接受最後一次請求的回覆（序號），避免連點造成的舊預覽覆蓋新預覽。
// - 寫回必須使用「預覽當下」的活動：預覽綁定 previewScope，寫回前確認仍在同一個活動與世代，否則不送出。
// - 切換活動或登出時 reset()：清除預覽、暫停編輯確認、歷史與最近結果。

import { sheetTitlesFrom } from './model.js';

export function createExportController({ api, gate, onChange = () => {} } = {}) {
  const state = { preview: null, previewScope: null, latest: null, history: [], confirmedPaused: false, loadedFor: null, sheetTitles: {} };
  let previewSeq = 0;
  let writeSeq = 0;
  let loadSeq = 0;
  const base = (id) => `/api/activities/${encodeURIComponent(id)}`;
  const emit = () => onChange(state);

  function clearTransient() {
    state.preview = null;
    state.previewScope = null;
    state.confirmedPaused = false;
  }

  /** 切換活動或登出：舊請求的回覆都會因為序號與範圍不符而被丟棄。 */
  function reset() {
    previewSeq += 1;
    writeSeq += 1;
    loadSeq += 1;
    clearTransient();
    state.latest = null;
    state.history = [];
    state.loadedFor = null;
    state.sheetTitles = {};
    emit();
  }

  async function load() {
    const scope = gate.current();
    if (!scope) return false;
    const stamp = (loadSeq += 1);
    state.loadedFor = scope.id;
    let exports;
    try {
      ({ exports } = await api.get(`${base(scope.id)}/exports`));
    } catch (error) {
      if (gate.same(scope) && stamp === loadSeq) state.loadedFor = null;
      if (!gate.same(scope)) return false;
      throw error;
    }
    if (!gate.same(scope) || stamp !== loadSeq) return false;
    state.history = exports;
    state.latest = exports[0] ?? state.latest;
    emit();
    return true;
  }

  /** 進入已結束畫面時載入一次歷史紀錄。 */
  function ensureLoaded() {
    const scope = gate.current();
    if (!scope || state.loadedFor === scope.id) return;
    state.loadedFor = scope.id;
    emit();
    load().catch(() => { if (gate.same(scope)) state.loadedFor = null; });
  }

  async function preview() {
    const scope = gate.current();
    if (!scope) return null;
    const stamp = (previewSeq += 1);
    clearTransient();
    emit();
    let data;
    try {
      data = await api.post(`${base(scope.id)}/export/preview`);
    } catch (error) {
      if (!gate.same(scope) || stamp !== previewSeq) return null; // 舊活動的錯誤不顯示在新畫面
      throw error;
    }
    if (!gate.same(scope) || stamp !== previewSeq) return null;
    state.preview = data;
    state.previewScope = scope;
    state.sheetTitles = { ...state.sheetTitles, ...sheetTitlesFrom(data) };
    emit();
    return data;
  }

  function setPaused(value) {
    state.confirmedPaused = Boolean(value);
    emit();
  }

  /**
   * 以「預覽當下的活動」送出寫回。回傳 { ok, stale }：
   * - stale：活動已切換、登出或預覽已失效，沒有送出（或回覆已被丟棄），呼叫端不可顯示成功提示。
   * 失敗（衝突、待核對、部分失敗）以拋出錯誤表示，逐題實況已放進 state.latest。
   */
  async function write() {
    const scope = state.previewScope;
    if (!scope || !gate.same(scope) || !state.preview?.canWrite || !state.confirmedPaused) {
      clearTransient();
      emit();
      return { ok: false, stale: true };
    }
    const stamp = (writeSeq += 1);
    let result;
    try {
      const view = await api.post(`${base(scope.id)}/export/write`, { confirmedPaused: true });
      if (gate.same(scope) && stamp === writeSeq) state.latest = view;
      result = { ok: gate.same(scope) && stamp === writeSeq, stale: !(gate.same(scope) && stamp === writeSeq) };
    } catch (error) {
      if (!gate.same(scope) || stamp !== writeSeq) return { ok: false, stale: true };
      // 失敗回應帶有逐題實況（衝突、待核對、部分失敗），一律保留，不可只留下錯誤訊息。
      if (error?.details?.items) state.latest = error.details;
      throw error;
    } finally {
      if (gate.same(scope) && stamp === writeSeq) {
        clearTransient();
        emit();
        await load().catch(() => {});
      }
    }
    return result;
  }

  return { state, reset, load, ensureLoaded, preview, setPaused, write };
}
