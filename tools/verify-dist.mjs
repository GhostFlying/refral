import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import assert from 'node:assert/strict';

await mkdir('artifacts/deployment', { recursive: true });
const log = createWriteStream('artifacts/deployment/preview.log');
await once(log, 'open');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: ['ignore', log, log] });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch('http://127.0.0.1:4174/examples/index.html')).ok; } catch { /* Preview is starting. */ }
    if (ready) break;
    if (server.exitCode !== null) throw new Error('Preview exited before serving the build. Check artifacts/deployment/preview.log.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Preview did not become available.');
  browser = await chromium.launch({ channel: 'chrome', headless: process.env.REFRAL_HEADLESS === '1' });
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/examples/index.html');
  assert.equal(await page.title(), 'Refral · Chrome validation');
  await page.getByRole('button', { name: 'Run GPU probe' }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Passed');
  const probe = JSON.parse(await page.locator('#report').innerText());
  assert.deepEqual(probe.validationErrors, []);
  await page.getByLabel('Demo backend').selectOption('refral');
  await page.getByRole('button', { name: 'Render to texture', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Passed');
  const demo = JSON.parse(await page.locator('#report').innerText());
  assert.equal(demo.backend, 'refral');
  assert.equal(demo.error, 0);
  assert.deepEqual(demo.validationErrors, []);
  assert.ok(demo.nonWhitePixels > 100);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  const rustBuffer = await page.evaluate(async () => {
    const response = await fetch('/artifacts/core-wasm/refral_core.wasm');
    if (!response.ok) throw new Error(`Packaged Rust Wasm fetch failed: ${response.status}`);
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    const abi = instance.exports;
    const call = (name, ...args) => abi[name](...args);
    const version = call('rf_abi_version');
    const initialized = call('rf_init', 1, 16);
    const slot = call('rf_create_buffer');
    const generation = call('rf_result_generation');
    call('rf_bind_buffer', 0x8892, 1, slot, generation);
    call('rf_buffer_data_size', 0x8892, 4, 0x88e4);
    const byteLength = call('rf_get_buffer_parameter', 0x8892, 0x8764);
    const error = call('rf_get_error');
    call('rf_dispose');
    return { version, initialized, slot, generation, byteLength, error };
  });
  assert.deepEqual(rustBuffer, { version: 1, initialized: 1, slot: 1, generation: 1, byteLength: 4, error: 0 });
  await page.screenshot({ path: 'artifacts/deployment/chrome.png' });
  const result = { recordedAt: new Date().toISOString(), url: page.url(), browserVersion: browser.version(), headless: process.env.REFRAL_HEADLESS === '1', viewport: page.viewportSize(), probe, demo, rustBuffer, pageErrors: errors };
  await writeFile('artifacts/deployment/result.json', JSON.stringify(result, null, 2) + '\n');
  console.log('Built deployment passed Chrome probe, compiler/demo rendering, packaged Rust Buffer ABI, controls and page-error checks.');
} finally {
  try { await browser?.close(); } finally {
    if (server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill('SIGTERM');
      await exited;
    }
    log.end();
  }
}
