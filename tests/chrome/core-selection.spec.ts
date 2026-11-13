import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

interface SelectionResult {
  configuration: {
    rounds: number;
    samples: number;
    draws: number;
    iterationsPerSample: number;
  };
  records: Array<{
    correct: boolean;
    p50Ms: number;
    p95Ms: number;
    rawSamples: Array<{ round: number; sample: number; ms: number }>;
  }>;
  gpuProof: Array<{
    correct: boolean;
    draws: number;
    gpuDurationMs: number | null;
    passCount: number;
    submitCount: number;
  }>;
}

test('JS and Rust/Wasm traces agree and feed the same real WebGPU executor', async ({ page, browser }) => {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  // Keep an agent's concurrent source edits from restarting an in-flight sample.
  await page.route('**/@vite/client', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'export {};',
  }));
  await page.goto('/experiments/core-selection/index.html');
  await expect(page).toHaveTitle('Refral · Runtime core comparison');
  await expect(page.locator('h1')).toHaveText('Runtime core comparison');
  await page.getByRole('button', { name: 'Run core comparison' }).click();
  await page.waitForFunction(() => {
    const state = window as unknown as { selectionResult?: SelectionResult; selectionFailure?: string };
    return state.selectionResult || state.selectionFailure;
  }, undefined, { timeout: 100_000 });
  const { result, failure } = await page.evaluate(() => {
    const state = window as unknown as { selectionResult: SelectionResult; selectionFailure: string | null };
    return { result: state.selectionResult, failure: state.selectionFailure };
  });
  expect(failure).toBeNull();
  expect(result.records).toHaveLength(9);
  for (const record of result.records) {
    expect(record.correct).toBe(true);
    expect(record.rawSamples).toHaveLength(result.configuration.rounds * result.configuration.samples);
    expect(record.rawSamples.every(({ ms }) => Number.isFinite(ms) && ms >= 0)).toBe(true);
    expect(record.p95Ms).toBeGreaterThanOrEqual(record.p50Ms);
  }
  expect(result.gpuProof).toHaveLength(9);
  for (const proof of result.gpuProof) {
    expect(proof.correct).toBe(true);
    expect(proof.draws).toBe(result.configuration.draws);
    expect(proof.gpuDurationMs).toBeNull();
    expect(proof.passCount).toBe(1);
    expect(proof.submitCount).toBe(1);
  }
  expect(errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await expect(page.locator('#status')).toHaveText('Completed · 9 CPU comparisons and 9 GPU checks passed');
  expect(await page.locator('vite-error-overlay').count()).toBe(0);
  const session = await browser.newBrowserCDPSession();
  let launchArguments: string[] | null = null;
  let launchArgumentsUnavailable: string | null = null;
  try {
    launchArguments = (await session.send('Browser.getBrowserCommandLine')).arguments;
  } catch (error) {
    launchArgumentsUnavailable = String(error);
  } finally {
    await session.detach();
  }
  const hash = createHash('sha256');
  for (const path of [
    'experiments/core-selection/core.rs',
    'experiments/core-selection/benchmark.mjs',
    'experiments/core-selection/browser.mjs',
  ]) hash.update(await readFile(path));
  const wasm = await readFile('artifacts/core-selection/core.wasm');
  const build = JSON.parse(await readFile('artifacts/core-selection/build.json', 'utf8'));
  await mkdir('artifacts/core-selection', { recursive: true });
  await writeFile('artifacts/core-selection/chrome-results.json', JSON.stringify({
    ...result,
    build,
    browserVersion: browser.version(),
    launchArguments,
    launchArgumentsUnavailable,
    sourceSha256: hash.digest('hex'),
    wasmSha256: createHash('sha256').update(wasm).digest('hex'),
    testAdapter: { viteHotReload: 'suppressed during the isolated experiment' },
    pageErrors: errors,
    consoleErrors,
  }, null, 2) + '\n');
  await page.screenshot({ path: 'artifacts/core-selection/chrome-results.png', fullPage: true });
});
