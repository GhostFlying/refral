import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { rttCaseNames } from '../fixtures/rtt-cases';
import type { RttResult } from '../fixtures/rtt-cases';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };

function image(width: number, height: number, pixels: number[]) {
  const png = new PNG({ width, height });
  for (let row = 0; row < height; row++) {
    png.data.set(pixels.slice(row * width * 4, (row + 1) * width * 4), (height - 1 - row) * width * 4);
  }
  return PNG.sync.write(png);
}

function compare(result: RttResult, expected: number[], tolerances: number[]) {
  let mismatchedChannels = 0; let maxDifference = 0;
  const pixels = result.pixels.map((value, index) => {
    const difference = Math.abs(value - expected[index]!);
    if (difference > tolerances[Math.floor(index / 4)]!) mismatchedChannels++;
    maxDifference = Math.max(maxDifference, difference);
    return index % 4 === 3 ? 255 : difference;
  });
  return { mismatchedChannels, maxDifference, pixels };
}

for (const name of rttCaseNames.filter(name => /^(uniform-|texture-|raster-)/.test(name))) {
  test(`RTT ${name}`, async ({ page, browser }) => {
    await page.goto('/tests/fixtures/runner.html');
    const results: RttResult[] = [];
    for (const backend of ['native', 'js', 'rust'] as const) {
      results.push(await page.evaluate(async ({ name, backend }) => {
        const path = '/tests/fixtures/rtt-cases.ts';
        const { runRttCase } = await import(/* @vite-ignore */ path);
        return runRttCase(name, backend);
      }, { name, backend }));
    }
    const directory = `artifacts/rtt/${name}`;
    await rm(directory, { force: true, recursive: true }); await mkdir(directory, { recursive: true });
    const comparisons = [];
    for (const result of results) {
      const expected = new Array<number>(result.width * result.height * 4).fill(-1);
      const tolerances = new Array<number>(result.width * result.height).fill(0);
      for (const region of result.regions) {
        for (let y = region.y; y < region.y + region.height; y++) {
          for (let x = region.x; x < region.x + region.width; x++) {
            const pixel = y * result.width + x; tolerances[pixel] = region.tolerance;
            for (let channel = 0; channel < 4; channel++) expected[pixel * 4 + channel] = region.color[channel]!;
          }
        }
      }
      const hasImage = result.pixels.length === result.width * result.height * 4;
      const difference = hasImage ? compare(result, expected, tolerances) : null;
      comparisons.push({ backend: result.backend, covered: !expected.includes(-1),
        mismatchedChannels: difference?.mismatchedChannels ?? null, maxDifference: difference?.maxDifference ?? null });
      if (hasImage) {
        await writeFile(`${directory}/${result.backend}.png`, image(result.width, result.height, result.pixels));
        if (difference && (difference.mismatchedChannels > 0 || result.checks.some(check => !check.passed))) {
          await writeFile(`${directory}/${result.backend}-expected-diff.png`, image(result.width, result.height, difference.pixels));
        }
      }
    }
    const [native, js, rust] = results;
    const nativeComparisons = [js!, rust!].map(result => ({ backend: result.backend,
      comparison: result.pixels.length === native!.pixels.length ? compare(result, native!.pixels,
        new Array(result.width * result.height).fill(1)) : null }));
    const exact = js!.pixels.length === rust!.pixels.length
      ? compare(rust!, js!.pixels, new Array(rust!.width * rust!.height).fill(0)) : null;
    for (const entry of nativeComparisons) {
      if (entry.comparison?.mismatchedChannels) await writeFile(`${directory}/${entry.backend}-native-diff.png`,
        image(native!.width, native!.height, entry.comparison.pixels));
    }
    if (exact?.mismatchedChannels) await writeFile(`${directory}/rust-js-diff.png`, image(rust!.width, rust!.height, exact.pixels));
    await writeFile(`${directory}/result.json`, JSON.stringify({ browserVersion: browser.version(),
      specificationRevision: fixtures.cts.revision,
      rustWasmSha256: createHash('sha256').update(await readFile('artifacts/core-wasm/refral_core.wasm')).digest('hex'),
      compilerWasmSha256: createHash('sha256').update(await readFile('artifacts/compiler/compiler.wasm')).digest('hex'),
      comparisons, nativeComparisons: nativeComparisons.map(entry => ({ backend: entry.backend,
        mismatchedChannels: entry.comparison?.mismatchedChannels, maxDifference: entry.comparison?.maxDifference })),
      jsRustExactMismatchedChannels: exact?.mismatchedChannels, results,
    }, null, 2) + '\n');
    for (const result of results) {
      expect(result.failure, `${result.backend} execution`).toBeNull();
      expect(result.selectedCore).toBe(result.backend);
      expect(result.checks.filter(check => !check.passed), `${result.backend} normative checks`).toEqual([]);
      expect(result.validationErrors).toEqual([]); expect(result.cleanupErrors).toEqual([]);
      expect(result.pixels).toHaveLength(result.width * result.height * 4);
    }
    for (const comparison of comparisons) {
      expect(comparison.covered).toBe(true); expect(comparison.mismatchedChannels, comparison.backend).toBe(0);
    }
    for (const entry of nativeComparisons) expect(entry.comparison?.mismatchedChannels, entry.backend).toBe(0);
    expect(exact?.mismatchedChannels, 'JS/Rust exact pixel agreement').toBe(0);
  });
}
