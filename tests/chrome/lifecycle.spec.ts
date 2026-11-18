import { test, expect } from '@playwright/test';

test('device loss notifies the context and terminates resource creation', async ({ page }) => {
  await page.goto('/tests/fixtures/runner.html');
  const result = await page.evaluate(async () => {
    const path = '/packages/webgl/src/index.ts';
    const { createWebGLOnWebGPU, getTestingHooks } = await import(/* @vite-ignore */ path);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    document.body.appendChild(canvas);
    const gl = await createWebGLOnWebGPU(canvas, { version: 1 });
    const hooks = getTestingHooks(gl);
    const lost = new Promise<boolean>((resolve) => canvas.addEventListener('webglcontextlost', (event) => resolve(event.cancelable), { once: true }));
    hooks.device.destroy();
    const cancelable = await lost;
    const buffer = gl.createBuffer();
    const result = { lost: gl.isContextLost(), cancelable, attributes: gl.getContextAttributes(), error: gl.getError(), nextError: gl.getError(), bufferCreated: buffer !== null, bufferValid: gl.isBuffer(buffer), shader: gl.createShader(gl.VERTEX_SHADER), viewport: gl.getParameter(gl.VIEWPORT) };
    await hooks.dispose();
    result.viewport = gl.getParameter(gl.VIEWPORT);
    return result;
  });
  expect(result).toEqual({ lost: true, cancelable: true, attributes: null, error: 0x9242, nextError: 0, bufferCreated: true, bufferValid: false, shader: null, viewport: null });
});

test('presentation after resizing a zero-sized drawing surface', async ({ page }) => {
  await page.goto('/tests/fixtures/runner.html');
  for (const core of ['js', 'rust'] as const) {
    const result = await page.evaluate(async core => {
      const path = '/packages/webgl/src/index.ts';
      const { createWebGLOnWebGPU, getTestingHooks } = await import(/* @vite-ignore */ path);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 0;
      const gl: WebGLRenderingContext = await createWebGLOnWebGPU(canvas, { version: 1, core });
      const hooks = getTestingHooks(gl);
      try {
        const initial = [gl.drawingBufferWidth, gl.drawingBufferHeight];
        gl.clearColor(1, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const pixel = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        canvas.width = canvas.height = 2;
        gl.clearColor(0, 1, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.flush();
        const sink = document.createElement('canvas').getContext('2d')!;
        sink.drawImage(canvas, 0, 0);
        const presented = Array.from(sink.getImageData(0, 0, 1, 1).data);
        await hooks.device.queue.onSubmittedWorkDone();
        return { initial, pixel: Array.from(pixel), presented, error: gl.getError(), validation: [...hooks.errors] };
      } finally {
        await hooks.dispose();
      }
    }, core);
    expect(result, core).toEqual({ initial: [1, 1], pixel: [255, 0, 0, 255],
      presented: [0, 255, 0, 255], error: 0, validation: [] });
  }
});
