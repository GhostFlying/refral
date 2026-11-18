import { expect, test } from '@playwright/test';
import type { prepareRttContext } from '../fixtures/rtt-cases';

for (const backend of ['native', 'js', 'rust'] as const) {
  test(`upload and snapshot a WebCodecs frame on ${backend}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async backend => {
      const fixtureUrl = '/tests/fixtures/rtt-cases.ts';
      const fixture = await import(/* @vite-ignore */ fixtureUrl) as { prepareRttContext: typeof prepareRttContext };
      const { gl, selectedCore, dispose } = await fixture.prepareRttContext(backend);
      const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
      const createFrame = () => new VideoFrame(pixels, { format: 'RGBA', codedWidth: 1, codedHeight: 2, timestamp: 0 });
      const texture = gl.createTexture();
      const fbo = gl.createFramebuffer();
      const first = createFrame();
      const second = createFrame();
      try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, first);
        first.close();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        const read = () => {
          const bytes = new Uint8Array(8);
          gl.readPixels(0, 0, 1, 2, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          return [...bytes];
        };
        const defined = read();
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, second);
        second.close();
        const updated = read();
        const error = gl.getError();
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, second);
        return { selectedCore, defined, updated, error, closedError: gl.getError(), after: read() };
      } finally {
        first.close(); second.close();
        gl.deleteFramebuffer(fbo); gl.deleteTexture(texture); await dispose();
      }
    }, backend);
    const reversed = [0, 255, 0, 255, 255, 0, 0, 255];
    expect(result).toEqual({ selectedCore: backend, defined: [255, 0, 0, 255, 0, 255, 0, 255],
      updated: reversed, error: 0, closedError: 0x0502, after: reversed });
  });
}
