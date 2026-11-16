import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };

interface CtsRecord {
  path: string;
  backend: string;
  status: string;
  passed: number;
  crossOriginIsolated?: boolean;
  sharedArrayBufferAvailable?: boolean;
  environments?: Record<string, unknown>[];
  observations?: Record<string, unknown>;
}

const backends = ['native', 'js', 'rust'] as const;
const errorBranchPath = 'sdk/tests/conformance/state/gl-geterror.html';
const sharedBufferPath = 'sdk/tests/conformance/buffers/buffer-data-and-buffer-sub-data.html';

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
  await mkdir('artifacts/cts', { recursive: true });
  await writeFile('artifacts/cts/results.json', JSON.stringify({
    revision: fixtures.cts.revision, browserVersion: browser.version(),
    rustWasmSha256: createHash('sha256').update(await readFile('artifacts/core-wasm/refral_core.wasm')).digest('hex'),
    backends: { native: 'native', js: 'js', rust: 'rust', refral: 'js' },
    selectedTestCount: fixtures.cts.tests.length, assertionTotals,
    configuration: { headless: test.info().project.use.headless, deviceScaleFactor: test.info().project.use.deviceScaleFactor },
    assertionCountPolicy: {
      exactPerFile: 'All selected files except the upstream getError branch case.',
      upstreamBranch: { path: errorBranchPath,
        reason: 'The original script permits first-error and multiple-error implementations and executes different assertion counts.' },
    },
    deferred: fixtures.cts.deferredTests.map(test => ({ ...test, status: 'prerequisite-not-run' })),
    results,
  }, null, 2) + '\n');
  for (const backend of backends) {
    for (const records of results) {
      const record = records[backend]!;
      expect(record.status, JSON.stringify(record)).toBe('pass');
      expect(record.environments?.length, `${backend} captured original contexts`).toBeGreaterThan(0);
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
  await writeFile('artifacts/cts/shared-buffer-results.json', JSON.stringify({
    revision: fixtures.cts.revision, browserVersion: browser.version(), path: sharedBufferPath,
    configuration: { headless: test.info().project.use.headless, deviceScaleFactor: test.info().project.use.deviceScaleFactor },
    adaptation: 'COOP/COEP on the harness and iframe responses exposes the original optional fixed-shared-storage branch.',
    ordinary, isolated,
  }, null, 2) + '\n');
  for (const backend of backends) {
    const baseline = ordinary[backend]!;
    const shared = isolated[backend]!;
    expect(baseline.status, JSON.stringify(baseline)).toBe('pass');
    expect(baseline.crossOriginIsolated).toBe(false);
    expect(baseline.sharedArrayBufferAvailable).toBe(false);
    expect(shared.status, JSON.stringify(shared)).toBe('pass');
    expect(shared.crossOriginIsolated).toBe(true);
    expect(shared.sharedArrayBufferAvailable).toBe(true);
    expect(shared.passed, `${backend} additional original shared-storage assertions`).toBeGreaterThan(baseline.passed);
    expect(shared.passed, `${backend} isolated original assertion count`).toBe(isolated.native!.passed);
    expect(shared.environments?.length, `${backend} captured detached helper canvas`).toBeGreaterThan(0);
    expect(shared.environments?.every(environment => environment.canvasInDocument === false)).toBe(true);
  }
});
