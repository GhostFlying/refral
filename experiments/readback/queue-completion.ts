import { probeResourceJoin } from './resource-join';
import { CanvasReadback } from '../../packages/browser-host/src/canvas-readback';
import type { HostStats } from '../../packages/browser-host/src';

type Route = 'queue-fence' | 'separate-texture' | 'written-texture';

function texel(seed: number, iterations: number, x: number, y: number) {
  let value = (seed ^ (y * 256 + x)) >>> 0;
  for (let i = 0; i < iterations; i++) value = (Math.imul(value ^ (value >>> 5), 1664525) + i + 1013904223) >>> 0;
  return [value & 255, value >>> 8 & 255, value >>> 16 & 255, 255];
}

export async function measureQueueCompletion() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable.');
  const timestamps = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: timestamps ? ['timestamp-query'] : [] });
  const queue = device.queue;
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const stats: HostStats = { draws: 0, passes: 0, submits: 0, copies: 0, uploadedBytes: 0, pipelines: 0,
    bindGroups: 0, allocatedBufferBytes: 0, allocatedTextureBytes: 0, peakAllocatedBufferBytes: 0, peakAllocatedTextureBytes: 0 };
  const bridge = new CanvasReadback(device, stats);
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST;
  const target = device.createTexture({ size: [256, 256], format: 'rgba8unorm', usage });
  const marker = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage });
  const args = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const queries = timestamps ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null;
  const resolved = timestamps ? device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const readTime = timestamps ? device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : null;
  const module = device.createShaderModule({ code: `
    @group(0) @binding(0) var<uniform> settings: vec4<u32>;
    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let corners = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
      return vec4f(corners[i], 0, 1);
    }
    @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
      var value = settings.x ^ (u32(p.y) * 256u + u32(p.x));
      for (var i = 0u; i < settings.y; i++) { value = (value ^ (value >> 5u)) * 1664525u + i + 1013904223u; }
      return vec4f(f32(value & 255u),f32((value >> 8u) & 255u),f32((value >> 16u) & 255u),255.0) / 255.0;
    }` });
  try {
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: args } }] });
    const samples = [];
    let seed = 0;
    for (const iterations of [32, 4096, 32768]) {
      for (let round = 0; round < 4; round++) {
        const routes: Route[] = ['queue-fence', 'separate-texture', 'written-texture'];
        for (let i = 0; i < routes.length; i++) {
          const route = routes[(round + i) % routes.length]!;
          seed++;
          const sentinel = [seed, 80, 126, 255];
          queue.writeTexture({ texture: marker }, Uint8Array.from(sentinel), {}, [1, 1]);
          queue.writeBuffer(args, 0, Uint32Array.of(seed, iterations, 0, 0));
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
            ...(queries ? { timestampWrites: { querySet: queries, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {}),
          });
          pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
          if (queries && resolved && readTime) {
            encoder.resolveQuerySet(queries, 0, 2, resolved, 0);
            encoder.copyBufferToBuffer(resolved, 0, readTime, 0, 16);
          }
          const commands = encoder.finish();
          const start = performance.now();
          queue.submit([commands]);
          const fence = queue.onSubmittedWorkDone();
          let pixels: number[] | null = null;
          const same = route === 'written-texture';
          if (route !== 'queue-fence') {
            const copy = device.createCommandEncoder();
            pixels = Array.from(bridge.capture(same ? target : marker, 1, 1, () => copy,
              () => queue.submit([copy.finish()]), same ? 255 : 0, same ? 255 : 0));
          }
          const synchronousReturnMs = performance.now() - start;
          await fence;
          const observedFenceMs = performance.now() - start;
          let gpuPassMs: number | null = null;
          if (readTime) {
            await readTime.mapAsync(GPUMapMode.READ);
            const times = new BigUint64Array(readTime.getMappedRange());
            gpuPassMs = Number(times[1]! - times[0]!) / 1e6;
            readTime.unmap();
          }
          const expected = route === 'queue-fence' ? null : same ? texel(seed, iterations, 255, 255) : sentinel;
          if (JSON.stringify(expected) !== JSON.stringify(pixels)) throw new Error('Probe pixels did not match submitted data.');
          samples.push({ route, round, iterations, seed, synchronousReturnMs, observedFenceMs, gpuPassMs, pixels });
        }
      }
    }
    const resourceJoin = await probeResourceJoin(device, bridge);
    await queue.onSubmittedWorkDone();
    if (errors.length) throw new Error(errors.join('\n'));
    return { adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
        backend: Reflect.get(adapter.info, 'backend') ?? null },
      timestamps, crossOriginIsolated, samples, resourceJoin };
  } finally {
    bridge.dispose(); queries?.destroy(); resolved?.destroy(); readTime?.destroy(); target.destroy(); marker.destroy(); args.destroy(); device.destroy();
  }
}
