import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { closeConformanceBrowser } from './conformance-browser.mjs';
import { conformanceFingerprint, validateConformanceCheckpoint } from './conformance-run-state.mjs';
import { installConformanceBridge } from '../tests/fixtures/conformance-init.ts';

const { values } = parseArgs({ options: {
  backend: { type: 'string', default: 'all' },
  output: { type: 'string', default: 'artifacts/conformance/baseline' },
  port: { type: 'string', default: '4175' },
  start: { type: 'string', default: '0' },
  count: { type: 'string' },
  include: { type: 'string' },
  'batch-size': { type: 'string', default: '32' },
  'timeout-ms': { type: 'string', default: '20000' },
  'hard-timeout-ms': { type: 'string', default: '600000' },
  fresh: { type: 'boolean', default: false },
  screenshots: { type: 'boolean', default: false },
  'wait-unsupported': { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} });
if (values.help) {
  console.log('pnpm conformance:run [--backend native|js|rust|all] [--output directory] [--include regex] [--start index] [--count entries] [--batch-size 32] [--timeout-ms 20000] [--hard-timeout-ms 600000] [--screenshots] [--wait-unsupported] [--fresh]');
  process.exit(0);
}
function integer(name, fallback) {
  const value = values[name] === undefined ? fallback : Number(values[name]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid --${name}.`);
  return value;
}
const settings = {
  port: integer('port'), start: integer('start'), count: integer('count', Number.MAX_SAFE_INTEGER),
  batchSize: integer('batch-size'), timeoutMs: integer('timeout-ms'),
  hardTimeoutMs: integer('hard-timeout-ms'), include: values.include ?? null,
};
if (!settings.batchSize || !settings.timeoutMs || !settings.hardTimeoutMs) throw new Error('Batch size and timeouts must be positive.');
const backends = values.backend === 'all' ? ['native', 'js', 'rust'] : [values.backend];
if (backends.some(backend => !['native', 'js', 'rust'].includes(backend))) throw new Error('Unknown conformance backend.');
const include = values.include ? new RegExp(values.include) : null;
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const sources = JSON.parse(await readFile('artifacts/conformance/sources.json', 'utf8'));
const hashes = {};
for (const file of ['artifacts/compiler/compiler.wasm', 'artifacts/core-wasm/refral_core.wasm',
  'tests/fixtures/conformance.html', 'tests/fixtures/conformance.ts', 'tests/fixtures/conformance-init.ts', 'tests/fixtures/conformance-worker.ts', 'tools/conformance-assets.ts']) {
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
}
async function hashRuntime(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await hashRuntime(file);
    else if (entry.isFile()) hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
}
for (const name of ['core-api', 'core-js', 'core-wasm', 'browser-host', 'webgl', 'compiler']) {
  await hashRuntime(`packages/${name}/src`);
}
for (const file of ['tools/conformance-run.mjs', 'tools/conformance-run-state.mjs', 'tools/conformance-browser.mjs', 'packages/compiler/profile-limits.json']) {
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
}
const runtimeRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const playwrightVersion = JSON.parse(await readFile('node_modules/@playwright/test/package.json', 'utf8')).version;
const configuration = { runtimeRevision, playwrightVersion, revision: sources.revision, version: '1.0.4', headless: true,
  channel: 'chrome', deviceScaleFactor: 1, frames: 1, slowTests: true,
  screenshots: values.screenshots,
  abortUnsupported: !values['wait-unsupported'], unsupportedGraceMs: 100,
  timeoutMs: settings.timeoutMs, hardTimeoutMs: settings.hardTimeoutMs, hashes };

const serverLog = createWriteStream(join(output, 'server.log'), { flags: 'a' });
await once(serverLog, 'open');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
  '--port', String(settings.port), '--strictPort'], {
  env: { ...process.env, REFRAL_TEST: '1', REFRAL_HEADLESS: '1' }, stdio: ['ignore', serverLog, serverLog],
});
const origin = `http://127.0.0.1:${settings.port}`;
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
async function withDeadline(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function writeJson(file, value) {
  const temporary = file + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, file);
}

function intersectClip(first, second) {
  const x = Math.ceil(Math.max(first.x, second.x));
  const y = Math.ceil(Math.max(first.y, second.y));
  const right = Math.floor(Math.min(first.x + first.width, second.x + second.width));
  const bottom = Math.floor(Math.min(first.y + first.height, second.y + second.height));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

async function captureCasePage(page, url, running = false) {
  const runnerUrl = `${origin}/third_party/cts/sdk/tests/webgl-conformance-tests.html`;
  const runner = page.frames().find(frame => frame.url().split('?')[0] === runnerUrl);
  const expected = new URL(url, runnerUrl);
  const frame = runner?.childFrames().find(candidate => {
    const current = new URL(candidate.url());
    return current.origin === expected.origin && current.pathname === expected.pathname;
  });
  if (!frame) return { kind: 'runner-page', bytes: await page.screenshot({ timeout: 3000 }) };

  const panel = runner.locator('#iframe-container');
  const saved = await panel.evaluate(element => {
    const style = element.getAttribute('style');
    element.style.transition = 'none';
    element.style.left = '10%';
    return style;
  }, undefined, { timeout: 1000 });
  try {
    const viewport = { x: 0, y: 0, ...page.viewportSize() };
    const iframe = await frame.frameElement();
    const frameBox = await iframe.boundingBox();
    const frameClip = frameBox && intersectClip(frameBox, viewport);
    if (!frameClip) return { kind: 'runner-page', bytes: await page.screenshot({ timeout: 3000 }) };
    if (running) {
      // Capture the known case rectangle before inspecting DOM nodes inside a busy renderer.
      const cdp = await withDeadline(page.context().newCDPSession(page), 2000, 'Case screenshot transport unavailable.');
      try {
        const { data } = await withDeadline(cdp.send('Page.captureScreenshot', {
          format: 'png', clip: { ...frameClip, scale: 1 },
        }), 3000, 'Case compositor screenshot timed out.');
        if (frame.isDetached() || new URL(frame.url()).pathname !== expected.pathname) {
          throw new Error('The case frame navigated during its in-flight screenshot.');
        }
        return { kind: 'case-page', bytes: Buffer.from(data, 'base64') };
      } finally { void cdp.detach().catch(() => {}); }
    }
    const canvases = frame.locator('canvas');
    const candidate = await canvases.evaluateAll(elements => {
      let selected = null;
      for (const [index, element] of elements.entries()) {
        if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const rect = element.getBoundingClientRect();
        const width = Math.min(innerWidth, rect.right) - Math.max(0, rect.left);
        const height = Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top);
        if (width < 1 || height < 1) continue;
        const area = width * height;
        if (!selected || area > selected.area) selected = { index, area, id: element.id };
      }
      return selected;
    });
    const canvasBox = candidate && await canvases.nth(candidate.index).boundingBox({ timeout: 1000 });
    const canvasClip = canvasBox && intersectClip(canvasBox, frameClip);
    const canvas = canvasClip && { id: candidate.id || String(candidate.index + 1),
      x: canvasClip.x - frameClip.x, y: canvasClip.y - frameClip.y,
      width: canvasClip.width, height: canvasClip.height };
    const bytes = await page.screenshot({ clip: frameClip, timeout: 3000 });
    return { kind: 'case-page', bytes, ...(canvas ? { canvas } : {}) };
  } finally {
    await panel.evaluate((element, style) => {
      if (style === null) element.removeAttribute('style');
      else element.setAttribute('style', style);
    }, saved, { timeout: 1000 }).catch(() => {});
  }
}

async function saveCaseScreenshot(page, backend, index, url, attempt) {
  try {
    let image;
    try {
      image = await withDeadline(captureCasePage(page, url, typeof attempt === 'string'), 10_000, 'Conformance screenshot exceeded its deadline.');
    } catch (error) {
      // The compositor can still expose a viewport while the case JavaScript is stalled.
      const cdp = await withDeadline(page.context().newCDPSession(page), 2000, 'Screenshot transport unavailable.');
      try {
        const capture = await withDeadline(cdp.send('Page.captureScreenshot', { format: 'png' }), 3000,
          'Compositor screenshot timed out.');
        image = { bytes: Buffer.from(capture.data, 'base64'), kind: 'runner-page', fallbackReason: String(error) };
      } finally { void cdp.detach().catch(() => {}); }
    }
    const { bytes, ...capture } = image;
    const suffix = attempt ? '-attempt-' + attempt : '';
    const relative = `${backend}/screenshots/${String(index).padStart(4, '0')}${suffix}.png`;
    await writeFile(join(output, relative), bytes);
    if (attempt && capture.kind !== 'case-page') {
      return { kind: 'unavailable', message: 'Only the runner viewport could be captured.', viewportFile: relative };
    }
    return { ...capture, file: relative, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } catch (error) {
    return { kind: 'unavailable', message: error.message };
  }
}

let browser;
let ownedServer;
let currentLaunch;
let browserClose;
let launchHistory = [];
let stopSignal = null;
let expectedBrowserVersion = null;
function requestStop(signal) {
  stopSignal = signal;
  void closeBrowser().catch(error => console.error(error.message));
}
const stopInterrupt = () => requestStop('SIGINT');
const stopTerminate = () => requestStop('SIGTERM');
process.on('SIGINT', stopInterrupt);
process.on('SIGTERM', stopTerminate);
async function openBrowser() {
  ownedServer = await chromium.launchServer({
    host: '127.0.0.1', channel: 'chrome', headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
  });
  const child = ownedServer.process();
  currentLaunch = { recordedAt: new Date().toISOString(), pid: child.pid,
    launchCommandLine: child.spawnargs.join(' '), launchArguments: child.spawnargs };
  launchHistory.push(currentLaunch);
  if (stopSignal) return;
  browser = await chromium.connect(ownedServer.wsEndpoint(), { timeout: 30_000 });
  currentLaunch.browserVersion = browser.version();
  if (expectedBrowserVersion && browser.version() !== expectedBrowserVersion) {
    throw new Error('Installed Chrome changed version during the baseline. Use a new output directory.');
  }
}
async function closeBrowser() {
  if (!ownedServer) return;
  browserClose ??= closeConformanceBrowser(ownedServer, currentLaunch, withDeadline).then(() => {
    browser = null;
    ownedServer = null;
  }).finally(() => { browserClose = null; });
  await browserClose;
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (server.exitCode !== null) throw new Error('Conformance server exited. Check server.log.');
    try { ready = (await fetch(`${origin}/tests/fixtures/conformance.html`)).ok; } catch { /* Server is starting. */ }
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error('Conformance server did not become ready.');
  for (const backend of backends) {
    if (stopSignal) break;
    const directory = join(output, backend);
    await mkdir(directory, { recursive: true });
    if (values.screenshots) await mkdir(join(directory, 'screenshots'), { recursive: true });
    const file = join(directory, 'results.json');
    const records = new Map();
    let inventory;
    let environment;
    let resumed = false;
    const attempts = new Map();
    const recovery = [];
    launchHistory = [];
    expectedBrowserVersion = null;
    await openBrowser();
    if (stopSignal) break;
    expectedBrowserVersion = browser.version();
    const fingerprint = conformanceFingerprint(configuration, browser.version());
    if (!values.fresh) {
      try {
        const previous = JSON.parse(await readFile(file, 'utf8'));
        validateConformanceCheckpoint(previous, backend, fingerprint);
        inventory = previous.inventory;
        environment = previous.environment;
        for (const record of previous.results) records.set(record.index, record);
        recovery.push(...(previous.recovery ?? []));
        for (const item of recovery) {
          if (Number.isInteger(item.index) && Number.isInteger(item.attempt)) {
            attempts.set(item.index, Math.max(attempts.get(item.index) ?? 0, item.attempt));
          }
        }
        launchHistory.unshift(...(previous.environment.launchHistory ?? []));
        resumed = true;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    environment = { ...environment, backend, browserVersion: browser.version(), runtimeRevision,
      configuration, launchHistory };
    async function checkpoint() {
      await writeJson(file, { recordedAt: new Date().toISOString(), fingerprint, backend,
        environment, sourceManifest: 'artifacts/conformance/sources.json', inventory,
        results: [...records.values()].sort((a, b) => a.index - b.index), recovery });
    }
    function pendingIndices() {
      if (!inventory) return [];
      return inventory.flatMap((url, index) => index >= settings.start
        && index - settings.start < settings.count && (!include || include.test(url))
        && !records.has(index) ? [index] : []);
    }
    let first = true;
    let initializationFailures = 0;
    while (!stopSignal && (first || pendingIndices().length)) {
      first = false;
      let context;
      let page;
      let activeIndex = null;
      let activeStarted = Date.now();
      let eventResults = [];
      const diagnostics = [];
      const lateDiagnostics = new Map();
      let lateChanged = false;
      let batch;
      let completedBatch = false;
      const partials = new Map();
      const runningCaptures = new Map();
      try {
        context = await withDeadline(browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 }),
          30_000, 'Chrome context initialization timed out.');
        await withDeadline(context.addInitScript(installConformanceBridge, { backend }), 30_000, 'Chrome init script timed out.');
        page = await withDeadline(context.newPage(), 30_000, 'Chrome page creation timed out.');
        page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
        page.on('pageerror', error => diagnostics.push({ index: activeIndex, kind: 'page', name: error.name, message: error.message }));
        page.on('requestfailed', request => diagnostics.push({ index: activeIndex, kind: 'request',
          name: 'RequestFailure', message: request.failure()?.errorText ?? '', url: request.url() }));
        page.on('response', response => {
          if (response.status() >= 400) diagnostics.push({ index: activeIndex, kind: 'response',
            name: 'HTTPError', message: `HTTP ${response.status()}`, url: response.url() });
        });
        if (values.screenshots) {
          await page.exposeFunction('__refralConformanceCapture', async ({ index, url }) => {
            if (!batch?.includes(index) || inventory?.[index] !== url) {
              throw new Error('Conformance screenshot identity mismatch.');
            }
            await runningCaptures.get(index);
            return saveCaseScreenshot(page, backend, index, url);
          });
        }
        await page.exposeFunction('__refralConformanceEvent', event => {
          if (event.type === 'start') { activeIndex = event.index; activeStarted = Date.now(); }
          if (event.type === 'finish') eventResults.push(event.result);
          if (event.type === 'partial' && batch?.includes(event.index) && inventory?.[event.index] === event.url) {
            partials.set(event.index, event.observation);
            // A renderer that stalled once can become unavailable before its final screenshot.
            // Capture one identified in-flight view on its retry, keeping the final capture separate.
            const previous = attempts.get(event.index);
            if (values.screenshots && previous && !event.observation.upstreamCompletion && !runningCaptures.has(event.index)) {
              const elapsedMsAtRequest = Date.now() - activeStarted;
              const { passed, failed } = event.observation;
              runningCaptures.set(event.index, saveCaseScreenshot(page, backend, event.index, event.url, (previous + 1) + '-running')
                .then(capture => ({ ...capture, phase: 'running', elapsedMsAtRequest, passed, failed })));
            }
          }
          if (event.type === 'late-diagnostic' && inventory?.[event.index] === event.url) {
            const values = lateDiagnostics.get(event.index) ?? [];
            values.push(event.diagnostic);
            lateDiagnostics.set(event.index, values);
            const result = records.get(event.index);
            if (result) {
              result.lateDiagnostics ??= [];
              if (!result.lateDiagnostics.some(value => JSON.stringify(value) === JSON.stringify(event.diagnostic))) {
                result.lateDiagnostics.push(event.diagnostic);
                lateChanged = true;
              }
            }
          }
        });
        await page.goto(`${origin}/tests/fixtures/conformance.html?backend=${backend}&timeoutMs=${settings.timeoutMs}&abortUnsupported=${values['wait-unsupported'] ? 0 : 1}`, { timeout: 90_000 });
        await page.waitForFunction(() => window.conformanceSession !== undefined, null, { timeout: 90_000 });
        const currentInventory = await withDeadline(page.evaluate(() => window.conformanceSession.ready()), 120_000, 'Official inventory initialization timeout.');
        if (inventory && JSON.stringify(inventory) !== JSON.stringify(currentInventory)) throw new Error('Official inventory changed during the run.');
        inventory = currentInventory;
        initializationFailures = 0;
        await writeJson(join(output, 'inventory.json'), { revision: sources.revision, version: '1.0.4', urls: inventory });
        const pending = pendingIndices();
        if (!pending.length) { completedBatch = true; break; }
        const start = pending[0];
        batch = [start];
        for (let i = 1; i < Math.min(settings.batchSize, pending.length); i++) {
          if (pending[i] !== start + i) break;
          batch.push(pending[i]);
        }
        activeIndex = start;
        activeStarted = Date.now();
        await withDeadline(page.evaluate(({ start, count }) => window.conformanceSession.run({ start, count }),
          { start, count: batch.length }), 30_000, 'Conformance page stopped responding.');
        while (!stopSignal) {
          const snapshot = await withDeadline(page.evaluate(() => ({
            progress: window.conformanceSession.progress, results: window.conformanceSession.results, partial: window.conformanceSession.partial,
          })), 30_000, 'Conformance page stopped responding.');
          const partial = snapshot.partial;
          if (partial && inventory[partial.index] === partial.url && !partials.get(partial.index)?.upstreamCompletion) {
            partials.set(partial.index, partial.observation);
          }
          const received = [...eventResults, ...snapshot.results];
          eventResults = [];
          let changed = lateChanged;
          lateChanged = false;
          for (const result of received) {
            if (records.has(result.index)) continue;
            const late = lateDiagnostics.get(result.index);
            if (late?.length) result.lateDiagnostics = [...(result.lateDiagnostics ?? []), ...late];
            if (inventory[result.index] !== result.url || result.backend !== backend) throw new Error('Conformance result identity mismatch.');
            result.browserDiagnostics = diagnostics.filter(item => item.index === result.index);
            records.set(result.index, result);
            changed = true;
            console.log(`[${backend}] ${records.size}/${inventory.length} ${result.index} ${result.status} ${result.url} (${result.passed}/${result.failed}/${result.skipped})`);
          }
          if (changed) await checkpoint();
          if (snapshot.progress.activeIndex !== null && snapshot.progress.activeIndex !== activeIndex) {
            activeIndex = snapshot.progress.activeIndex;
            activeStarted = Date.now();
          }
          if (batch.every(index => records.has(index))) { completedBatch = true; break; }
          if (Date.now() - activeStarted > settings.hardTimeoutMs) throw new Error('Conformance case exceeded hard deadline.');
          await delay(500);
        }
      } catch (error) {
        for (const result of eventResults) {
          if (inventory?.[result.index] === result.url && result.backend === backend) records.set(result.index, result);
        }
        if (stopSignal) {
          if (inventory) await checkpoint();
          break;
        }
        if (!batch) {
          initializationFailures++;
          first = true;
          recovery.push({ phase: 'runner-initialization', attempt: initializationFailures,
            error: String(error), recordedAt: new Date().toISOString() });
          if (initializationFailures >= 3) throw error;
          console.log(`[${backend}] restarting runner initialization: ${error.message}`);
          if (inventory) await checkpoint();
        } else if (batch.some(index => !records.has(index))) {
          initializationFailures = 0;
          const failedIndex = batch.find(index => !records.has(index));
          if (failedIndex === null || failedIndex === undefined) throw error;
          const failures = (attempts.get(failedIndex) ?? 0) + 1;
          attempts.set(failedIndex, failures);
          const url = inventory[failedIndex];
          const observation = partials.get(failedIndex);
          const durationMs = Date.now() - activeStarted;
          const runningCapture = await runningCaptures.get(failedIndex);
          const finalCapture = values.screenshots ? await saveCaseScreenshot(page, backend, failedIndex, url, failures) : undefined;
          const screenshot = finalCapture?.kind === 'unavailable' && runningCapture && runningCapture.kind !== 'unavailable'
            ? { ...runningCapture, phase: 'running', finalCaptureError: finalCapture.message } : finalCapture;
          const timedOut = error.message.includes('deadline') || error.message.includes('responding');
          const attempt = { index: failedIndex, url, attempt: failures, error: String(error), recordedAt: new Date().toISOString(),
            durationMs, ...(observation ? { observation } : {}), ...(screenshot ? { screenshot } : {}),
            ...(runningCapture ? { runningCapture } : {}) };
          recovery.push(attempt);
          console.log(`[${backend}] recovering ${failedIndex} attempt ${failures}: ${error.message}`);
          if (failures >= 2) {
            const completion = observation?.upstreamCompletion;
            records.set(failedIndex, {
              index: failedIndex, url, backend,
              status: completion ? (observation.upstreamStatus === 'pass' ? 'harness-error' : observation.upstreamStatus)
                : timedOut ? 'timeout' : 'harness-error',
              completion: completion ?? (timedOut ? 'timeout' : 'crash'), upstreamCompleted: completion === 'finished',
              passed: 0, failed: 0, skipped: 0, skippedFailures: 0, assertionTimeouts: 0, failures: [], failuresTruncated: 0,
              contexts: [], adapterGaps: [], ...observation,
              errors: [...(observation?.errors ?? []), { kind: 'recovery', name: error.name, message: error.message }],
              browserDiagnostics: diagnostics.filter(item => item.index === failedIndex), partialCountsUnavailable: !completion,
              durationMs: attempt.durationMs, ...(screenshot ? { screenshot } : {}),
            });
          }
          await checkpoint();
        } else {
          await checkpoint();
        }
      } finally {
        if (context) {
          try { await withDeadline(context.close(), 15_000, 'Closing conformance context timed out.'); }
          catch (error) {
            completedBatch = false;
            recovery.push({ phase: 'context-close', error: String(error), recordedAt: new Date().toISOString() });
          }
        }
      }
      if (!stopSignal && (!completedBatch || !browser.isConnected())) {
        await closeBrowser();
        await openBrowser();
      }
    }
    await closeBrowser();
    if (inventory) await checkpoint();
    console.log(`[${backend}] ${stopSignal ? 'stopped' : 'complete requested range'}; recorded ${records.size}/${inventory?.length ?? 0}${resumed ? ' with checkpoint reuse' : ''}.`);
  }
} finally {
  try {
    await closeBrowser();
  } finally {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([once(server, 'exit'), delay(5000)]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    serverLog.end();
    process.off('SIGINT', stopInterrupt);
    process.off('SIGTERM', stopTerminate);
    if (stopSignal) process.exitCode = stopSignal === 'SIGINT' ? 130 : 143;
  }
}
