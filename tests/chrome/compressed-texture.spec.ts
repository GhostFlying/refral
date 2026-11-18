import { expect, test } from '@playwright/test';
import type { prepareRttContext } from '../fixtures/rtt-cases';

for (const backend of ['native', 'js', 'rust'] as const) {
  test(`compressed texture calls before enabling any format on ${backend}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async backend => {
      const path = '/tests/fixtures/rtt-cases.ts';
      const fixture: { prepareRttContext: typeof prepareRttContext } = await import(/* @vite-ignore */ path);
      const { gl, selectedCore, dispose } = await fixture.prepareRttContext(backend, 1, 1);
      try {
        const formats = gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS);
        const fresh = formats !== gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS);
        const bytes = new DataView(new ArrayBuffer(12), 4, 8);
        const pvrtc = 0x8c00;
        gl.compressedTexImage2D(gl.TEXTURE_2D, 0, pvrtc, 4, 4, 0, bytes);
        const unbound = gl.getError();
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const color = new Uint8Array([29, 107, 203, 255]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, color);
        gl.compressedTexImage2D(gl.TEXTURE_2D, 0, pvrtc, 4, 4, 0, bytes);
        const definition = gl.getError();
        gl.compressedTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, pvrtc, bytes);
        const update = gl.getError();
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        const pixel = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return { selectedCore, uints: formats instanceof Uint32Array, length: formats.length, fresh,
          unbound, definition, update, color: Array.from(pixel), finalError: gl.getError() };
      } finally {
        await dispose();
      }
    }, backend);
    const { update, ...rest } = result;
    // The original CTS accepts INVALID_OPERATION when the existing image is uncompressed.
    expect(backend === 'native' ? [0x0500, 0x0502] : [0x0500]).toContain(update);
    expect(rest).toEqual({ selectedCore: backend, uints: true, length: 0, fresh: true,
      unbound: 0x0502, definition: 0x0500, color: [29, 107, 203, 255], finalError: 0 });
  });
}
