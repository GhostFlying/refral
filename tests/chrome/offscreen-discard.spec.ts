import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import type { runDiscardCase, Scenario } from '../fixtures/offscreen-discard';

for (const realm of ['window', 'worker'] as const) for (const kind of ['standalone', 'detached', 'visible'] as const) {
  test(`offscreen discard state in ${realm} for ${kind}`, async ({ page }) => {
    const directory = `artifacts/offscreen-discard/${realm}-${kind}`;
    await mkdir(directory, { recursive: true });
    await page.goto('/tests/fixtures/runner.html');
    const screens: Array<{ id: string; pixel: number[] }> = [];
    await page.exposeFunction('captureOffscreenFront', async (id: string) => {
      const png = PNG.sync.read(await page.screenshot({ path: `${directory}/${id}.png` }));
      const start = 4 * (png.width * 12 + 12);
      screens.push({ id, pixel: [...png.data.subarray(start, start + 4)] });
    });
    const records = [];
    for (const backend of ['native', 'js', 'rust'] as const) for (const scenario of ['color', 'depth', 'stencil'] as const) {
      const result = await page.evaluate(async ({ backend, scenario, realm, kind }) => {
        const placeholder = document.createElement('canvas');
        placeholder.width = placeholder.height = 16;
        placeholder.style.cssText = 'position:fixed;top:0;left:0;width:24px;height:24px;z-index:1';
        if (kind === 'visible') document.body.append(placeholder);
        const canvas = kind === 'standalone' ? new OffscreenCanvas(16, 16) : placeholder.transferControlToOffscreen();
        const capture = async (step: string) => {
          if (kind === 'visible') await (window as unknown as {
            captureOffscreenFront(id: string): Promise<void>;
          }).captureOffscreenFront(backend + '-' + step);
        };
        try {
          if (realm === 'window') {
            const path = '/tests/fixtures/offscreen-discard.ts';
            const fixture: { runDiscardCase: typeof runDiscardCase } = await import(/* @vite-ignore */ path);
            return await fixture.runDiscardCase(canvas, backend, scenario as Scenario, capture);
          }
          const worker = new Worker('/tests/fixtures/offscreen-discard-worker.ts', { type: 'module' });
          try {
            return await new Promise<Awaited<ReturnType<typeof runDiscardCase>>>((resolve, reject) => {
              worker.onmessage = async event => {
                if (event.data.capture) {
                  try { await capture(event.data.capture); worker.postMessage({ ready: true }); } catch (error) { reject(error); }
                } else if (event.data.error) reject(new Error(event.data.error));
                else resolve(event.data.result);
              };
              worker.onerror = event => reject(new Error(event.message));
              worker.postMessage({ canvas, backend, scenario }, [canvas]);
            });
          } finally { worker.terminate(); }
        } finally { placeholder.remove(); }
      }, { backend, scenario, realm, kind });
      records.push({ ...result, requested: backend });
    }
    await writeFile(directory + '/results.json', JSON.stringify({ records, screens }, null, 2) + '\n');
    const zero = [0, 0, 0, 0], hidden = [255, 128, 64, 0], blue = [0, 0, 255, 255];
    for (const record of records) {
      const live = kind === 'standalone';
      expect(record.core).toBe(record.requested);
      expect(record.glError).toBe(0);
      expect(record.errors).toEqual([]);
      expect(record.emptyProbes).toBe(0);
      expect(record.indeterminate).toBe(0);
      if (record.scenario === 'color') {
        expect(record.first).toEqual(hidden);
        expect(record.after).toEqual(live ? hidden : zero);
        expect(record.second).toEqual(blue);
        expect(record.final).toEqual(live ? blue : zero);
      } else {
        expect(record.first).toEqual(zero);
        expect(record.after).toEqual(live ? [0, 255, 0, 255] : zero);
      }
      if (record.core !== 'native') {
        const generations = record.scenario === 'color' ? 2 : 1;
        expect(record.probes).toBe(generations);
        expect(record.discards).toBe(live ? 0 : generations);
      }
    }
    for (const { pixel } of screens) expect(pixel).toEqual(blue);
  });
}
