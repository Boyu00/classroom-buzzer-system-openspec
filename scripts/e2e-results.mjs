// 以真實 Chrome（headless，Chrome DevTools Protocol）驗證結果頁 /results.html 在各種身分下的行為。
// 用法：node scripts/e2e-results.mjs [--shots <截圖資料夾>]；CHROME_PATH 可指定瀏覽器。
// 使用記憶體 fixture 建立題目，不是線上 Sheets 驗收。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { removeTestDirectory } from '../tests/helpers.js';
import { httpClient, teacherClient } from '../tests/http-helpers.js';

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('找不到 Chrome 或 Edge，請設定 CHROME_PATH。');
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${detail}`}`); };
const profile = mkdtempSync(join(tmpdir(), 'classroom-e2e-'));
const dbDir = mkdtempSync(join(tmpdir(), 'classroom-e2e-db-'));
let runtime;
let chrome;
let socket;

async function main() {
  runtime = await startServer({ host: '127.0.0.1', port: 0, databasePath: join(dbDir, 'e2e.sqlite3') });
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  const teacher = await teacherClient(base);
  const created = (await teacher.post('/api/activities', { mode: 'FAIR' })).result.data;
  const id = created.activityId;
  await runtime.store.write(id, (db) => {
    const unit = db.prepare('INSERT INTO units VALUES (?, ?, ?, ?)');
    const question = db.prepare('INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    unit.run(id, 'single', 'SINGLE', 0); question.run(id, 'single', '1', 0, 'f', 0, 0, 0, '{{Q:1}}', 'f');
    unit.run(id, 'group', 'GROUP', 1);
    question.run(id, 'group', '2', 0, 'f', 0, 1, 0, '{{Q:2|G:X}}', 'f'); question.run(id, 'group', '3', 1, 'f', 0, 2, 0, '{{Q:3|G:X}}', 'f');
    unit.run(id, 'empty', 'SINGLE', 2); question.run(id, 'empty', '4', 0, 'f', 0, 3, 0, '{{Q:4}}', 'f');
  });
  const joinGroup = async (name) => {
    const student = await httpClient(base);
    await student.refresh();
    const result = await student.post('/api/join', { joinCode: created.joinCode, groupName: name });
    if (result.status !== 200) throw new Error(`加入失敗：${JSON.stringify(result.result)}`);
    return student;
  };
  const s1 = await joinGroup('甲組');
  const s2 = await joinGroup('乙組');
  await teacher.post(`/api/activities/${id}/open`, {});
  await s1.post(`/api/activities/${id}/submissions`, { unitId: 'single', answers: [{ questionId: '1', text: '甲組的答案\n第二行' }] });
  await s2.post(`/api/activities/${id}/submissions`, { unitId: 'group', answers: [{ questionId: '2', text: XSS }, { questionId: '3', text: '乙組第二題' }] });

  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
    '--remote-debugging-port=0', '--window-size=1100,1500', 'about:blank'], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i += 1) await new Promise((r) => setTimeout(r, 100));
  const [port] = readFileSync(portFile, 'utf8').split('\n');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const browserLog = [];
  socket.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') browserLog.push(`例外：${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  };
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++nextId; pending.set(i, resolve); socket.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? '評估失敗');
    return result.result.value;
  };
  const waitFor = async (expression, label, timeout = 6000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 60));
    }
    const page = (await evaluate('document.body.innerText.slice(0, 300)').catch(() => '')).replace(/\n+/g, ' / ');
    throw new Error(`逾時：${label}｜頁面：${page}｜瀏覽器：${browserLog.slice(-4).join(' | ')}`);
  };
  const shot = async (name) => {
    if (!shotsDir) return;
    const { result } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(result.data, 'base64'));
  };
  const text = (selector = '#content') => evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  // 以指定的 HTTP 用戶端身分（其 Cookie）開啟頁面；null 代表沒有任何 Cookie。
  const openAs = async (client, path) => {
    await send('Network.clearBrowserCookies');
    if (client) {
      const [name, value] = client.cookie.split('=');
      await send('Network.setCookie', { name, value, url: base, httpOnly: true, sameSite: 'Strict' });
    }
    await send('Page.navigate', { url: `${base}${path}` });
    await waitFor("document.readyState === 'complete'", '頁面載入');
  };
  const page = `/results.html?activityId=${id}`;

  // 1. 匿名、缺少活動 ID
  await openAs(null, page);
  await waitFor("document.querySelector('#content .notice')", '身分提示');
  check('匿名使用者看到需要確認身分，且有教師與學生入口', (await text()).includes('需要確認身分') && (await text()).includes('教師登入') && (await text()).includes('學生頁'));
  await openAs(teacher, '/results.html');
  await waitFor("document.querySelector('#content .notice')", '缺少活動提示');
  check('缺少 activityId 時明確提示', (await text()).includes('缺少活動'));

  // 2. 活動進行中：學生只看到「尚未結束」，沒有任何答案；結束後自動顯示結果
  await openAs(s1, page);
  await waitFor("document.querySelector('#content .notice')", '等待提示');
  const waiting = await text('main');
  check('活動進行中顯示尚未結束，且沒有任何組別答案', waiting.includes('活動尚未結束') && !waiting.includes('乙組') && !waiting.includes('甲組的答案'), waiting);
  await waitFor("document.querySelector('#connection-status').innerText.includes('已連線')", 'SSE 已連線');
  check('等待時已連上即時同步', true);
  await shot('01-waiting');
  await teacher.post(`/api/activities/${id}/close`, { confirmed: true });
  await waitFor("document.querySelector('#content .unit')", '結束後自動顯示結果', 5000);
  check('老師結束後，等待中的學生頁自動顯示結果（不需重新整理）', true);

  // 3. 學生視角
  const asStudent = await text();
  await shot('02-student-s1');
  check('顯示模式與固定結果說明', asStudent.includes('公平模式') && asStudent.includes('結果已固定'));
  check('各單位依順序列出，題組顯示所有題號', asStudent.indexOf('第 1 單位') < asStudent.indexOf('第 2 單位') && asStudent.includes('題 2、3'));
  check('可看到各組已受理答案（結束後公開）', asStudent.includes('甲組的答案') && asStudent.includes('乙組第二題'));
  check('答案換行保留', await evaluate("document.querySelector('.text').innerText.includes('\\n') || document.querySelector('.text').textContent.includes('\\n')"));
  check('惡意字串以純文字顯示且未執行', asStudent.includes('<img src=x') && await evaluate('window.__xss === undefined && document.querySelectorAll("#content img, #content script").length === 0'));
  check('無人作答的單位明示', asStudent.includes('無人作答'));
  check('勝出組別與順位標示', asStudent.includes('勝出組別：甲組') && (await evaluate("document.querySelectorAll('tr.winner').length")) === 2);
  check('學生看到自己的組別標示「你們這組」，且只有一處', (await evaluate("document.querySelectorAll('.own-badge').length")) === 1 && (await evaluate("document.querySelector('tr.own th').innerText")).includes('甲組'));
  check('學生沒有 CSV 下載，並有回學生作答頁連結', !asStudent.includes('下載 CSV') && asStudent.includes('回學生作答頁'));

  await openAs(s2, page);
  await waitFor("document.querySelector('#content .unit')", '乙組結果');
  check('另一組學生標示的是自己的組別', (await evaluate("document.querySelector('tr.own th').innerText")).includes('乙組'));

  // 4. 老師視角
  await openAs(teacher, page);
  await waitFor("document.querySelector('#content .unit')", '老師結果');
  const asTeacher = await text();
  await shot('03-teacher');
  check('老師看到全部結果，沒有「你們這組」，有回教師控制台連結', asTeacher.includes('甲組的答案') && !asTeacher.includes('你們這組') && asTeacher.includes('回教師控制台'));

  // 5. 其他活動的學生、不存在的活動
  const next = (await teacher.post('/api/activities', { mode: 'SPEED' })).result.data;
  const outsider = await httpClient(base);
  await outsider.refresh();
  await outsider.post('/api/join', { joinCode: next.joinCode, groupName: '外組' });
  await openAs(outsider, page);
  await waitFor("document.querySelector('#content .notice')", '無權限提示');
  const forbidden = await text('main');
  check('其他活動的學生被拒絕，看不到任何答案', forbidden.includes('無法查看') && !forbidden.includes('甲組的答案') && !forbidden.includes('乙組第二題'), forbidden);
  await openAs(teacher, '/results.html?activityId=does-not-exist');
  await waitFor("document.querySelector('#content .notice')", '找不到活動');
  check('不存在的活動顯示找不到', (await text()).includes('找不到活動'));

  const all = await text('main');
  check('畫面沒有殘留的 null 或 [object …] 文字', !/null|\[object/.test(all), all);
  check('無未預期的瀏覽器例外', !browserLog.some((l) => l.startsWith('例外')), browserLog.join(' | '));
}

main().catch((error) => { check(`流程中斷：${error.message}`, false, error.stack); }).finally(async () => {
  try { socket?.close(); } catch { /* 忽略 */ }
  chrome?.kill();
  await runtime?.close().catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  for (const dir of [profile, dbDir]) { try { removeTestDirectory(dir); } catch { /* Chrome 可能仍佔用暫存檔 */ } }
  console.log(`\n${results.filter(Boolean).length}/${results.length} 項通過`);
  process.exit(results.every(Boolean) ? 0 : 1);
});
