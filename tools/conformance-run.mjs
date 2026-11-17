import { chromium } from '@playwright/test';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
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
  'wait-unsupported': { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} });
if (values.help) {
  console.log('pnpm conformance:run [--backend native|js|rust|all] [--output directory] [--include regex] [--start index] [--count entries] [--batch-size 32] [--timeout-ms 20000] [--hard-timeout-ms 600000] [--wait-unsupported] [--fresh]');
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
  'tests/fixtures/conformance.html', 'tests/fixtures/conformance.ts', 'tests/fixtures/conformance-init.ts', 'tools/conformance-assets.ts']) {
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
for (const file of ['tools/conformance-run.mjs', 'tools/conformance-run-state.mjs', 'packages/compiler/profile-limits.json']) {
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
}
const runtimeRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const playwrightVersion = JSON.parse(await readFile('node_modules/@playwright/test/package.json', 'utf8')).version;
const configuration = { runtimeRevision, playwrightVersion, revision: sources.revision, version: '1.0.4', headless: true,
  channel: 'chrome', deviceScaleFactor: 1, frames: 1, slowTests: true,
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
let browser;
let browserProcess;
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
  const launched = await chromium.launch({
    channel: 'chrome', headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
  });
  browser = launched;
  if (stopSignal) return;
  const browserVersion = launched.version();
  if (expectedBrowserVersion && browserVersion !== expectedBrowserVersion) {
    throw new Error('Installed Chrome changed version during the baseline. Use a new output directory.');
  }
  const session = await launched.newBrowserCDPSession();
  try {
    const { processInfo } = await withDeadline(session.send('SystemInfo.getProcessInfo'), 10_000, 'Chrome process info timed out.');
    const owned = processInfo.find(info => info.type === 'browser');
    if (!owned) throw new Error('Chrome process information is unavailable.');
    const launchCommandLine = execFileSync('ps', ['-ww', '-p', String(owned.id), '-o', 'command='],
      { encoding: 'utf8' }).trim();
    browserProcess = { pid: owned.id, launchCommandLine };
    launchHistory.push({ recordedAt: new Date().toISOString(), browserVersion, launchCommandLine });
  } finally {
    await session.detach().catch(() => {});
  }
}
async function closeBrowser() {
  if (!browser) return;
  browserClose ??= closeOwnedChrome(browser, browserProcess).finally(() => {
    browser = null;
    browserProcess = null;
    browserClose = null;
  });
  await browserClose;
}

async function closeOwnedChrome(current, owned) {
  const closing = current.close();
  try {
    await withDeadline(closing, 10_000, 'Chrome close timed out.');
  } catch (error) {
    if (!owned) throw error;
    const observed = spawnSync('ps', ['-ww', '-p', String(owned.pid), '-o', 'command='], { encoding: 'utf8' });
    if (observed.status === 0 && observed.stdout.trim() === owned.launchCommandLine) {
      console.error(`Stopping owned Chrome ${owned.pid} after close failed: ${error.message}`);
      try {
        process.kill(owned.pid, 'SIGKILL');
      } catch (killError) {
        if (killError.code !== 'ESRCH') throw killError;
      }
    }
    await withDeadline(closing, 5_000, 'Chrome teardown did not finish.');
  }
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
      try {
        context = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
        await context.addInitScript(installConformanceBridge, { backend });
        page = await context.newPage();
      } catch (error) {
        await context?.close().catch(() => {});
        if (stopSignal) break;
        await closeBrowser();
        await openBrowser();
        if (stopSignal) break;
        context = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
        await context.addInitScript(installConformanceBridge, { backend });
        page = await context.newPage();
        recovery.push({ phase: 'context-initialization', error: String(error), recordedAt: new Date().toISOString() });
      }
      page.on('dialog', dialog => { void dialog.dismiss(); });
      let activeIndex = null;
      let activeStarted = Date.now();
      let eventResults = [];
      const diagnostics = [];
      const lateDiagnostics = new Map();
      let lateChanged = false;
      page.on('pageerror', error => diagnostics.push({ index: activeIndex, kind: 'page', name: error.name, message: error.message }));
      page.on('requestfailed', request => diagnostics.push({ index: activeIndex, kind: 'request',
        name: 'RequestFailure', message: request.failure()?.errorText ?? '', url: request.url() }));
      page.on('response', response => {
        if (response.status() >= 400) diagnostics.push({ index: activeIndex, kind: 'response',
          name: 'HTTPError', message: `HTTP ${response.status()}`, url: response.url() });
      });
      let batch;
      let completedBatch = false;
      try {
        await page.exposeFunction('__refralConformanceEvent', event => {
          if (event.type === 'start') { activeIndex = event.index; activeStarted = Date.now(); }
          if (event.type === 'finish') eventResults.push(event.result);
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
        await page.evaluate(({ start, count }) => window.conformanceSession.run({ start, count }), { start, count: batch.length });
        while (!stopSignal) {
          const snapshot = await withDeadline(page.evaluate(() => ({
            progress: window.conformanceSession.progress, results: window.conformanceSession.results,
          })), 30_000, 'Conformance page stopped responding.');
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
        } else {
          initializationFailures = 0;
          const failedIndex = batch?.find(index => !records.has(index)) ?? activeIndex;
          if (failedIndex === null || failedIndex === undefined) throw error;
          const failures = (attempts.get(failedIndex) ?? 0) + 1;
          attempts.set(failedIndex, failures);
          recovery.push({ index: failedIndex, url: inventory[failedIndex], attempt: failures, error: String(error), recordedAt: new Date().toISOString() });
          console.log(`[${backend}] recovering ${failedIndex} attempt ${failures}: ${error.message}`);
          if (failures >= 2) records.set(failedIndex, {
            index: failedIndex, url: inventory[failedIndex], backend,
            status: error.message.includes('deadline') || error.message.includes('responding') ? 'timeout' : 'harness-error',
            completion: 'crash', passed: 0, failed: 0, skipped: 0, failures: [], failuresTruncated: 0,
            errors: [{ kind: 'recovery', name: error.name, message: error.message }], contexts: [], adapterGaps: [],
            browserDiagnostics: diagnostics.filter(item => item.index === failedIndex), partialCountsUnavailable: true,
            durationMs: Date.now() - activeStarted,
          });
          await checkpoint();
        }
      } finally {
        await withDeadline(context.close(), 15_000, 'Closing conformance context timed out.').catch(() => {});
      }
      if (!stopSignal && (!completedBatch || !browser.isConnected())) {
        await closeBrowser();
        await openBrowser();
      }
    }
    if (inventory) await checkpoint();
    console.log(`[${backend}] ${stopSignal ? 'stopped' : 'complete requested range'}; recorded ${records.size}/${inventory?.length ?? 0}${resumed ? ' with checkpoint reuse' : ''}.`);
    await closeBrowser();
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
