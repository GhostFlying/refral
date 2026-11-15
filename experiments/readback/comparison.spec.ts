import { test, expect, chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { captureEnvironment } from './evidence';
import type { runComparisonCorpus, runNativeCorpus } from './comparison';

let environment: Awaited<ReturnType<typeof captureEnvironment>>;
test.beforeAll(async ({ browser }) => {
  environment = await captureEnvironment(browser, 'artifacts/readback-comparison');
});

test('native byte palette and state reference', async ({ page }) => {
  await page.goto('http://127.0.0.1:4175/tests/fixtures/runner.html');
  const result: ReturnType<typeof runNativeCorpus> = await page.evaluate(async () => {
    const path = '/experiments/readback/comparison.ts';
    return (await import(/* @vite-ignore */ path)).runNativeCorpus();
  });
  await writeFile('artifacts/readback-comparison/native.json', JSON.stringify({ environment, result }, null, 2));
  expect(result.images.every((image) => image.mismatchedChannels === 0)).toBe(true);
});

for (const isolated of [false, true]) {
  for (const route of ['canvas', 'worker'] as const) {
    if (!isolated && route === 'worker') continue;
    for (const core of ['js', 'rust'] as const) {
      test(`${route} ${core} corpus isolated=${isolated}`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${isolated ? 4176 : 4175}/tests/fixtures/runner.html`);
        const result: Awaited<ReturnType<typeof runComparisonCorpus>> = await page.evaluate(
          async ({ core, route }) => {
            const path = '/experiments/readback/comparison.ts';
            return (await import(/* @vite-ignore */ path)).runComparisonCorpus(core, route);
          },
          { core, route }
        );
        await writeFile(
          `artifacts/readback-comparison/${route}-${core}-${isolated}.json`,
          JSON.stringify({ environment, result }, null, 2)
        );
        expect(errors).toEqual([]);
        expect(result.core).toBe(core);
        expect(result.crossOriginIsolated).toBe(isolated);
        expect(result.frames).toHaveLength(12);
        expect(result.frames.every((frame) => frame.mismatchedChannels === 0)).toBe(true);
        expect(result.images).toHaveLength(7);
        expect(
          result.images.every((image) => image.mismatchedChannels === 0),
          JSON.stringify(result.images)
        ).toBe(true);
        expect(result.diagnostics.errors).toEqual([]);
      });
    }
  }
}

test('Canvas tiling, resize, empty capture and map reference', async ({ page }) => {
  await page.goto('http://127.0.0.1:4175/tests/fixtures/runner.html');
  const result = await page.evaluate(async () => {
    const path = '/experiments/readback/comparison.ts';
    return (await import(/* @vite-ignore */ path)).probeCanvasTiles();
  });
  await writeFile('artifacts/readback-comparison/tiles.json', JSON.stringify({ environment, result }, null, 2));
  expect(result.records.every((record: { mismatchedChannels: number }) => record.mismatchedChannels === 0)).toBe(true);
  expect(result.emptyBytes).toBe(0);
  expect(result.stats.tiles).toBe(3);
  expect(result.errors).toEqual([]);
});

test('Canvas bytes with the browser native color-profile configuration', async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env.REFRAL_HEADLESS === '1',
    ignoreDefaultArgs: ['--force-color-profile=srgb'],
  });
  try {
    const environment = await captureEnvironment(browser, 'artifacts/readback-comparison/natural-color');
    for (const core of ['js', 'rust'] as const) {
      const page = await browser.newPage({ deviceScaleFactor: 1 });
      try {
        await page.goto('http://127.0.0.1:4175/tests/fixtures/runner.html');
        const result: Awaited<ReturnType<typeof runComparisonCorpus>> = await page.evaluate(async (core) => {
          const path = '/experiments/readback/comparison.ts';
          return (await import(/* @vite-ignore */ path)).runComparisonCorpus(core, 'canvas');
        }, core);
        await writeFile(
          `artifacts/readback-comparison/natural-color/${core}.json`,
          JSON.stringify({ environment, result }, null, 2)
        );
        expect(result.frames.every((frame) => frame.mismatchedChannels === 0)).toBe(true);
        expect(result.images.every((image) => image.mismatchedChannels === 0)).toBe(true);
        expect(result.diagnostics.errors).toEqual([]);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
