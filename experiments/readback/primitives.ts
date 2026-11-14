export function probeTimer() {
  let minimum = Infinity;
  let previous = performance.now();
  for (let index = 0; index < 5000; index++) {
    const current = performance.now();
    if (current > previous) minimum = Math.min(minimum, current - previous);
    previous = current;
  }
  return {
    minimumPositiveDeltaMs: Number.isFinite(minimum) ? minimum : null,
    readings: 5000,
    timeOrigin: performance.timeOrigin,
  };
}

export async function probeAgent(mode: 'spin' | 'wait') {
  const timer = probeTimer();
  let wasmSharedBufferClone = '';
  try {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    try {
      structuredClone(memory.buffer);
      wasmSharedBufferClone = 'shared';
    } catch (error) {
      wasmSharedBufferClone = error instanceof Error ? error.name : String(error);
    }
  } catch (error) {
    wasmSharedBufferClone = 'construction: ' + String(error);
  }
  let waitResult = 'SharedArrayBuffer unavailable';
  if (typeof SharedArrayBuffer !== 'undefined') {
    try {
      waitResult = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 0);
    } catch (error) {
      waitResult = error instanceof Error ? error.name : String(error);
    }
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter.');
  const device = await adapter.requestDevice();
  const source = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const result = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const input = new Uint32Array([17, 31, 127, 255]);
    device.queue.writeBuffer(source, 0, input);
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(source, 0, result, 0, 16);
    device.queue.submit([encoder.finish()]);
    let callbackRan = false;
    const mapped = result.mapAsync(GPUMapMode.READ).then(() => {
      callbackRan = true;
    });
    const start = performance.now();
    let mappingWaitResult = 'bounded-spin';
    if (mode === 'wait') {
      mappingWaitResult = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    } else {
      while (performance.now() - start < 30) {
        /* Bounded observation of one caller task. */
      }
    }
    let mappedRangeResult = '';
    try {
      result.getMappedRange();
      mappedRangeResult = 'available';
    } catch (error) {
      mappedRangeResult = error instanceof Error ? error.name : String(error);
    }
    const duringTask = {
      callbackRan,
      mapState: result.mapState,
      mappedRangeResult,
      blockedMs: performance.now() - start,
    };
    await mapped;
    return {
      userAgent: navigator.userAgent,
      origin: location.origin,
      timer,
      isSecureContext,
      scope: typeof document === 'undefined' ? 'worker' : 'window',
      mappingWaitResult,
      crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      wasmSharedBufferClone,
      waitResult,
      duringTask,
      afterYield: {
        callbackRan,
        mapState: result.mapState,
        values: Array.from(new Uint32Array(result.getMappedRange())),
      },
      adapter: {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        isFallbackAdapter: adapter.info.isFallbackAdapter,
      },
    };
  } finally {
    source.destroy();
    result.destroy();
    device.destroy();
  }
}
