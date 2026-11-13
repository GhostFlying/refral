import { expect, test } from '@playwright/test';

test('explicit Rust selection reports its Buffer profile and JS remains the rendering default', async ({ page }) => {
  await page.goto('/tests/fixtures/runner.html');
  const result = await page.evaluate(async () => {
    const path = '/packages/webgl/src/index.ts';
    const { createWebGLOnWebGPU, getTestingHooks } = await import(/* @vite-ignore */ path);
    const js = await createWebGLOnWebGPU(document.createElement('canvas'), { version: 1 });
    const rust = await createWebGLOnWebGPU(document.createElement('canvas'), { version: 1, core: 'rust' });
    const failure = async (operation: () => unknown) => {
      try { await operation(); return null; }
      catch (error) { return error instanceof DOMException ? error.name : String(error); }
    };
    try {
      const shader = js.createShader(js.VERTEX_SHADER);
      const result = {
        defaultCore: getTestingHooks(js).core,
        explicitCore: getTestingHooks(rust).core,
        jsShaderCreated: shader !== null,
        rustShader: await failure(() => rust.createShader(rust.VERTEX_SHADER)),
        rustDraw: await failure(() => rust.drawArrays(rust.TRIANGLES, 0, 3)),
        rustCapture: await failure(() => getTestingHooks(rust).capture()),
        rustError: rust.getError(),
      };
      js.deleteShader(shader);
      return result;
    } finally {
      await getTestingHooks(js).dispose();
      await getTestingHooks(rust).dispose();
    }
  });
  expect(result).toEqual({
    defaultCore: 'js', explicitCore: 'rust', jsShaderCreated: true,
    rustShader: 'NotSupportedError', rustDraw: 'NotSupportedError', rustCapture: 'NotSupportedError', rustError: 0,
  });
});
