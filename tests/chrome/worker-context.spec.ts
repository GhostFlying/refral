import { expect, test } from '@playwright/test';

for (const core of ['js', 'rust'] as const) {
  test(`${core} draws and reads pixels in a dedicated worker`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async core => {
      const worker = new Worker('/tests/fixtures/worker-drawing.ts', { type: 'module' });
      try {
        const response = new Promise<unknown>((resolve, reject) => {
          worker.onmessage = event => resolve(event.data);
          worker.onerror = event => reject(new Error(event.message));
        });
        const canvas = new OffscreenCanvas(4, 3);
        worker.postMessage({ canvas, core }, [canvas]);
        return await response;
      } finally { worker.terminate(); }
    }, core);
    expect(result).toMatchObject({ core, worker: true, canvas: true, pixels: [0, 255, 0, 255],
      error: 0, validation: [], adapter: { isFallbackAdapter: false } });
  });
}
