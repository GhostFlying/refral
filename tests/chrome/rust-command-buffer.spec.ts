import { expect, test } from '@playwright/test';

test('Rust command buffer preserves draw snapshots and synchronous query order', async ({ page }) => {
  await page.goto('/tests/fixtures/runner.html');
  const result = await page.evaluate(async () => {
    const runtime = '/packages/webgl/src/index.ts';
    const fixtures = '/tests/fixtures/rtt-cases.ts';
    const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ runtime);
    const { rttProgram }: typeof import('../fixtures/rtt-cases') = await import(/* @vite-ignore */ fixtures);
    const gl = await createWebGLOnWebGPU(new OffscreenCanvas(4, 2), { version: 1, core: 'rust' });
    const hooks = getTestingHooks(gl);
    try {
      const extension = gl.getExtension('OES_vertex_array_object')!;
      const vao = extension.createVertexArrayOES()!;
      extension.bindVertexArrayOES(vao);
      const program = rttProgram(gl);
      const color = gl.getUniformLocation(program, 'u_color');
      const enabled = hooks.enableRustCommandBuffer();
      const value = new Float32Array([1, 0, 0, 1]);
      extension.bindVertexArrayOES(null);
      extension.bindVertexArrayOES(vao);
      gl.viewport(0, 0, 2, 2);
      gl.uniform4fv(color, value);
      value.set([0, 1, 0, 1]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.viewport(2, 0, 2, 2);
      gl.uniform4fv(color, value);
      value.set([0, 0, 1, 1]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.drawArrays(0xffff, 0, 6);
      const pending = hooks.rustCommandBatchStats();
      const error = gl.getError();
      const drained = hooks.rustCommandBatchStats();
      const binding = gl.getParameter(extension.VERTEX_ARRAY_BINDING_OES) === vao;
      const left = new Uint8Array(4);
      const right = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, left);
      gl.readPixels(3, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, right);
      for (let index = 0; index < 3_000; index++) gl.uniform4f(color, 0, 0, index % 2, 1);
      const overflowBatches = hooks.rustCommandBatchStats()!.batches;
      const lastUniform = [...gl.getUniform(program, color!) as Float32Array];
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.flush();
      const reused = hooks.rustCommandBatchStats();
      return { enabled, pending, drained, binding, error, invalidEnum: gl.INVALID_ENUM, overflowBatches,
        lastUniform, reused, left: [...left], right: [...right], finalError: gl.getError(), validation: hooks.errors };
    } finally { await hooks.dispose(); }
  });
  expect(result.enabled).toBe(true);
  expect(result.pending).toMatchObject({ commands: 9, batches: 0 });
  expect(result.drained).toMatchObject({ commands: 9, batches: 1, bufferCopies: 1 });
  expect(result.error).toBe(result.invalidEnum);
  expect(result.binding).toBe(true);
  expect(result.left).toEqual([255, 0, 0, 255]);
  expect(result.right).toEqual([0, 255, 0, 255]);
  expect(result.overflowBatches).toBe(2);
  expect(result.lastUniform).toEqual([0, 0, 1, 1]);
  expect(result.reused).toMatchObject({ batches: 4, bufferCopies: 1 });
  expect(result.finalError).toBe(0);
  expect(result.validation).toEqual([]);
});

test('Rust command buffer orders framebuffer writes and program retirement with draws', async ({ page }) => {
  await page.goto('/tests/fixtures/runner.html');
  const result = await page.evaluate(async () => {
    const runtime = '/packages/webgl/src/index.ts';
    const fixtures = '/tests/fixtures/rtt-cases.ts';
    const { createWebGLOnWebGPU, getTestingHooks }: typeof import('@refral/webgl') = await import(/* @vite-ignore */ runtime);
    const { rttProgram, rttTexture }: typeof import('../fixtures/rtt-cases') = await import(/* @vite-ignore */ fixtures);
    const gl = await createWebGLOnWebGPU(new OffscreenCanvas(4, 2), { version: 1, core: 'rust' });
    const hooks = getTestingHooks(gl);
    try {
      const first = rttProgram(gl);
      const second = rttProgram(gl);
      const firstColor = gl.getUniformLocation(first, 'u_color');
      const secondColor = gl.getUniformLocation(second, 'u_color');
      const texture = rttTexture(gl, 4, 2, null);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.useProgram(first);
      gl.deleteProgram(first);
      const enabled = hooks.enableRustCommandBuffer();
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.viewport(0, 0, 2, 2);
      gl.uniform4f(firstColor, 1, 0, 0, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.useProgram(second);
      gl.viewport(2, 0, 2, 2);
      gl.uniform4f(secondColor, 0, 0, 1, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const left = new Uint8Array(4);
      const right = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, left);
      gl.readPixels(3, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, right);
      return { enabled, complete: status === gl.FRAMEBUFFER_COMPLETE, deleted: !gl.isProgram(first),
        left: [...left], right: [...right], error: gl.getError(), validation: hooks.errors,
        batches: hooks.rustCommandBatchStats()?.batches };
    } finally { await hooks.dispose(); }
  });
  expect(result).toEqual({ enabled: true, complete: true, deleted: true, left: [255, 0, 0, 255],
    right: [0, 0, 255, 255], error: 0, validation: [], batches: 1 });
});
