import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

for (const kind of ['standalone', 'transferred'] as const) {
  test(`complete and partial offscreen clears on ${kind}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const records = await page.evaluate(async kind => {
      const path = '/packages/webgl/src/index.ts';
      const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ path);
      const records = [];
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      for (const core of ['native', 'js', 'rust'] as const) for (const scenario of [
        'color', 'opaque-rgb', 'depth', 'stencil', 'all', 'color-only', 'masked-red', 'masked-alpha',
        'masked-depth', 'masked-stencil', 'scissor', 'fully-masked', 'empty',
      ]) {
        const placeholder = document.createElement('canvas');
        placeholder.width = placeholder.height = 4;
        if (kind === 'transferred') document.body.append(placeholder);
        const canvas = kind === 'standalone' ? new OffscreenCanvas(4, 4) : placeholder.transferControlToOffscreen();
        const attributes = { alpha: scenario !== 'opaque-rgb', antialias: false, preserveDrawingBuffer: false,
          depth: !['color', 'opaque-rgb', 'stencil'].includes(scenario),
          stencil: !['color', 'opaque-rgb', 'depth'].includes(scenario) };
        const gl = core === 'native' ? canvas.getContext('webgl', attributes) : await createWebGLOnWebGPU(canvas, { version: 1, core, attributes });
        if (!gl) throw new Error('Missing WebGL context.');
        const hooks = core === 'native' ? null : getTestingHooks(gl);
        const complete = ['color', 'opaque-rgb', 'depth', 'stencil', 'all'].includes(scenario);
        const timed = ['all', 'color-only'].includes(scenario);
        const probeCount = () => hooks?.stats.offscreenDiscardProbes ?? 0;
        try {
          const all = gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT;
          const warmups = timed ? 5 : 0;
          const iterations = timed ? 30 : 1;
          const samples = [];
          for (let index = -warmups; index < iterations; index++) {
            gl.disable(gl.SCISSOR_TEST);
            gl.colorMask(true, true, true, true); gl.depthMask(true); gl.stencilMask(255);
            gl.clearColor(1, 0, 0, 1); gl.clearDepth(0.25); gl.clearStencil(7); gl.clear(all);
            await frame(); await frame();
            if (scenario === 'masked-red') gl.colorMask(false, true, true, true);
            if (scenario === 'masked-alpha' || scenario === 'opaque-rgb') gl.colorMask(true, true, true, false);
            if (scenario === 'masked-depth') gl.depthMask(false);
            if (scenario === 'masked-stencil') gl.stencilMask(127);
            if (scenario === 'fully-masked') { gl.colorMask(false, false, false, false); gl.depthMask(false); gl.stencilMask(0); }
            if (scenario === 'scissor') { gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 1, 1); }
            gl.clearColor(0, 1, 1, 1); gl.clearDepth(0.75); gl.clearStencil(9);
            const mask = scenario === 'empty' ? 0 : scenario === 'color-only' ? gl.COLOR_BUFFER_BIT : all;
            const before = probeCount();
            const start = performance.now();
            gl.clear(mask);
            const ms = performance.now() - start;
            // Observe host probes after the pending clear has reached the host.
            const error = gl.getError();
            const probes = probeCount() - before;
            const pixel = new Uint8Array(4);
            gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            if (index >= 0) samples.push({ ms, probes, error, pixel: [...pixel] });
          }
          if (hooks) await hooks.device.queue.onSubmittedWorkDone();
          records.push({ core, actual: hooks?.core ?? 'native', scenario, complete, warmups, attributes,
            actualAttributes: gl.getContextAttributes(), error: gl.getError(), validation: hooks?.errors ?? [], samples });
        } finally {
          if (hooks) await hooks.dispose(); else gl.getExtension('WEBGL_lose_context')?.loseContext();
          placeholder.remove();
        }
      }
      return records;
    }, kind);
    await mkdir('artifacts/offscreen-discard', { recursive: true });
    await writeFile(`artifacts/offscreen-discard/clear-${kind}.json`, JSON.stringify(records, null, 2) + '\n');
    for (const row of records) {
      expect(row.actual).toBe(row.core);
      expect(row.error).toBe(0);
      expect(row.validation).toEqual([]);
      const retained = kind === 'standalone';
      const noWrite = ['fully-masked', 'empty'].includes(row.scenario);
      const expected = [0, 255, 255, 255];
      if (row.scenario === 'masked-red' && retained) expected[0] = 255;
      if (row.scenario === 'masked-alpha' && !retained) expected[3] = 0;
      const pixel = row.scenario === 'scissor' || noWrite ? (retained ? [255, 0, 0, 255] : [0, 0, 0, 0]) : expected;
      for (const sample of row.samples) {
        expect(sample.error).toBe(0);
        expect(sample.pixel).toEqual(pixel);
        if (row.core !== 'native') expect(sample.probes).toBe(row.complete || noWrite ? 0 : 1);
      }
    }
  });
}
