import { createWebGLOnWebGPU, getTestingHooks } from '@refral/webgl';

globalThis.onmessage = async (event: MessageEvent<{ canvas: OffscreenCanvas; core: 'js' | 'rust' }>) => {
  try {
    const { canvas, core } = event.data;
    const gl = await createWebGLOnWebGPU(canvas, { version: 1, core });
    const hooks = getTestingHooks(gl);
    try {
      gl.clearColor(0, 1, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const pixels = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      await hooks.device.queue.onSubmittedWorkDone();
      await new Promise(resolve => setTimeout(resolve, 0));
      postMessage({ core: hooks.core, worker: typeof window === 'undefined', canvas: gl.canvas === canvas,
        pixels: [...pixels], error: gl.getError(), validation: hooks.errors, adapter: hooks.environment.adapter });
    } finally { await hooks.dispose(); }
  } catch (error) { postMessage({ exception: String(error) }); }
};
