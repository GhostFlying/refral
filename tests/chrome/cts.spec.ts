import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };

interface CtsRecord { path: string; backend: string; status: string; passed: number }

test('pinned Khronos CTS cases execute original assertions', async ({ page, browser }) => {
  await page.goto('/tests/fixtures/runner.html');
  const results: Record<string, CtsRecord>[] = [];
  for (const path of fixtures.cts.tests) {
    const records: Record<string, CtsRecord> = {};
    for (const backend of ['native', 'js', 'rust'] as const) {
      records[backend] = await page.evaluate(async ({ path, backend }) => {
        const entry = '/tests/fixtures/cts-runner.ts';
        const { runCts } = await import(/* @vite-ignore */ entry);
        return runCts(path, backend);
      }, { path, backend }).catch(error => ({ path, backend, status: 'initialization-failed',
        passed: 0, failed: 1, error: String(error) }));
    }
    results.push({ ...records, refral: records.js });
  }
  await mkdir('artifacts/cts', { recursive: true });
  await writeFile('artifacts/cts/results.json', JSON.stringify({
    revision: fixtures.cts.revision, browserVersion: browser.version(),
    rustWasmSha256: createHash('sha256').update(await readFile('artifacts/core-wasm/refral_core.wasm')).digest('hex'),
    backends: { native: 'native', js: 'js', rust: 'rust', refral: 'js' },
    deferred: fixtures.cts.deferredTests.map(test => ({ ...test, status: 'prerequisite-not-run' })),
    results,
  }, null, 2) + '\n');
  for (const backend of ['native', 'js', 'rust'] as const) {
    for (const records of results) expect(records[backend]!.status, JSON.stringify(records[backend])).toBe('pass');
    expect(results.reduce((total, records) => total + records[backend]!.passed, 0),
      `${backend} original CTS assertion count`).toBe(100);
  }
});
