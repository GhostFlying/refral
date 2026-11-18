import { createWebGLOnWebGPU, getTestingHooks } from '@refral/webgl';

export type FinishBackend = 'native' | 'js' | 'rust';

export async function checkFinish(core: FinishBackend) {
  const canvas = new OffscreenCanvas(4, 4);
  const gl = core === 'native' ? canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true })!
    : await createWebGLOnWebGPU(canvas, { version: 1, core });
  const hooks = core === 'native' ? null : getTestingHooks(gl);
  const states: string[] = [];
  function finish() {
    try {
      gl.finish();
      states.push('complete');
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotSupportedError' || !error.message.includes('pending GPU queue work')) throw error;
      states.push('pending');
    }
  }
  try {
    finish();
    gl.clearColor(0, 1, 0, 1);
    finish();
    gl.clear(gl.COLOR_BUFFER_BIT);
    finish();
    gl.flush();
    finish();
    await hooks?.device.queue.onSubmittedWorkDone();
    finish();
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    finish();
    await hooks?.device.queue.onSubmittedWorkDone();
    finish();
    const source = new OffscreenCanvas(2, 2);
    const ctx = source.getContext('2d')!;
    ctx.fillStyle = '#f00';
    ctx.fillRect(0, 0, 2, 2);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    finish();
    await hooks?.device.queue.onSubmittedWorkDone();
    finish();
    return { core: hooks?.core ?? core, worker: typeof window === 'undefined', states, pixel: [...pixel], error: gl.getError(), validation: hooks?.errors ?? [] };
  } finally {
    if (hooks) await hooks.dispose();
    else gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

if (typeof window === 'undefined') {
  globalThis.onmessage = async (event: MessageEvent<FinishBackend>) => {
    try { postMessage({ value: await checkFinish(event.data) }); }
    catch (error) { postMessage({ error: String(error) }); }
  };
}
