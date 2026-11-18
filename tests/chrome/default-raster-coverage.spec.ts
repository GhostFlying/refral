import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

for (const backend of ['native', 'js', 'rust'] as const) {
  test(`adjacent default-framebuffer triangles cover each shared edge sample once on ${backend}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const observed = await page.evaluate(async backend => {
      const runtime = '/packages/webgl/src/index.ts';
      const fixtures = '/tests/fixtures/rtt-cases.ts';
      const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ runtime);
      const { rttProgram }: typeof import('../fixtures/rtt-cases') = await import(/* @vite-ignore */ fixtures);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 8;
      const attributes = { antialias: false, depth: true, preserveDrawingBuffer: false };
      const gl = backend === 'native' ? canvas.getContext('webgl', attributes) as WebGLRenderingContext
        : await createWebGLOnWebGPU(canvas, { version: 1, core: backend, attributes });
      const hooks = backend === 'native' ? null : getTestingHooks(gl);
      try {
        const program = rttProgram(gl);
        gl.uniform4f(gl.getUniformLocation(program, 'u_color'), 0.25, 0, 0, 1);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.depthFunc(gl.ALWAYS);
        gl.depthMask(false);

        // Both triangles share the horizontal edge (1.5, 3.5) to (6.5, 3.5).
        const positions = [1.5, 3.5, 6.5, 3.5, 4.5, 7.5, 6.5, 3.5, 1.5, 3.5, 4.5, 0.5];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions.map(value => value / 4 - 1)), gl.STATIC_DRAW);
        const frames: number[][] = [];
        for (const first of [0, 3]) {
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.disable(gl.DEPTH_TEST);
          gl.drawArrays(gl.TRIANGLES, first, 3);
          gl.enable(gl.DEPTH_TEST);
          gl.drawArrays(gl.TRIANGLES, 3 - first, 3);
          const pixels = new Uint8Array(8 * 8 * 4);
          gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          frames.push([...pixels]);
        }
        return { frames, backend: hooks?.core ?? 'native', error: gl.getError(), diagnostics: [...hooks?.errors ?? []] };
      } finally { await hooks?.dispose(); }
    }, backend);
    const directory = 'artifacts/differential/default-raster-coverage';
    await mkdir(directory, { recursive: true });
    const rows: number[][] = [];
    for (const [order, pixels] of observed.frames.entries()) {
      const image = new PNG({ width: 8, height: 8 });
      for (let y = 0; y < 8; y++) image.data.set(pixels.slice(32 * y, 32 * (y + 1)), 32 * (7 - y));
      await writeFile(`${directory}/${backend}-${order}.png`, PNG.sync.write(image));
      rows.push([2, 3, 4, 5].map(x => pixels[4 * (8 * 3 + x)]!));
    }
    expect(rows).toEqual([[64, 64, 64, 64], [64, 64, 64, 64]]);
    expect(observed.backend).toBe(backend);
    expect(observed.error).toBe(0);
    expect(observed.diagnostics).toEqual([]);
  });
}
