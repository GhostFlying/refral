import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };

test('pinned Khronos CTS cases execute original assertions', async ({ page, browser }) => {
  await page.goto('/tests/fixtures/runner.html');
  const results = [];
  for (const path of fixtures.cts.tests) {
    const pair = await page.evaluate(async (testPath) => {
      const entry = '/tests/fixtures/cts-runner.ts';
      const { runCts } = await import(/* @vite-ignore */ entry);
      return { native: await runCts(testPath, 'native'), refral: await runCts(testPath, 'refral') };
    }, path);
    results.push(pair);
  }
  await mkdir('artifacts/cts', { recursive: true });
  await writeFile('artifacts/cts/results.json', JSON.stringify({
    revision: fixtures.cts.revision, browserVersion: browser.version(),
    backends: { native: 'native', refral: 'js' },
    deferred: fixtures.cts.deferredTests.map(test => ({ ...test, status: 'prerequisite-not-run' })),
    results,
  }, null, 2) + '\n');
  for (const pair of results) {
    expect(pair.native.status, pair.native.path).toBe('pass');
    expect(pair.refral.status, JSON.stringify(pair.refral)).toBe('pass');
  }
});
