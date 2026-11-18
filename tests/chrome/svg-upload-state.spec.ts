import { expect, test } from '@playwright/test';
import type { prepareRttContext } from '../fixtures/rtt-cases';

for (const backend of ['native', 'js', 'rust'] as const) {
  test(`preserve the existing texture on a rejected SVG subimage on ${backend}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async backend => {
      const url = '/tests/fixtures/rtt-cases.ts';
      const fixture = await import(/* @vite-ignore */ url) as { prepareRttContext: typeof prepareRttContext };
      const { gl, selectedCore, dispose } = await fixture.prepareRttContext(backend);
      const svg = new Image();
      svg.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="50" height="50" fill="blue"/></svg>');
      await svg.decode();
      try {
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, svg.width, svg.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const before = new Uint8Array([32, 64, 96, 255]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, before);
        gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gl.getParameter(gl.TEXTURE_BINDING_2D), 0);
        const initial = gl.getError();
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, svg);
        const rejected = gl.getError();
        const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        const read = () => {
          const bytes = new Uint8Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          return [...bytes];
        };
        const retained = complete ? read() : null;
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 0, 255]));
        return { selectedCore, initial, rejected, complete, retained, update: gl.getError(), after: complete ? read() : null };
      } finally { await dispose(); }
    }, backend);
    expect(result.selectedCore).toBe(backend);
    expect(result.initial).toBe(0);
    expect(result.rejected).toBe(0x0501);
    if (backend === 'native' && !result.complete) {
      // Chrome 158 replaces the level while generating INVALID_VALUE.
      expect(result.update).toBe(0x0501);
    } else {
      expect(result.complete).toBe(true);
      expect(result.retained).toEqual([32, 64, 96, 255]);
      expect(result.update).toBe(0);
      expect(result.after).toEqual([255, 0, 0, 255]);
    }
  });
}
