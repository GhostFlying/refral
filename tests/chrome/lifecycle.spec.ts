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
