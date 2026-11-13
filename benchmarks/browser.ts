import { createWebGLOnWebGPU, getTestingHooks } from '@refral/webgl';
import { geometry, makeProgram } from '../tests/fixtures/runtime-cases';

function percentile(samples: number[], fraction: number) {
  const sorted = samples.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export async function runBrowserBenchmark(backend: 'native' | 'refral', scene: 'uniform-draws' | 'state-changes' | 'dynamic-upload') {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  document.body.appendChild(canvas);
  const attributes = { alpha: false, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: true };
  const start = performance.now();
  const implementation = backend === 'refral' ? await createWebGLOnWebGPU(canvas, { version: 1, ...attributes }) : null;
  const gl = (implementation ?? canvas.getContext('webgl', attributes)) as unknown as WebGLRenderingContext;
  if (!gl) throw new Error('Benchmark context creation failed.');
  const initialized = performance.now();
  const hooks = implementation ? getTestingHooks(implementation) : null;
  const program = makeProgram(gl);
  geometry(gl, program);
  const color = gl.getUniformLocation(program, 'u_color');
  const upload = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const drawsPerFrame = 64;
  const warmupFrames = 30;
  const sampleFrames = 120;
  const framesPerSample = 8;
  const samples: number[] = [];
  let firstFrameMs = 0;
  for (let frame = 0; frame < warmupFrames + sampleFrames; frame++) {
    const began = performance.now();
    for (let repeated = 0; repeated < framesPerSample; repeated++) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      for (let draw = 0; draw < drawsPerFrame; draw++) {
        if (scene === 'state-changes') {
          if (draw % 2) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
        if (scene === 'dynamic-upload') {
          upload[0] = -1 + (draw % 4) * 0.01;
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, upload);
        }
        gl.uniform4f(color, (draw % 3) / 2, (draw % 5) / 4, (draw % 7) / 6, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.flush();
      if (frame === 0 && repeated === 0) firstFrameMs = performance.now() - began;
    }
    const elapsed = (performance.now() - began) / framesPerSample;
    if (frame >= warmupFrames) samples.push(elapsed);
    // Keep readback outside the timed interval and bound queued work equally for both paths.
    if (hooks) await hooks.capture();
    else gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }
  const error = gl.getError();
  const result = {
    backend, scene, userAgent: navigator.userAgent,
    configuration: { width: 64, height: 64, dpr: 1, attributes, drawsPerFrame, warmupSamples: warmupFrames, sampleCount: sampleFrames, framesPerSample },
    initializationMs: initialized - start,
    initializationCacheState: 'page module and browser caches retained',
    firstFrameCpuMs: firstFrameMs,
    cpuSamplesMs: samples,
    cpuP50Ms: percentile(samples, 0.5),
    cpuP95Ms: percentile(samples, 0.95),
    gpuSamplesMs: null,
    gpuTimingReason: 'GPU timestamp queries are outside the initial runtime profile.',
    counters: hooks ? { ...hooks.stats } : { glDrawCount: drawsPerFrame * framesPerSample * (warmupFrames + sampleFrames) },
    validationErrors: [...hooks?.errors ?? []],
    environment: hooks?.environment ?? { renderer: gl.getParameter(gl.RENDERER), vendor: gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION) },
    error,
    limitations: ['CPU samples average eight frames to reduce browser timer quantization.', 'CPU samples measure API processing, encoding and submission.', 'Readback pacing occurs outside samples.', 'One run is an initial baseline. Thermal, driver cache and repeated-run variance require longer experiments.'],
  };
  await hooks?.dispose();
  if (!hooks) gl.getExtension('WEBGL_lose_context')?.loseContext();
  canvas.remove();
  return result;
}
