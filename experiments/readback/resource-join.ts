import { CanvasReadback } from '../../packages/browser-host/src/canvas-readback';

const vertex = `
  @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let corners = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    return vec4f(corners[i], 0, 1);
  }`;

function expectedSamples(seed: number) {
  let count = 0;
  for (let pixel = 0; pixel < 128 * 128; pixel++) {
    let value = seed ^ pixel;
    for (let i = 0; i < 64; i++) value = (Math.imul(value ^ (value >>> 5), 1664525) + i) >>> 0;
    if ((value & 3) === 0) count++;
  }
  return count;
}

export async function probeResourceJoin(device: GPUDevice, bridge: CanvasReadback) {
  const inputs = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM });
  const source = device.createTexture({ size: [2, 1], format: 'rgba8unorm',
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
  const output = device.createTexture({ size: [1, 1], format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const maskedTarget = device.createTexture({ size: [128, 128], format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const queries = device.createQuerySet({ type: 'occlusion', count: 1 });
  const resolved = device.createBuffer({ size: 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const count = device.createBuffer({ size: 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const makePipeline = async (code: string, writeMask: GPUColorWriteFlags) => {
    const module = device.createShaderModule({ code: vertex + code });
    return device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm', writeMask }] } });
  };
  try {
    const masked = await makePipeline(`
      @group(0) @binding(0) var<uniform> input: vec4u;
      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var value = input.x ^ (u32(position.y) * 128u + u32(position.x));
        for (var i = 0u; i < 64u; i++) { value = (value ^ (value >> 5u)) * 1664525u + i; }
        if ((value & 3u) != 0u) { discard; }
        return vec4f(1);
      }`, 0);
    const joined = await makePipeline(`
      @group(0) @binding(0) var<uniform> input: vec4u;
      @group(0) @binding(1) var image: texture_2d<f32>;
      @group(0) @binding(2) var framebuffer: texture_2d<f32>;
      @fragment fn fs() -> @location(0) vec4f {
        let a = vec4u(round(textureLoad(image, vec2i(0, 0), 0) * 255.0));
        let b = vec4u(round(textureLoad(image, vec2i(1, 0), 0) * 255.0));
        var sum = input + a + b;
        for (var y = 0; y < 128; y++) {
          for (var x = 0; x < 128; x++) {
            sum += vec4u(round(textureLoad(framebuffer, vec2i(x, y), 0) * 255.0));
          }
        }
        return vec4f(sum & vec4u(255u)) / 255.0;
      }`, GPUColorWrite.ALL);
    const maskedBindings = device.createBindGroup({ layout: masked.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: inputs } }] });
    const joinedBindings = device.createBindGroup({ layout: joined.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: inputs } }, { binding: 1, resource: source.createView() },
        { binding: 2, resource: maskedTarget.createView() }] });
    const observations = [];
    for (const draw of [false, true]) {
      const words = Uint32Array.of(25, 9, 48, 1);
      const pixels = Uint8Array.of(13, 79, 32, 9, 88, 33, 42, 63);
      device.queue.writeBuffer(inputs, 0, words.subarray(0, 2));
      device.queue.writeBuffer(inputs, 8, words.subarray(2));
      device.queue.writeTexture({ texture: source }, pixels.subarray(0, 4), {}, [1, 1]);
      device.queue.writeTexture({ texture: source, origin: [1, 0] }, pixels.subarray(4), {}, [1, 1]);
      const previous = device.createCommandEncoder();
      const pass = previous.beginRenderPass({ colorAttachments: [{ view: maskedTarget.createView(),
        loadOp: 'load', storeOp: 'store' }], occlusionQuerySet: queries });
      pass.beginOcclusionQuery(0);
      if (draw) {
        pass.setPipeline(masked);
        pass.setBindGroup(0, maskedBindings);
        pass.draw(3);
      }
      pass.endOcclusionQuery();
      pass.end();
      previous.resolveQuerySet(queries, 0, 1, resolved, 0);
      previous.copyBufferToBuffer(resolved, 0, count, 0, 8);
      device.queue.submit([previous.finish()]);
      const encoder = device.createCommandEncoder();
      const join = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      join.setPipeline(joined);
      join.setBindGroup(0, joinedBindings);
      join.draw(3);
      join.end();
      const bytes = Array.from(bridge.capture(output, 1, 1, () => encoder,
        () => device.queue.submit([encoder.finish()])));
      const expected = Array.from(words, (word, i) => (word + pixels[i]! + pixels[i + 4]!) & 255);
      if (!bytes.every((byte, i) => byte === expected[i])) throw new Error('Resource join returned incorrect bytes.');
      await count.mapAsync(GPUMapMode.READ);
      const samples = Number(new BigUint64Array(count.getMappedRange())[0]);
      count.unmap();
      const reference = draw ? expectedSamples(words[0]!) : 0;
      // WebGPU only guarantees a nonzero result if at least one sample passed.
      if ((samples !== 0) !== (reference !== 0)) throw new Error('Occlusion result mismatch.');
      observations.push({ draw, bytes, samples, reference });
    }
    return observations;
  } finally {
    count.destroy();
    resolved.destroy();
    queries.destroy();
    maskedTarget.destroy();
    output.destroy();
    source.destroy();
    inputs.destroy();
  }
}
