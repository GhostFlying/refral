import { expect, test } from '@playwright/test';

for (const core of ['js', 'rust'] as const) {
  test(`uniforms retain draw values across pages and submissions on ${core}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async core => {
      const runtime = '/packages/webgl/src/index.ts';
      const fixtures = '/tests/fixtures/rtt-cases.ts';
      const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ runtime);
      const { rttProgram }: typeof import('../fixtures/rtt-cases') = await import(/* @vite-ignore */ fixtures);
      const canvas = new OffscreenCanvas(4, 1);
      const gl = await createWebGLOnWebGPU(canvas, { version: 1, core, attributes: { preserveDrawingBuffer: true } });
      const hooks = getTestingHooks(gl)!;
      try {
        const program = rttProgram(gl);
        const color = gl.getUniformLocation(program, 'u_color');
        const z = gl.getUniformLocation(program, 'u_z');
        const draw = (x: number, r: number, g: number, b: number, depth = 0) => {
          gl.viewport(x, 0, 1, 1);
          gl.uniform1f(z, depth);
          gl.uniform4f(color, r, g, b, 1);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        };
        const alignment = hooks.device.limits.minUniformBufferOffsetAlignment;
        const drawsPerPage = (256 * 1024) / (2 * alignment);
        gl.clear(gl.COLOR_BUFFER_BIT);
        draw(0, 1, 0, 0);
        gl.viewport(1, 0, 1, 1);
        gl.uniform4f(color, 0, 0, 1, 1);
        for (let i = 0; i < 2 * drawsPerPage; i++) gl.drawArrays(gl.TRIANGLES, 0, 6);
        draw(2, 0, 1, 0);
        draw(2, 1, 1, 0, 2); // Outside the clip range, leaving the earlier green draw visible.
        gl.flush();
        draw(3, 1, 1, 1);
        gl.flush();
        const { data } = await hooks.capture();
        return { pixels: [...data], errors: hooks.errors, glError: gl.getError(), core: hooks.core };
      } finally { await hooks.dispose(); }
    }, core);
    expect(result).toEqual({
      pixels: [255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255],
      errors: [], glError: 0, core,
    });
  });
}
