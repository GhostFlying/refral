import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';

function compareImages(reference, candidate, tolerance, radius) {
  assert.equal(candidate.width, reference.width);
  assert.equal(candidate.height, reference.height);
  const difference = new PNG({ width: reference.width, height: reference.height });
  let differingPixels = 0;
  let unmatchedPixels = 0;
  for (let y = 0; y < reference.height; y++) {
    for (let x = 0; x < reference.width; x++) {
      const index = (y * reference.width + x) * 4;
      const matches = (otherX, otherY) => {
        if (otherX < 0 || otherY < 0 || otherX >= reference.width || otherY >= reference.height) return false;
        const other = (otherY * reference.width + otherX) * 4;
        return [0, 1, 2, 3].every(channel =>
          Math.abs(reference.data[other + channel] - candidate.data[index + channel]) <= tolerance);
      };
      for (let channel = 0; channel < 4; channel++) {
        difference.data[index + channel] = channel === 3 ? 255
          : Math.abs(reference.data[index + channel] - candidate.data[index + channel]);
      }
      if (matches(x, y)) continue;
      differingPixels++;
      let nearby = false;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) nearby ||= matches(x + dx, y + dy);
      }
      if (!nearby) unmatchedPixels++;
    }
  }
  return { differingPixels, unmatchedPixels, difference };
}

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
  const demos = [];
  const demoImages = new Map();
  for (const backend of ['native', 'refral', 'rust']) {
    await page.getByLabel('Demo backend').selectOption(backend);
    await page.getByRole('button', { name: 'Render to texture', exact: true }).click();
    await page.waitForFunction(() => ['Passed', 'Failed'].includes(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#status').innerText(), 'Passed', await page.locator('#report').innerText());
    const demo = JSON.parse(await page.locator('#report').innerText());
    const core = backend === 'refral' ? 'js' : backend;
    assert.equal(demo.backend, backend);
    assert.equal(demo.selectedCore, core);
    assert.equal(demo.error, 0);
    assert.deepEqual(demo.validationErrors, []);
    assert.ok(demo.nonWhitePixels > 100);
    for (const flag of ['alpha', 'depth', 'stencil', 'antialias', 'premultipliedAlpha', 'preserveDrawingBuffer']) {
      assert.equal(demo.environment.attributes[flag], demo.nativeReference.environment.attributes[flag], `${core} ${flag}`);
    }
    await page.locator('#gpu').evaluate(canvas => {
      canvas.style.border = '0';
      canvas.style.borderRadius = '0';
    });
    const pixels = await page.locator('#gpu').screenshot({ path: `artifacts/deployment/rtt-${core}.png` });
    demoImages.set(core, PNG.sync.read(pixels));
    demos.push(demo);
  }
  const demoComparisons = [];
  for (const [reference, candidate, tolerance, radius] of [
    ['native', 'js', 2, 1], ['native', 'rust', 2, 1], ['js', 'rust', 0, 0],
  ]) {
    const { difference, ...comparison } = compareImages(demoImages.get(reference), demoImages.get(candidate), tolerance, radius);
    await writeFile(`artifacts/deployment/rtt-${candidate}-${reference}-diff.png`, PNG.sync.write(difference));
    assert.equal(comparison.unmatchedPixels, 0, `${candidate}/${reference} built RTT pixels`);
    demoComparisons.push({ reference, candidate, tolerance, radius, ...comparison });
  }
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  const rustBuffer = await page.evaluate(async () => {
    const response = await fetch('/artifacts/core-wasm/refral_core.wasm');
    if (!response.ok) throw new Error(`Packaged Rust Wasm fetch failed: ${response.status}`);
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    const abi = instance.exports;
    const call = (name, ...args) => abi[name](...args);
    const version = call('rf_abi_version');
    const resourceProtocol = call('rf_resource_protocol_version');
    const initialized = call('rf_init', 1, 16);
    const slot = call('rf_create_buffer');
    const generation = call('rf_result_generation');
    call('rf_bind_buffer', 0x8892, 1, slot, generation);
    call('rf_buffer_data_size', 0x8892, 4, 0x88e4);
    const byteLength = call('rf_get_buffer_parameter', 0x8892, 0x8764);
    const error = call('rf_get_error');
    call('rf_dispose');
    return { version, resourceProtocol, initialized, slot, generation, byteLength, error };
  });
  assert.deepEqual(rustBuffer, { version: 3, resourceProtocol: 2, initialized: 1, slot: 1, generation: 1, byteLength: 4, error: 0 });
  await page.screenshot({ path: 'artifacts/deployment/chrome.png' });
  const triangles = [];
  for (const core of ['native', 'js', 'rust']) {
    await page.goto(`http://127.0.0.1:4174/examples/triangle/index.html?core=${core}`);
    await page.waitForFunction(expected => document.querySelector('#status').textContent === `${expected} · rendered`, core);
    const context = await page.evaluate(() => window.refralTriangle);
    assert.equal(context.selectedCore, core);
    assert.equal(context.ready, true);
    const screenshot = await page.locator('canvas').screenshot({ path: `artifacts/deployment/triangle-${core}.png` });
    const png = PNG.sync.read(screenshot);
    const center = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
    const centerPixel = Array.from(png.data.subarray(center, center + 4));
    assert.ok(centerPixel[0] + centerPixel[1] + centerPixel[2] > 150, `${core} triangle pixels`);
    triangles.push({ ...context, centerPixel });
  }
  assert.deepEqual(errors, []);
  const result = { recordedAt: new Date().toISOString(), url: page.url(), browserVersion: browser.version(), headless: process.env.REFRAL_HEADLESS === '1', viewport: page.viewportSize(), probe, demos, demoComparisons, rustBuffer, triangles, pageErrors: errors };
  await writeFile('artifacts/deployment/result.json', JSON.stringify(result, null, 2) + '\n');
  console.log('Built deployment passed Chrome probe, three-path render-to-texture and triangle pixels, packaged ABI v3/resource protocol v2 and page-error checks.');
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
