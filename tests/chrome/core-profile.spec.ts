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
      const texture = rust.createTexture();
      rust.bindTexture(rust.TEXTURE_2D, texture);
      const result = {
        defaultCore: getTestingHooks(js).core,
        explicitCore: getTestingHooks(rust).core,
        jsShaderCreated: shader !== null,
        rustShaderCreated: rustShader !== null,
        drawError,
        captureDimensions: [captured.width, captured.height],
        rustTextureCreated: rust.isTexture(texture),
        mipmapGap: await failure(() => rust.generateMipmap(rust.TEXTURE_2D)),
        rustError: rust.getError(),
        members: [js, rust].map(gl => ({
          draw: [typeof gl.drawArrays, 'drawArrays' in gl, gl.drawArrays === gl.drawArrays],
          webgl2Draw: [typeof Reflect.get(gl, 'drawArraysInstanced'), 'drawArraysInstanced' in gl],
          unpackColorSpace: [typeof gl.unpackColorSpace, 'unpackColorSpace' in gl],
          drawingBuffer: ['drawingBufferWidth' in gl, gl.drawingBufferColorSpace],
          constants: [gl.TRIANGLE_STRIP, gl.STENCIL_WRITEMASK, 'TRIANGLE_STRIP' in gl],
          expando: Reflect.set(gl, 'marker', 42) && Reflect.get(gl, 'marker'),
        })),
      };
      js.deleteShader(shader);
      rust.deleteShader(rustShader);
      rust.deleteTexture(texture);
      return result;
    } finally {
      await getTestingHooks(js).dispose();
      await getTestingHooks(rust).dispose();
    }
  });
  expect(result).toEqual({
    defaultCore: 'js', explicitCore: 'rust', jsShaderCreated: true,
    rustShaderCreated: true, drawError: 0x0502, captureDimensions: [300, 150],
    rustTextureCreated: true, mipmapGap: 'NotSupportedError', rustError: 0,
    members: [0, 1].map(() => ({
      draw: ['function', true, true], webgl2Draw: ['undefined', false],
      unpackColorSpace: ['undefined', false], drawingBuffer: [true, 'srgb'],
      constants: [5, 0x0b98, true], expando: 42,
    })),
  });
});
