import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };
import { domImageDataCaseNames, domImageDataSources } from '../fixtures/dom-imagedata-cases';
import type { DomImageDataResult } from '../fixtures/dom-imagedata-cases';

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

for (const name of domImageDataCaseNames) {
  test(`DOM ImageData ${name}`, async ({ page, browser }) => {
    await page.goto('/tests/fixtures/runner.html');
    const results: DomImageDataResult[] = [];
    for (const backend of ['native', 'js', 'rust'] as const) {
      const result = await page.evaluate(async ({ name, backend }) => {
        const entry = '/tests/fixtures/dom-imagedata-cases.ts';
        const { runDomImageDataCase } = await import(/* @vite-ignore */ entry);
        return runDomImageDataCase(name, backend);
      }, { name, backend });
      results.push(result);
    }
    const directory = `artifacts/dom-input/pr2/public/${name}`;
    await mkdir(directory, { recursive: true });
    const { channel, headless, launchOptions, deviceScaleFactor } = test.info().project.use;
    await writeFile(`${directory}/result.json`, JSON.stringify({
      recordedAt: new Date().toISOString(), browserVersion: browser.version(), specificationRevision: fixtures.cts.revision,
      fixtureKind: 'source-derived public semantics', sourceReferences: domImageDataSources,
      builds, configuration: { channel, headless, launchOptions: launchOptions ?? {}, deviceScaleFactor, launchCommandLine },
      pixelTolerance: 0,
      timing: 'Upload snapshots and public readPixels assertions complete before any task yield or GPU completion wait.',
      results,
    }, null, 2) + '\n');
    for (const result of results) {
      expect.soft(result.selectedCore, `${result.backend} selected core`).toBe(result.backend);
      expect.soft(result.failure, `${result.backend} execution`).toBeNull();
      expect.soft(result.checks.filter(check => !check.passed), `${result.backend} specification assertions`).toEqual([]);
      expect.soft(result.checks.length, `${result.backend} executed checks`).toBeGreaterThan(0);
      expect.soft(result.validationErrors, `${result.backend} delayed GPU diagnostics`).toEqual([]);
      expect.soft(result.cleanupErrors, `${result.backend} cleanup`).toEqual([]);
    }
  });
}
