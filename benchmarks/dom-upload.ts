import { prepareRttContext, rttProgram, rttTexture, rttTextureFragment, rttVertex } from '../tests/fixtures/rtt-cases';
import type { DrawingBackend } from '../tests/fixtures/dual-core-cases';

export const domUploadSources = ['imagedata', 'canvas', 'image-png'] as const;
export type DomUploadSource = typeof domUploadSources[number];
export const domUploadConfiguration = {
  width: 64, height: 64, color: [41, 137, 211, 255],
  warmupSamples: 30, measuredSamples: 120, framesPerSample: 8,
} as const;

const counterNames = ['draws', 'passes', 'submits', 'copies', 'uploadedBytes', 'pipelines', 'bindGroups'] as const;
type Counters = Record<typeof counterNames[number], number>;

function percentile(samples: number[], fraction: number) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1]!;
}

function timerResolution() {
  let minimum = Infinity;
  let previous = performance.now();
  for (let index = 0; index < 10000; index++) {
    const current = performance.now();
    if (current > previous) minimum = Math.min(minimum, current - previous);
    previous = current;
  }
  return { minimumPositiveDeltaMs: Number.isFinite(minimum) ? minimum : null,
    readings: 10000, crossOriginIsolated, timeOrigin: performance.timeOrigin };
}

async function prepareSource(kind: DomUploadSource, pngDataURL: string) {
  const { width, height, color } = domUploadConfiguration;
  if (kind === 'image-png') {
    const image = new Image();
    image.src = pngDataURL;
    await image.decode();
    if (image.naturalWidth !== width || image.naturalHeight !== height) {
      throw new Error('The decoded PNG dimensions differ from the DOM benchmark fixture.');
    }
    return image;
  }
  const bytes = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < bytes.length; offset += 4) bytes.set(color, offset);
  const imageData = new ImageData(bytes, width, height, { colorSpace: 'srgb' });
  if (kind === 'imagedata') return imageData;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!context) throw new Error('Cannot create the DOM benchmark source Canvas2D context.');
  context.putImageData(imageData, 0, 0);
  return canvas;
}

export async function runDomUploadBenchmark(backend: DrawingBackend, sourceKind: DomUploadSource, pngDataURL: string) {
  const configuration = domUploadConfiguration;
  const timer = timerResolution();
  const runStarted = performance.now();
  const sourceStarted = performance.now();
  const source = await prepareSource(sourceKind, pngDataURL);
  const sourcePreparationMs = performance.now() - sourceStarted;
  const contextStarted = performance.now();
  const context = await prepareRttContext(backend, configuration.width, configuration.height);
  const contextInitializationMs = performance.now() - contextStarted;
  const { gl, hooks } = context;
  try {
    const resourcesStarted = performance.now();
    const program = rttProgram(gl, undefined, rttTextureFragment);
    rttTexture(gl, configuration.width, configuration.height, null);
    gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
    gl.viewport(0, 0, configuration.width, configuration.height);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    const pixel = new Uint8Array(4);
    const resourcePreparationMs = performance.now() - resourcesStarted;
    const setupError = gl.getError();
    if (setupError !== gl.NO_ERROR) throw new Error(`DOM benchmark setup GL error ${setupError}.`);
    const frame = () => {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.flush();
    };
    const completeAndProbe = async () => {
      const began = performance.now();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      await hooks?.device.queue.onSubmittedWorkDone();
      const elapsedMs = performance.now() - began;
      const error = gl.getError();
      return { elapsedMs, pixel: Array.from(pixel), error,
        pixelCorrect: configuration.color.every((value, index) => pixel[index] === value) };
    };

    const firstStarted = performance.now();
    frame();
    const firstFrameCpuMs = performance.now() - firstStarted;
    const firstProbe = await completeAndProbe();
    const firstImageCompleteMs = performance.now() - firstStarted;
    const firstImageSinceStartMs = performance.now() - runStarted;
    const timedCounters: Counters | null = hooks
      ? Object.fromEntries(counterNames.map(name => [name, 0])) as Counters : null;
    const warmup: Sample[] = [];
    const samples: Sample[] = [];
    for (let index = 0; index < configuration.warmupSamples + configuration.measuredSamples; index++) {
      const before = hooks ? { ...hooks.stats } : null;
      const began = performance.now();
      for (let frameIndex = 0; frameIndex < configuration.framesPerSample; frameIndex++) frame();
      const cpuSampleMs = performance.now() - began;
      const counters: Counters | null = hooks && before
        ? Object.fromEntries(counterNames.map(name => [name, hooks.stats[name] - before[name]])) as Counters : null;
      // Readback and completion can create host work, so snapshot counters first.
      const probe = await completeAndProbe();
      const sample = { cpuSampleMs, cpuMsPerLogicalFrame: cpuSampleMs / configuration.framesPerSample,
        counters, completionMs: probe.elapsedMs, pixel: probe.pixel, pixelCorrect: probe.pixelCorrect, error: probe.error };
      if (index < configuration.warmupSamples) warmup.push(sample);
      else {
        samples.push(sample);
        if (timedCounters && counters) {
          for (const name of counterNames) timedCounters[name] += counters[name];
        }
      }
    }
    const cpuSamplesMs = samples.map(sample => sample.cpuSampleMs);
    const cpuSamplesMsPerLogicalFrame = samples.map(sample => sample.cpuMsPerLogicalFrame);
    const adapterFeatures = hooks?.environment.adapterFeatures;
    return {
      backend, selectedCore: context.selectedCore, sourceKind, configuration,
      units: { sample: 'ms/sample', logicalFrame: 'ms/logical-frame', completion: 'ms/sample completion' },
      sourcePreparationMs, contextInitializationMs, resourcePreparationMs,
      firstFrameCpuMs, firstImageCompleteMs, firstImageSinceStartMs, firstProbe,
      warmup, samples, cpuSamplesMs, cpuSamplesMsPerLogicalFrame,
      cpuSampleP50Ms: percentile(cpuSamplesMs, 0.5), cpuSampleP95Ms: percentile(cpuSamplesMs, 0.95),
      cpuP50MsPerLogicalFrame: percentile(cpuSamplesMsPerLogicalFrame, 0.5),
      cpuP95MsPerLogicalFrame: percentile(cpuSamplesMsPerLogicalFrame, 0.95),
      percentileMethod: 'nearest-rank, sorted index ceil(n*p)-1', timer,
      timingBoundary: 'Each logical frame calls public DOM texSubImage2D, drawArrays and flush. Facade conversion, source extraction/snapshot, semantic core, Wasm bridge, encoding and submission are inside the CPU interval.',
      completionBoundary: 'After each CPU interval, synchronous public readPixels verifies one RGBA pixel at (0,0), then the Refral WebGPU queue is awaited. Completion and assertions are outside the CPU interval.',
      preparationBoundary: 'Source construction/PNG decode, context initialization, shader compilation, resource allocation and caller readback storage precede the first timed upload. PNG encoding and data URL construction happen in the Node harness.',
      cacheState: 'Fresh Playwright browser context and public GL context per run, same browser process. The immutable DOM source and destination storage are reused. First frame precedes 30 warmup samples. Browser decoder and GPU driver caches are unmanaged.',
      apiCallsPerLogicalFrame: { texSubImage2D: 1, drawArrays: 1, flush: 1 },
      measuredLogicalFrames: configuration.measuredSamples * configuration.framesPerSample,
      warmupLogicalFrames: configuration.warmupSamples * configuration.framesPerSample,
      sourceBytesPerUpload: configuration.width * configuration.height * 4,
      shaders: { vertex: rttVertex, fragment: rttTextureFragment },
      hostCounters: { available: hooks !== null, timedTotals: timedCounters,
        totalAfterRun: hooks ? { ...hooks.stats } : null,
        scope: 'Timed totals and each measured sample delta exclude setup, first frame, warmup, readback and GPU completion. Total-after-run includes all those operations.',
        unavailableReason: hooks ? null : 'Native WebGL does not expose the common Refral host counters.' },
      gpuTiming: { sampled: false, samplesMs: null,
        timestampFeatureEnabled: hooks?.device.features.has('timestamp-query') ?? null,
        adapterTimestampFeatureAvailable: Array.isArray(adapterFeatures) ? adapterFeatures.includes('timestamp-query') : null,
        nativeTimerExtensionAvailable: backend === 'native'
          ? gl.getSupportedExtensions()?.includes('EXT_disjoint_timer_query') ?? false : null,
        reason: 'This CPU upload baseline does not enable timestamp queries or instrument GPU passes. GPU completion is used only for pacing outside each CPU interval.' },
      environment: { ...context.environment, crossOriginIsolated, visibilityState: document.visibilityState },
      error: gl.getError(), validationErrors: [...hooks?.errors ?? []],
    };
  } finally {
    await context.dispose();
  }
}

interface Sample {
  cpuSampleMs: number;
  cpuMsPerLogicalFrame: number;
  completionMs: number;
  counters: Counters | null;
  pixel: number[];
  pixelCorrect: boolean;
  error: number;
}
