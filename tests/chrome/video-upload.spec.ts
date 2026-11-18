import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import fixtures from '../../fixtures.lock.json' with { type: 'json' };
import type { runVideoUploadCase } from '../fixtures/video-upload-cases';

const media = '/third_party/cts/sdk/tests/resources/transparent-2frames.webm';
const evidence = 'artifacts/video-upload/public';
const expectedFrames = [[0, 255, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 255, 255]];
const expectedCors = [expectedFrames[0]!, expectedFrames[1]!, expectedFrames[0]!, expectedFrames[1]!];
const rgbTolerance = 5;

function matchesVideoPixels(pixels: number[][], expected: number[][]): boolean {
  return pixels.length === expected.length && pixels.every((pixel, i) =>
    pixel[3] === expected[i]![3] && pixel.slice(0, 3).every((channel, j) =>
      Math.abs(channel - expected[i]![j]!) <= rgbTolerance));
}

test('video upload snapshots frames and rejects tainted sources on all three paths', async ({ page, browser }) => {
  const clip = await readFile('.' + media);
  await page.route('**/video-upload-security.webm*', route => route.fulfill({
    status: 200, body: clip, contentType: 'video/webm',
    headers: new URL(route.request().url()).searchParams.has('cors') ? { 'Access-Control-Allow-Origin': '*' } : {},
  }));
  await page.goto('/tests/fixtures/runner.html');
  const securityURL = new URL('/video-upload-security.webm', page.url());
  securityURL.hostname = 'localhost';
  const results: Awaited<ReturnType<typeof runVideoUploadCase>>[] = [];
  for (const backend of ['native', 'js', 'rust'] as const) {
    const result = await page.evaluate(async ({ backend, asset, crossOriginAsset }) => {
      const entry = '/tests/fixtures/video-upload-cases.ts';
      const { runVideoUploadCase } = await import(/* @vite-ignore */ entry);
      return runVideoUploadCase(backend, asset, crossOriginAsset);
    }, { backend, asset: new URL(media, page.url()).href, crossOriginAsset: securityURL.href });
    results.push(result);
  }
  await mkdir(evidence, { recursive: true });
  await writeFile(`${evidence}/result.json`, JSON.stringify({
    chrome: browser.version(), headless: test.info().project.use.headless, revision: fixtures.cts.revision,
    clip: media, clipHash: createHash('sha256').update(clip).digest('hex'), expectedFrames, expectedCors,
    rgbTolerance, alphaTolerance: 0, results,
  }, null, 2) + '\n');

  const native = results[0]!;
  for (const result of results) {
    const { backend } = result;
    expect.soft(result.selectedCore).toBe(backend);
    expect.soft(result.dimensions).toEqual([32, 32]);
    expect.soft(result.emptyImage).toBe(0x0501);
    expect.soft(result.emptySubImage).toBe(0x0501);
    expect.soft(result.taintedImage).toBe('SecurityError');
    expect.soft(result.taintedSubImage).toBe('SecurityError');
    expect.soft(result.errors.every(error => error === 0), `${backend} GL errors ${result.errors}`).toBe(true);
    expect.soft(result.validationErrors).toEqual([]);
    expect.soft(result.retainedPixels).toEqual(result.orderedPixels);
    for (const [pixels, expected, reference] of [
      [result.orderedPixels, expectedFrames, native.orderedPixels],
      [result.corsPixels, expectedCors, native.corsPixels],
    ] as const) {
      expect.soft(matchesVideoPixels(pixels, reference), `${backend} native comparison`).toBe(true);
      expect.soft(matchesVideoPixels(pixels, expected), `${backend} decoded colors ${JSON.stringify(pixels)}`).toBe(true);
    }
  }
  expect(results[1]!.orderedPixels).toEqual(results[2]!.orderedPixels);
  expect(results[1]!.corsPixels).toEqual(results[2]!.corsPixels);
});
