import { expect, test } from '@playwright/test';

for (const backend of ['native', 'js', 'rust'] as const) {
  test(`explicit and automatic canvas publication on ${backend}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const observations = await page.evaluate(async backend => {
      const path = '/packages/webgl/src/index.ts';
      const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ path);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      document.body.append(canvas);
      const attributes = { alpha: true, antialias: false, preserveDrawingBuffer: false };
      const gl = backend === 'native' ? canvas.getContext('webgl', attributes) as WebGLRenderingContext
        : await createWebGLOnWebGPU(canvas, { version: 1, core: backend, attributes });
      const hooks = backend === 'native' ? null : getTestingHooks(gl);
      const sink = new OffscreenCanvas(2, 2).getContext('2d', { willReadFrequently: true })!;
      const drawImage = OffscreenCanvasRenderingContext2D.prototype.drawImage;
      sink.globalCompositeOperation = 'copy';
      const snapshot = () => {
        Reflect.apply(drawImage, sink, [canvas, 0, 0]);
        return [...sink.getImageData(0, 0, 1, 1).data];
      };
      try {
        gl.clearColor(1, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.flush();
        const red = snapshot();
        const initialSubmits = hooks?.stats.submits ?? 0;
        gl.clearColor(0, 1, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const beforeFlush = snapshot();
        const unsubmitted = (hooks?.stats.submits ?? 0) - initialSubmits;
        gl.flush();
        const afterFlush = snapshot();
        gl.clearColor(0, 0, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        await Promise.resolve();
        const afterMicrotask = snapshot();
        return { red, beforeFlush, unsubmitted, afterFlush, afterMicrotask,
          totalSubmits: (hooks?.stats.submits ?? 0) - initialSubmits, error: gl.getError(), gpuErrors: hooks?.errors ?? [] };
      } finally {
        await hooks?.dispose();
        canvas.remove();
      }
    }, backend);
    expect(observations).toEqual({
      red: [255, 0, 0, 255], beforeFlush: backend === 'native' ? [0, 255, 0, 255] : [255, 0, 0, 255],
      unsubmitted: 0, afterFlush: [0, 255, 0, 255], afterMicrotask: [0, 0, 255, 255],
      totalSubmits: backend === 'native' ? 0 : 2, error: 0, gpuErrors: [],
    });
  });
}
