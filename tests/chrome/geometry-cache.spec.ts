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
