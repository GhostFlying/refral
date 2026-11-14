import type { TestingHooks } from '@refral/webgl';
import type { DrawingBackend } from '../tests/fixtures/dual-core-cases';
import type { DemoBackend } from '../examples/render-to-texture';

export const benchmarkWorkloads = ['uniform-draws', 'state-changes', 'dynamic-buffer-upload',
  'dynamic-texture-upload', 'render-to-texture'] as const;
export type BenchmarkWorkload = typeof benchmarkWorkloads[number];
export const benchmarkConfiguration = { width: 64, height: 64, drawsPerFrame: 64,
  warmupSamples: 30, sampleCount: 120, framesPerSample: 8 } as const;
interface Command { operation: string; args: unknown[] }
interface BenchmarkContext {
  canvas: HTMLCanvasElement; gl: WebGLRenderingContext; hooks: TestingHooks | null;
  selectedCore: string; environment: Record<string, unknown>;
  capture(): Promise<{ width: number; height: number; data: Uint8Array }>;
  dispose(): Promise<void>;
}

function percentile(samples: number[], fraction: number) {
  const sorted = samples.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]!;
}

function timerResolution() {
  let minimum = Infinity;
  let previous = performance.now();
  for (let index = 0; index < 5000; index++) {
    const current = performance.now();
    if (current > previous) minimum = Math.min(minimum, current - previous);
    previous = current;
  }
  return { minimumPositiveDeltaMs: Number.isFinite(minimum) ? minimum : null,
    readings: 5000, crossOriginIsolated: window.crossOriginIsolated, timeOrigin: performance.timeOrigin };
}

function snapshotArgument(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) {
    const bytes = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    return Reflect.construct(value.constructor, [bytes]);
  }
  if (Array.isArray(value)) return value.map(snapshotArgument);
  return value;
}

function replay(gl: WebGLRenderingContext, commands: Command[]) {
  for (const command of commands) {
    const method = (gl as unknown as Record<string, (...args: unknown[]) => unknown>)[command.operation]!;
    Reflect.apply(method, gl, command.args);
  }
}

async function prepareWorkload(backend: DrawingBackend, workload: BenchmarkWorkload) {
  const { prepareRttContext, rttProgram, rttTexture, rttVertex, rttColorFragment } =
    await import('../tests/fixtures/rtt-cases');
  const frames: Command[][] = [];
  const preparationStarted = performance.now();
  let context: BenchmarkContext;
  let contextInitializationMs: number;
  let resourcePreparationMs: number;
  let fixturePreparationMs = 0;
  let inputPreparationMs: number;
  let inputBytes = 0;
  let shaders: Record<string, string>;
  if (workload === 'render-to-texture') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    canvas.style.width = canvas.style.height = '64px';
    document.body.append(canvas);
    const { prepareDemo } = await import('../examples/render-to-texture');
    let recording: Command[] | null = null;
    const scene = await prepareDemo(canvas, backend, {
      transformContext: gl => new Proxy(gl, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            if (recording && typeof property === 'string' && !property.startsWith('get') && !property.startsWith('is')) {
              const copies = args.map(snapshotArgument);
              inputBytes += copies.reduce<number>((total, value) => total + (ArrayBuffer.isView(value) ? value.byteLength : 0), 0);
              recording.push({ operation: property, args: copies });
              return undefined;
            }
            return Reflect.apply(value, target, args);
          };
        },
      }),
    });
    context = { canvas, gl: scene.gl, hooks: scene.hooks, selectedCore: scene.selectedCore,
      environment: scene.environment, capture: scene.capture,
      dispose: async () => { await scene.dispose(); canvas.remove(); } };
    contextInitializationMs = scene.timings.contextInitializationMs;
    resourcePreparationMs = scene.timings.resourcePreparationMs;
    fixturePreparationMs = scene.timings.fixturePreparationMs;
    shaders = scene.shaders;
    const beganInputs = performance.now();
    for (let frame = 0; frame < benchmarkConfiguration.framesPerSample; frame++) {
      recording = [];
      scene.frame(frame * 1000 / 60);
      recording.push({ operation: 'flush', args: [] });
      frames.push(recording);
    }
    recording = null;
    inputPreparationMs = performance.now() - beganInputs;
  } else {
    context = await prepareRttContext(backend);
    contextInitializationMs = performance.now() - preparationStarted;
    const resourceStarted = performance.now();
    const gl = context.gl;
    const textured = workload === 'dynamic-texture-upload';
    const fragment = textured
      ? 'precision mediump float; varying vec2 v_uv; uniform sampler2D u_texture; uniform vec4 u_color; void main(){gl_FragColor=texture2D(u_texture,v_uv)*u_color;}'
      : rttColorFragment;
    const program = rttProgram(gl, rttVertex, fragment);
    shaders = { vertex: rttVertex, fragment };
    const color = gl.getUniformLocation(program, 'u_color');
    if (textured) {
      rttTexture(gl, 8, 8, new Uint8Array(8 * 8 * 4).fill(255));
      gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
    }
    gl.viewport(0, 0, 64, 64);
    resourcePreparationMs = performance.now() - resourceStarted;
    const beganInputs = performance.now();
    for (let frame = 0; frame < benchmarkConfiguration.framesPerSample; frame++) {
      const commands: Command[] = [{ operation: 'clearColor', args: [0, 0, 0, 1] },
        { operation: 'clear', args: [gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT] }];
      for (let draw = 0; draw < benchmarkConfiguration.drawsPerFrame; draw++) {
        if (workload === 'state-changes') {
          commands.push({ operation: draw % 2 ? 'enable' : 'disable', args: [gl.BLEND] },
            { operation: 'blendFunc', args: [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA] });
        }
        if (workload === 'dynamic-buffer-upload') {
          const vertices = new Float32Array([-1 + (draw % 4) * 0.01, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
          inputBytes += vertices.byteLength;
          commands.push({ operation: 'bufferSubData', args: [gl.ARRAY_BUFFER, 0, vertices] });
        }
        if (textured) {
          const pixels = new Uint8Array(8 * 8 * 4);
          for (let index = 0; index < pixels.length; index += 4) {
            pixels.set([(draw % 3) * 127, (draw % 5) * 63, (draw % 7) * 42, 255], index);
          }
          inputBytes += pixels.byteLength;
          commands.push({ operation: 'texSubImage2D', args: [gl.TEXTURE_2D, 0, 0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, pixels] });
        }
        const values = new Float32Array([(draw % 3) / 2, (draw % 5) / 4, (draw % 7) / 6, 1]);
        inputBytes += values.byteLength;
        commands.push({ operation: 'uniform4fv', args: [color, values] },
          { operation: 'drawArrays', args: [gl.TRIANGLES, 0, 6] });
      }
      commands.push({ operation: 'flush', args: [] }); frames.push(commands);
    }
    inputPreparationMs = performance.now() - beganInputs;
  }
  return { context, frames, shaders, contextInitializationMs, resourcePreparationMs, fixturePreparationMs, inputPreparationMs, inputBytes };
}

const counterNames = ['draws', 'passes', 'submits', 'copies', 'uploadedBytes', 'pipelines', 'bindGroups'] as const;

export async function runRttBenchmark(backend: DrawingBackend, workload: BenchmarkWorkload) {
  const timer = timerResolution();
  const started = performance.now();
  const prepared = await prepareWorkload(backend, workload);
  const { context, frames } = prepared;
  const { gl, hooks } = context;
  const samples: number[] = [];
  const timedCounters = hooks ? Object.fromEntries(counterNames.map(name => [name, 0])) : null;
  const paceRegion = { x: 0, y: 0, width: 64, height: 64, format: 'RGBA', type: 'UNSIGNED_BYTE' };
  try {
    const firstBegan = performance.now(); replay(gl, frames[0]!);
    const firstFrameCpuMs = performance.now() - firstBegan;
    const firstImage = await context.capture();
    const firstImageCompleteMs = performance.now() - firstBegan;
    const firstImageSinceStartMs = performance.now() - started;
    let lastImage = firstImage;
    for (let sample = 0; sample < benchmarkConfiguration.warmupSamples + benchmarkConfiguration.sampleCount; sample++) {
      const before = hooks ? { ...hooks.stats } : null;
      const began = performance.now();
      for (const frame of frames) replay(gl, frame);
      const elapsed = performance.now() - began;
      if (sample >= benchmarkConfiguration.warmupSamples) {
        samples.push(elapsed / benchmarkConfiguration.framesPerSample);
        if (hooks && before && timedCounters) {
          for (const name of counterNames) timedCounters[name]! += hooks.stats[name] - before[name];
        }
      }
      // All three paths read the same full 64x64 RGBA region after the CPU interval.
      lastImage = await context.capture();
    }
    const apiCallsPerFrame = frames.map(frame => frame.reduce<Record<string, number>>((counts, command) => {
      counts[command.operation] = (counts[command.operation] ?? 0) + 1; return counts;
    }, {}));
    const error = gl.getError();
    return {
      backend, selectedCore: context.selectedCore, workload, userAgent: navigator.userAgent,
      shaders: prepared.shaders,
      configuration: { ...benchmarkConfiguration, paceRegion,
        warmupLogicalFrames: benchmarkConfiguration.warmupSamples * benchmarkConfiguration.framesPerSample,
        measuredLogicalFrames: benchmarkConfiguration.sampleCount * benchmarkConfiguration.framesPerSample,
        firstFrameSeparateFromWarmup: true, drawsPerFrame: workload === 'render-to-texture'
        ? apiCallsPerFrame[0]?.drawArrays ?? 0 : benchmarkConfiguration.drawsPerFrame },
      timingBoundary: 'Public GL trace replay, argument conversion/snapshots, Wasm bridge, encoding and explicit flush, divided by eight logical frames.',
      inputPreparation: 'Typed inputs and RTT matrix/scene computation occur before timed replay. Public method lookup and dispatch occur inside replay.',
      initializationCacheState: 'Fresh Playwright context per run; browser process retained; GPU driver caches unmanaged. First draw is executed after input preparation.',
      contextInitializationMs: prepared.contextInitializationMs,
      resourcePreparationMs: prepared.resourcePreparationMs, fixturePreparationMs: prepared.fixturePreparationMs,
      inputPreparationMs: prepared.inputPreparationMs, preparedInputBytes: prepared.inputBytes,
      firstFrameCpuMs, firstImageCompleteMs, firstImageSinceStartMs,
      cpuSamplesMs: samples, cpuP50Ms: percentile(samples, 0.5), cpuP95Ms: percentile(samples, 0.95),
      units: 'ms/logical-frame', timer, gpuSamplesMs: null,
      percentileMethod: 'nearest-rank: sorted index ceil(n*p)-1',
      gpuTiming: { sampled: false, timestampFeatureEnabled: hooks?.device.features.has('timestamp-query') ?? null,
        adapterTimestampFeatureAvailable: hooks
          ? (hooks.environment.adapterFeatures as string[]).includes('timestamp-query') : null,
        nativeTimerExtensionAvailable: backend === 'native' ? gl.getSupportedExtensions()?.includes('EXT_disjoint_timer_query') ?? false : null,
        reason: 'GPU timestamp queries are not enabled by this CPU baseline.' },
      timedCounters, totalCounters: hooks ? { ...hooks.stats } : null, apiCallsPerFrame,
      counterScope: 'Timed counters cover measured replay intervals; total counters also include setup, first frame, warmup and readback pacing.',
      memory: { preparedInputBytes: prepared.inputBytes, hostAllocatedBufferBytes: hooks?.stats.allocatedBufferBytes ?? null,
        hostAllocatedTextureBytes: hooks?.stats.allocatedTextureBytes ?? null,
        hostPeakBufferBytes: hooks?.stats.peakAllocatedBufferBytes ?? null,
        hostPeakTextureBytes: hooks?.stats.peakAllocatedTextureBytes ?? null,
        nativeGpuAllocationBytes: null, nativeGpuAllocationReason: 'WebGL does not expose equivalent GPU allocation counters.' },
      firstImage: { width: firstImage.width, height: firstImage.height, pixels: Array.from(firstImage.data) },
      lastImage: { width: lastImage.width, height: lastImage.height, pixels: Array.from(lastImage.data) },
      validationErrors: [...hooks?.errors ?? []], environment: context.environment, error,
    };
  } finally { await context.dispose(); }
}

/** Existing callers use these workload/backend aliases. */
export function runBrowserBenchmark(backend: DemoBackend, scene: 'uniform-draws' | 'state-changes' | 'dynamic-upload') {
  return runRttBenchmark(backend === 'refral' ? 'js' : backend,
    scene === 'dynamic-upload' ? 'dynamic-buffer-upload' : scene);
}
