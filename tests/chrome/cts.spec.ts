import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };

interface CtsRecord {
  path: string;
  backend: string;
  status: string;
  selectedCore?: string | null;
  passed: number;
  crossOriginIsolated?: boolean;
  sharedArrayBufferAvailable?: boolean;
  environments?: Record<string, unknown>[];
  observations?: Record<string, unknown>;
}

const backends = ['native', 'js', 'rust'] as const;
const errorBranchPath = 'sdk/tests/conformance/state/gl-geterror.html';
const sharedBufferPath = 'sdk/tests/conformance/buffers/buffer-data-and-buffer-sub-data.html';
let builds: Record<string, string>;
let launchCommandLine: string;
let sourceManifest: Record<string, unknown>;

test.beforeAll(async ({ browser }) => {
  builds = {
    rustWasmSha256: createHash('sha256').update(await readFile('artifacts/core-wasm/refral_core.wasm')).digest('hex'),
    compilerWasmSha256: createHash('sha256').update(await readFile('artifacts/compiler/compiler.wasm')).digest('hex'),
  };
  sourceManifest = JSON.parse(await readFile('artifacts/fixtures/manifest.json', 'utf8'));
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const browserProcess = processInfo.find(info => info.type === 'browser');
    if (!browserProcess) throw new Error('Chrome process information is unavailable.');
    launchCommandLine = execFileSync('ps', ['-ww', '-p', String(browserProcess.id), '-o', 'command='],
      { encoding: 'utf8' }).trim();
  } finally { await session.detach(); }
});

async function runBackends(page: Page, path: string): Promise<Record<string, CtsRecord>> {
  const records: Record<string, CtsRecord> = {};
  for (const backend of backends) {
    records[backend] = await page.evaluate(async ({ path, backend }) => {
      const entry = '/tests/fixtures/cts-runner.ts';
      const { runCts } = await import(/* @vite-ignore */ entry);
      return runCts(path, backend);
    }, { path, backend }).catch(error => ({ path, backend, status: 'initialization-failed',
      passed: 0, failed: 1, error: String(error) }));
  }
  return records;
}

test('pinned Khronos CTS cases execute original assertions', async ({ page, browser }) => {
  await page.goto('/tests/fixtures/runner.html');
  const results: Record<string, CtsRecord>[] = [];
  for (const path of fixtures.cts.tests) {
    const records = await runBackends(page, path);
    results.push({ ...records, refral: records.js });
  }
  const assertionTotals = Object.fromEntries(backends.map(backend => [backend,
    results.reduce((total, records) => total + records[backend]!.passed, 0)]));
  const { channel, headless, launchOptions, deviceScaleFactor } = test.info().project.use;
  const report = JSON.stringify({
    recordedAt: new Date().toISOString(), revision: fixtures.cts.revision, browserVersion: browser.version(),
    ...builds, builds, sources: sourceManifest.sources,
    backends: { native: 'native', js: 'js', rust: 'rust', refral: 'js' },
    selectedTestCount: fixtures.cts.tests.length, assertionTotals,
    configuration: { channel, headless, launchOptions: launchOptions ?? {}, deviceScaleFactor, launchCommandLine },
    assertionCountPolicy: {
      exactPerFile: 'All selected files except the upstream getError branch case.',
      upstreamBranch: { path: errorBranchPath,
        reason: 'The original script permits first-error and multiple-error implementations and executes different assertion counts.' },
      conditionalApis: 'Original DOM texture scripts execute their OffscreenCanvas branches when the browser exposes that API.',
    },
    deferred: fixtures.cts.deferredTests.map(test => ({ ...test, status: 'prerequisite-not-run' })),
    results,
  }, null, 2) + '\n';
  for (const directory of ['artifacts/cts', 'artifacts/cubemap/pr3/cts']) {
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/results.json`, report);
  }
  for (const backend of backends) {
    for (const records of results) {
      const record = records[backend]!;
      expect(record.status, JSON.stringify(record)).toBe('pass');
      expect(record.selectedCore, `${backend} actual selected core`).toBe(backend);
      expect(record.environments?.length, `${backend} captured original contexts`).toBeGreaterThan(0);
      expect(record.environments?.every(environment => environment.core === backend), `${backend} original context provenance`).toBe(true);
      expect(record.observations?.offscreenCanvasAvailable, `${backend} original optional API exposure`)
        .toBe(records.native!.observations?.offscreenCanvasAvailable);
      if (record.path === errorBranchPath) {
        expect(record.observations?.errorCollection).toMatch(/^(first-error|multiple-errors)$/);
      } else {
        expect(record.passed, `${backend} ${record.path} assertion count`).toBe(records.native!.passed);
      }
    }
    expect(assertionTotals[backend]).toBeGreaterThan(0);
  }
});

test('original Buffer CTS executes fixed shared storage assertions in isolation', async ({ page, browser }) => {
  await page.goto('/tests/fixtures/runner.html');
  const ordinary = await runBackends(page, sharedBufferPath);
  await page.route(/\/tests\/fixtures\/(runner|cts-frame)\.html$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(),
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } });
  });
  await page.goto('/tests/fixtures/runner.html');
  const isolated = await runBackends(page, sharedBufferPath);
  await mkdir('artifacts/cts', { recursive: true });
  const { channel, headless, launchOptions, deviceScaleFactor } = test.info().project.use;
  await writeFile('artifacts/cts/shared-buffer-results.json', JSON.stringify({
    recordedAt: new Date().toISOString(), revision: fixtures.cts.revision, browserVersion: browser.version(), path: sharedBufferPath,
    builds, sources: sourceManifest.sources,
    configuration: { channel, headless, launchOptions: launchOptions ?? {}, deviceScaleFactor, launchCommandLine },
    adaptation: 'COOP/COEP on the harness and iframe responses exposes the original optional fixed-shared-storage branch.',
    ordinary, isolated,
  }, null, 2) + '\n');
  for (const backend of backends) {
    const baseline = ordinary[backend]!;
    const shared = isolated[backend]!;
    expect(baseline.status, JSON.stringify(baseline)).toBe('pass');
    expect(baseline.selectedCore).toBe(backend);
    expect(baseline.crossOriginIsolated).toBe(false);
    expect(baseline.sharedArrayBufferAvailable).toBe(false);
    expect(shared.status, JSON.stringify(shared)).toBe('pass');
    expect(shared.selectedCore).toBe(backend);
    expect(shared.crossOriginIsolated).toBe(true);
    expect(shared.sharedArrayBufferAvailable).toBe(true);
    expect(shared.passed, `${backend} additional original shared-storage assertions`).toBeGreaterThan(baseline.passed);
    expect(shared.passed, `${backend} isolated original assertion count`).toBe(isolated.native!.passed);
    expect(shared.environments?.length, `${backend} captured detached helper canvas`).toBeGreaterThan(0);
    expect(shared.environments?.every(environment => environment.canvasInDocument === false)).toBe(true);
  }
});
