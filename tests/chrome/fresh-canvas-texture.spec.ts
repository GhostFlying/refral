import { expect, test } from '@playwright/test';
import type { prepareRttContext } from '../fixtures/rtt-cases';

test('fresh canvas uploads transparent pixels and preserves its context mode', async ({ page }) => {
  await page.goto('/tests/fixtures/runner.html');
  for (const backend of ['native', 'js', 'rust'] as const) {
    const result = await page.evaluate(async backend => {
      const path = '/tests/fixtures/rtt-cases.ts';
      const fixture = await import(/* @vite-ignore */ path) as { prepareRttContext: typeof prepareRttContext };
      const { gl, selectedCore, dispose } = await fixture.prepareRttContext(backend);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      try {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(16).fill(255));
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        const bytes = new Uint8Array(16).fill(255);
        gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        return { selectedCore, pixels: [...bytes], error: gl.getError(), free: !!canvas.getContext('bitmaprenderer') };
      } finally { await dispose(); }
    }, backend);
    expect(result).toEqual({ selectedCore: backend, pixels: Array(16).fill(0), error: 0, free: true });
  }
});
