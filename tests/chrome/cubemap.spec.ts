import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };
import { cubemapCaseNames, cubemapSources } from '../fixtures/cubemap-cases';
import type { CubemapResult } from '../fixtures/cubemap-cases';

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

function png(result: CubemapResult, pixels: readonly number[]): Buffer {
  const image = new PNG({ width: result.width, height: result.height });
  for (let y = 0; y < result.height; y++) {
    image.data.set(pixels.slice(y * result.width * 4, (y + 1) * result.width * 4),
      (result.height - y - 1) * result.width * 4);
  }
  return PNG.sync.write(image);
}

function compare(actual: readonly number[], expected: readonly number[]) {
  let mismatchedChannels = 0;
  let maxDifference = 0;
  const difference = actual.map((value, index) => {
    const delta = Math.abs(value - expected[index]!);
    if (delta !== 0) mismatchedChannels++;
    maxDifference = Math.max(maxDifference, delta);
    return index % 4 === 3 ? 255 : delta;
  });
  return { mismatchedChannels, maxDifference, difference };
}

for (const name of cubemapCaseNames) {
  test(`CubeMap ${name}`, async ({ page, browser }) => {
    await page.goto('/tests/fixtures/runner.html');
    const results: CubemapResult[] = [];
    for (const backend of ['native', 'js', 'rust'] as const) {
      results.push(await page.evaluate(async ({ name, backend }) => {
        const entry = '/tests/fixtures/cubemap-cases.ts';
        const { runCubemapCase } = await import(/* @vite-ignore */ entry);
        return runCubemapCase(name, backend);
      }, { name, backend }));
    }
    const directory = `artifacts/cubemap/pr2/cases/${name}`;
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    const comparisons = [];
    const native = results[0]!;
    const js = results[1]!;
    for (const result of results) {
      const complete = result.pixels.length === result.width * result.height * 4;
      const expected = complete ? compare(result.pixels, result.expected) : null;
      const nativeDifference = complete && result.pixels.length === native.pixels.length
        ? compare(result.pixels, native.pixels) : null;
      const jsDifference = complete && result.pixels.length === js.pixels.length
        ? compare(result.pixels, js.pixels) : null;
      comparisons.push({ backend: result.backend,
        expectedMismatchedChannels: expected?.mismatchedChannels ?? null,
        expectedMaxDifference: expected?.maxDifference ?? null,
        nativeMismatchedChannels: nativeDifference?.mismatchedChannels ?? null,
        nativeMaxDifference: nativeDifference?.maxDifference ?? null,
        jsMismatchedChannels: jsDifference?.mismatchedChannels ?? null,
      });
      if (complete) {
        await writeFile(`${directory}/${result.backend}.png`, png(result, result.pixels));
        await writeFile(`${directory}/${result.backend}-expected.png`, png(result, result.expected));
        if (expected?.mismatchedChannels) await writeFile(`${directory}/${result.backend}-expected-diff.png`, png(result, expected.difference));
        if (nativeDifference?.mismatchedChannels) await writeFile(`${directory}/${result.backend}-native-diff.png`, png(result, nativeDifference.difference));
      }
    }
    const { channel, headless, launchOptions, deviceScaleFactor } = test.info().project.use;
    await writeFile(`${directory}/result.json`, JSON.stringify({
      recordedAt: new Date().toISOString(), browserVersion: browser.version(), specificationRevision: fixtures.cts.revision,
      fixtureKind: 'source-derived public CubeMap semantics', sourceReferences: cubemapSources,
      builds, configuration: { channel, headless, launchOptions: launchOptions ?? {}, deviceScaleFactor, launchCommandLine },
      pixelTolerance: 0, comparisons, results,
    }, null, 2) + '\n');
    for (const result of results) {
      expect.soft(result.selectedCore, `${result.backend} selected core`).toBe(result.backend);
      expect.soft(result.failure, `${result.backend} execution`).toBeNull();
      expect.soft(result.checks.filter(check => !check.passed), `${result.backend} specification assertions`).toEqual([]);
      expect.soft(result.samples.length, `${result.backend} executed pixel samples`).toBeGreaterThan(0);
      expect.soft(result.validationErrors, `${result.backend} delayed GPU diagnostics`).toEqual([]);
      expect.soft(result.cleanupErrors, `${result.backend} cleanup`).toEqual([]);
      expect.soft(result.pixels, `${result.backend} complete output`).toHaveLength(result.width * result.height * 4);
    }
    for (const comparison of comparisons) {
      expect.soft(comparison.expectedMismatchedChannels, `${comparison.backend} expected pixels`).toBe(0);
      expect.soft(comparison.nativeMismatchedChannels, `${comparison.backend} native pixels`).toBe(0);
      expect.soft(comparison.jsMismatchedChannels, `${comparison.backend} JS pixels`).toBe(0);
    }
  });
}
