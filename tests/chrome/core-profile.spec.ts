import { expect, test } from '@playwright/test';

test('explicit Rust selection runs its drawing core and JS remains the default', async ({ page }) => {
  await page.goto('/tests/fixtures/runner.html');
  const result = await page.evaluate(async () => {
    const path = '/packages/webgl/src/index.ts';
    const { createWebGLOnWebGPU, getTestingHooks } = await import(/* @vite-ignore */ path);
    const js = await createWebGLOnWebGPU(document.createElement('canvas'), { version: 1 });
    const rust = await createWebGLOnWebGPU(document.createElement('canvas'), { version: 1, core: 'rust' });
    const failure = async (operation: () => unknown) => {
      try { await operation(); return null; }
      catch (error) { return error instanceof Error || error instanceof DOMException ? error.name : String(error); }
    };
    try {
      const shader = js.createShader(js.VERTEX_SHADER);
      const rustShader = rust.createShader(rust.VERTEX_SHADER);
      rust.drawArrays(rust.TRIANGLES, 0, 3);
      const drawError = rust.getError();
      const captured = await getTestingHooks(rust).capture();
      const result = {
        defaultCore: getTestingHooks(js).core,
        explicitCore: getTestingHooks(rust).core,
        jsShaderCreated: shader !== null,
        rustShaderCreated: rustShader !== null,
        drawError,
        captureDimensions: [captured.width, captured.height],
        textureGap: await failure(() => rust.createTexture()),
        rustError: rust.getError(),
      };
      js.deleteShader(shader);
      rust.deleteShader(rustShader);
      return result;
    } finally {
      await getTestingHooks(js).dispose();
      await getTestingHooks(rust).dispose();
    }
  });
  expect(result).toEqual({
    defaultCore: 'js', explicitCore: 'rust', jsShaderCreated: true,
    rustShaderCreated: true, drawError: 0x0502, captureDimensions: [300, 150],
    textureGap: 'NotSupportedError', rustError: 0,
  });
});
