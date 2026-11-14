import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { programCaseNames } from '../fixtures/case-names';
import type { ProgramCaseName } from '../fixtures/case-names';
import type { runCase } from '../fixtures/runtime-cases';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };

interface Region { x: number; width: number; color: readonly number[] }
const red = [255, 0, 0, 255];
const green = [0, 255, 0, 255];
const blue = [0, 0, 255, 255];
const black = [0, 0, 0, 255];
const expected: Record<ProgramCaseName, { observed: Record<string, unknown>; regions: Region[] }> = {
  'failed-current-program-relink': {
    observed: { replacementCompiled: true, linked: false, currentProgramRetained: true,
      linkError: 0, oldLocationError: 0x0502, drawError: 0x0502, finalError: 0 },
    regions: [{ x: 0, width: 64, color: [255, 127, 0, 255] }],
  },
  'successful-relink-reset': {
    observed: { linked: true, currentProgramRetained: true, linkError: 0,
      freshLocation: true, locationPresent: true, resetUniform: [0, 0, 0, 0], oldLocationError: 0x0502,
      resetDrawError: 0, finalError: 0 },
    regions: [{ x: 0, width: 16, color: red }, { x: 16, width: 16, color: black },
      { x: 32, width: 32, color: green }],
  },
  'shader-source-compile-executable': {
    observed: { sourceUpdated: true, linkedAfterSource: true, sourceDrawError: 0,
      replacementCompiled: true, linkedAfterCompile: true, compileDrawError: 0,
      invalidShaderCompiled: false, linkedAfterFailedCompile: true,
      failedCompileDrawError: 0, currentProgramRetained: true, finalError: 0 },
    regions: [{ x: 0, width: 16, color: red }, { x: 16, width: 16, color: green },
      { x: 32, width: 16, color: blue }, { x: 48, width: 16, color: [255, 255, 255, 255] }],
  },
  'detached-deleted-shader-executable': {
    observed: { attachedCount: 0, shadersDeleted: true, linked: true,
      currentProgramRetained: true, removalError: 0, drawError: 0, finalError: 0 },
    regions: [{ x: 0, width: 32, color: red }, { x: 32, width: 32, color: blue }],
  },
  'shader-source-code-units': {
    observed: { sourcePreserved: true, sourceError: 0, finalError: 0 },
    regions: [{ x: 0, width: 64, color: black }],
  },
};

type Result = Awaited<ReturnType<typeof runCase>>;

function regionDifferences(result: Result, regions: Region[]) {
  const failures: { x: number; mismatchedChannels: number; maxDifference: number }[] = [];
  for (const region of regions) {
    let mismatchedChannels = 0;
    let maxDifference = 0;
    for (let y = 0; y < result.height; y++) {
      for (let x = region.x; x < region.x + region.width; x++) {
        for (let channel = 0; channel < 4; channel++) {
          const difference = Math.abs(result.pixels[(y * result.width + x) * 4 + channel]! - region.color[channel]!);
          if (difference > 1) mismatchedChannels++;
          maxDifference = Math.max(maxDifference, difference);
        }
      }
    }
    failures.push({ x: region.x, mismatchedChannels, maxDifference });
  }
  return failures;
}

for (const name of programCaseNames) {
  test(`program specification ${name}`, async ({ page, browser }) => {
    await page.goto('/tests/fixtures/runner.html');
    const results: Result[] = [];
    for (const backend of ['native', 'refral'] as const) {
      const result = await page.evaluate(async ({ name, backend }) => {
        const path = '/tests/fixtures/runtime-cases.ts';
        const { runCase } = await import(/* @vite-ignore */ path);
        return runCase(name, backend);
      }, { name, backend });
      results.push(result);
    }
    const directory = `artifacts/program-spec/${name}`;
    await mkdir(directory, { recursive: true });
    const pixels = results.map(result => ({ backend: result.backend,
      regions: regionDifferences(result, expected[name].regions) }));
    const configuration = { width: 64, height: 64, tolerance: 1, dpr: 1,
      alpha: false, depth: true, stencil: false, antialias: false, preserveDrawingBuffer: true };
    await writeFile(`${directory}/result.json`, JSON.stringify({
      specificationRevision: fixtures.cts.revision, browserVersion: browser.version(),
      configuration, expected: expected[name], pixels, results,
    }, null, 2) + '\n');
    for (const result of results) {
      const png = new PNG({ width: result.width, height: result.height });
      for (let row = 0; row < result.height; row++) {
        png.data.set(result.pixels.slice(row * result.width * 4, (row + 1) * result.width * 4),
          (result.height - 1 - row) * result.width * 4);
      }
      await writeFile(`${directory}/${result.backend}.png`, PNG.sync.write(png));
    }
    for (const result of results) {
      expect(result.observed, `${result.backend} required program state`).toMatchObject(expected[name].observed);
      expect(result.validationErrors, `${result.backend} GPU diagnostics`).toEqual([]);
      if (name === 'shader-source-code-units') {
        expect((result.observed.codeUnits as number[]).slice(0, 13)).toEqual([
          47, 47, 32, 0xd800, 32, 0, 32, 0xdc00, 32, 0xd83d, 0xde80, 13, 10,
        ]);
      }
    }
    for (const result of pixels) {
      expect(result.regions.every(region => region.mismatchedChannels === 0), JSON.stringify(result)).toBe(true);
    }
    expect(results[1]!.observed).toEqual(results[0]!.observed);
  });
}
