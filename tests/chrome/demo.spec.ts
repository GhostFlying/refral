import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

test('pinned render-to-texture demo renders through both backends', async ({ page }) => {
  await page.goto('/tests/fixtures/runner.html');
  const results = await page.evaluate(async () => {
    const path = '/examples/render-to-texture.ts';
    const { prepareDemo } = await import(/* @vite-ignore */ path);
    const images = [];
    for (const backend of ['native', 'refral']) {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      canvas.style.width = '320px';
      canvas.style.height = '240px';
      document.body.appendChild(canvas);
      const scene = await prepareDemo(canvas, backend);
      scene.frame(1000);
      scene.gl.flush();
      const image = await scene.capture();
      images.push({ backend, width: image.width, height: image.height, pixels: Array.from(image.data as Uint8Array), error: scene.gl.getError(), validationErrors: scene.hooks?.errors ?? [] });
      await scene.hooks?.dispose();
      canvas.remove();
    }
    return images;
  });
  const [native, refral] = results;
  let differingPixels = 0;
  let unmatchedPixels = 0;
  for (let y = 0; y < native.height; y++) {
    for (let x = 0; x < native.width; x++) {
      const index = (y * native.width + x) * 4;
      const matches = (otherX: number, otherY: number) => {
        if (otherX < 0 || otherY < 0 || otherX >= native.width || otherY >= native.height) return false;
        const otherIndex = (otherY * native.width + otherX) * 4;
        return [0, 1, 2, 3].every((channel) => Math.abs(native.pixels[otherIndex + channel] - refral.pixels[index + channel]) <= 2);
      };
      if (matches(x, y)) continue;
      differingPixels++;
      const nearby = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => matches(x + dx, y + dy)));
      if (!nearby) unmatchedPixels++;
    }
  }
  await mkdir('artifacts/demo', { recursive: true });
  for (const image of results) {
    const png = new PNG({ width: image.width, height: image.height });
    for (let row = 0; row < image.height; row++) {
      png.data.set(image.pixels.slice(row * image.width * 4, (row + 1) * image.width * 4), (image.height - 1 - row) * image.width * 4);
    }
    await writeFile(`artifacts/demo/${image.backend}.png`, PNG.sync.write(png));
    expect(image.error).toBe(0);
    expect(image.validationErrors).toEqual([]);
  }
  await writeFile('artifacts/demo/result.json', JSON.stringify({ differingPixels, unmatchedPixels, tolerance: { channelBytes: 2, rasterEdgeNeighborhood: 1 }, width: native.width, height: native.height }, null, 2) + '\n');
  expect(unmatchedPixels).toBe(0);
});

test('demo backend control produces an actual Refral frame', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/examples/index.html');
  await page.getByLabel('Demo backend').selectOption('refral');
  await page.getByRole('button', { name: 'Render to texture', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Passed');
  const report = JSON.parse(await page.locator('#report').innerText());
  expect(report.backend).toBe('refral');
  expect(report.error).toBe(0);
  expect(report.nonWhitePixels).toBeGreaterThan(100);
  expect(report.nativeReference.error).toBe(0);
  expect(report.nativeReference.nonWhitePixels).toBeGreaterThan(100);
  expect(errors).toEqual([]);
  expect(await page.locator('vite-error-overlay').count()).toBe(0);
  await page.screenshot({ path: 'artifacts/demo/chrome-demo.png' });
});
