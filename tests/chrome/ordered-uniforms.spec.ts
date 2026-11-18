import { expect, test } from '@playwright/test';
import type * as RttCases from '../fixtures/rtt-cases';

for (const backend of ['native', 'js', 'rust'] as const) {
  test(`uniforms retain each draw's value across queued and submitted targets on ${backend}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async backend => {
      const url = '/tests/fixtures/rtt-cases.ts';
      const { prepareRttContext, rttProgram, rttTexture } = await import(/* @vite-ignore */ url) as typeof RttCases;
      const { gl, selectedCore, dispose } = await prepareRttContext(backend, 4, 4);
      try {
        const program = rttProgram(gl);
        const color = gl.getUniformLocation(program, 'u_color');
        const texture = rttTexture(gl, 4, 4, null);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, 2, 4);
        gl.uniform4f(color, 1, 0, 0, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.viewport(2, 0, 2, 4);
        gl.uniform4f(color, 0, 1, 0, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, 4, 4);
        gl.uniform4f(color, 0, 0, 1, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const pixel = (x: number) => {
          const bytes = new Uint8Array(4);
          gl.readPixels(x, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          return [...bytes];
        };
        const output = pixel(1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        return { selectedCore, output, left: pixel(0), right: pixel(3), error: gl.getError() };
      } finally { await dispose(); }
    }, backend);
    expect(result).toEqual({ selectedCore: backend, output: [0, 0, 255, 255], left: [255, 0, 0, 255],
      right: [0, 255, 0, 255], error: 0 });
  });
}
