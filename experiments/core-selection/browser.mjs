import { consumeSnapshots, createJsCore, createTrace, createWasmCore, RECORD_WORDS, runSelection } from './benchmark.mjs';

const shader = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};
@group(0) @binding(0) var<storage, read> snapshots: array<u32>;

@vertex fn vertexMain(
  @builtin(vertex_index) vertex: u32,
  @builtin(instance_index) instance: u32,
) -> VertexOutput {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let offset = instance * 12u;
  var output: VertexOutput;
  output.position = vec4f(positions[vertex], 0.0, 1.0);
  output.color = vec4f(
    f32(snapshots[offset]), f32(snapshots[offset + 1u]),
    f32(snapshots[offset + 2u]), f32(snapshots[offset + 3u]),
  ) / 255.0;
  return output;
}

@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return input.color;
}
`;

async function renderSnapshots(device, pipeline, snapshots) {
  const draws = snapshots.length / RECORD_WORDS;
  const bytesPerRow = Math.ceil(draws * 4 / 256) * 256;
  const input = device.createBuffer({ size: snapshots.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const texture = device.createTexture({ size: [draws, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const start = performance.now();
    device.queue.writeBuffer(input, 0, snapshots);
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: input } }] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    for (let draw = 0; draw < draws; draw++) {
      pass.setScissorRect(draw, 0, 1, 1);
      pass.draw(3, 1, 0, draw);
    }
    pass.end();
    encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow }, [draws, 1]);
    device.queue.submit([encoder.finish()]);
    const cpuEncodeSubmitMs = performance.now() - start;
    await readback.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8Array(readback.getMappedRange()).slice(0, draws * 4);
    readback.unmap();
    for (let draw = 0; draw < draws; draw++) {
      for (let channel = 0; channel < 4; channel++) {
        if (pixels[draw * 4 + channel] !== snapshots[draw * RECORD_WORDS + channel]) {
          throw new Error(`GPU snapshot mismatch at draw ${draw}, channel ${channel}`);
        }
      }
    }
    return {
      correct: true,
      draws,
      passCount: 1,
      copyCount: 1,
      submitCount: 1,
      uploadedBytes: snapshots.byteLength,
      cpuEncodeSubmitMs,
      gpuDurationMs: null,
      pixelChecksum: consumeSnapshots(new Uint32Array(pixels.buffer)),
    };
  } finally {
    input.destroy();
    texture.destroy();
    readback.destroy();
  }
}

export async function runBrowserSelection(options = {}) {
  const response = await fetch(options.wasmUrl ?? '/artifacts/core-selection/core.wasm');
  if (!response.ok) throw new Error(`Wasm fetch failed with ${response.status}`);
  const bytes = await response.arrayBuffer();
  const result = await runSelection(bytes, options);
  if (!navigator.gpu) throw new Error('WebGPU unavailable for core-selection GPU proof');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter for core-selection GPU proof');
  const device = await adapter.requestDevice();
  const gpuProof = [];
  try {
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code: shader });
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages.filter(({ type }) => type === 'error');
    if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    const cores = [
      { path: 'javascript', core: createJsCore() },
      { path: 'rust-wasm-per-call', core: await createWasmCore(bytes) },
      { path: 'rust-wasm-batch', core: await createWasmCore(bytes, { mode: 'batch' }) },
    ];
    for (const scene of ['uniform-draws', 'state-cache', 'dynamic-upload']) {
      const trace = createTrace(scene, result.configuration);
      for (const { path, core } of cores) {
        const snapshots = core.replay(trace);
        const proof = await renderSnapshots(device, pipeline, snapshots);
        gpuProof.push({ scene, path, ...proof });
      }
    }
    const error = await device.popErrorScope();
    if (error) throw new Error(`Core-selection GPU validation failed: ${error.message}`);
    return {
      generatedAt: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        crossOriginIsolated,
        adapter: {
          vendor: adapter.info.vendor,
          architecture: adapter.info.architecture,
          device: adapter.info.device,
          description: adapter.info.description,
          isFallbackAdapter: adapter.info.isFallbackAdapter,
        },
        features: [...adapter.features],
      },
      ...result,
      gpuProof,
      gpuProofLimitations: [
        'All three paths feed the same fixed-WGSL WebGPU executor using their emitted color snapshots.',
        'The GPU proof checks every draw color. Pipeline-state and upload-version equivalence are checked in the full CPU snapshot comparison.',
        'GPU proof encoding/readback is outside the CPU-selection samples and includes readback only for correctness.',
      ],
    };
  } finally {
    device.destroy();
  }
}
