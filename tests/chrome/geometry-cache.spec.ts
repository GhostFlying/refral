import { expect, test } from '@playwright/test';

for (const core of ['js', 'rust'] as const) {
  test(`static vertex and index buffers survive flush on ${core}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const result = await page.evaluate(async core => {
      const entry = '/examples/three-shapes/demo.ts';
      const { createShapesDemo }: typeof import('../../examples/three-shapes/demo') =
        await import(/* @vite-ignore */ entry);
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      const demo = await createShapesDemo(canvas, core);
      const createBuffer = GPUDevice.prototype.createBuffer;
      let vertex = 0;
      let index = 0;
      GPUDevice.prototype.createBuffer = function (descriptor) {
        if (descriptor.usage & GPUBufferUsage.VERTEX) vertex++;
        if (descriptor.usage & GPUBufferUsage.INDEX) index++;
        return createBuffer.call(this, descriptor);
      };
      try {
        function frame() {
          demo.render(0.2);
          demo.gl.flush();
          return { vertex, index, draws: demo.renderer.info.render.calls };
        }
        const first = frame();
        const second = frame();
        const third = frame();
        await demo.hooks?.device.queue.onSubmittedWorkDone();
        return { first, second, third, errors: demo.hooks?.errors, core: demo.backend };
      } finally {
        GPUDevice.prototype.createBuffer = createBuffer;
        await demo.dispose();
      }
    }, core);
    expect(result.core).toBe(core);
    expect(result.errors).toEqual([]);
    expect(result.first.vertex).toBeGreaterThan(0);
    expect(result.first.index).toBeGreaterThan(0);
    expect(result.first.draws).toBeGreaterThan(80);
    expect(result.second).toEqual(result.first);
    expect(result.third).toEqual(result.first);
  });
}

for (const core of ['native', 'js', 'rust'] as const) {
  test(`consecutive indexed and non-indexed draws use the active byte ranges and versions on ${core}`, async ({ page }) => {
    await page.goto('/tests/fixtures/runner.html');
    const pixels = await page.evaluate(async core => {
      const url = '/tests/fixtures/rtt-cases.ts';
      const { prepareRttContext, rttProgram } =
        await import(/* @vite-ignore */ url) as typeof import('../fixtures/rtt-cases');
      const { gl, dispose } = await prepareRttContext(core, 4, 4);
      try {
        const program = rttProgram(gl);
        gl.uniform4f(gl.getUniformLocation(program, 'u_color'), 1, 0, 0, 1);
        const position = gl.getAttribLocation(program, 'a_position');
        const triangle = [-1, -1, 3, -1, -1, 3];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...triangle, 0, 0, 0, 0, 0, 0]), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2, 2, 2, 2]), gl.STATIC_DRAW);
        const samples: number[] = [];
        function sample(offset = 0, mode: 'elements' | 'arrays' = 'elements') {
          gl.clear(gl.COLOR_BUFFER_BIT);
          if (mode === 'elements') gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_BYTE, offset);
          else gl.drawArrays(gl.TRIANGLES, offset, 3);
          const pixel = new Uint8Array(4);
          gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          samples.push(pixel[0]);
        }
        sample(); sample(); sample();
        sample(3);
        sample(0, 'arrays'); sample(0, 'arrays'); sample(0, 'arrays');
        sample(3, 'arrays');
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(6));
        sample(0, 'arrays');
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(triangle));
        sample(0, 'arrays');

        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 24);
        sample();
        gl.bufferSubData(gl.ARRAY_BUFFER, 24, new Float32Array(triangle));
        sample();
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, new Uint8Array([2, 2, 2]));
        sample();
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, new Uint8Array([0, 1, 2]));
        sample(); sample(); sample();
        gl.disableVertexAttribArray(position);
        gl.vertexAttrib2f(position, 0, 0);
        sample();
        return { samples, error: gl.getError() };
      } finally { await dispose(); }
    }, core);
    expect(pixels).toEqual({ samples: [255, 255, 255, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 0], error: 0 });
  });
}
