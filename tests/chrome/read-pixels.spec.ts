import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };
import { readPixelsCaseNames } from '../fixtures/read-pixels-cases';
import type { ReadPixelsResult } from '../fixtures/read-pixels-cases';

let builds: Record<string, string>;
let launchCommandLine: string;
test.beforeAll(async ({ browser }) => {
  builds = {
    rustWasmSha256: createHash('sha256').update(await readFile('artifacts/core-wasm/refral_core.wasm')).digest('hex'),
    compilerWasmSha256: createHash('sha256').update(await readFile('artifacts/compiler/compiler.wasm')).digest('hex'),
  };
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const browserProcess = processInfo.find(info => info.type === 'browser');
    if (!browserProcess) throw new Error('Chrome process information is unavailable.');
    launchCommandLine = execFileSync('ps', ['-ww', '-p', String(browserProcess.id), '-o', 'command='],
      { encoding: 'utf8' }).trim();
  } finally { await session.detach(); }
});

for (const name of readPixelsCaseNames) {
  test(`public readPixels ${name}`, async ({ page, browser }) => {
    if (name === 'packing-and-destination-views') {
      await page.route('**/tests/fixtures/runner.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(),
          'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } });
      });
    }
    await page.goto('/tests/fixtures/runner.html');
    const results: ReadPixelsResult[] = [];
    for (const backend of ['native', 'js', 'rust'] as const) {
      const result = await page.evaluate(async ({ name, backend }) => {
        const path = '/tests/fixtures/read-pixels-cases.ts';
        const fixture = await import(/* @vite-ignore */ path);
        return fixture.runReadPixelsCase(name, backend);
      }, { name, backend });
      results.push(result);
    }
    const directory = `artifacts/readpixels/public/${name}`;
    await mkdir(directory, { recursive: true });
    const nativeObservations = results.filter(result => result.backend === 'native')
      .flatMap(result => result.checks.filter(check => !check.passed && check.nativeObservationOnly));
    const { channel, headless, launchOptions, deviceScaleFactor } = test.info().project.use;
    await writeFile(`${directory}/result.json`, JSON.stringify({
      specificationRevision: fixtures.cts.revision,
      browserVersion: browser.version(),
      builds,
      configuration: { channel, headless, launchOptions: launchOptions ?? {}, deviceScaleFactor, launchCommandLine },
      expectedPixelTolerance: 0,
      timing: 'Each public readPixels assertion observes the destination synchronously, before any await or GPU completion wait.',
      nativeObservations,
      results,
    }, null, 2) + '\n');
    for (const result of results) {
      expect.soft(result.failure, `${result.backend} execution`).toBeNull();
      expect.soft(result.selectedCore, `${result.backend} selected implementation`).toBe(result.backend);
      const failed = result.checks.filter(check => !check.passed
        && !(result.backend === 'native' && check.nativeObservationOnly));
      expect.soft(failed, `${result.backend} specification-derived assertions`).toEqual([]);
      expect.soft(result.validationErrors, `${result.backend} delayed GPU diagnostics`).toEqual([]);
      expect.soft(result.cleanupErrors, `${result.backend} cleanup`).toEqual([]);
      expect.soft(result.checks.length, `${result.backend} executed assertions`).toBeGreaterThan(0);
    }
  });
}
