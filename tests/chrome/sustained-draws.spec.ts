import { expect, test } from '@playwright/test';

for (const backend of ['native', 'js', 'rust'] as const) {
  test(`consecutive draws preserve immediate canvas pixels and buffer versions on ${backend}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async backend => {
      const runtime = '/packages/webgl/src/index.ts';
      const fixtures = '/tests/fixtures/rtt-cases.ts';
      const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ runtime);
      const { rttProgram }: typeof import('../fixtures/rtt-cases') = await import(/* @vite-ignore */ fixtures);
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 2;
      document.body.append(canvas);
      const attributes = { alpha: true, depth: true, antialias: false, preserveDrawingBuffer: false };
      const gl = backend === 'native' ? canvas.getContext('webgl', attributes) as WebGLRenderingContext
        : await createWebGLOnWebGPU(canvas, { version: 1, core: backend, attributes });
      const hooks = backend === 'native' ? null : getTestingHooks(gl);
      try {
        const program = rttProgram(gl);
        const color = gl.getUniformLocation(program, 'u_color');
        const offset = gl.getUniformLocation(program, 'u_z');
        const dst = new OffscreenCanvas(4, 2).getContext('2d', { willReadFrequently: true })!;
        const observed = () => {
          dst.drawImage(canvas, 0, 0);
          return [...dst.getImageData(2, 1, 1, 1).data];
        };
        const pixels = new Uint8Array(4);
        gl.uniform4f(color, 1, 0, 0, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const before = observed();
        gl.uniform4f(color, 0, 1, 0, 1);
        for (let index = 0; index < 32; index++) {
          gl.uniform1f(offset, index % 2 ? 0.5 : 0);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
        const updated = observed();
        const outside = new Float32Array(12).fill(3);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, outside);
        gl.uniform4f(color, 0, 0, 1, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const afterSubData = observed();
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const afterReplacement = observed();
        gl.readPixels(2, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return { before, updated, afterSubData, afterReplacement, readback: [...pixels],
          backend: hooks?.core ?? 'native', error: gl.getError(), validation: hooks?.errors ?? [] };
      } finally { await hooks?.dispose(); canvas.remove(); }
    }, backend);
    expect(result).toEqual({ before: [255, 0, 0, 255], updated: [0, 255, 0, 255],
      afterSubData: [0, 255, 0, 255], afterReplacement: [0, 0, 255, 255],
      readback: [0, 0, 255, 255], backend, error: 0, validation: [] });
  });
}
