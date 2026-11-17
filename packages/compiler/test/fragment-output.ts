import type { Compiler, LinkedProgram } from "../src/types.js";
import shaders from "./fragment-output-shaders.json" with { type: "json" };

// Original shader strings from Khronos WebGL CTS 39443210f7f81db4773eb104facadfb85d05dfa4,
// sdk/tests/js/webgl-test-utils.js. Copyright (c) 2019 The Khronos Group Inc.
// MIT-style license retained in third_party/cts/LICENSE.txt.
export const { simpleTextureVertexShader, simpleCubeMapTextureFragmentShader,
  fragDataReadFragmentShader } = shaders;


const cubeFaces = [0x8515, 0x8516, 0x8517, 0x8518, 0x8519, 0x851a] as const;
const vertices = new Float32Array([
  -1, -1, 0, 1, 0, 0,
  3, -1, 0, 1, 2, 0,
  -1, 3, 0, 1, 0, 2,
]);

function facePixels(face: number): Uint8Array<ArrayBuffer> {
  const pixels = new Uint8Array(16);
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 2; column++) {
      pixels.set([32 + face * 32, 32 + column * 160, 32 + row * 160, 255],
        (row * 2 + column) * 4);
    }
  }
  return pixels;
}

function nativeShader(gl: WebGLRenderingContext, stage: number, source: string): WebGLShader {
  const shader = gl.createShader(stage)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Native fragment-output shader failed. ${log}`);
  }
  return shader;
}

function nativePixels(gl: WebGLRenderingContext, fragmentSource: string, targets: readonly number[]) {
  const vertex = nativeShader(gl, gl.VERTEX_SHADER, simpleTextureVertexShader);
  const fragment = nativeShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram()!;
  const buffer = gl.createBuffer()!;
  const texture = gl.createTexture()!;
  try {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, "vPosition");
    gl.bindAttribLocation(program, 1, "texCoord0");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Native fragment-output link failed. ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (let face = 0; face < cubeFaces.length; face++) {
      gl.texImage2D(cubeFaces[face]!, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, facePixels(face));
    }
    gl.uniform1i(gl.getUniformLocation(program, "tex"), 0);
    gl.viewport(0, 0, 2, 2);
    gl.disable(gl.DITHER);
    return targets.map(target => {
      gl.uniform1i(gl.getUniformLocation(program, "face"), target);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixels = new Uint8Array(16);
      gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return { target, pixels: Array.from(pixels), error: gl.getError() };
    });
  } finally {
    gl.useProgram(null);
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  }
}

async function webgpuPixels(device: GPUDevice, program: LinkedProgram, targets: readonly number[]) {
  const vertex = device.createShaderModule({ code: program.vertexWGSL });
  const fragment = device.createShaderModule({ code: program.fragmentWGSL });
  const compilation = [];
  for (const [stage, module] of [["vertex", vertex], ["fragment", fragment]] as const) {
    const info = await module.getCompilationInfo();
    compilation.push(...info.messages.map(({ type, message }) => ({ stage, type, message })));
  }
  const pipeline = await device.createRenderPipelineAsync({ layout: "auto",
    vertex: { module: vertex, entryPoint: program.vertexEntryPoint, buffers: [{ arrayStride: 24,
      attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" },
        { shaderLocation: 1, offset: 16, format: "float32x2" }] }] },
    fragment: { module: fragment, entryPoint: program.fragmentEntryPoint,
      targets: [{ format: "rgba8unorm" }] }, primitive: { topology: "triangle-list" } });
  const input = device.createBuffer({ size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const driver = device.createBuffer({ size: program.driverUniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uniform = device.createBuffer({ size: Math.max(16, program.fragmentUniformBufferSize),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const image = device.createTexture({ size: [2, 2, 6], format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const output = device.createTexture({ size: [2, 2], format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 512,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    device.queue.writeBuffer(input, 0, vertices);
    const driverData = new ArrayBuffer(program.driverUniformBufferSize);
    new Float32Array(driverData)[1] = 1;
    const uints = new Uint32Array(driverData);
    uints[2] = (2 << 16) | 2;
    uints[3] = 0x817f7f7f;
    uints[4] = 1 << 20;
    device.queue.writeBuffer(driver, 0, driverData);
    for (let face = 0; face < cubeFaces.length; face++) {
      device.queue.writeTexture({ texture: image, origin: [0, 0, face] }, facePixels(face),
        { bytesPerRow: 8, rowsPerImage: 2 }, [2, 2, 1]);
    }
    const uniforms = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: program.fragmentUniformBufferSize === 0 ? [] : [{ binding: 1, resource: { buffer: uniform } }] });
    const sampler = program.samplers[0];
    const textures = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1),
      entries: sampler ? [
        { binding: sampler.samplerBinding, resource: device.createSampler({ minFilter: "nearest",
          magFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }) },
        { binding: sampler.textureBinding, resource: image.createView({ dimension: "cube" }) },
      ] : [] });
    const drivers = device.createBindGroup({ layout: pipeline.getBindGroupLayout(2),
      entries: [{ binding: 0, resource: { buffer: driver } }] });
    const results = [];
    for (const target of targets) {
      const uniformData = new ArrayBuffer(Math.max(16, program.fragmentUniformBufferSize));
      const face = program.uniforms.find(value => value.name === "face");
      if (face?.fragmentOffset != null) {
        new DataView(uniformData).setInt32(face.fragmentOffset, target, true);
      }
      device.queue.writeBuffer(uniform, 0, uniformData);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(),
        loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, uniforms);
      pass.setBindGroup(1, textures);
      pass.setBindGroup(2, drivers);
      pass.setVertexBuffer(0, input);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow: 256 }, [2, 2]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(readback.getMappedRange());
      results.push({ target, pixels: [...data.slice(0, 8), ...data.slice(256, 264)] });
      readback.unmap();
    }
    return { results, compilation, pipeline: true };
  } finally {
    readback.destroy();
    output.destroy();
    image.destroy();
    uniform.destroy();
    driver.destroy();
    input.destroy();
  }
}

export async function runFragmentOutputVerification(compiler: Compiler) {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const native = canvas.getContext("webgl", { alpha: false, depth: false, stencil: false,
    antialias: false, preserveDrawingBuffer: true });
  if (!native) throw new Error("Native WebGL is unavailable for the fragment-output reference.");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU is unavailable for fragment-output verification.");
  const device = await adapter.requestDevice();
  const validationErrors: string[] = [];
  device.addEventListener("uncapturederror", event => validationErrors.push(event.error.message));
  try {
    const cases = [
      { id: "original-cts-cubemap-frag-data", fragment: simpleCubeMapTextureFragmentShader, targets: cubeFaces },
      { id: "frag-data-array-read-early-return", fragment: fragDataReadFragmentShader, targets: [cubeFaces[0]] },
    ];
    const results = [];
    for (const sample of cases) {
      const vertex = compiler.compile(simpleTextureVertexShader, "vertex");
      const fragment = compiler.compile(sample.fragment, "fragment");
      const program = compiler.link(vertex, fragment, { vPosition: 0, texCoord0: 1 });
      if (!program.success) throw new Error(`${sample.id} link failed. ${program.log}`);
      const reference = nativePixels(native, sample.fragment, sample.targets);
      device.pushErrorScope("validation");
      const gpu = await webgpuPixels(device, program, sample.targets);
      const error = await device.popErrorScope();
      if (error) validationErrors.push(error.message);
      results.push({ id: sample.id,
        sources: { vertex: simpleTextureVertexShader, fragment: sample.fragment,
          vertexWGSL: program.vertexWGSL, fragmentWGSL: program.fragmentWGSL },
        reflection: { outputs: fragment.outputs, samplers: program.samplers, uniforms: program.uniforms },
        compilation: gpu.compilation, pipeline: gpu.pipeline,
        samples: reference.map((value, index) => ({ target: value.target, nativeError: value.error,
          expected: sample.id === "original-cts-cubemap-frag-data" ? Array.from(facePixels(index))
            : [255, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 0, 0, 255, 255],
          native: value.pixels, webgpu: gpu.results[index]!.pixels })) });
    }
    return { userAgent: navigator.userAgent,
      upstream: { revision: "39443210f7f81db4773eb104facadfb85d05dfa4",
        path: "sdk/tests/js/webgl-test-utils.js",
        shaderNames: ["simpleTextureVertexShader", "simpleCubeMapTextureFragmentShader"] },
      adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
        device: adapter.info.device, description: adapter.info.description,
        isFallbackAdapter: adapter.info.isFallbackAdapter },
      configuration: { width: 2, height: 2, samples: 1, filtering: "nearest", rows: "GL bottom row first" },
      faceInputs: cubeFaces.map((target, index) => ({ target, pixels: Array.from(facePixels(index)) })),
      results, validationErrors };
  } finally {
    device.destroy();
    native.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

