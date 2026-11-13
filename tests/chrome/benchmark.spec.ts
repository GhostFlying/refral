import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('records paired native WebGL and Refral CPU baseline samples', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/tests/fixtures/runner.html');
  const results = [];
  for (const scene of ['uniform-draws', 'state-changes', 'dynamic-upload']) {
    for (const backend of ['native', 'refral']) {
      results.push(await page.evaluate(async ({ scene, backend }) => {
        const path = '/benchmarks/browser.ts';
        const { runBrowserBenchmark } = await import(/* @vite-ignore */ path);
        return runBrowserBenchmark(backend, scene);
      }, { scene, backend }));
    }
  }
  await mkdir('artifacts/benchmarks', { recursive: true });
  await writeFile('artifacts/benchmarks/chrome.json', JSON.stringify({ recordedAt: new Date().toISOString(), results }, null, 2) + '\n');
  for (const result of results) {
    expect(result.error).toBe(0);
    expect(result.validationErrors).toEqual([]);
    expect(result.cpuSamplesMs).toHaveLength(120);
  }
});
