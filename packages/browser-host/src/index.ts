import { GL, componentCount } from "@refral/core-api";
import type {
  AttributeSnapshot, RasterState, TargetSnapshot, TextureParameters, TextureStorage,
  LinkedProgram, DrawOperation, SemanticHost,
} from "@refral/core-api";

export type { TextureBinding, DrawOperation } from "@refral/core-api";

export interface HostStats {
  draws: number;
  passes: number;
  submits: number;
  copies: number;
  uploadedBytes: number;
  pipelines: number;
  bindGroups: number;
  allocatedBufferBytes: number;
  allocatedTextureBytes: number;
  peakAllocatedBufferBytes: number;
  peakAllocatedTextureBytes: number;
}

export interface CapturedPixels {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PreparedHostFactory {
  (canvas: HTMLCanvasElement, attributes: { alpha: boolean; depth: boolean }, ownsDevice?: boolean): BrowserHost;
  dispose(): void;
}

interface Target {
  color: GPUTexture;
  depth: GPUTexture | null;
  width: number;
  height: number;
  opaque: boolean;
}

const TEXTURE_USAGE = 0x10 | 0x04 | 0x01 | 0x02;

function aligned(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function compareFunction(value: number): GPUCompareFunction {
  const functions: Record<number, GPUCompareFunction> = {
    [GL.NEVER]: "never", [GL.LESS]: "less", [GL.EQUAL]: "equal", [GL.LEQUAL]: "less-equal",
    [GL.GREATER]: "greater", [GL.NOTEQUAL]: "not-equal", [GL.GEQUAL]: "greater-equal",
    [GL.ALWAYS]: "always",
  };
  return functions[value] ?? "always";
}

function blendFactor(value: number): GPUBlendFactor {
  const factors: Record<number, GPUBlendFactor> = {
    [GL.ZERO]: "zero", [GL.ONE]: "one", [GL.SRC_COLOR]: "src",
    [GL.ONE_MINUS_SRC_COLOR]: "one-minus-src", [GL.SRC_ALPHA]: "src-alpha",
    [GL.ONE_MINUS_SRC_ALPHA]: "one-minus-src-alpha", [GL.DST_ALPHA]: "dst-alpha",
    [GL.ONE_MINUS_DST_ALPHA]: "one-minus-dst-alpha", [GL.DST_COLOR]: "dst",
    [GL.ONE_MINUS_DST_COLOR]: "one-minus-dst", [GL.SRC_ALPHA_SATURATE]: "src-alpha-saturated",
    [GL.CONSTANT_COLOR]: "constant", [GL.ONE_MINUS_CONSTANT_COLOR]: "one-minus-constant",
    [GL.CONSTANT_ALPHA]: "constant", [GL.ONE_MINUS_CONSTANT_ALPHA]: "one-minus-constant",
  };
  return factors[value] ?? "one";
}

function blendOperation(value: number): GPUBlendOperation {
  if (value === GL.FUNC_SUBTRACT) return "subtract";
  if (value === GL.FUNC_REVERSE_SUBTRACT) return "reverse-subtract";
  return "add";
}

function colorWriteMask(mask: readonly boolean[]): GPUColorWriteFlags {
  return mask.reduce((bits, enabled, index) => bits | (enabled ? 1 << index : 0), 0);
}

export class BrowserHost implements SemanticHost {
  readonly stats: HostStats = {
    draws: 0, passes: 0, submits: 0, copies: 0, uploadedBytes: 0,
    pipelines: 0, bindGroups: 0, allocatedBufferBytes: 0, allocatedTextureBytes: 0,
    peakAllocatedBufferBytes: 0, peakAllocatedTextureBytes: 0,
  };
  readonly errors: string[] = [];
  readonly environment: Record<string, unknown>;
  readonly limits: GPUSupportedLimits;
  private encoder: GPUCommandEncoder | null = null;
  private pass: GPURenderPassEncoder | null = null;
  private passTarget: Target | null = null;
  private defaultTarget: Target | null = null;
  private defaultDirty = false;
  private textureCache = new WeakMap<TextureStorage, GPUTexture>();
  private depthCache = new Map<string, GPUTexture>();
  private targetCache = new WeakMap<GPUTexture, Target>();
  private initialized = new WeakSet<GPUTexture>();
  private vertexCache = new WeakMap<Uint8Array, Map<string, GPUBuffer>>();
  private indexCache = new WeakMap<Uint8Array, Map<number, GPUBuffer>>();
  private programs = new WeakMap<LinkedProgram, {
    layout: GPUPipelineLayout;
    groups: [GPUBindGroupLayout, GPUBindGroupLayout, GPUBindGroupLayout];
    vertex: GPUShaderModule;
    fragment: GPUShaderModule;
    pipelines: Map<string, GPURenderPipeline>;
  }>();
  private samplers = new Map<string, GPUSampler>();
  private clearPipelines = new Map<string, GPURenderPipeline>();
  private textures = new Set<GPUTexture>();
  private buffers = new Set<GPUBuffer>();
  private retiredTextures = new Set<GPUTexture>();
  private driverGroups = new WeakMap<LinkedProgram, Map<string, GPUBindGroup>>();
  private presentationPipeline: GPURenderPipeline | null = null;
  private blackTexture: GPUTexture | null = null;
  private disposed = false;
  private readonly handleError = (event: Event): void => {
    this.errors.push((event as GPUUncapturedErrorEvent).error.message);
  };

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly device: GPUDevice,
    readonly context: GPUCanvasContext,
    readonly format: GPUTextureFormat,
    adapter: GPUAdapter,
    readonly alpha: boolean,
    readonly hasDepth: boolean,
    private readonly ownsDevice = true,
  ) {
    this.limits = device.limits;
    this.environment = {
      userAgent: navigator.userAgent,
      adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
        device: adapter.info.device, description: adapter.info.description,
        isFallbackAdapter: adapter.info.isFallbackAdapter },
      features: [...device.features],
      limits: Object.fromEntries(Object.keys(Object.getPrototypeOf(device.limits)).map(
        key => [key, (device.limits as unknown as Record<string, unknown>)[key]],
      )),
      canvasFormat: format,
      coordinateConvention: "GL row zero in offscreen surfaces, flipped on presentation",
    };
    device.addEventListener("uncapturederror", this.handleError);
  }

  static async create(canvas: HTMLCanvasElement, attributes: { alpha: boolean; depth: boolean }): Promise<BrowserHost> {
    const prepared = await BrowserHost.prepare();
    try {
      return prepared(canvas, attributes, true);
    } catch (error) {
      prepared.dispose();
      throw error;
    }
  }

  static async prepare(): Promise<PreparedHostFactory> {
    if (!navigator.gpu) throw new DOMException("WebGPU is unavailable", "NotSupportedError");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new DOMException("No WebGPU adapter is available", "NotSupportedError");
    const device = await adapter.requestDevice();
    const format = navigator.gpu.getPreferredCanvasFormat();
    const factory: PreparedHostFactory = (canvas, attributes, ownsDevice = false) => {
      const context = canvas.getContext("webgpu");
      if (!context) throw new DOMException("Canvas is already bound to another context", "InvalidStateError");
      context.configure({ device, format, alphaMode: attributes.alpha ? "premultiplied" : "opaque" });
      return new BrowserHost(canvas, device, context, format, adapter, attributes.alpha, attributes.depth, ownsDevice);
    };
    factory.dispose = () => device.destroy();
    return factory;
  }

  private getEncoder(): GPUCommandEncoder {
    this.encoder ??= this.device.createCommandEncoder({ label: "Refral ordered GL work" });
    return this.encoder;
  }

  private createTexture(width: number, height: number, format: GPUTextureFormat): GPUTexture {
    const texture = this.device.createTexture({
      size: { width: Math.max(1, width), height: Math.max(1, height) }, format,
      usage: format === "depth24plus" ? GPUTextureUsage.RENDER_ATTACHMENT : TEXTURE_USAGE,
    });
    this.textures.add(texture);
    this.stats.allocatedTextureBytes += Math.max(1, width) * Math.max(1, height) * 4;
    this.stats.peakAllocatedTextureBytes = Math.max(this.stats.peakAllocatedTextureBytes,
      this.stats.allocatedTextureBytes);
    return texture;
  }

  private createBuffer(data: Uint8Array, usage: GPUBufferUsageFlags, _transient = false): GPUBuffer {
    const buffer = this.device.createBuffer({ size: Math.max(4, aligned(data.byteLength, 4)),
      usage: usage | GPUBufferUsage.COPY_DST });
    if (data.byteLength) {
      const padded = new Uint8Array(aligned(data.byteLength, 4));
      padded.set(data);
      this.device.queue.writeBuffer(buffer, 0, padded);
      this.stats.uploadedBytes += data.byteLength;
    }
    this.buffers.add(buffer);
    this.stats.allocatedBufferBytes += buffer.size;
    this.stats.peakAllocatedBufferBytes = Math.max(this.stats.peakAllocatedBufferBytes,
      this.stats.allocatedBufferBytes);
    return buffer;
  }

  private uploadTexture(texture: GPUTexture, data: Uint8Array, width: number, height: number,
    x = 0, y = 0): void {
    if (!width || !height) return;
    this.endPass();
    const bytesPerRow = aligned(width * 4, 256);
    const staging = new Uint8Array(bytesPerRow * height);
    for (let row = 0; row < height; row++) {
      staging.set(data.subarray(row * width * 4, (row + 1) * width * 4), row * bytesPerRow);
    }
    const buffer = this.createBuffer(staging, GPUBufferUsage.COPY_SRC, true);
    this.getEncoder().copyBufferToTexture({ buffer, bytesPerRow },
      { texture, origin: { x, y } }, { width, height });
    this.stats.copies++;
    this.initialized.add(texture);
  }

  private materializeTexture(storage: TextureStorage): GPUTexture {
    let texture = this.textureCache.get(storage);
    if (texture) return texture;
    texture = this.createTexture(storage.width, storage.height, "rgba8unorm");
    this.textureCache.set(storage, texture);
    if (storage.parent) {
      const parent = this.materializeTexture(storage.parent);
      this.endPass();
      this.getEncoder().copyTextureToTexture({ texture: parent }, { texture },
        { width: storage.width, height: storage.height });
      this.initialized.add(texture);
      this.stats.copies++;
    }
    if (storage.data) this.uploadTexture(texture, storage.data, storage.width, storage.height);
    if (storage.update) {
      const update = storage.update;
      this.uploadTexture(texture, update.data, update.width, update.height, update.x, update.y);
    }
    return texture;
  }

  private resolveTarget(snapshot: TargetSnapshot): Target {
    if (snapshot.isDefault) {
      if (!this.defaultTarget || this.defaultTarget.width !== snapshot.width ||
          this.defaultTarget.height !== snapshot.height) {
        this.endPass();
        if (this.defaultTarget) {
          this.retiredTextures.add(this.defaultTarget.color);
          if (this.defaultTarget.depth) this.retiredTextures.add(this.defaultTarget.depth);
        }
        this.defaultTarget = {
          color: this.createTexture(snapshot.width, snapshot.height, "rgba8unorm"),
          depth: this.hasDepth ? this.createTexture(snapshot.width, snapshot.height, "depth24plus") : null,
          width: snapshot.width, height: snapshot.height,
          opaque: !this.alpha,
        };
      }
      return this.defaultTarget;
    }
    const color = this.materializeTexture(snapshot.color!);
    let depth: GPUTexture | null = null;
    if (snapshot.depth) {
      const key = `${snapshot.depth.id}:${snapshot.depthGeneration}`;
      depth = this.depthCache.get(key) ?? null;
      if (!depth) {
        depth = this.createTexture(snapshot.width, snapshot.height, "depth24plus");
        this.depthCache.set(key, depth);
      }
    }
    let target = this.targetCache.get(color);
    if (!target || target.depth !== depth) {
      target = { color, depth, width: snapshot.width, height: snapshot.height, opaque: false };
      this.targetCache.set(color, target);
    }
    return target;
  }

  private beginPass(target: Target): GPURenderPassEncoder {
    if (this.pass && this.passTarget === target) return this.pass;
    this.endPass();
    const descriptor: GPURenderPassDescriptor = {
      colorAttachments: [{ view: target.color.createView(),
        loadOp: this.initialized.has(target.color) ? "load" : "clear",
        storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: target.opaque ? 1 : 0 } }],
    };
    if (target.depth) {
      descriptor.depthStencilAttachment = { view: target.depth.createView(),
        depthLoadOp: this.initialized.has(target.depth) ? "load" : "clear",
        depthStoreOp: "store", depthClearValue: 1 };
      this.initialized.add(target.depth);
    }
    this.initialized.add(target.color);
    this.pass = this.getEncoder().beginRenderPass(descriptor);
    this.passTarget = target;
    this.stats.passes++;
    return this.pass;
  }

  private endPass(): void {
    this.pass?.end();
    this.pass = null;
    this.passTarget = null;
  }

  replaceStorage(previous: TextureStorage | null, next: TextureStorage): void {
    if (next.parent) {
      this.materializeTexture(next);
      // The new GPU image now owns the content dependency through the encoded copy.
      // Drop the CPU history so repeated sub-image uploads have bounded metadata.
      delete next.parent;
      delete next.update;
    }
    if (previous) this.retireStorage(previous);
  }

  retireStorage(storage: TextureStorage): void {
    const texture = this.textureCache.get(storage);
    if (!texture) return;
    this.textureCache.delete(storage);
    this.retiredTextures.add(texture);
  }

  retireDepth(id: number, generation: number): void {
    const key = `${id}:${generation}`;
    const texture = this.depthCache.get(key);
    if (texture) {
      this.depthCache.delete(key);
      this.retiredTextures.add(texture);
    }
  }

  private programResources(program: LinkedProgram) {
    let resources = this.programs.get(program);
    if (resources) return resources;
    const uniformLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ] });
    const textureEntries: GPUBindGroupLayoutEntry[] = [];
    for (const sampler of program.samplers) {
      textureEntries.push({ binding: sampler.samplerBinding,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } });
      textureEntries.push({ binding: sampler.textureBinding,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
    }
    const textureLayout = this.device.createBindGroupLayout({ entries: textureEntries });
    const driverLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" } },
    ] });
    const groups: [GPUBindGroupLayout, GPUBindGroupLayout, GPUBindGroupLayout] =
      [uniformLayout, textureLayout, driverLayout];
    resources = { groups, layout: this.device.createPipelineLayout({ bindGroupLayouts: groups }),
      vertex: this.device.createShaderModule({ code: program.vertexWGSL }),
      fragment: this.device.createShaderModule({ code: program.fragmentWGSL }),
      pipelines: new Map<string, GPURenderPipeline>() };
    this.programs.set(program, resources);
    return resources;
  }

  private vertexBuffer(attribute: AttributeSnapshot, vertices: number): GPUBuffer {
    const components = componentCount(attribute.shaderType);
    const key = `${attribute.size}:${attribute.stride}:${attribute.offset}:${components}:${vertices}`;
    if (attribute.data) {
      const cached = this.vertexCache.get(attribute.data)?.get(key);
      if (cached) return cached;
    }
    const values = new Float32Array(Math.max(1, vertices) * components);
    const view = attribute.data ? new DataView(attribute.data.buffer, attribute.data.byteOffset,
      attribute.data.byteLength) : null;
    const stride = attribute.stride || attribute.size * 4;
    for (let vertex = 0; vertex < Math.max(1, vertices); vertex++) {
      for (let component = 0; component < components; component++) {
        values[vertex * components + component] = view
          ? (component < attribute.size
            ? view.getFloat32(attribute.offset + vertex * stride + component * 4, true)
            : component === 3 ? 1 : 0)
          : attribute.constant[component] ?? (component === 3 ? 1 : 0);
      }
    }
    const buffer = this.createBuffer(new Uint8Array(values.buffer), GPUBufferUsage.VERTEX,
      !attribute.data);
    if (attribute.data) {
      let cache = this.vertexCache.get(attribute.data);
      if (!cache) { cache = new Map(); this.vertexCache.set(attribute.data, cache); }
      cache.set(key, buffer);
    }
    return buffer;
  }

  private sampler(parameters: TextureParameters): GPUSampler {
    const key = JSON.stringify(parameters);
    let sampler = this.samplers.get(key);
    if (!sampler) {
      const wrap = (mode: number): GPUAddressMode => mode === GL.REPEAT ? "repeat" :
        mode === GL.MIRRORED_REPEAT ? "mirror-repeat" : "clamp-to-edge";
      sampler = this.device.createSampler({
        minFilter: parameters.minFilter === GL.NEAREST ? "nearest" : "linear",
        magFilter: parameters.magFilter === GL.NEAREST ? "nearest" : "linear",
        addressModeU: wrap(parameters.wrapS), addressModeV: wrap(parameters.wrapT),
      });
      this.samplers.set(key, sampler);
    }
    return sampler;
  }

  private getBlackTexture(): GPUTexture {
    if (!this.blackTexture) {
      this.blackTexture = this.createTexture(1, 1, "rgba8unorm");
      this.uploadTexture(this.blackTexture, new Uint8Array([0, 0, 0, 255]), 1, 1);
    }
    return this.blackTexture;
  }

  draw(operation: DrawOperation): void {
    const { program, state } = operation;
    const target = this.resolveTarget(operation.target);
    const resources = this.programResources(program);
    const layouts: GPUVertexBufferLayout[] = operation.attributes.map(attribute => {
      const components = componentCount(attribute.shaderType);
      const format = (components === 1 ? "float32" : `float32x${components}`) as GPUVertexFormat;
      return { arrayStride: components * 4,
        attributes: [{ shaderLocation: attribute.location, offset: 0, format }] };
    });
    const key = JSON.stringify([layouts, !!target.depth, target.opaque, state.depthTest, state.depthMask,
      state.depthFunc, state.colorMask, state.blend, state.blendSrcRGB, state.blendDstRGB,
      state.blendSrcAlpha, state.blendDstAlpha, state.blendEquationRGB, state.blendEquationAlpha,
      state.cull, state.cullFace, state.frontFace]);
    let pipeline = resources.pipelines.get(key);
    if (!pipeline) {
      const blend: GPUBlendState | undefined = state.blend ? {
        color: { operation: blendOperation(state.blendEquationRGB),
          srcFactor: blendFactor(state.blendSrcRGB), dstFactor: blendFactor(state.blendDstRGB) },
        alpha: { operation: blendOperation(state.blendEquationAlpha),
          srcFactor: blendFactor(state.blendSrcAlpha), dstFactor: blendFactor(state.blendDstAlpha) },
      } : undefined;
      pipeline = this.device.createRenderPipeline({ layout: resources.layout,
        vertex: { module: resources.vertex, entryPoint: program.vertexEntryPoint, buffers: layouts },
        fragment: { module: resources.fragment, entryPoint: program.fragmentEntryPoint,
          targets: [{ format: "rgba8unorm",
            writeMask: colorWriteMask(state.colorMask) & (target.opaque ? 7 : 15), blend }] },
        primitive: { topology: "triangle-list",
          frontFace: state.frontFace === GL.CCW ? "cw" : "ccw",
          cullMode: !state.cull ? "none" : state.cullFace === GL.FRONT ? "front" : "back" },
        depthStencil: target.depth ? { format: "depth24plus",
          depthWriteEnabled: state.depthTest && state.depthMask,
          depthCompare: state.depthTest ? compareFunction(state.depthFunc) : "always" } : undefined,
      });
      resources.pipelines.set(key, pipeline);
      this.stats.pipelines++;
    }
    const vertexBuffers = operation.attributes.map(attribute =>
      this.vertexBuffer(attribute, operation.vertexCount));
    const vertexUniform = this.createBuffer(operation.vertexUniforms, GPUBufferUsage.UNIFORM, true);
    const fragmentUniform = this.createBuffer(operation.fragmentUniforms, GPUBufferUsage.UNIFORM, true);
    const uniformGroup = this.device.createBindGroup({ layout: resources.groups[0], entries: [
      { binding: 0, resource: { buffer: vertexUniform } },
      { binding: 1, resource: { buffer: fragmentUniform } },
    ] });
    const textureEntries: GPUBindGroupEntry[] = [];
    for (let i = 0; i < program.samplers.length; i++) {
      const sampler = program.samplers[i]!;
      const binding = operation.textures[i]!;
      const texture = binding.storage ? this.materializeTexture(binding.storage) : this.getBlackTexture();
      textureEntries.push({ binding: sampler.samplerBinding, resource: this.sampler(binding.parameters) });
      textureEntries.push({ binding: sampler.textureBinding, resource: texture.createView() });
    }
    const textureGroup = this.device.createBindGroup({ layout: resources.groups[1], entries: textureEntries });
    const driverKey = JSON.stringify([target.width, target.height, state.depthRange]);
    let driverCache = this.driverGroups.get(program);
    if (!driverCache) { driverCache = new Map(); this.driverGroups.set(program, driverCache); }
    let driverGroup = driverCache.get(driverKey);
    if (!driverGroup) {
      const data = new ArrayBuffer(Math.max(32, program.driverUniformBufferSize));
      const floats = new Float32Array(data);
      const uints = new Uint32Array(data);
      floats[0] = state.depthRange[0]; floats[1] = state.depthRange[1];
      uints[2] = ((target.height & 0xffff) << 16) | (target.width & 0xffff);
      uints[3] = 0x817f7f7f;
      uints[4] = 1 << 20;
      const buffer = this.createBuffer(new Uint8Array(data), GPUBufferUsage.UNIFORM);
      driverGroup = this.device.createBindGroup({ layout: resources.groups[2], entries: [
        { binding: 0, resource: { buffer } },
      ] });
      driverCache.set(driverKey, driverGroup);
      this.stats.bindGroups++;
    }
    let indexBuffer: GPUBuffer | null = null;
    if (operation.indices) {
      const cachedIndices = this.indexCache.get(operation.indices.data);
      indexBuffer = cachedIndices?.get(operation.indices.type) ?? null;
      if (!indexBuffer) {
        const values = operation.indices.type === GL.UNSIGNED_BYTE
          ? new Uint16Array(operation.indices.data)
          : new Uint16Array(operation.indices.data.buffer, operation.indices.data.byteOffset,
            operation.indices.data.byteLength / 2);
        indexBuffer = this.createBuffer(new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
          GPUBufferUsage.INDEX);
        let cache = cachedIndices;
        if (!cache) {
          cache = new Map();
          this.indexCache.set(operation.indices.data, cache);
        }
        cache.set(operation.indices.type, indexBuffer);
      }
    }
    const pass = this.beginPass(target);
    const viewport = state.viewport;
    if (viewport[0] < 0 || viewport[1] < 0 || viewport[0] + viewport[2] > target.width ||
        viewport[1] + viewport[3] > target.height) {
      throw new DOMException("Out-of-target viewport requires an emulation path", "NotSupportedError");
    }
    if (!viewport[2] || !viewport[3]) return;
    pass.setPipeline(pipeline);
    pass.setViewport(...viewport, ...state.depthRange);
    this.applyScissor(pass, state, target);
    const alphaConstants = [GL.CONSTANT_ALPHA, GL.ONE_MINUS_CONSTANT_ALPHA] as number[];
    const usesConstantAlphaRGB = alphaConstants.includes(state.blendSrcRGB) || alphaConstants.includes(state.blendDstRGB);
    const blendAlpha = state.blendColor[3];
    pass.setBlendConstant(usesConstantAlphaRGB
      ? [blendAlpha, blendAlpha, blendAlpha, blendAlpha] : state.blendColor);
    pass.setBindGroup(0, uniformGroup);
    pass.setBindGroup(1, textureGroup);
    pass.setBindGroup(2, driverGroup);
    vertexBuffers.forEach((buffer, index) => pass.setVertexBuffer(index, buffer));
    if (indexBuffer && operation.indices) {
      pass.setIndexBuffer(indexBuffer, "uint16");
      const size = operation.indices.type === GL.UNSIGNED_BYTE ? 1 : 2;
      pass.drawIndexed(operation.count, 1, operation.indices.offset / size);
    } else pass.draw(operation.count, 1, operation.first);
    this.stats.draws++;
    this.stats.bindGroups += 2;
    if (operation.target.isDefault) this.defaultDirty = true;
  }

  private applyScissor(pass: GPURenderPassEncoder, state: RasterState, target: Target): void {
    const box = state.scissorTest ? state.scissor : [0, 0, target.width, target.height];
    const x = Math.max(0, Math.min(target.width, box[0]!));
    const y = Math.max(0, Math.min(target.height, box[1]!));
    const right = Math.max(x, Math.min(target.width, box[0]! + box[2]!));
    const bottom = Math.max(y, Math.min(target.height, box[1]! + box[3]!));
    pass.setScissorRect(x, y, right - x, bottom - y);
  }

  clear(snapshot: TargetSnapshot, state: RasterState, mask: number,
    color: readonly number[], depth: number): void {
    const target = this.resolveTarget(snapshot);
    const writesColor = !!(mask & GL.COLOR_BUFFER_BIT);
    const writesDepth = !!(mask & GL.DEPTH_BUFFER_BIT) && state.depthMask && !!target.depth;
    if (!writesColor && !writesDepth) return;
    const writeMask = writesColor ? colorWriteMask(state.colorMask) & (target.opaque ? 7 : 15) : 0;
    const key = `${!!target.depth}:${writesDepth}:${writeMask}`;
    let pipeline = this.clearPipelines.get(key);
    if (!pipeline) {
      const code = `struct Clear { color: vec4f, depth: f32 };
        @group(0) @binding(0) var<uniform> value: Clear;
        @vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
          var p = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
          return vec4f(p[index],value.depth,1);
        }
        @fragment fn fs() -> @location(0) vec4f { return value.color; }`;
      const module = this.device.createShaderModule({ code });
      pipeline = this.device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm", writeMask }] },
        primitive: { topology: "triangle-list" },
        depthStencil: target.depth ? { format: "depth24plus", depthWriteEnabled: writesDepth,
          depthCompare: "always" } : undefined,
      });
      this.clearPipelines.set(key, pipeline);
      this.stats.pipelines++;
    }
    const values = new Float32Array(8);
    values.set(color, 0); values[4] = depth;
    const buffer = this.createBuffer(new Uint8Array(values.buffer), GPUBufferUsage.UNIFORM, true);
    const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }] });
    const pass = this.beginPass(target);
    pass.setPipeline(pipeline);
    pass.setViewport(0, 0, target.width, target.height, 0, 1);
    this.applyScissor(pass, state, target);
    pass.setBindGroup(0, group);
    pass.draw(3);
    this.stats.bindGroups++;
    if (snapshot.isDefault) this.defaultDirty = true;
  }

  private present(): void {
    const target = this.defaultTarget;
    if (!target || !this.defaultDirty || !this.canvas.width || !this.canvas.height) return;
    this.endPass();
    if (!this.presentationPipeline) {
      const module = this.device.createShaderModule({ code: `
        struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };
        @group(0) @binding(0) var image: texture_2d<f32>;
        @group(0) @binding(1) var filtering: sampler;
        @vertex fn vs(@builtin(vertex_index) index: u32) -> Out {
          var positions = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
          var out: Out; out.position = vec4f(positions[index],0,1);
          out.uv = (positions[index] + vec2f(1)) * 0.5; return out;
        }
        @fragment fn fs(input: Out) -> @location(0) vec4f {
          return textureSample(image,filtering,input.uv);
        }` });
      this.presentationPipeline = this.device.createRenderPipeline({ layout: "auto",
        vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs",
          targets: [{ format: this.format }] }, primitive: { topology: "triangle-list" } });
      this.stats.pipelines++;
    }
    const group = this.device.createBindGroup({ layout: this.presentationPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: target.color.createView() },
        { binding: 1, resource: this.device.createSampler({ magFilter: "nearest", minFilter: "nearest" }) }] });
    const pass = this.getEncoder().beginRenderPass({ colorAttachments: [{
      view: this.context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: this.alpha ? 0 : 1 },
    }] });
    pass.setPipeline(this.presentationPipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    this.stats.passes++;
    this.stats.bindGroups++;
    this.defaultDirty = false;
  }

  flush(): void {
    if (this.disposed) return;
    this.endPass();
    this.present();
    if (this.encoder) {
      this.device.queue.submit([this.encoder.finish()]);
      this.encoder = null;
      this.stats.submits++;
    }
    if (!this.buffers.size && !this.retiredTextures.size) return;
    const completed = [...this.buffers];
    this.buffers.clear();
    this.vertexCache = new WeakMap();
    this.indexCache = new WeakMap();
    this.driverGroups = new WeakMap();
    const retired = [...this.retiredTextures];
    this.retiredTextures.clear();
    void this.device.queue.onSubmittedWorkDone().then(() => {
      for (const buffer of completed) {
        this.stats.allocatedBufferBytes -= buffer.size;
        this.buffers.delete(buffer);
        buffer.destroy();
      }
      for (const texture of retired) {
        this.stats.allocatedTextureBytes -= texture.width * texture.height * 4;
        this.textures.delete(texture);
        texture.destroy();
      }
    }).catch(() => {});
  }

  async capture(snapshot: TargetSnapshot): Promise<CapturedPixels> {
    if (this.disposed) throw new DOMException("The context has been disposed", "InvalidStateError");
    if (!snapshot.width || !snapshot.height) {
      return { width: snapshot.width, height: snapshot.height, data: new Uint8Array(0) };
    }
    const target = this.resolveTarget(snapshot);
    this.beginPass(target);
    this.endPass();
    const bytesPerRow = aligned(target.width * 4, 256);
    const buffer = this.device.createBuffer({ size: Math.max(256, bytesPerRow * target.height),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.getEncoder().copyTextureToBuffer({ texture: target.color }, { buffer, bytesPerRow },
      { width: target.width, height: target.height });
    this.stats.copies++;
    this.flush();
    try {
      await buffer.mapAsync(GPUMapMode.READ);
      const source = new Uint8Array(buffer.getMappedRange());
      const data = new Uint8Array(target.width * target.height * 4);
      for (let row = 0; row < target.height; row++) {
        data.set(source.subarray(row * bytesPerRow, row * bytesPerRow + target.width * 4),
          row * target.width * 4);
      }
      return { width: target.width, height: target.height, data };
    } finally {
      buffer.destroy();
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.flush();
    this.disposed = true;
    await this.device.queue.onSubmittedWorkDone().catch(() => {});
    for (const buffer of this.buffers) buffer.destroy();
    for (const texture of this.textures) texture.destroy();
    this.context.unconfigure();
    this.device.removeEventListener("uncapturederror", this.handleError);
    if (this.ownsDevice) this.device.destroy();
    this.buffers.clear();
    this.textures.clear();
    this.stats.allocatedBufferBytes = 0;
    this.stats.allocatedTextureBytes = 0;
  }
}
