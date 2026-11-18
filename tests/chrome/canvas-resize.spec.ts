import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('HTML canvas assignments preserve equal-size attachments and the GL viewport', async ({ page }) => {
  await page.goto('/tests/fixtures/runner.html');
  const rows = await page.evaluate(async () => {
    const path = '/packages/webgl/src/index.ts';
    const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ path);
    const rows = [];
    for (const visibility of ['visible', 'hidden', 'detached'] as const) for (const core of ['native', 'js', 'rust'] as const) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 3;
      canvas.hidden = visibility === 'hidden';
      if (visibility !== 'detached') document.body.appendChild(canvas);
      const attributes = { antialias: false, preserveDrawingBuffer: false };
      const gl = core === 'native' ? (canvas.getContext('webgl', attributes) as WebGLRenderingContext) :
        await createWebGLOnWebGPU(canvas, { version: 1, core, ...attributes });
      const hooks = core === 'native' ? null : getTestingHooks(gl);
      try {
        const surface = hooks ? canvas.getContext('webgpu') : null;
        const pixel = () => {
          const result = new Uint8Array(4);
          gl.readPixels(1, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, result);
          return [...result];
        };
        const sink = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
        const copy = () => {
          sink.globalCompositeOperation = 'copy';
          sink.drawImage(canvas, 0, 0);
          return Array.from(sink.getImageData(1, 0, 1, 1).data);
        };
        const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        gl.viewport(1, 0, 2, 2);
        gl.clearColor(0, 1, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const green = pixel();
        const published = surface?.getCurrentTexture();
        canvas.width = canvas.width;
        const replaced = surface ? published !== surface.getCurrentTexture() : null;
        const afterWidth = pixel();
        const afterWidthCopy = copy();
        canvas.setAttribute('height', String(canvas.height));
        const afterHeight = pixel();
        gl.clearColor(1, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        canvas.width = 5;
        const afterResize = pixel();
        gl.clear(gl.COLOR_BUFFER_BIT);
        canvas.width = 6;
        canvas.width = 5;
        const afterRoundTrip = pixel();
        gl.clear(gl.COLOR_BUFFER_BIT);
        await Promise.resolve();
        canvas.height = canvas.height;
        await Promise.resolve();
        const microtaskCopy = copy();
        const afterMicrotask = pixel();
        gl.clear(gl.COLOR_BUFFER_BIT);
        await frame();
        await frame();
        canvas.width = canvas.width;
        const composedCopy = copy();
        const afterComposite = pixel();
        const size = [gl.drawingBufferWidth, gl.drawingBufferHeight];
        const viewport = Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array);
        await hooks?.device.queue.onSubmittedWorkDone();
        const error = gl.getError();
        const errors = hooks ? [...hooks.errors] : [];
        gl.clearColor(0, 1, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        canvas.width = canvas.width;
        // The sole consumer following this assignment is the unmodified platform Canvas2D API.
        const domOnly = copy();
        rows.push({ core, actual: hooks?.core ?? 'native', visibility, green, replaced, afterWidth, afterHeight, afterResize,
          domOnly, afterWidthCopy, microtaskCopy, composedCopy, afterRoundTrip, afterMicrotask, afterComposite,
          size, viewport, error, errors });
      } finally {
        if (hooks) await hooks.dispose();
        canvas.remove();
      }
    }
    return rows;
  });
  await mkdir('artifacts/resize', { recursive: true });
  await writeFile('artifacts/resize/attachment-observation.json', JSON.stringify(rows, null, 2) + '\n');
  for (const row of rows) {
    expect(row.actual).toBe(row.core);
    expect(row.green).toEqual([0, 255, 0, 255]);
    expect(row.afterWidth, row.core).toEqual(row.green);
    expect(row.afterWidthCopy, row.core).toEqual(row.green);
    expect(row.microtaskCopy, row.core).toEqual([255, 0, 0, 255]);
    expect(row.afterHeight, row.core).toEqual(row.green);
    expect(row.afterResize, row.core).toEqual([0, 0, 0, 0]);
    expect(row.afterRoundTrip, row.core).toEqual([0, 0, 0, 0]);
    expect(row.afterMicrotask, row.core).toEqual([255, 0, 0, 255]);
    expect(row.afterComposite, row.core).toEqual(row.visibility === 'visible' ? [0, 0, 0, 0] : [255, 0, 0, 255]);
    if (row.core === 'native') expect(row.domOnly).toEqual(row.green);
    expect(row.size).toEqual([5, 3]);
    expect(row.viewport).toEqual([1, 0, 2, 2]);
    expect(row.error).toBe(0);
    expect(row.errors).toEqual([]);
  }
});
