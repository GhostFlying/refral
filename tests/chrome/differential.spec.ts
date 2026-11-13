import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { caseNames } from '../fixtures/case-names';

for (const name of caseNames) {
  test(`WebGL1 differential ${name}`, async ({ page }) => {
    await page.goto('/examples/index.html');
    const results = await page.evaluate(async (caseName) => {
      const path = '/tests/fixtures/runtime-cases.ts';
      const { runCase } = await import(/* @vite-ignore */ path);
      return { native: await runCase(caseName, 'native'), refral: await runCase(caseName, 'refral') };
    }, name);
    const directory = `artifacts/differential/${name}`;
    await mkdir(directory, { recursive: true });
    const diff = new PNG({ width: results.native.width, height: results.native.height });
    let mismatchedChannels = 0;
    let maxDifference = 0;
    for (let index = 0; index < results.native.pixels.length; index++) {
      const difference = Math.abs(results.native.pixels[index] - results.refral.pixels[index]);
      maxDifference = Math.max(maxDifference, difference);
      if (difference > 1) mismatchedChannels++;
      diff.data[index] = index % 4 === 3 ? 255 : difference;
    }
    for (const backend of ['native', 'refral'] as const) {
      const image = results[backend];
      const png = new PNG({ width: image.width, height: image.height });
      // Internal captures use bottom-left rows. PNG images use top-left rows.
      for (let row = 0; row < image.height; row++) {
        png.data.set(image.pixels.slice(row * image.width * 4, (row + 1) * image.width * 4), (image.height - 1 - row) * image.width * 4);
      }
      await writeFile(`${directory}/${backend}.png`, PNG.sync.write(png));
    }
    await writeFile(`${directory}/difference.png`, PNG.sync.write(diff));
    const summary = { name, tolerance: 1, mismatchedChannels, maxDifference, native: results.native.observed, refral: results.refral.observed, stats: results.refral.stats };
    await writeFile(`${directory}/result.json`, JSON.stringify(summary, null, 2) + '\n');
    expect(results.refral.observed).toEqual(results.native.observed);
    expect(results.refral.validationErrors).toEqual([]);
    expect(mismatchedChannels, JSON.stringify(summary)).toBe(0);
  });
}
