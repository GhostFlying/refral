import { test, expect } from '@playwright/test';

test('device loss notifies the context and invalidates new resources', async ({ page }) => {
  await page.goto('/tests/fixtures/runner.html');
  const result = await page.evaluate(async () => {
    const path = '/packages/webgl/src/index.ts';
    const { createWebGLOnWebGPU, getTestingHooks } = await import(/* @vite-ignore */ path);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    document.body.appendChild(canvas);
    const gl = await createWebGLOnWebGPU(canvas, { version: 1 });
    const hooks = getTestingHooks(gl);
    const lost = new Promise<boolean>((resolve) => canvas.addEventListener('webglcontextlost', (event) => resolve(event.cancelable), { once: true }));
    hooks.device.destroy();
    const cancelable = await lost;
    const buffer = gl.createBuffer();
    const result = { lost: gl.isContextLost(), cancelable, attributes: gl.getContextAttributes(), error: gl.getError(), nextError: gl.getError(), bufferCreated: buffer !== null, bufferValid: gl.isBuffer(buffer), shaderCreated: gl.createShader(gl.VERTEX_SHADER) !== null, viewport: gl.getParameter(gl.VIEWPORT) };
    await hooks.dispose();
    result.viewport = gl.getParameter(gl.VIEWPORT);
    return result;
  });
  expect(result).toEqual({ lost: true, cancelable: true, attributes: null, error: 0x9242, nextError: 0, bufferCreated: true, bufferValid: false, shaderCreated: true, viewport: null });
});

test('presentation after resizing a zero-sized drawing surface', async ({ page }) => {
  await page.goto('/tests/fixtures/runner.html');
  for (const core of ['js', 'rust'] as const) {
    const result = await page.evaluate(async core => {
      const path = '/packages/webgl/src/index.ts';
      const { createWebGLOnWebGPU, getTestingHooks } = await import(/* @vite-ignore */ path);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 0;
      const gl: WebGLRenderingContext = await createWebGLOnWebGPU(canvas, { version: 1, core });
      const hooks = getTestingHooks(gl);
      try {
        const initial = [gl.drawingBufferWidth, gl.drawingBufferHeight];
        gl.clearColor(1, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const pixel = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        canvas.width = canvas.height = 2;
        gl.clearColor(0, 1, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.flush();
        const sink = document.createElement('canvas').getContext('2d')!;
        sink.drawImage(canvas, 0, 0);
        const presented = Array.from(sink.getImageData(0, 0, 1, 1).data);
        await hooks.device.queue.onSubmittedWorkDone();
        return { initial, pixel: Array.from(pixel), presented, error: gl.getError(), validation: [...hooks.errors] };
      } finally {
        await hooks.dispose();
      }
    }, core);
    expect(result, core).toEqual({ initial: [1, 1], pixel: [255, 0, 0, 255],
      presented: [0, 255, 0, 255], error: 0, validation: [] });
  }
});

for (const core of ['js', 'rust'] as const) {
  test(`${core} loses and restores one generation on a shared device`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async core => {
      const path = '/packages/webgl/src/index.ts';
      const { prepareContextFactory, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ path);
      const factory = await prepareContextFactory({ core });
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 3; canvas.height = 2;
        const gl = factory(canvas);
        const hooks = getTestingHooks(gl);
        const peer = factory(new OffscreenCanvas(2, 2));
        const deviceShared = hooks.device === getTestingHooks(peer).device;
        peer.clearColor(1, 0, 0, 1);
        peer.clear(peer.COLOR_BUFFER_BIT);
        const initialExtensions = gl.getSupportedExtensions()?.sort();
        const ext = gl.getExtension('WEBGL_lose_context')!;
        const previous = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, previous);
        gl.bufferData(gl.ARRAY_BUFFER, 16, gl.STATIC_DRAW);
        gl.clearColor(0.4, 0.5, 0.6, 1);
        const errors: number[] = [];
        ext.restoreContext(); errors.push(gl.getError());
        const loss = new Promise<void>(r => canvas.addEventListener('webglcontextlost', e => {
          e.preventDefault();
          ext.restoreContext(); errors.push(gl.getError()); r();
        }, { once: true }));
        const restored = new Promise<void>(r => canvas.addEventListener('webglcontextrestored', () => r(), { once: true }));
        ext.loseContext();
        const immediate = gl.isContextLost();
        const lostExtensions = gl.getSupportedExtensions();
        errors.push(gl.getError(), gl.getError());
        ext.loseContext(); errors.push(gl.getError());
        await loss;
        ext.restoreContext(); ext.restoreContext();
        const queued = gl.isContextLost();
        await restored;
        const restoredState = [gl.getParameter(gl.ARRAY_BUFFER_BINDING), ...gl.getParameter(gl.COLOR_CLEAR_VALUE)];
        gl.bindBuffer(gl.ARRAY_BUFFER, previous); errors.push(gl.getError());
        const fresh = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, fresh);
        const bound = gl.isBuffer(fresh) && !gl.isBuffer(previous);
        gl.clearColor(0, 1, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        const read = (context: WebGLRenderingContext) => {
          const out = new Uint8Array(4);
          context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, out);
          return [...out];
        };
        return { core: hooks.core, deviceShared, immediate, queued, initialExtensions, lostExtensions, restoredExtensions: gl.getSupportedExtensions()?.sort(),
          sameExtension: ext === gl.getExtension('webgl_lose_context'), bound, restoredState, errors,
          pixels: read(gl), peerPixels: read(peer), lost: gl.isContextLost(), peerLost: peer.isContextLost() };
      } finally { await factory.dispose(); }
    }, core);
    const supported = ['EXT_blend_minmax', 'EXT_frag_depth', 'EXT_sRGB', 'EXT_shader_texture_lod',
      'OES_element_index_uint', 'OES_fbo_render_mipmap', 'OES_standard_derivatives',
      'OES_texture_float', 'OES_vertex_array_object', 'WEBGL_lose_context'];
    expect(result).toEqual({ core, deviceShared: true, immediate: true, queued: true,
      initialExtensions: supported, lostExtensions: null, restoredExtensions: supported,
      sameExtension: true, bound: true, restoredState: [null, 0, 0, 0, 0], errors: [0x0502, 0x9242, 0, 0x0502, 0x0502, 0x0502],
      pixels: [0, 255, 0, 255], peerPixels: [255, 0, 0, 255], lost: false, peerLost: false });
  });
}
