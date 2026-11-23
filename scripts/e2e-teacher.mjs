// 以真實 Chrome（headless，Chrome DevTools Protocol）走完整個教師流程；Google Sheets 以記憶體替身取代。
// 用法：node scripts/e2e-teacher.mjs [--shots <截圖資料夾>]
// 環境變數 CHROME_PATH 可指定瀏覽器；預設使用 Windows 常見的 Chrome／Edge 安裝路徑。
// 這是人工驗收前的自動化輔助，不取代真實線上 Sheets 驗收（AC-01、AC-03）。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { removeTestDirectory } from '../tests/helpers.js';
import { httpClient } from '../tests/http-helpers.js';

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('找不到 Chrome 或 Edge，請設定 CHROME_PATH。');
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const PASSWORD = 'e2e-only-password-密碼';
const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
const SHEET_ID = 's'.repeat(44);

// 記憶體 Sheets 替身：兩張工作表，共 4 題、3 個單位（單題 1、題組 X 跨兩表、單題 4）。
function blank() { return Array.from({ length: 12 }, () => Array(6).fill('')); }
const sheetData = {
  0: { title: '第一頁', cells: (() => { const c = blank(); c[2][1] = '{{Q:1}}'; c[5][1] = '{{Q:2|G:X}}'; return c; })() },
  5: { title: '第二頁', cells: (() => { const c = blank(); c[1][2] = '{{Q:3|G:X}}'; c[4][2] = '{{Q:4}}'; return c; })() },
};
const gateway = {
  serviceAccountEmail: 'e2e-demo@example.iam.gserviceaccount.com',
  async listSheets() {
    return { spreadsheetId: SHEET_ID, title: '示範試算表', sheets: Object.entries(sheetData).map(([id, s], index) => ({ sheetId: Number(id), title: s.title, index })) };
  },
  async readSheets({ sheetIds }) {
    return sheetIds.map((id) => ({ spreadsheetId: SHEET_ID, sheetId: id, title: sheetData[id].title, rowCount: 12, columnCount: 6, cells: sheetData[id].cells, merges: [] }));
  },
};

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${detail}`}`);
}

const profile = mkdtempSync(join(tmpdir(), 'classroom-e2e-'));
const dbDir = mkdtempSync(join(tmpdir(), 'classroom-e2e-db-'));
let runtime;
let chrome;
let socket;

async function main() {
  runtime = await startServer({ host: '127.0.0.1', port: 0, databasePath: join(dbDir, 'e2e.sqlite3') }, { sheetsGateway: gateway });
  const base = `http://127.0.0.1:${runtime.server.address().port}`;

  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
    '--remote-debugging-port=0', '--window-size=1200,1400', 'about:blank'], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i += 1) await new Promise((r) => setTimeout(r, 100));
  const [port] = readFileSync(portFile, 'utf8').split('\n');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

  let nextId = 0;
  const pending = new Map();
  const browserLog = [];
  const heldRequests = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Fetch.requestPaused') heldRequests.push(message.params.requestId);
    if (message.method === "Runtime.exceptionThrown") browserLog.push(`例外：${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
    if (message.method === "Runtime.consoleAPICalled") browserLog.push(`console.${message.params.type}：${message.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    if (message.method === "Log.entryAdded") browserLog.push(`${message.params.entry.level}：${message.params.entry.text} ${message.params.entry.url ?? ""}`);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? '評估失敗');
    return result.result.value;
  };
  const waitFor = async (expression, label, timeout = 6000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(`Boolean(${expression})`).catch(() => false)) return true;
      await new Promise((r) => setTimeout(r, 60));
    }
    const body = await evaluate("document.body.innerText.slice(0, 300)").catch(() => "");
    throw new Error(`逾時未出現：${label}
頁面內容：${body}
瀏覽器訊息：${browserLog.slice(-6).join(" | ")}`);
  };
  const shot = async (name) => {
    if (!shotsDir) return;
    const { result } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(result.data, 'base64'));
  };
  const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`);
  const setValue = (selector, value) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const clickByText = (label) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) throw new Error('找不到按鈕：${label}'); b.click(); })()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  const go = async (url) => { await send('Page.navigate', { url }); await waitFor("document.readyState === 'complete'", '頁面載入'); };

  // 1. 初次設定密碼
  await go(`${base}/teacher.html`);
  await waitFor("document.querySelector('#confirm')", '初次設定畫面');
  check('未設定密碼時顯示初次設定畫面', (await text('h2')).includes('初次設定教師密碼'));
  await shot('01-setup');
  await setValue('#password', 'short');
  await setValue('#confirm', 'short');
  await click('form button[type=submit]');
  await waitFor("!document.querySelector('#alert').hidden", '密碼過短提示');
  check('過短密碼被前端擋下並顯示提示', (await text('#alert')).includes('8～128'));
  await setValue('#password', PASSWORD);
  await setValue('#confirm', `${PASSWORD}x`);
  await click('form button[type=submit]');
  await waitFor("document.querySelector('#alert').innerText.includes('不一致')", '密碼不一致提示');
  check('兩次密碼不一致被擋下', true);
  await setValue('#confirm', PASSWORD);
  await click('form button[type=submit]');
  await waitFor("document.querySelector('#create-title')", '教師控制台');
  check('設定成功後進入教師控制台', (await text('h1')).includes('教師控制台'));

  // 2. 建立活動（公平模式）
  await evaluate("document.querySelector('input[name=create-mode][value=FAIR]').click()");
  await clickByText('建立新活動');
  await waitFor("document.querySelector('.code')?.innerText.length === 6", '加入碼');
  const joinCode = await text('.code');
  check('建立活動後顯示六碼加入碼', /^[A-HJ-NP-Z2-9]{6}$/.test(joinCode), joinCode);
  await waitFor("document.querySelector('#connection-status').innerText.includes('已連線')", 'SSE 已連線');
  check('SSE 已連線並顯示連線狀態', true);
  check('開啟按鈕在未匯入題目時停用', await evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent === '開啟搶答').disabled"));
  await shot('02-created');

  // 3. 匯入：讀取工作表 → 依序勾選（先第二頁再第一頁）→ 預覽 → 確認
  await setValue('#spreadsheet', `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
  await clickByText('讀取工作表');
  await waitFor("document.querySelectorAll('#sheet-list input[type=checkbox]').length === 2", '工作表清單');
  check('列出工作表並顯示服務帳戶 email', (await text('#sheet-list')).includes(gateway.serviceAccountEmail));
  await evaluate("document.querySelectorAll('#sheet-list input[type=checkbox]')[1].click()");
  await evaluate("document.querySelectorAll('#sheet-list input[type=checkbox]')[0].click()");
  check('掃描順序依勾選順序（第二頁為 1）', (await text('#sheet-list')).includes('掃描順序 1'));
  await clickByText('預覽匯入');
  await waitFor("document.querySelector('.preview-box table')", '匯入預覽');
  const preview = await text('.preview-box');
  check('預覽顯示 4 題、3 單位與原格位置', preview.includes('共 4 題、3 個單位') && preview.includes('第二頁!C2'), preview);
  await shot('03-preview');
  await clickByText('確認匯入');
  await waitFor("!document.querySelector('#notice').hidden", '匯入完成提示');
  await waitFor("document.querySelector('.facts')?.innerText.includes('3 個單位')", '快照更新題目數');
  check('確認後 SSE 更新題目數', true);
  check('開啟按鈕在匯入後啟用', await evaluate("![...document.querySelectorAll('button')].find((b) => b.textContent === '開啟搶答').disabled"));

  // 4. 學生加入（兩組）後開啟
  const students = [];
  for (const name of ['甲組', '乙組']) {
    const student = await httpClient(base);
    await student.refresh();
    const joined = await student.post('/api/join', { joinCode, groupName: name });
    if (joined.status !== 200) throw new Error(`學生加入失敗：${JSON.stringify(joined.result)}`);
    students.push(student);
  }
  await waitFor("document.querySelector('.chips')?.innerText.includes('甲組') && document.querySelector('.chips').innerText.includes('乙組')", '組別即時出現');
  check('學生加入後教師端即時看到組別', true);
  await clickByText('開啟搶答');
  await waitFor("document.querySelector('.facts')?.innerText.includes('搶答中')", '搶答中');
  check('開啟後階段變為搶答中，模式選項消失', !(await evaluate("Boolean(document.querySelector('input[name=activity-mode]'))")));
  check('開啟後不再顯示匯入面板', await evaluate("document.querySelector('#import-title').closest('section').hidden"));

  // 5. 學生送出（甲組送惡意字串、乙組答題組）→ 教師即時監看
  const view = (await students[0].request(`/api/activities/${(await students[0].refresh()).result.data.activityId}/snapshot`)).result.data;
  const single = view.units.find((u) => u.type === 'SINGLE');
  const group = view.units.find((u) => u.type === 'GROUP');
  const send1 = await students[0].post(`/api/activities/${view.activityId}/submissions`, { unitId: single.unitId, answers: [{ questionId: single.questions[0].questionId, text: XSS }] });
  const send2 = await students[1].post(`/api/activities/${view.activityId}/submissions`, { unitId: group.unitId, answers: group.questions.map((q) => ({ questionId: q.questionId, text: `乙組答案 ${q.questionId}` })) });
  check('學生送出被受理', send1.status === 200 && send2.status === 200, JSON.stringify([send1.result, send2.result]));
  await waitFor("document.querySelector('#monitor-title')?.closest('section').innerText.includes('乙組答案 2')", '監看顯示答案');
  const monitor = await text('#monitor-title ~ article, section:has(#monitor-title)');
  check('監看顯示各組答案與受理順序', monitor.includes('乙組答案 3') && monitor.includes('已送出'), monitor);
  check('公平模式顯示「結束時計算」，不標暫定勝出', monitor.includes('勝出者：結束時計算') && !monitor.includes('暫定勝出'));
  check('惡意字串以純文字顯示', monitor.includes('<img src=x') && monitor.includes('<script>'));
  check('畫面沒有殘留的 null 或 [object …] 文字', !/null|\[object/.test(await text('#app')), await text('#app'));
  check('惡意腳本沒有執行也沒有產生元素', (await evaluate('window.__xss === undefined && document.querySelectorAll("#app img, #app script").length === 0')));
  await shot('04-monitor');

  // 6. 重新整理後仍能找回活動
  await go(`${base}/teacher.html`);
  await waitFor("document.querySelector('.code')?.innerText === " + JSON.stringify(joinCode), '重新整理後找回活動');
  await waitFor("document.querySelector('#monitor-title')?.closest('section').innerText.includes('乙組答案 2')", '重新整理後監看資料');
  check('重新整理後自動找回進行中的活動與監看資料', true);

  // 7. 結束（需確認對話框）
  await clickByText('結束活動');
  await waitFor("document.querySelector('dialog').open", '確認對話框');
  check('結束前要求確認', (await text('dialog')).includes('無法復原'));
  await shot('05-confirm-dialog');
  await clickByText('取消');
  await waitFor("!document.querySelector('dialog').open", '對話框關閉');
  check('取消後活動仍在搶答中', (await text('.facts')).includes('搶答中'));
  await clickByText('結束活動');
  await clickByText('確認結束');
  await waitFor("document.querySelector('.facts')?.innerText.includes('已結束')", '已結束');
  const closed = await text('section:has(#monitor-title)');
  check('結束後顯示固定結果與勝出者', closed.includes('勝出') && closed.includes('甲組') && closed.includes('乙組'), closed);
  check('無人作答的單位明示', closed.includes('無人作答'));
  check('結束後可建立新活動', (await text('#create-title')).includes('建立活動'));

  // 結果頁與 CSV 是獨立功能：連結「出現與否」必須和端點是否存在一致（不存在時不能有會導向錯誤的連結）。
  await waitFor("document.querySelector('#closed-links')", '結束後連結區');
  await new Promise((r) => setTimeout(r, 400));
  const available = await evaluate(`(async () => {
    const id = (await (await fetch('/api/teacher/activity')).json()).data.activity.activityId;
    const page = await fetch('/results.html', { method: 'HEAD' });
    const csv = await fetch('/api/activities/' + id + '/results.csv', { method: 'HEAD' });
    return { id, page: page.ok && (page.headers.get('content-type') || '').includes('text/html'), csv: csv.ok && (csv.headers.get('content-type') || '').includes('text/csv') };
  })()`);
  const shown = await evaluate("[...document.querySelectorAll('#closed-links a')].map((a) => [a.textContent, a.getAttribute('href')])");
  const hasPageLink = shown.some(([label]) => label === '查看結果頁');
  const hasCsvLink = shown.some(([label]) => label === '下載 CSV');
  check(`結果頁連結與端點一致（端點${available.page ? '存在' : '不存在'}）`, hasPageLink === available.page, JSON.stringify([shown, available]));
  check(`CSV 連結與端點一致（端點${available.csv ? '存在' : '不存在'}）`, hasCsvLink === available.csv, JSON.stringify([shown, available]));
  if (available.page) check('結果頁連結指向正確的活動', shown.some(([, href]) => href === `/results.html?activityId=${available.id}`), JSON.stringify(shown));
  if (available.csv) {
    // 用位元組檢查 BOM：fetch().text() 解碼時會把 BOM 吃掉，無法用字串判斷。
    const csv = await evaluate(`(async () => { const r = await fetch('/api/activities/${available.id}/results.csv'); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, bom: b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF, text: new TextDecoder().decode(b) }; })()`);
    check('CSV 可下載，含 BOM、題號與學生答案', csv.status === 200 && csv.bom && csv.text.includes('activity_id') && csv.text.includes('乙組答案'), JSON.stringify(csv).slice(0, 200));
  }
  await shot('06-closed');

  // 8. 登出、錯誤密碼、重新登入
  await clickByText('登出');
  await waitFor("document.querySelector('#password') && !document.querySelector('#confirm')", '登入畫面');
  check('登出後回到登入畫面', true);
  await setValue('#password', 'wrong-password-xx');
  await click('form button[type=submit]');
  await waitFor("!document.querySelector('#alert').hidden", '錯誤密碼提示');
  check('錯誤密碼顯示提示且不進入控制台', (await text('#alert')).includes('錯誤') && !(await evaluate("Boolean(document.querySelector('#create-title'))")));
  await setValue('#password', PASSWORD);
  await click('form button[type=submit]');
  await waitFor("document.querySelector('.facts')?.innerText.includes('已結束')", '登入後找回已結束活動');
  check('重新登入後找回最近一場活動結果', true);

  // ===== #37 review：舊 HTTP 快照不得蓋掉較新的 SSE 狀態，也不得在切換活動後更新畫面 =====
  // 以頁面內的 fetch 閘門讓「/snapshot」回應延遲抵達，重現 A 指出的回應順序。
  const other = await httpClient(base);
  await other.refresh();
  if ((await other.post('/api/teacher/login', { password: PASSWORD })).status !== 200) throw new Error('第二個教師工作階段登入失敗');
  const seedQuestions = (id) => runtime.store.write(id, (db) => {
    db.prepare("INSERT INTO units VALUES (?, 'race-unit', 'SINGLE', 0)").run(id);
    db.prepare("INSERT INTO questions VALUES (?, 'race-unit', '1', 0, 'race-sheet', 0, 0, 0, '{{Q:1}}', 'race')").run(id);
  });
  const installGate = () => { heldRequests.length = 0; return send('Fetch.enable', { patterns: [{ urlPattern: '*/snapshot', requestStage: 'Response' }] }); };
  const waitHeld = async (count, label) => {
    const started = Date.now();
    while (heldRequests.length < count) {
      if (Date.now() - started > 6000) throw new Error(`逾時未攔到請求：${label}`);
      await new Promise((r) => setTimeout(r, 40));
    }
  };
  const releaseHeld = async () => {
    for (const requestId of heldRequests.splice(0)) await send('Fetch.continueResponse', { requestId });
    await send('Fetch.disable');
  };
  const currentActivityId = () => evaluate("fetch('/api/teacher/activity').then((r) => r.json()).then((j) => j.data.activity.activityId)");
  const newActivity = async () => {
    const previous = await text('.code');
    await clickByText('建立新活動');
    await waitFor("document.querySelector('.code') && document.querySelector('.facts')?.innerText.includes('準備中')", '新活動進入準備中');
    const id = await currentActivityId();
    await seedQuestions(id);
    await waitFor("document.querySelector('.facts')?.innerText.includes('1 個單位')", '快照顯示題目');
    return { id, code: await text('.code'), previous };
  };

  // 情境 1：舊的 OPEN HTTP 回應在 CLOSED SSE 之後才抵達
  const first = await newActivity();
  await installGate();
  await clickByText('開啟搶答');
  await waitHeld(1, '開啟後的快照請求');
  check('情境 1：開啟請求的快照回應被延遲（頁面尚未收到）', heldRequests.length === 1);
  const closeFirst = await other.post(`/api/activities/${first.id}/close`, { confirmed: true });
  if (closeFirst.status !== 200) throw new Error(`結束失敗：${JSON.stringify(closeFirst.result)}`);
  await waitFor("document.querySelector('.facts')?.innerText.includes('已結束')", 'SSE 送來 CLOSED');
  check('情境 1：SSE 先送到，畫面顯示已結束', true);
  await releaseHeld();
  await new Promise((r) => setTimeout(r, 400));
  check('情境 1：舊 OPEN 回應後到，畫面仍是已結束且沒有「結束活動」按鈕',
    (await text('.facts')).includes('已結束') && !(await evaluate("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '結束活動')")),
    await text('.facts'));

  // 情境 2：舊活動的 HTTP 回應在切換到新活動之後才抵達
  const second = await newActivity();
  await installGate();
  await clickByText('開啟搶答');
  await waitHeld(1, '第二個活動開啟後的快照請求');
  const closeSecond = await other.post(`/api/activities/${second.id}/close`, { confirmed: true });
  if (closeSecond.status !== 200) throw new Error(`結束失敗：${JSON.stringify(closeSecond.result)}`);
  await waitFor("document.querySelector('.facts')?.innerText.includes('已結束')", '第二個活動已結束');
  await clickByText('建立新活動');
  await waitFor("document.querySelector('.code') && document.querySelector('.facts')?.innerText.includes('準備中')", '切換到第三個活動');
  const third = await text('.code');
  check('情境 2：已切換到新活動（加入碼不同）', third !== second.code, `${third} / ${second.code}`);
  await releaseHeld();
  await new Promise((r) => setTimeout(r, 400));
  check('情境 2：舊活動的回應後到，畫面仍是新活動（加入碼、階段不變）',
    (await text('.code')) === third && (await text('.facts')).includes('準備中') && !(await text('.facts')).includes('搶答中'),
    `${await text('.code')} / ${await text('.facts')}`);
  check('回應順序測試後沒有未預期的瀏覽器例外', !browserLog.some((l) => l.startsWith('例外')), browserLog.join(' | '));
}

main().catch((error) => { check(`流程中斷：${error.message}`, false, error.stack); }).finally(async () => {
  try { socket?.close(); } catch { /* 忽略 */ }
  chrome?.kill();
  await runtime?.close().catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  for (const dir of [profile, dbDir]) { try { removeTestDirectory(dir); } catch { /* Chrome 可能仍佔用暫存檔 */ } }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 項通過`);
  process.exit(failed ? 1 : 0);
});
