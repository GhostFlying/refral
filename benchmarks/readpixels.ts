import { prepareRttContext, rttTexture } from '../tests/fixtures/rtt-cases';
import type { DrawingBackend } from '../tests/fixtures/dual-core-cases';

export async function runReadPixelsBenchmark(backend: DrawingBackend, workload: 'one-pixel' | 'fbo-320x240') {
  const started = performance.now();
  const context = await prepareRttContext(backend, 320, 240, true);
  const initializationMs = performance.now() - started;
  const { gl, hooks } = context;
  try {
    const preparation = performance.now();
    const width = workload === 'one-pixel' ? 1 : 320;
    const height = workload === 'one-pixel' ? 1 : 240;
    if (workload === 'fbo-320x240') {
      const texture = rttTexture(gl, width, height, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Benchmark FBO is incomplete.');
    }
    const pixels = new Uint8Array(width * height * 4);
    const colors = [[17, 34, 51, 0], [204, 153, 102, 85]];
    const callsPerSample = 8;
    const warmupSamples = 30;
    const measuredSamples = 120;
    const resourcePreparationMs = performance.now() - preparation;
    const operation = (index: number) => {
      const color = colors[index % colors.length]!;
      gl.clearColor(color[0]! / 255, color[1]! / 255, color[2]! / 255, color[3]! / 255);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    };
    const firstStarted = performance.now();
    operation(0);
    const firstCompletedReadMs = performance.now() - firstStarted;
    const samplesMsPerOperation: number[] = [];
    for (let sample = 0; sample < warmupSamples; sample++) {
      for (let index = 0; index < callsPerSample; index++) operation(index);
    }
    const before = hooks ? { ...hooks.stats } : null;
    for (let sample = 0; sample < measuredSamples; sample++) {
      const from = performance.now();
      for (let index = 0; index < callsPerSample; index++) operation(index);
      samplesMsPerOperation.push((performance.now() - from) / callsPerSample);
      const expected = colors[1]!;
      if (expected.some((value, channel) => pixels[channel] !== value)) throw new Error('Completed pixel sample differs.');
    }
    const after = hooks ? { ...hooks.stats } : null;
    const sorted = [...samplesMsPerOperation].sort((a, b) => a - b);
    const expected = colors[1]!;
    for (let index = 0; index < pixels.length; index++) {
      if (pixels[index] !== expected[index % 4]) throw new Error(`Final pixel byte differs at ${index}.`);
    }
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`Benchmark GL error ${error}.`);
    await hooks?.device.queue.onSubmittedWorkDone();
    if (hooks?.errors.length) throw new Error(hooks.errors.join('\n'));
    let timerResolutionMs = Infinity;
    let previous = performance.now();
    for (let index = 0; index < 10000; index++) {
      const now = performance.now();
      if (now > previous) timerResolutionMs = Math.min(timerResolutionMs, now - previous);
      previous = now;
    }
    return {
      backend, selectedCore: context.selectedCore, workload, width, height,
      initializationMs, resourcePreparationMs, firstCompletedReadMs,
      warmupSamples, measuredSamples, callsPerSample, samplesMsPerOperation,
      p50Ms: sorted[Math.floor(sorted.length * 0.5)]!, p95Ms: sorted[Math.floor(sorted.length * 0.95)]!,
      countersBefore: before, countersAfter: after,
      timerResolutionMs: Number.isFinite(timerResolutionMs) ? timerResolutionMs : null,
      environment: { ...context.environment, crossOriginIsolated },
      finalPixel: [...pixels.subarray(0, 4)], error, validationErrors: hooks?.errors ?? [],
      timingBoundary: 'clearColor + clear + synchronous public readPixels, including completed GPU work and destination copy',
      allocationBoundary: 'caller destination, colors and target setup precede sampling; internal conversion/allocation/copy are timed',
      cacheState: 'fresh context per run; helper warmed before steady-state samples; same Chrome process; driver caches unmanaged',
      units: 'milliseconds per clear/read operation; sample is the mean of eight operations',
    };
  } finally { await context.dispose(); }
}
