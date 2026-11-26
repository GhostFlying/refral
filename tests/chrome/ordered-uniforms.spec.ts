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

for (const backend of ['native', 'js', 'rust'] as const) {
  test(`matrix setters capture the current contents of a reused foreign subview on ${backend}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async backend => {
      const url = '/tests/fixtures/rtt-cases.ts';
      const { prepareRttContext, rttProgram } = await import(/* @vite-ignore */ url) as typeof RttCases;
      const { gl, dispose } = await prepareRttContext(backend, 4, 4);
      const iframe = document.createElement('iframe');
      document.body.append(iframe);
      try {
        const program = rttProgram(gl, undefined,
          'precision mediump float; uniform mat2 m; void main(){gl_FragColor=vec4(m[0],0.,1.);}');
        const m = gl.getUniformLocation(program, 'm')!;
        const ForeignFloats = (iframe.contentWindow as Window & typeof globalThis).Float32Array;
        const values = new ForeignFloats([12, 1, 0, 0, 1, 13]).subarray(1, 5);
        gl.uniformMatrix2fv(m, false, values);
        values.set([0, 1, 1, 0]);
        gl.viewport(0, 0, 2, 4);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.uniformMatrix2fv(m, false, values);
        values.fill(0);
        gl.viewport(2, 0, 2, 4);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const pixels = new Uint8Array(8);
        gl.readPixels(1, 1, 2, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const query = Array.from(gl.getUniform(program, m));
        return { pixels: [...pixels], query, error: gl.getError() };
      } finally { iframe.remove(); await dispose(); }
    }, backend);
    expect(result).toEqual({ pixels: [255, 0, 0, 255, 0, 255, 0, 255], query: [0, 1, 1, 0], error: 0 });
  });
}
