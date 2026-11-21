import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openStore } from './storage/store.js';

// sheetsGateway 由 #13 提供真實 Sheets 讀取；測試可注入替身，產品不提供假匯入。
export async function startServer(config = loadConfig(), { sheetsGateway } = {}) {
  // 即使由其他模組呼叫，也不能改綁到公開介面。
  if (config.host !== '127.0.0.1') throw new Error('服務僅允許綁定 127.0.0.1。');
  const store = openStore(config.databasePath);
  const app = createApp({ store, sheetsGateway });
  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(config.port, config.host, () => resolve(listener));
      listener.once('error', reject);
    });
  } catch (error) {
    await store.close();
    throw error;
  }

  let closing;
  return {
    app,
    server,
    store,
    close() {
      closing ??= (async () => {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeIdleConnections();
        });
        await store.close();
      })();
      return closing;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const runtime = await startServer();
    console.log(`課堂搶答系統骨架：http://127.0.0.1:${runtime.server.address().port}`);
    console.log('教師驗證與活動控制 API 已提供；操作頁面、搶答、推播與 Sheets 功能待後續整合。');
    const shutdown = () => {
      runtime.close().catch(() => {
        console.error('關閉服務失敗。');
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    console.error(error.code === 'EADDRINUSE' ? '連接埠已被使用，請在 .env 調整 PORT。' : '啟動失敗，請檢查 Node.js 版本、PORT 及資料庫路徑與權限。');
    process.exitCode = 1;
  }
}
