import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { threeBackends } from '../../examples/three-context';

const output = 'artifacts/three-animation';

function pixelsOverTolerance(before: Buffer, after: Buffer) {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  expect([b.width, b.height]).toEqual([a.width, a.height]);
  let pixels = 0;
  for (let index = 0; index < a.data.length; index += 4) {
    if (Math.max(
      Math.abs(a.data[index]! - b.data[index]!),
      Math.abs(a.data[index + 1]! - b.data[index + 1]!),
      Math.abs(a.data[index + 2]! - b.data[index + 2]!),
    ) > 2) pixels++;
  }
  return pixels;
}

for (const backend of threeBackends) {
  test(`Marching Cubes plays without input on ${backend}`, async ({ page, browser }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`/examples/three-marching-cubes/index.html?core=${backend}`);
    const status = page.locator('output');
    await expect(status).toContainText('Playing');
    await expect(page.locator(`a[href="?core=${backend}"]`)).toHaveAttribute('aria-current', 'page');
    const canvas = page.locator('canvas');
    const before = await canvas.screenshot({ path: `${output}/${backend}-playing-first.png` });
    const firstStatus = await status.textContent();
    await expect(status).not.toHaveText(firstStatus!);
    await expect(status).toContainText('Playing');
    const after = await canvas.screenshot({ path: `${output}/${backend}-playing-later.png` });
    const changedPixels = pixelsOverTolerance(before, after);
    await writeFile(`${output}/${backend}-playing.json`, JSON.stringify({
      backend, browserVersion: browser.version(), firstStatus, laterStatus: await status.textContent(),
      changedPixels, errors,
    }, null, 2) + '\n');
    expect(changedPixels).toBeGreaterThan(4800);
    expect(errors).toEqual([]);
  });
}

test('Marching Cubes fixed pose uses matching work across all backends', async ({ page, browser }) => {
  await mkdir(output, { recursive: true });
  const poses = [];
  const seconds = 1.25;
  for (const backend of threeBackends) {
    await page.goto('/tests/fixtures/runner.html');
    const stats = await page.evaluate(async ({ backend, seconds }) => {
      const module = '/examples/three-marching-cubes/demo.ts';
      const { createMarchingCubesDemo }: typeof import('../../examples/three-marching-cubes/demo') =
        await import(/* @vite-ignore */ module);
      const canvas = document.createElement('canvas');
      canvas.style.display = 'block';
      document.body.replaceChildren(canvas);
      const demo = await createMarchingCubesDemo(canvas, backend);
      window.addEventListener('pagehide', () => { void demo.dispose(); }, { once: true });
      demo.render(seconds * 0.5);
      demo.render(seconds);
      demo.gl.flush();
      await demo.hooks?.device.queue.onSubmittedWorkDone();
      return { backend: demo.backend, calls: demo.renderer.info.render.calls, triangles: demo.renderer.info.render.triangles,
        error: demo.gl.getError(), validationErrors: demo.hooks?.errors.slice() ?? [] };
    }, { backend, seconds });
    const image = await page.locator('canvas').screenshot({ path: `${output}/${backend}-fixed.png` });
    poses.push({ stats, image });
    expect(stats.backend).toBe(backend);
    expect(stats.error).toBe(0);
    expect(stats.validationErrors).toEqual([]);
  }
  const [native, js, rust] = poses;
  const nativeJs = pixelsOverTolerance(native.image, js.image);
  const nativeRust = pixelsOverTolerance(native.image, rust.image);
  await writeFile(`${output}/fixed-pose.json`, JSON.stringify({
    browserVersion: browser.version(), seconds, poses: poses.map(pose => pose.stats),
    nativeJs, nativeRust, jsRustIdentical: js.image.equals(rust.image),
  }, null, 2) + '\n');
  expect(js.stats.triangles).toBe(native.stats.triangles);
  expect(rust.stats.triangles).toBe(native.stats.triangles);
  expect(native.stats.triangles).toBeGreaterThan(8000);
  expect(nativeJs).toBeLessThan(2400);
  expect(nativeRust).toBeLessThan(2400);
  expect(js.image.equals(rust.image)).toBe(true);
});
