import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'artifacts/conformance/campaign/queue-completion');
await mkdir(directory, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${address.port}/tests/fixtures/runner.html`);
  for (const realm of ['window', 'worker']) {
    const result = await page.evaluate(async realm => {
      const url = new URL('/experiments/readback/queue-completion.ts', location.href).href;
      if (realm === 'window') return (await import(url)).measureQueueCompletion();
      const script = `import { measureQueueCompletion } from ${JSON.stringify(url)};
        measureQueueCompletion().then(value => postMessage({value}), error => postMessage({error: String(error)}));`;
      const workerURL = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
      const worker = new Worker(workerURL, { type: 'module' });
      try {
        return await new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.value);
          worker.onerror = error => reject(new Error(error.message));
        });
      } finally {
        worker.terminate();
        URL.revokeObjectURL(workerURL);
      }
    }, realm);
    const record = { realm, chrome: browser.version(), headless: true, ...result };
    await writeFile(resolve(directory, realm + '.json'), JSON.stringify(record, null, 2) + '\n');
    console.log(realm, record.adapter, record.samples.length);
  }
} finally {
  await browser?.close();
  await server.close();
}
