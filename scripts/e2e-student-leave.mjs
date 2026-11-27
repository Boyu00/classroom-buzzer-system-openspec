// 真實無頭 Chrome／Edge 的準備中退出與重新加入流程；本機測試 fixture，不操作 Google Sheets。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { teacherClient, fixtureQuestion } from '../tests/http-helpers.js';
import { removeTestDirectory } from '../tests/helpers.js';

const executable = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p));
if (!executable) throw new Error('找不到 Chrome／Edge，請設定 CHROME_PATH。');
const directory = mkdtempSync(join(tmpdir(), 'classroom-leave-e2e-'));
const profile = join(directory, 'profile');
let runtime; let chrome; let socket; let passed = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, value) => { assert.ok(value, name); passed++; console.log(`PASS ${name}`); };
try {
  runtime = await startServer({ host: '127.0.0.1', port: 0, databasePath: join(directory, 'test.sqlite3') });
  const url = `http://127.0.0.1:${runtime.server.address().port}`;
  const teacher = await teacherClient(url);
  const activity = (await teacher.post('/api/activities', {})).result.data;
  await fixtureQuestion(runtime, activity.activityId);
  const base = `/api/activities/${activity.activityId}`;
  chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await delay(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map(); const exceptions = [];
  socket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(resolve => { const n = ++id; pending.set(n, resolve); socket.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async expression => {
    const message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (message.error || message.result.exceptionDetails) throw new Error('瀏覽器測試運算失敗');
    return message.result.result.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 120; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(50); }
    throw new Error(`等候畫面逾時：${expression}`);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: url + '/student.html' });
  await wait("document.querySelector('#join-panel') && !document.querySelector('#join-panel').hidden");
  check('未加入時不顯示退出入口', await evaluate("document.querySelector('#leave-group').hidden"));
  const joinGroup = async name => {
    await evaluate(`document.querySelector('#join-code').value=${JSON.stringify(activity.joinCode)}; document.querySelector('#group-name').value=${JSON.stringify(name)}; document.querySelector('#join-form').requestSubmit()`);
    await wait("!document.querySelector('#activity-panel').hidden && !document.querySelector('#leave-group').disabled");
  };
  await joinGroup('打錯組名');
  check('準備中顯示可操作的退出按鈕', await evaluate("!document.querySelector('#leave-group').hidden"));
  check('教師看到原組別', (await teacher.request(base + '/snapshot')).result.data.groups[0].groupName === '打錯組名');
  await evaluate("document.querySelector('#leave-group').click()");
  await wait("!document.querySelector('#join-panel').hidden && document.querySelector('#connection-status').textContent.includes('已退出')");
  check('退出後回到可加入畫面', await evaluate("!document.querySelector('#join-fields').disabled"));
  check('舊題目與活動畫面已清除', await evaluate("document.querySelector('#activity-panel').hidden && document.querySelector('#units').children.length===0"));
  check('重新確認的身分為匿名', await evaluate("fetch('/api/session').then(r=>r.json()).then(p=>p.data.role==='ANONYMOUS')"));
  check('教師名單移除原組', (await teacher.request(base + '/snapshot')).result.data.groups.length === 0);
  await send('Page.reload');
  await wait("document.querySelector('#join-panel') && !document.querySelector('#join-panel').hidden && !document.querySelector('#join-fields').disabled");
  check('退出後刷新不恢復舊組', await evaluate("document.querySelector('#activity-panel').hidden"));
  await joinGroup('更正組名');
  check('新組名成功加入', (await teacher.request(base + '/snapshot')).result.data.groups[0].groupName === '更正組名');
  await teacher.post(base + '/open', {});
  await wait("document.querySelector('#phase').textContent==='搶答中'");
  check('搶答中隱藏退出入口', await evaluate("document.querySelector('#leave-group').hidden"));
  const code = await evaluate("(async()=>{const s=(await(await fetch('/api/session')).json()).data;const r=await fetch('/api/student/leave',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrfToken},body:'{}'});return {status:r.status,code:(await r.json()).error?.code}})()");
  check('搶答中直接請求亦拒絕退出', code.status === 409 && code.code === 'INVALID_PHASE');
  await teacher.post(base + '/close', { confirmed: true });
  await wait("document.querySelector('#phase').textContent==='已結束'");
  check('已結束仍保留組別且不提供退出', await evaluate("document.querySelector('#leave-group').hidden && document.querySelector('#group-label').textContent.includes('更正組名')"));
  check('瀏覽器沒有未預期例外', exceptions.length === 0);
  console.log(`${passed}/${passed} 項通過（本機 fixture，非真實 Sheets）`);
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once('exit', resolve));
    chrome.kill(); await Promise.race([exited, delay(5000)]);
  }
  await runtime?.close();
  removeTestDirectory(directory);
}
