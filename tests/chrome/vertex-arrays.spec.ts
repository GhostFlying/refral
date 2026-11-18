import { expect, test } from '@playwright/test';

for (const core of ['js', 'rust'] as const) {
  test(`${core} resets extension ownership when restoring a vertex array context`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async kind => {
      const path = '/packages/webgl/src/index.ts';
      const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ path);
      const canvas = document.createElement('canvas');
      const gl = await createWebGLOnWebGPU(canvas, { version: 1, core: kind });
      const hooks = getTestingHooks(gl);
      try {
        const ext = gl.getExtension('OES_vertex_array_object')!;
        const array = ext.createVertexArrayOES();
        ext.bindVertexArrayOES(array);
        const before = gl.getParameter(ext.VERTEX_ARRAY_BINDING_OES) === array;
        const loss = gl.getExtension('WEBGL_lose_context')!;
        const lost = new Promise<void>(resolve => canvas.addEventListener('webglcontextlost', event => {
          event.preventDefault();
          resolve();
        }, { once: true }));
        loss.loseContext();
        await lost;
        const restored = new Promise<void>(resolve => canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true }));
        loss.restoreContext();
        await restored;
        const disabled = gl.getParameter(ext.VERTEX_ARRAY_BINDING_OES);
        const disabledError = gl.getError();
        const fresh = gl.getExtension('OES_vertex_array_object')!;
        const obsolete = ext.createVertexArrayOES();
        ext.bindVertexArrayOES(array);
        const afterOldCall = gl.getParameter(fresh.VERTEX_ARRAY_BINDING_OES);
        fresh.bindVertexArrayOES(array);
        return { core: hooks.core, before, disabled, disabledError, freshExtension: fresh !== ext,
          obsoleteCreated: obsolete !== null, oldValid: fresh.isVertexArrayOES(obsolete),
          afterOldCall, staleError: gl.getError(), errors: [...hooks.errors] };
      } finally { await hooks.dispose(); }
    }, core);
    expect(result).toEqual({ core, before: true, disabled: null, disabledError: 0x500, freshExtension: true,
      obsoleteCreated: true, oldValid: false, afterOldCall: null, staleError: 0x502, errors: [] });
  });
}
