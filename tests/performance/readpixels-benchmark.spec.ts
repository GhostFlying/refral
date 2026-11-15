import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { runReadPixelsBenchmark } from '../../benchmarks/readpixels';

test('public synchronous readPixels completed-read baseline', async ({ page, browser }) => {
  execFileSync(process.execPath, ['tools/snapshot.mjs']);
  const source = JSON.parse(await readFile('artifacts/environment/source.json', 'utf8'));
  const session = await browser.newBrowserCDPSession();
  let launchCommandLine: string;
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const browserProcess = processInfo.find(info => info.type === 'browser');
    if (!browserProcess) throw new Error('Chrome process information is unavailable.');
    launchCommandLine = execFileSync('ps', ['-ww', '-p', String(browserProcess.id), '-o', 'command='],
      { encoding: 'utf8' }).trim();
  } finally { await session.detach(); }
  const orders = [['native', 'js', 'rust'], ['js', 'rust', 'native'], ['rust', 'native', 'js']] as const;
  const results: { round: number; result: Awaited<ReturnType<typeof runReadPixelsBenchmark>> }[] = [];
  await mkdir('artifacts/readpixels/benchmark', { recursive: true });
  for (let round = 0; round < orders.length; round++) {
    for (const workload of ['one-pixel', 'fbo-320x240'] as const) {
      for (const backend of orders[round]!) {
        await page.goto('/tests/fixtures/runner.html');
        const result = await page.evaluate(async ({ backend, workload }) => {
          const entry = '/benchmarks/readpixels.ts';
          const { runReadPixelsBenchmark } = await import(/* @vite-ignore */ entry);
          return runReadPixelsBenchmark(backend, workload);
        }, { backend, workload });
        results.push({ round: round + 1, result });
        await writeFile(`artifacts/readpixels/benchmark/round-${round + 1}-${workload}-${backend}.json`,
          JSON.stringify(result, null, 2) + '\n');
        expect(result.selectedCore).toBe(backend);
        expect(result.error).toBe(0);
        expect(result.validationErrors).toEqual([]);
        expect(result.environment.crossOriginIsolated).toBe(false);
      }
    }
  }
  await writeFile('artifacts/readpixels/benchmark/summary.json', JSON.stringify({
    recordedAt: new Date().toISOString(), browserVersion: browser.version(), source, launchCommandLine,
    headless: test.info().project.use.headless, deviceScaleFactor: test.info().project.use.deviceScaleFactor,
    rustWasmSha256: createHash('sha256').update(await readFile('artifacts/core-wasm/refral_core.wasm')).digest('hex'),
    orders, units: 'milliseconds per clear/read operation', completedRuns: results.length,
    runs: results.map(({ round, result }) => ({ round, backend: result.backend, workload: result.workload,
      initializationMs: result.initializationMs, firstCompletedReadMs: result.firstCompletedReadMs,
      p50Ms: result.p50Ms, p95Ms: result.p95Ms, timerResolutionMs: result.timerResolutionMs })),
  }, null, 2) + '\n');
  expect(results).toHaveLength(18);
});
