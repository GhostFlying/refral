import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('Chrome renders WebGPU, reads actual pixels, and reports native WebGL', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/examples/index.html');
  await expect(page).toHaveTitle('Refral · Chrome validation');
  await expect(page.locator('h1')).toHaveText('Refral');
  await page.getByRole('button', { name: 'Run GPU probe' }).click();
  await expect(page.locator('#status')).toHaveText('Passed');
  const report = JSON.parse(await page.locator('#report').innerText());
  expect(report.secureContext).toBe(true);
  // RGBA8 UNORM may round the 0.7 channel halfway value to either adjacent byte.
  for (let channel = 0; channel < 4; channel++) {
    expect(Math.abs(report.pixels.center[channel] - report.pixels.expectedCenter[channel])).toBeLessThanOrEqual(1);
  }
  expect(report.pixels.corner).toEqual(report.pixels.expectedCorner);
  expect(report.validationErrors).toEqual([]);
  expect(report.compilation.filter((entry: { type: string }) => entry.type === 'error')).toEqual([]);
  expect(report.native.version).toContain('WebGL');
  expect(errors).toEqual([]);
  expect(await page.locator('vite-error-overlay').count()).toBe(0);
  await mkdir('artifacts/environment', { recursive: true });
  await writeFile('artifacts/environment/chrome-probe.json', JSON.stringify(report, null, 2) + '\n');
  await page.screenshot({ path: 'artifacts/environment/chrome-probe.png' });
});
