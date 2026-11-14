import { expect, test } from '@playwright/test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { dualCoreCaseNames } from '../fixtures/dual-core-cases';
import type { DrawingResult } from '../fixtures/dual-core-cases';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };

let builds: Record<string, string>;
test.beforeAll(async () => {
  builds = {
    rustWasmSha256: createHash('sha256').update(await readFile('artifacts/core-wasm/refral_core.wasm')).digest('hex'),
    compilerWasmSha256: createHash('sha256').update(await readFile('artifacts/compiler/compiler.wasm')).digest('hex'),
  };
});

function image(result: DrawingResult) {
  const png = new PNG({ width: result.width, height: result.height });
  for (let row = 0; row < result.height; row++) {
    png.data.set(result.pixels.slice(row * result.width * 4, (row + 1) * result.width * 4),
      (result.height - 1 - row) * result.width * 4);
  }
  return png;
}

function expectedPixels(result: DrawingResult) {
  const expected = new Array<number>(result.width * result.height * 4).fill(0);
  for (const region of result.regions) {
    for (let y = region.y; y < region.y + region.height; y++) {
      for (let x = region.x; x < region.x + region.width; x++) {
        for (let channel = 0; channel < 4; channel++) {
          expected[(y * result.width + x) * 4 + channel] = region.color[channel]!;
        }
      }
    }
  }
  return expected;
}

function difference(actual: number[], expected: number[]) {
  let mismatchedChannels = 0;
  let maxDifference = 0;
  const pixels = actual.map((value, index) => {
    const delta = Math.abs(value - expected[index]!);
    if (delta > 1) mismatchedChannels++;
    maxDifference = Math.max(maxDifference, delta);
    return index % 4 === 3 ? 255 : delta;
  });
  return { mismatchedChannels, maxDifference, pixels };
}

for (const name of dualCoreCaseNames) {
  test(`dual-core drawing ${name}`, async ({ page, browser }) => {
    await page.goto('/tests/fixtures/runner.html');
    const results: DrawingResult[] = [];
    for (const backend of ['native', 'js', 'rust'] as const) {
      const result = await page.evaluate(async ({ name, backend }) => {
        const path = '/tests/fixtures/dual-core-cases.ts';
        const { runDrawingCase } = await import(/* @vite-ignore */ path);
        return runDrawingCase(name, backend);
      }, { name, backend });
      results.push(result);
    }
    const directory = `artifacts/dual-core-drawing/${name}`;
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    const comparisons = [];
    const native = results[0]!;
    for (const result of results) {
      const hasPixels = result.pixels.length === result.width * result.height * 4;
      const expected = hasPixels ? difference(result.pixels, expectedPixels(result)) : null;
      const reference = hasPixels && result.width === native.width && result.height === native.height
        && native.pixels.length === result.pixels.length ? difference(result.pixels, native.pixels) : null;
      comparisons.push({ backend: result.backend,
        expected: expected && { mismatchedChannels: expected.mismatchedChannels, maxDifference: expected.maxDifference },
        native: reference && { mismatchedChannels: reference.mismatchedChannels, maxDifference: reference.maxDifference } });
      if (hasPixels) await writeFile(`${directory}/${result.backend}.png`, PNG.sync.write(image(result)));
      const failed = result.failure !== null || result.checks.some(check => !check.passed)
        || result.validationErrors.length > 0 || result.cleanupErrors.length > 0;
      if (expected && (expected.mismatchedChannels > 0 || failed)) {
        await writeFile(`${directory}/${result.backend}-expected-diff.png`, PNG.sync.write(image({ ...result, pixels: expected.pixels })));
      }
      if (reference && result.backend !== 'native' && (reference.mismatchedChannels > 0 || failed)) {
        await writeFile(`${directory}/${result.backend}-native-diff.png`, PNG.sync.write(image({ ...result, pixels: reference.pixels })));
      }
    }
    const { channel, headless, launchOptions, deviceScaleFactor } = test.info().project.use;
    await writeFile(`${directory}/result.json`, JSON.stringify({
      specificationRevision: fixtures.cts.revision, browserVersion: browser.version(), builds, tolerance: 1,
      configuration: { channel, headless, launchOptions: launchOptions ?? {}, deviceScaleFactor },
      comparisons, results,
    }, null, 2) + '\n');
    for (const result of results) {
      expect(result.failure, `${result.backend} execution`).toBeNull();
      expect(result.selectedCore).toBe(result.backend);
      expect(result.checks.filter(check => !check.passed), `${result.backend} state and errors`).toEqual([]);
      expect(result.cleanupErrors).toEqual([]);
      expect(result.validationErrors).toEqual([]);
      expect(result.pixels).toHaveLength(result.width * result.height * 4);
      const commonNames = native.checks.filter(check => check.name !== 'selected implementation').map(check => check.name);
      expect(result.checks.filter(check => commonNames.includes(check.name))).toEqual(
        native.checks.filter(check => commonNames.includes(check.name)));
    }
    for (const comparison of comparisons) {
      expect(comparison.expected?.mismatchedChannels, `${comparison.backend} expected pixels`).toBe(0);
      expect(comparison.native?.mismatchedChannels, `${comparison.backend} native pixels`).toBe(0);
    }
  });
}

for (const backend of ['native', 'js', 'rust'] as const) {
  test(`triangle example selects ${backend}`, async ({ page }) => {
    await page.goto(`/examples/triangle/index.html?core=${backend}`);
    await expect(page.locator('#status')).toHaveText(`${backend} · rendered`);
    const implementation = await page.evaluate(() => window.refralTriangle);
    expect(implementation).toMatchObject({ core: backend, selectedCore: backend, ready: true });
    const canvas = await page.locator('canvas').screenshot();
    const png = PNG.sync.read(canvas);
    const center = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
    expect(png.data[center]! + png.data[center + 1]! + png.data[center + 2]!).toBeGreaterThan(150);
    const directory = 'artifacts/dual-core-drawing/triangle-example';
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/${backend}.png`, canvas);
  });
}
