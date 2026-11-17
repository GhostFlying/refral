import { CUBE_FACES } from "@refral/core-api";
import type { Compiler, LinkedProgram } from "../src/types.js";

type Color = readonly [number, number, number, number];
type Direction = readonly [number, number, number];
type TextureKind = "2d" | "cube";

interface Probe {
  id: string;
  face: number;
  direction?: Direction;
  uv?: readonly [number, number];
  expected: Color;
}

interface SamplingCase {
  id: string;
  kind: TextureKind;
  vertex: string;
  fragment: string;
  probes: Probe[];
  faces: Uint8Array<ArrayBuffer>[];
}

const faceNames = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as const;
const axisDirections: readonly Direction[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const positions = new Float32Array([-1, -1, 3, -1, -1, 3]);
const vertexSource = "attribute vec2 position; void main(){gl_Position=vec4(position,0.0,1.0);}";
const sampledFragment = "precision mediump float; varying vec4 sampled; void main(){gl_FragColor=sampled;}";

function faceColor(face: number, column?: number, row?: number): Color {
  return column === undefined || row === undefined
    ? [32 + face * 32, 64, 128, 255]
    : [32 + face * 32, 32 + column * 160, 32 + row * 160, 255];
}

function facePixels(face: number, palette: boolean): Uint8Array<ArrayBuffer> {
  const pixels = new Uint8Array(16);
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 2; column++) {
      pixels.set(palette ? faceColor(face, column, row) : faceColor(face), (row * 2 + column) * 4);
    }
  }
  return pixels;
}

/** Inverse of the GLES2 cube face (sc, tc, ma) table, with strictly dominant face axes. */
function directionForTexel(face: number, u: number, v: number): Direction {
  const s = 2 * u - 1;
  const t = 2 * v - 1;
  const directions: Direction[] = [
    [1, -t, -s], [-1, -t, s], [s, 1, t], [s, -1, -t], [s, -t, 1], [-s, -t, -1],
  ];
  return directions[face]!;
}

function glslNumber(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function fragmentForProbes(probes: Probe[]): string {
  const statements = probes.map((probe, index) => {
    if (!probe.direction) throw new Error("Cube fragment probe requires a direction.");
    const value = `vec3(${probe.direction.map(glslNumber).join(",")})`;
    return index === probes.length - 1 ? `return ${value};`
      : `if(gl_FragCoord.x < ${index + 1}.0) return ${value};`;
  });
  return `precision highp float; uniform samplerCube image;
    vec3 lookupDirection(){${statements.join("\n")}}
    void main(){gl_FragColor=textureCube(image,lookupDirection());}`;
}

function samplingCases(): SamplingCase[] {
  const axes = axisDirections.map((direction, face): Probe => ({
    id: faceNames[face]!, face, direction, expected: faceColor(face),
  }));
  const orientation: Probe[] = [];
  for (let face = 0; face < CUBE_FACES.length; face++) {
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 2; column++) {
        const u = (column + 0.5) / 2;
        const v = (row + 0.5) / 2;
        orientation.push({ id: `${faceNames[face]}:${column},${row}`, face, uv: [u, v],
          direction: directionForTexel(face, u, v), expected: faceColor(face, column, row) });
      }
    }
  }
  const solidFaces = CUBE_FACES.map((_target, face) => facePixels(face, false));
  return [
    { id: "six-axis-directions", kind: "cube", vertex: vertexSource,
      fragment: fragmentForProbes(axes), probes: axes, faces: solidFaces },
    { id: "six-face-texel-orientation", kind: "cube", vertex: vertexSource,
      fragment: fragmentForProbes(orientation), probes: orientation,
      faces: CUBE_FACES.map((_target, face) => facePixels(face, true)) },
    { id: "vertex-implicit-cube-level-zero", kind: "cube",
      vertex: "attribute vec2 position; uniform samplerCube image; varying vec4 sampled; void main(){gl_Position=vec4(position,0.0,1.0);sampled=textureCube(image,vec3(1.0,0.0,0.0));}",
      fragment: sampledFragment, probes: [axes[0]!], faces: solidFaces },
    { id: "vertex-implicit-2d-level-zero", kind: "2d",
      vertex: "attribute vec2 position; uniform sampler2D image; varying vec4 sampled; void main(){gl_Position=vec4(position,0.0,1.0);sampled=texture2D(image,vec2(0.25));}",
      fragment: sampledFragment, probes: [{ id: "2D:0,0", face: 0, uv: [0.25, 0.25], expected: faceColor(0) }],
      faces: [solidFaces[0]!] },
  ];
}

function nativeShader(gl: WebGLRenderingContext, stage: number, source: string): WebGLShader {
  const shader = gl.createShader(stage);
  if (!shader) throw new Error("Native WebGL failed to create a shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Native shader compilation failed. ${log}`);
  }
  return shader;
}

function renderNative(gl: WebGLRenderingContext, sample: SamplingCase) {
  gl.canvas.width = sample.probes.length;
  gl.canvas.height = 1;
  const vertex = nativeShader(gl, gl.VERTEX_SHADER, sample.vertex);
  const fragment = nativeShader(gl, gl.FRAGMENT_SHADER, sample.fragment);
  const program = gl.createProgram()!;
  const buffer = gl.createBuffer()!;
  const texture = gl.createTexture()!;
  try {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, "position");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Native program link failed. ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    const target = sample.kind === "cube" ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D;
    gl.bindTexture(target, texture);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (let face = 0; face < sample.faces.length; face++) {
      gl.texImage2D(sample.kind === "cube" ? CUBE_FACES[face]! : gl.TEXTURE_2D,
        0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, sample.faces[face]!);
    }
    gl.uniform1i(gl.getUniformLocation(program, "image"), 0);
    gl.viewport(0, 0, sample.probes.length, 1);
    gl.disable(gl.DITHER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = new Uint8Array(sample.probes.length * 4);
    gl.readPixels(0, 0, sample.probes.length, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: Array.from(pixels), error: gl.getError() };
  } finally {
    gl.useProgram(null);
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  }
}

async function renderWebGPU(device: GPUDevice, program: LinkedProgram, sample: SamplingCase) {
  const width = sample.probes.length;
  const vertexModule = device.createShaderModule({ code: program.vertexWGSL });
  const fragmentModule = device.createShaderModule({ code: program.fragmentWGSL });
  const compilation = [];
  for (const [stage, module] of [["vertex", vertexModule], ["fragment", fragmentModule]] as const) {
    const info = await module.getCompilationInfo();
    compilation.push(...info.messages.map(({ type, message }) => ({ stage, type, message })));
  }
  const pipeline = await device.createRenderPipelineAsync({ layout: "auto",
    vertex: { module: vertexModule, entryPoint: program.vertexEntryPoint,
      buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] }] },
    fragment: { module: fragmentModule, entryPoint: program.fragmentEntryPoint,
      targets: [{ format: "rgba8unorm" }] }, primitive: { topology: "triangle-list" } });
  const image = device.createTexture({ size: { width: 2, height: 2, depthOrArrayLayers: sample.faces.length },
    format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: { width, height: 1 }, format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const vertices = device.createBuffer({ size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const driver = device.createBuffer({ size: program.driverUniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const readback = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    device.queue.writeBuffer(vertices, 0, positions);
    const driverData = new ArrayBuffer(program.driverUniformBufferSize);
    new Float32Array(driverData)[1] = 1;
    const uints = new Uint32Array(driverData);
    uints[2] = (1 << 16) | width;
    uints[3] = 0x817f7f7f;
    uints[4] = 1 << 20;
    device.queue.writeBuffer(driver, 0, driverData);
    for (let face = 0; face < sample.faces.length; face++) {
      device.queue.writeTexture({ texture: image, origin: { x: 0, y: 0, z: face } },
        sample.faces[face]!, { bytesPerRow: 8, rowsPerImage: 2 },
        { width: 2, height: 2, depthOrArrayLayers: 1 });
    }
    const sampler = program.samplers.find(value => value.name === "image");
    if (!sampler) throw new Error("Compiler omitted the active image sampler.");
    const textures = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [
      { binding: sampler.samplerBinding, resource: device.createSampler({
        minFilter: "nearest", magFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }) },
      { binding: sampler.textureBinding, resource: image.createView({ dimension: sample.kind }) },
    ] });
    const drivers = device.createBindGroup({ layout: pipeline.getBindGroupLayout(2),
      entries: [{ binding: 0, resource: { buffer: driver } }] });
    const empty = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(),
      loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, empty);
    pass.setBindGroup(1, textures);
    pass.setBindGroup(2, drivers);
    pass.setVertexBuffer(0, vertices);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 256 }, { width, height: 1 });
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const pixels = Array.from(new Uint8Array(readback.getMappedRange()).slice(0, width * 4));
    readback.unmap();
    return { pixels, compilation, pipeline: true };
  } finally {
    readback.destroy();
    driver.destroy();
    vertices.destroy();
    target.destroy();
    image.destroy();
  }
}

export async function runCubeSamplerVerification(compiler: Compiler) {
  const canvas = document.createElement("canvas");
  const native = canvas.getContext("webgl", { alpha: false, depth: false, stencil: false,
    antialias: false, preserveDrawingBuffer: true });
  if (!native) throw new Error("Native WebGL is unavailable for the cube compiler reference.");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Chrome did not provide a WebGPU adapter for cube sampling.");
  const device = await adapter.requestDevice();
  const validationErrors: string[] = [];
  device.addEventListener("uncapturederror", event => validationErrors.push(event.error.message));
  try {
    const results = [];
    for (const sample of samplingCases()) {
      const vertex = compiler.compile(sample.vertex, "vertex");
      const fragment = compiler.compile(sample.fragment, "fragment");
      const program = compiler.link(vertex, fragment, { position: 0 });
      if (!program.success) throw new Error(`${sample.id} compiler link failed. ${program.log}`);
      const reference = renderNative(native, sample);
      device.pushErrorScope("validation");
      const gpu = await renderWebGPU(device, program, sample);
      const validation = await device.popErrorScope();
      if (validation) validationErrors.push(validation.message);
      const probes = sample.probes.map((probe, index) => ({ ...probe,
        native: reference.pixels.slice(index * 4, index * 4 + 4),
        webgpu: gpu.pixels.slice(index * 4, index * 4 + 4) }));
      results.push({ id: sample.id, kind: sample.kind, probes,
        sources: { vertex: sample.vertex, fragment: sample.fragment,
          vertexWGSL: program.vertexWGSL, fragmentWGSL: program.fragmentWGSL },
        reflection: { samplers: program.samplers, vertexUniforms: program.vertexUniformBufferSize,
          fragmentUniforms: program.fragmentUniformBufferSize },
        faces: sample.faces.map((pixels, layer) => ({ layer,
          target: sample.kind === "cube" ? CUBE_FACES[layer] : native.TEXTURE_2D, pixels: Array.from(pixels) })),
        nativeError: reference.error, compilation: gpu.compilation, pipeline: gpu.pipeline });
    }
    return { userAgent: navigator.userAgent,
      adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
        device: adapter.info.device, description: adapter.info.description,
        isFallbackAdapter: adapter.info.isFallbackAdapter },
      faceOrder: CUBE_FACES.map((target, layer) => ({ target, layer, name: faceNames[layer] })),
      configuration: { textureSize: [2, 2], filtering: "nearest", level: 0,
        paletteRows: "row zero is the uploaded GL bottom row", directionSource: "GLES2 cube face coordinate table" },
      results, validationErrors };
  } finally {
    device.destroy();
    native.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
