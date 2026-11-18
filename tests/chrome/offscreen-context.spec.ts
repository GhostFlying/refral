import { expect, test } from '@playwright/test';

for (const core of ['js', 'rust'] as const) {
  test(`${core} uses a same-thread offscreen context as a texture source`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async core => {
      const path = '/packages/webgl/src/index.ts';
      const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ path);
      const source = new OffscreenCanvas(4, 3);
      const src = await createWebGLOnWebGPU(source, { version: 1, core });
      const dst = await createWebGLOnWebGPU(new OffscreenCanvas(4, 3), { version: 1, core });
      const srcHooks = getTestingHooks(src);
      const dstHooks = getTestingHooks(dst);
      try {
        const tex = dst.createTexture();
        dst.bindTexture(dst.TEXTURE_2D, tex);
        const fbo = dst.createFramebuffer();
        dst.bindFramebuffer(dst.FRAMEBUFFER, fbo);
        src.clearColor(0, 1, 0, 1);
        src.clear(src.COLOR_BUFFER_BIT);
        // The upload consumes this pending source draw before the next clear.
        dst.texImage2D(dst.TEXTURE_2D, 0, dst.RGBA, dst.RGBA, dst.UNSIGNED_BYTE, source);
        src.clearColor(1, 0, 0, 1);
        src.clear(src.COLOR_BUFFER_BIT);
        dst.framebufferTexture2D(dst.FRAMEBUFFER, dst.COLOR_ATTACHMENT0, dst.TEXTURE_2D, tex, 0);
        const pixels = new Uint8Array(4);
        dst.readPixels(1, 1, 1, 1, dst.RGBA, dst.UNSIGNED_BYTE, pixels);
        const srcPixels = new Uint8Array(4);
        src.readPixels(1, 1, 1, 1, src.RGBA, src.UNSIGNED_BYTE, srcPixels);
        return { cores: [srcHooks.core, dstHooks.core], canvas: src.canvas === source,
          dimensions: [src.drawingBufferWidth, src.drawingBufferHeight], pixels: [...pixels], srcPixels: [...srcPixels],
          errors: [src.getError(), dst.getError()], validation: [...srcHooks.errors, ...dstHooks.errors] };
      } finally {
        await Promise.all([srcHooks.dispose(), dstHooks.dispose()]);
      }
    }, core);
    expect(result).toEqual({ cores: [core, core], canvas: true, dimensions: [4, 3], pixels: [0, 255, 0, 255],
      srcPixels: [255, 0, 0, 255], errors: [0, 0], validation: [] });
  });
}

for (const core of ['js', 'rust'] as const) {
  test(`${core} transfers pending pixels and resets only the default framebuffer`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async core => {
      const path = '/packages/webgl/src/index.ts';
      const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ path);
      const canvas = new OffscreenCanvas(2, 2);
      const originalTransfer = canvas.transferToImageBitmap;
      const gl = await createWebGLOnWebGPU(canvas, { version: 1, core });
      const hooks = getTestingHooks(gl);
      try {
        gl.clearColor(1, 1, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const fbo = gl.createFramebuffer();
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 0, 255]));
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, 0, 0, 0);
        gl.colorMask(false, false, false, false);
        const bitmap = canvas.transferToImageBitmap();
        const copy = new OffscreenCanvas(2, 2).getContext('2d')!;
        copy.drawImage(bitmap, 0, 0);
        bitmap.close();
        const transferred = [...copy.getImageData(0, 0, 1, 1).data];
        const remainedBound = gl.getParameter(gl.FRAMEBUFFER_BINDING) === fbo;
        const read = () => {
          const pixel = new Uint8Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return [...pixel];
        };
        const retained = read();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const fresh = read();
        return { core: hooks.core, transferred, remainedBound, retained, fresh,
          mask: gl.getParameter(gl.COLOR_WRITEMASK), scissor: gl.isEnabled(gl.SCISSOR_TEST), error: gl.getError() };
      } finally {
        await hooks.dispose();
        if (originalTransfer !== canvas.transferToImageBitmap) throw new Error('Canvas hook outlived the context.');
      }
    }, core);
    expect(result).toEqual({ core, transferred: [255, 255, 0, 255], remainedBound: true,
      retained: [255, 0, 0, 255], fresh: [0, 0, 0, 0], mask: [false, false, false, false], scissor: true, error: 0 });
  });
}
