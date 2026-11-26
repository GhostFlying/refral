import { GL, BLEND_MINMAX, elementIndexBytes, readElementIndex, componentCount, stencilReference, vertexComponentBytes } from "@refral/core-api";
import { primitiveIndexBatches } from './primitive-indices.js';
import { OffscreenDiscard } from './offscreen-discard.js';
import { QueueCompletion } from './queue-completion.js';
import { CanvasReadback } from './canvas-readback.js';
import { GeometryCache } from './geometry-cache.js';
import { UniformArena } from './uniform-arena.js';
import type {
  AttributeSnapshot, RasterState, StencilFaceState, TargetSnapshot, TextureCopy, TextureParameters, TextureStorage,
  LinkedProgram, DrawOperation, DrawingSurface, SemanticHost, DomTextureCapturePlan, TextureVersion,
} from "@refral/core-api";

export type { TextureBinding, DrawOperation } from "@refral/core-api";

const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const geometryCacheBytes = 32 * 1024 * 1024;
const geometryCacheEntries = 512;

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
  offscreenDiscardProbes: number;
  offscreenDiscards: number;
  offscreenDiscardIndeterminate: number;
}

export interface CapturedPixels {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PreparedHostFactory {
  (canvas: HTMLCanvasElement | OffscreenCanvas, attributes: HostContextAttributes, ownsDevice?: boolean): BrowserHost;
  dispose(): void;
}

interface HostContextAttributes {
  alpha: boolean;
  depth: boolean;
  stencil?: boolean | undefined;
  premultipliedAlpha?: boolean | undefined;
  preserveDrawingBuffer?: boolean | undefined;
  errors?: string[];
}
interface RetainedSurface {
  producer: OffscreenCanvas;
  destination: ImageBitmapRenderingContext;
}


interface Target {
  presentationGroup?: GPUBindGroup;
  color: GPUTexture;
  depth: GPUTexture | null;
  width: number;
  height: number;
  opaque: boolean;
}

interface PreparedVertexLayout {
  points: boolean;
  inputs: number[];
  buffers: GPUVertexBufferLayout[];
  key: string;
}

function prepareVertexLayout(previous: PreparedVertexLayout | undefined, attributes: AttributeSnapshot[],
  points: boolean): PreparedVertexLayout {
  if (previous && previous.points === points && previous.inputs.length === attributes.length * 2) {
    let index = 0;
    for (; index < attributes.length; index++) {
      const attribute = attributes[index]!;
      if (previous.inputs[2 * index] !== attribute.location || previous.inputs[2 * index + 1] !== attribute.shaderType) break;
    }
    if (index === attributes.length) return previous;
  }
  const inputs: number[] = [];
  const buffers = attributes.map((attribute): GPUVertexBufferLayout => {
    inputs.push(attribute.location, attribute.shaderType);
    const components = componentCount(attribute.shaderType);
    const format = (components === 1 ? "float32" : `float32x${components}`) as GPUVertexFormat;
    return { arrayStride: components * 4, stepMode: points ? "instance" : "vertex",
      attributes: [{ shaderLocation: attribute.location, offset: 0, format }] };
  });
  return { points, inputs, buffers, key: inputs.join(',') };
}

interface GeometryBuffers {
  vertexBuffers: GPUBuffer[];
  indexBuffer: GPUBuffer | null;
}

type VertexStream = Pick<AttributeSnapshot,
  'bufferVersion' | 'shaderType' | 'size' | 'type' | 'normalized' | 'stride' | 'offset'>;

interface ResidentGeometry extends GeometryBuffers {
  indexVersion: string;
  indexType: number;
  vertexCount: number;
  streams: VertexStream[];
}

function sameVertexStreams(streams: VertexStream[], attributes: AttributeSnapshot[]): boolean {
  if (streams.length !== attributes.length) return false;
  for (let i = 0; i < streams.length; i++) {
    const a = streams[i]!, b = attributes[i]!;
    if (a.bufferVersion !== b.bufferVersion || a.shaderType !== b.shaderType || a.size !== b.size ||
        a.type !== b.type || a.normalized !== b.normalized || a.stride !== b.stride || a.offset !== b.offset) return false;
  }
  return true;
}

interface PassBindings {
  pipeline: GPURenderPipeline | null;
  textureGroup: GPUBindGroup | null;
  driverGroup: GPUBindGroup | null;
  vertexBuffers: GPUBuffer[];
  indexBuffer: GPUBuffer | null;
  indexFormat: GPUIndexFormat | null;
  viewport: RasterState['viewport'] | null;
  depthRange: RasterState['depthRange'] | null;
  blendColor: readonly number[] | null;
  stencilReference: number;
  scissorX: number;
  scissorY: number;
  scissorWidth: number;
  scissorHeight: number;
}

const TEXTURE_USAGE = 0x10 | 0x04 | 0x01 | 0x02;

function textureAllocationBytes(texture: GPUTexture): number {
  let texelsPerLayer = 0;
  for (let level = 0; level < texture.mipLevelCount; level++) {
    texelsPerLayer += Math.max(1, texture.width >> level) * Math.max(1, texture.height >> level);
  }
  return texelsPerLayer * texture.depthOrArrayLayers * (texture.format === 'rgba32float' ? 16 : 4);
}

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

const stencilOperations: Record<number, GPUStencilOperation> = {
  [GL.KEEP]: 'keep', [GL.ZERO]: 'zero', [GL.REPLACE]: 'replace', [GL.INVERT]: 'invert',
  [GL.INCR]: 'increment-clamp', [GL.DECR]: 'decrement-clamp',
  [GL.INCR_WRAP]: 'increment-wrap', [GL.DECR_WRAP]: 'decrement-wrap',
};

function stencilFace(face: StencilFaceState): GPUStencilFaceState {
  return { compare: compareFunction(face.func), failOp: stencilOperations[face.fail]!,
    depthFailOp: stencilOperations[face.depthFail]!, passOp: stencilOperations[face.pass]! };
}

function targetHasStencil(target: Target): boolean {
  return target.depth?.format === 'stencil8' || target.depth?.format === 'depth24plus-stencil8';
}

const clearStencilFace: GPUStencilFaceState = { compare: 'always', passOp: 'replace' };

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

function blendComponent(equation: number, source: number, destination: number): GPUBlendComponent {
  if (equation === BLEND_MINMAX.MIN_EXT || equation === BLEND_MINMAX.MAX_EXT) {
    return { operation: equation === BLEND_MINMAX.MIN_EXT ? 'min' : 'max', srcFactor: 'one', dstFactor: 'one' };
  }
  const operation = equation === GL.FUNC_SUBTRACT ? 'subtract'
    : equation === GL.FUNC_REVERSE_SUBTRACT ? 'reverse-subtract' : 'add';
  return { operation, srcFactor: blendFactor(source), dstFactor: blendFactor(destination) };
}

function colorWriteMask(mask: readonly boolean[]): GPUColorWriteFlags {
  return mask.reduce((bits, enabled, index) => bits | (enabled ? 1 << index : 0), 0);
}

// Device listeners outlive individual canvases when a prepared factory shares its device.
function errorListener(errors: string[]) {
  return (event: Event) => { errors.push((event as GPUUncapturedErrorEvent).error.message); };
}

const abandonedHosts = new FinalizationRegistry<{
  device: GPUDevice; listener: EventListener; textures: Set<GPUTexture>; buffers: Set<GPUBuffer>; ownsDevice: boolean;
}>(resources => {
  resources.device.removeEventListener('uncapturederror', resources.listener);
  void resources.device.queue.onSubmittedWorkDone().catch(() => {}).then(() => {
    for (const buffer of resources.buffers) buffer.destroy();
    for (const texture of resources.textures) texture.destroy();
    if (resources.ownsDevice) resources.device.destroy();
  });
});

export class BrowserHost implements SemanticHost {
  readonly stats: HostStats = {
    draws: 0, passes: 0, submits: 0, copies: 0, uploadedBytes: 0,
    pipelines: 0, bindGroups: 0, allocatedBufferBytes: 0, allocatedTextureBytes: 0,
    peakAllocatedBufferBytes: 0, peakAllocatedTextureBytes: 0,
    offscreenDiscardProbes: 0, offscreenDiscards: 0, offscreenDiscardIndeterminate: 0,
  };
  readonly environment: Record<string, unknown>;
  readonly limits: GPUSupportedLimits;
  readonly surface: DrawingSurface;
  private readonly completion: QueueCompletion;
  private encoder: GPUCommandEncoder | null = null;
  private pass: GPURenderPassEncoder | null = null;
  private passTarget: Target | null = null;
  private readonly passBindings: PassBindings = {
    pipeline: null, textureGroup: null, driverGroup: null, vertexBuffers: [],
    indexBuffer: null, indexFormat: null, viewport: null, depthRange: null,
    blendColor: null, stencilReference: -1,
    scissorX: -1, scissorY: -1, scissorWidth: 0, scissorHeight: 0,
  };
  private defaultTarget: Target | null = null;
  private defaultDirty = false;
  private readonly attachmentViews = new WeakMap<GPUTexture, GPUTextureView>();
  private textureCache = new WeakMap<TextureStorage, GPUTexture>();
  private sampledImageCache = new Map<TextureStorage, {
    texture: GPUTexture; images: readonly TextureStorage[]; versions: readonly (TextureVersion | undefined)[];
  }>();
  private depthCache = new Map<string, GPUTexture>();
  private targetCache = new WeakMap<GPUTexture, Target>();
  private initialized = new WeakSet<GPUTexture>();
  private readonly transientBuffers = new Set<GPUBuffer>();
  private previousIndexVersion: string | undefined;
  private residentGeometry: ResidentGeometry | null = null;
  private readonly geometryCache = new GeometryCache(geometryCacheBytes, geometryCacheEntries,
    buffer => { this.transientBuffers.delete(buffer); },
    // Evicted buffers can still be referenced by the active encoder.
    buffer => { this.transientBuffers.add(buffer); });
  private readonly uniforms: UniformArena;
  private readonly emptyTextureGroups = new WeakMap<GPUBindGroupLayout, GPUBindGroup>();
  private programs = new WeakMap<LinkedProgram, Map<string, {
    layout: GPUPipelineLayout;
    sampledElements: { type: number; samplerBinding: number; textureBinding: number }[];
    groups: [GPUBindGroupLayout, GPUBindGroupLayout, GPUBindGroupLayout];
    vertex: GPUShaderModule;
    fragment: GPUShaderModule;
    lastVertexLayout?: PreparedVertexLayout;
    pipelines: Map<string, GPURenderPipeline>;
  }>>();
  private samplers = new Map<string, GPUSampler>();
  private clearPipelines = new Map<string, GPURenderPipeline>();
  private textures = new Set<GPUTexture>();
  private buffers = new Set<GPUBuffer>();
  private retiredTextures = new Set<GPUTexture>();
  private driverGroups = new WeakMap<GPUBindGroupLayout, Map<string, GPUBindGroup>>();
  private mipPipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private textureCopyPipeline: GPURenderPipeline | null = null;
  private presentationConfigured = false;
  private lastPresentedTexture: GPUTexture | null = null;
  private lastPresentationTime: DocumentTimeline['currentTime'] = null;
  private replayingBeforeResize = false;
  private beforeCanvasResize?: () => void;
  private readonly sizeObserver: MutationObserver | null;
  private readonly offscreenDiscard: OffscreenDiscard | null;
  private presentationPipeline: GPURenderPipeline | null = null;
  private blackTexture: GPUTexture | null = null;
  private blackCubeTexture: GPUTexture | null = null;
  private disposed = false;
  private canvasReadback: CanvasReadback | null = null;
  private readonly handleError: (event: Event) => void;

  private constructor(
    readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    readonly device: GPUDevice,
    readonly context: GPUCanvasContext,
    readonly format: GPUTextureFormat,
    adapter: GPUAdapter,
    readonly alpha: boolean,
    readonly hasDepth: boolean,
    readonly hasStencil: boolean,
    private readonly premultipliedAlpha: boolean,
    private readonly retained: RetainedSurface | null,
    private readonly ownsDevice = true,
    readonly errors: string[] = [],
  ) {
    this.handleError = errorListener(errors);
    this.completion = new QueueCompletion(device.queue);
    this.uniforms = new UniformArena(device,
      size => this.allocateBuffer(size, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      () => { this.stats.bindGroups++; });
    this.offscreenDiscard = !retained && 'transferToImageBitmap' in canvas
      ? OffscreenDiscard.create(device, format, alpha ? 'premultiplied' : 'opaque', this.stats, this.completion) : null;
    this.limits = device.limits;
    const dimensionLimit = this.limits.maxTextureDimension2D;
    this.surface = {
      get width() { return Math.max(1, Math.min(canvas.width, dimensionLimit)); },
      get height() { return Math.max(1, Math.min(canvas.height, dimensionLimit)); },
    };
    this.environment = {
      userAgent: navigator.userAgent,
      adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
        device: adapter.info.device, description: adapter.info.description,
        isFallbackAdapter: adapter.info.isFallbackAdapter },
      features: [...device.features],
      adapterFeatures: [...adapter.features],
      limits: Object.fromEntries(Object.keys(Object.getPrototypeOf(device.limits)).map(
        key => [key, (device.limits as unknown as Record<string, unknown>)[key]],
      )),
      canvasFormat: format,
      coordinateConvention: "GL row zero in offscreen surfaces, flipped on presentation",
    };
    this.sizeObserver = null;
    if ('ownerDocument' in canvas) {
      this.sizeObserver = new MutationObserver(records => this.observeCanvasSize(canvas, records));
      this.sizeObserver.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'], attributeOldValue: true });
      this.surface.bindResizeBarrier = replay => {
        this.beforeCanvasResize = replay;
        return () => this.observeCanvasSize(canvas, this.sizeObserver!.takeRecords());
      };
    }
    this.configurePresentation();
    device.addEventListener("uncapturederror", this.handleError);
    abandonedHosts.register(this, { device, listener: this.handleError, textures: this.textures,
      buffers: this.buffers, ownsDevice }, this);
  }

  static async create(canvas: HTMLCanvasElement | OffscreenCanvas, attributes: HostContextAttributes): Promise<BrowserHost> {
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
    const requiredFeatures: GPUFeatureName[] = [];
    if (adapter.features.has('float32-filterable')) requiredFeatures.push('float32-filterable');
    if (adapter.features.has('depth-clip-control')) requiredFeatures.push('depth-clip-control');
    const device = await adapter.requestDevice({ requiredFeatures });
    const format = navigator.gpu.getPreferredCanvasFormat();
    const surfaces = new WeakMap<HTMLCanvasElement | OffscreenCanvas, { context: GPUCanvasContext; retained: RetainedSurface | null }>();
    const factory: PreparedHostFactory = (canvas, attributes, ownsDevice = false) => {
      let surface = surfaces.get(canvas);
      if (!surface) {
        let retained: RetainedSurface | null = null;
        if (attributes.preserveDrawingBuffer) {
          const destination = canvas.getContext('bitmaprenderer', { alpha: attributes.alpha });
          if (!destination) throw new DOMException("Canvas is already bound to another context", "InvalidStateError");
          retained = { producer: new OffscreenCanvas(1, 1), destination };
        }
        const context = (retained?.producer ?? canvas).getContext("webgpu");
        if (!context) throw new DOMException("Canvas is already bound to another context", "InvalidStateError");
        surface = { context, retained };
        surfaces.set(canvas, surface);
      }
      const presentationFormat = attributes.alpha && attributes.premultipliedAlpha === false ? "rgba16float" : format;
      return new BrowserHost(canvas, device, surface.context, presentationFormat, adapter, attributes.alpha, attributes.depth,
        attributes.stencil ?? false, attributes.premultipliedAlpha ?? true, surface.retained, ownsDevice, attributes.errors);
    };
    factory.dispose = () => device.destroy();
    return factory;
  }

  private getEncoder(): GPUCommandEncoder {
    this.encoder ??= this.device.createCommandEncoder({ label: "Refral ordered GL work" });
    return this.encoder;
  }

  private createTexture(width: number, height: number, format: GPUTextureFormat, layers = 1, mipLevelCount = 1): GPUTexture {
    const texture = this.device.createTexture({
      size: { width: Math.max(1, width), height: Math.max(1, height), depthOrArrayLayers: layers }, format, mipLevelCount,
      viewFormats: format === 'rgba8unorm-srgb' ? ['rgba8unorm'] : [],
      usage: format === "rgba8unorm" || format === 'rgba8unorm-srgb' || format === "rgba32float" ? TEXTURE_USAGE : GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.textures.add(texture);
    this.stats.allocatedTextureBytes += textureAllocationBytes(texture);
    this.stats.peakAllocatedTextureBytes = Math.max(this.stats.peakAllocatedTextureBytes,
      this.stats.allocatedTextureBytes);
    return texture;
  }

  private allocateBuffer(size: number, usage: GPUBufferUsageFlags): GPUBuffer {
    const buffer = this.device.createBuffer({ size, usage });
    this.buffers.add(buffer);
    this.stats.allocatedBufferBytes += buffer.size;
    this.stats.peakAllocatedBufferBytes = Math.max(this.stats.peakAllocatedBufferBytes,
      this.stats.allocatedBufferBytes);
    return buffer;
  }

  private createBuffer(data: Uint8Array, usage: GPUBufferUsageFlags, _transient = false): GPUBuffer {
    const buffer = this.allocateBuffer(Math.max(4, aligned(data.byteLength, 4)), usage | GPUBufferUsage.COPY_DST);
    this.writeBuffer(buffer, data);
    this.transientBuffers.add(buffer);
    return buffer;
  }

  private writeBuffer(buffer: GPUBuffer, data: Uint8Array): void {
    if (!data.byteLength) return;
    if (data.byteLength % 4 === 0) {
      // WebGPU copies the input bytes before writeBuffer returns.
      this.device.queue.writeBuffer(buffer, 0, data);
    } else {
      const bytes = new Uint8Array(aligned(data.byteLength, 4));
      bytes.set(data);
      this.device.queue.writeBuffer(buffer, 0, bytes);
    }
    this.completion.markIssued();
    this.stats.uploadedBytes += data.byteLength;
  }

  private uploadTexture(texture: GPUTexture, data: Uint8Array, width: number, height: number,
    x = 0, y = 0, layer = 0): void {
    if (!width || !height) return;
    this.endPass();
    const rowBytes = width * (texture.format === "rgba32float" ? 16 : 4);
    const bytesPerRow = aligned(rowBytes, 256);
    const staging = new Uint8Array(bytesPerRow * height);
    for (let row = 0; row < height; row++) {
      staging.set(data.subarray(row * rowBytes, (row + 1) * rowBytes), row * bytesPerRow);
    }
    const buffer = this.createBuffer(staging, GPUBufferUsage.COPY_SRC, true);
    this.getEncoder().copyBufferToTexture({ buffer, bytesPerRow },
      { texture, origin: { x, y, z: layer } }, { width, height });
    this.stats.copies++;
    this.initialized.add(texture);
  }

  private materializeTexture(storage: TextureStorage): GPUTexture {
    let texture = this.textureCache.get(storage);
    if (texture) return texture;
    texture = this.createTexture(storage.width, storage.height, storage.texelFormat ?? "rgba8unorm");
    this.textureCache.set(storage, texture);
    if (storage.parent) {
      const parent = this.materializeTexture(storage.parent);
      this.endPass();
      this.getEncoder().copyTextureToTexture({ texture: parent }, { texture },
        { width: storage.width, height: storage.height });
      this.initialized.add(texture);
      this.stats.copies++;
    }
    if (storage.mipSource) this.downsampleTexture(this.materializeTexture(storage.mipSource), texture);
    if (storage.data) this.uploadTexture(texture, storage.data, storage.width, storage.height);
    if (storage.update) {
      const update = storage.update;
      this.uploadTexture(texture, update.data, update.width, update.height, update.x, update.y);
    }
    if (storage.copy && storage.width && storage.height) {
      this.copyFramebufferTexture(storage.copy, texture, !!storage.parent);
    }
    return texture;
  }

  private copyFramebufferTexture(copy: TextureCopy, destination: GPUTexture, preserve: boolean): void {
    const sourceX = Math.max(0, copy.sourceX);
    const sourceY = Math.max(0, copy.sourceY);
    const width = Math.min(copy.source.width, copy.sourceX + copy.width) - sourceX;
    const height = Math.min(copy.source.height, copy.sourceY + copy.height) - sourceY;
    const intersects = width > 0 && height > 0;
    const opaque = copy.format === GL.RGB || copy.format === GL.LUMINANCE;
    if (preserve && !intersects) return;
    const source = intersects ? this.resolveTarget(copy.source) : null;
    if (source && !this.initialized.has(source.color)) this.beginPass({ ...source, depth: null });
    this.endPass();
    const pass = this.getEncoder().beginRenderPass({ colorAttachments: [{
      view: destination.createView(), loadOp: preserve ? 'load' : 'clear', storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: opaque ? 1 : 0 },
    }] });
    if (source) {
      const pipeline = this.framebufferCopyPipeline();
      const x = copy.x + sourceX - copy.sourceX;
      const y = copy.y + sourceY - copy.sourceY;
      const parameters = new Int32Array([sourceX - x, sourceY - y, copy.format, copy.type]);
      const buffer = this.createBuffer(new Uint8Array(parameters.buffer), GPUBufferUsage.UNIFORM, true);
      const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: source.color.createView() }, { binding: 1, resource: { buffer } },
      ] });
      pass.setPipeline(pipeline);
      pass.setScissorRect(x, y, width, height);
      pass.setBindGroup(0, group);
      pass.draw(3);
      this.stats.bindGroups++;
      this.stats.copies++;
    }
    pass.end();
    this.stats.passes++;
    this.initialized.add(destination);
  }

  private framebufferCopyPipeline(): GPURenderPipeline {
    if (this.textureCopyPipeline) return this.textureCopyPipeline;
    const module = this.device.createShaderModule({ code: `
      @group(0) @binding(0) var source: texture_2d<f32>;
      @group(0) @binding(1) var<uniform> parameters: vec4i;
      @vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
        let points = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
        return vec4f(points[index], 0, 1);
      }
      @fragment fn fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let pixel = textureLoad(source, vec2i(position.xy) + parameters.xy, 0);
        var color = pixel;
        switch parameters.z {
          case ${GL.RGB}: { color = vec4f(pixel.rgb, 1); }
          case ${GL.ALPHA}: { color = vec4f(0, 0, 0, pixel.a); }
          case ${GL.LUMINANCE}: { color = vec4f(pixel.rrr, 1); }
          case ${GL.LUMINANCE_ALPHA}: { color = vec4f(pixel.rrr, pixel.a); }
          default: {}
        }
        switch parameters.w {
          case ${GL.UNSIGNED_SHORT_5_6_5}: { let scale = vec4f(31, 63, 31, 1); return round(color * scale) / scale; }
          case ${GL.UNSIGNED_SHORT_4_4_4_4}: { return round(color * 15) / 15; }
          case ${GL.UNSIGNED_SHORT_5_5_5_1}: { let scale = vec4f(31, 31, 31, 1); return round(color * scale) / scale; }
          default: { return color; }
        }
      }` });
    this.textureCopyPipeline = this.device.createRenderPipeline({ layout: 'auto',
      vertex: { module, entryPoint: 'vertex' }, fragment: { module, entryPoint: 'fragment', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    this.stats.pipelines++;
    return this.textureCopyPipeline;
  }

  private downsampleTexture(source: GPUTexture, destination: GPUTexture): void {
    this.endPass();
    let pipeline = this.mipPipelines.get(destination.format);
    if (!pipeline) {
      const module = this.device.createShaderModule({ code: `
        @group(0) @binding(0) var source : texture_2d<f32>;
        @vertex fn vertex(@builtin(vertex_index) index : u32) -> @builtin(position) vec4f {
          let points = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
          return vec4f(points[index], 0, 1);
        }
        @fragment fn fragment(@builtin(position) position : vec4f) -> @location(0) vec4f {
          let origin = vec2i(position.xy) * 2;
          let limit = vec2i(textureDimensions(source)) - vec2i(1);
          return (textureLoad(source, origin, 0)
            + textureLoad(source, min(origin + vec2i(1,0), limit), 0)
            + textureLoad(source, min(origin + vec2i(0,1), limit), 0)
            + textureLoad(source, min(origin + vec2i(1,1), limit), 0)) * 0.25;
        }` });
      const sourceLayout = this.device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      ] });
      pipeline = this.device.createRenderPipeline({ layout: this.device.createPipelineLayout({ bindGroupLayouts: [sourceLayout] }),
        vertex: { module, entryPoint: 'vertex' },
        fragment: { module, entryPoint: 'fragment', targets: [{ format: destination.format }] },
      });
      this.mipPipelines.set(destination.format, pipeline);
      this.stats.pipelines++;
    }
    const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: source.createView() }],
    });
    const pass = this.getEncoder().beginRenderPass({ colorAttachments: [{
      view: destination.createView(), loadOp: 'clear', storeOp: 'store',
    }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    this.initialized.add(destination);
    this.stats.bindGroups++;
    this.stats.passes++;
  }

  private materializeSampledImages(images: readonly TextureStorage[], layers: 1 | 6): GPUTexture {
    const first = images[0];
    const levels = images.length / layers;
    if (!first?.width || !first.height || !Number.isInteger(levels)
      || (layers === 6 && first.width !== first.height)) {
      throw new Error('Invalid sampled texture image chain.');
    }
    const cached = this.sampledImageCache.get(first);
    if (cached && images.length === cached.images.length
      && images.every((image, index) => image === cached.images[index]
        && image.reference === cached.versions[index])) return cached.texture;

    const sources = images.map((image, index) => {
      const level = Math.floor(index / layers);
      if (image.width !== Math.max(1, first.width >> level)
        || image.height !== Math.max(1, first.height >> level)) {
        throw new Error('Invalid sampled texture image dimensions.');
      }
      return this.materializeTexture(image);
    });
    this.endPass();
    const texture = this.createTexture(first.width, first.height, first.texelFormat ?? 'rgba8unorm', layers, levels);
    for (const [index, source] of sources.entries()) {
      const mipLevel = Math.floor(index / layers);
      this.getEncoder().copyTextureToTexture({ texture: source },
        { texture, mipLevel, origin: { x: 0, y: 0, z: index % layers } },
        { width: source.width, height: source.height, depthOrArrayLayers: 1 });
      this.stats.copies++;
    }
    this.initialized.add(texture);
    if (cached) this.retiredTextures.add(cached.texture);
    this.sampledImageCache.set(first, { texture, images: [...images], versions: images.map(image => image.reference) });
    return texture;
  }

  private observeCanvasSize(canvas: HTMLCanvasElement, records: MutationRecord[]): void {
    if (!records.length || this.disposed) return;
    if (this.beforeCanvasResize) {
      // The assignment can replace the public texture in this frame. Earlier queued draws
      // still use the canonical attachments that were current before the assignment.
      this.replayingBeforeResize = this.lastPresentationTime === canvas.ownerDocument.timeline.currentTime;
      try { this.beforeCanvasResize(); } finally { this.replayingBeforeResize = false; }
    }
    if (!this.defaultTarget) return;
    let parser: HTMLCanvasElement | undefined;
    const resized = records.some(({ attributeName, oldValue }) => {
      const dimension = attributeName === 'width' ? 'width' : 'height';
      if (oldValue === canvas.getAttribute(dimension)) return false;
      // Use HTML's own parsing and dimension limits for absent or noncanonical attribute values.
      parser ??= canvas.ownerDocument.createElement('canvas');
      if (oldValue === null) parser.removeAttribute(dimension);
      else parser.setAttribute(dimension, oldValue);
      return parser[dimension] !== canvas[dimension];
    });
    if (resized) {
      this.resetDefaultDrawingBuffer();
      return;
    }
    // Replacing the public bitmap at equal dimensions can change its WebGPU texture in the
    // same frame. Republish the canonical attachments before the next GL use or compositor.
    if (this.retained || (this.lastPresentedTexture && (this.lastPresentationTime === canvas.ownerDocument.timeline.currentTime
        || !canvas.isConnected || !canvas.checkVisibility({ visibilityProperty: true })))) {
      this.beginPass(this.defaultTarget);
      this.defaultDirty = true;
      this.submitEncoded();
    }
  }

  private resolveTarget(snapshot: TargetSnapshot): Target {
    if (snapshot.isDefault) {
      if (this.sizeObserver && 'ownerDocument' in this.canvas) {
        this.observeCanvasSize(this.canvas, this.sizeObserver.takeRecords());
      }
      if (this.offscreenDiscard && this.defaultTarget?.width === snapshot.width &&
          this.defaultTarget.height === snapshot.height && this.offscreenDiscard.discarded()) {
        this.resetDefaultDrawingBuffer();
      }
      if (!this.replayingBeforeResize && this.lastPresentedTexture && this.defaultTarget && this.canvas.width === this.surface.width &&
          this.canvas.height === this.surface.height && 'isConnected' in this.canvas &&
          this.canvas.isConnected && this.canvas.checkVisibility({ visibilityProperty: true })) {
        if (this.context.getCurrentTexture() !== this.lastPresentedTexture) {
          this.resetDefaultDrawingBuffer();
        }
      }
      if (!this.defaultTarget || this.defaultTarget.width !== snapshot.width ||
          this.defaultTarget.height !== snapshot.height) {
        this.endPass();
        this.offscreenDiscard?.forget();
        if (this.defaultTarget) {
          this.retiredTextures.add(this.defaultTarget.color);
          if (this.defaultTarget.depth) this.retiredTextures.add(this.defaultTarget.depth);
        }
        const depthFormat = this.hasStencil ? (this.hasDepth ? "depth24plus-stencil8" : "stencil8") : "depth24plus";
        this.defaultTarget = {
          color: this.createTexture(snapshot.width, snapshot.height, "rgba8unorm"),
          depth: this.hasDepth || this.hasStencil ? this.createTexture(snapshot.width, snapshot.height, depthFormat) : null,
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
        const format = snapshot.depthFormat === GL.DEPTH_STENCIL ? "depth24plus-stencil8"
          : snapshot.depthFormat === GL.STENCIL_INDEX8 ? "stencil8" : "depth24plus";
        depth = this.createTexture(snapshot.width, snapshot.height, format);
        this.depthCache.set(key, depth);
      }
    }
    let target = this.targetCache.get(color);
    if (!target || target.depth !== depth) {
      target = { color, depth, width: snapshot.width, height: snapshot.height,
        opaque: snapshot.colorOpaque ?? !!snapshot.color!.opaque };
      this.targetCache.set(color, target);
    }
    return target;
  }

  private attachmentView(texture: GPUTexture): GPUTextureView {
    let view = this.attachmentViews.get(texture);
    if (!view) {
      view = texture.createView();
      this.attachmentViews.set(texture, view);
    }
    return view;
  }

  private beginPass(target: Target): GPURenderPassEncoder {
    if (this.pass && this.passTarget === target) return this.pass;
    this.endPass();
    const descriptor: GPURenderPassDescriptor = {
      colorAttachments: [{ view: this.attachmentView(target.color),
        loadOp: this.initialized.has(target.color) ? "load" : "clear",
        storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: target.opaque ? 1 : 0 } }],
    };
    if (target.depth) {
      const format = target.depth.format;
      const loadOp = this.initialized.has(target.depth) ? "load" : "clear";
      descriptor.depthStencilAttachment = {
        view: this.attachmentView(target.depth),
        ...(format !== "stencil8" ? { depthLoadOp: loadOp, depthStoreOp: "store", depthClearValue: 1 } as const : {}),
        ...(format !== "depth24plus" ? { stencilLoadOp: loadOp, stencilStoreOp: "store", stencilClearValue: 0 } as const : {}),
      };
      this.initialized.add(target.depth);
    }
    this.initialized.add(target.color);
    this.pass = this.getEncoder().beginRenderPass(descriptor);
    this.passTarget = target;
    this.stats.passes++;
    return this.pass;
  }

  private endPass(): void {
    if (!this.pass) return;
    this.pass.end();
    this.pass = null;
    this.passTarget = null;
    const bindings = this.passBindings;
    bindings.pipeline = bindings.textureGroup = bindings.driverGroup = null;
    bindings.vertexBuffers.length = 0;
    bindings.indexBuffer = bindings.indexFormat = null;
    bindings.viewport = bindings.depthRange = bindings.blendColor = null;
    bindings.stencilReference = bindings.scissorX = -1;
  }

  replaceStorage(previous: TextureStorage | null, next: TextureStorage): void {
    if (next.mipSource) {
      this.materializeTexture(next);
      delete next.mipSource;
    }
    if (next.parent || next.copy) {
      this.materializeTexture(next);
      // The new GPU image now owns the content dependency through the encoded copy.
      // Drop the CPU history so repeated sub-image uploads have bounded metadata.
      delete next.parent;
      delete next.update;
      delete next.copy;
    }
    if (previous) this.retireStorage(previous);
  }

  retireStorage(storage: TextureStorage): void {
    for (const [first, sampled] of this.sampledImageCache) {
      if (sampled.images.includes(storage)) {
        this.sampledImageCache.delete(first);
        this.retiredTextures.add(sampled.texture);
      }
    }
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

  private programResources(program: LinkedProgram, textures: DrawOperation['textures']) {
    const unfilterableFloatSlots = this.device.features.has('float32-filterable') ? [] : textures.map(binding =>
      (binding.storage ?? binding.mipImages?.[0] ?? binding.cubeFaces?.[0])?.texelFormat === 'rgba32float');
    const key = unfilterableFloatSlots.map(value => value ? '1' : '0').join('');
    let variants = this.programs.get(program);
    if (!variants) { variants = new Map(); this.programs.set(program, variants); }
    let resources = variants.get(key);
    if (resources) return resources;
    const uniformLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform", hasDynamicOffset: true } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform", hasDynamicOffset: true } },
    ] });
    const textureEntries: GPUBindGroupLayoutEntry[] = [];
    const sampledElements = program.samplers.flatMap(sampler => Array.from({ length: sampler.size }, (_, i) => ({
      type: sampler.type, samplerBinding: sampler.samplerBinding + i * 2, textureBinding: sampler.textureBinding + i * 2,
    })));
    for (const [index, sampler] of sampledElements.entries()) {
      textureEntries.push({ binding: sampler.samplerBinding,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: unfilterableFloatSlots[index] ? "non-filtering" : "filtering" } });
      textureEntries.push({ binding: sampler.textureBinding,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        texture: { sampleType: unfilterableFloatSlots[index] ? "unfilterable-float" : "float", viewDimension: sampler.type === GL.SAMPLER_CUBE ? 'cube' : '2d' } });
    }
    const textureLayout = this.device.createBindGroupLayout({ entries: textureEntries });
    const driverLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" } },
    ] });
    const groups: [GPUBindGroupLayout, GPUBindGroupLayout, GPUBindGroupLayout] =
      [uniformLayout, textureLayout, driverLayout];
    resources = { groups, sampledElements, layout: this.device.createPipelineLayout({ bindGroupLayouts: groups }),
      vertex: this.device.createShaderModule({ code: program.vertexWGSL }),
      fragment: this.device.createShaderModule({ code: program.fragmentWGSL }),
      pipelines: new Map<string, GPURenderPipeline>() };
    variants.set(key, resources);
    return resources;
  }

  private geometryBuffer(key: string | null, usage: GPUBufferUsageFlags,
    prepare: () => Uint8Array): GPUBuffer {
    const cached = key === null ? undefined : this.geometryCache.get(key);
    if (cached) return cached;
    const buffer = this.createBuffer(prepare(), usage);
    if (key !== null) this.geometryCache.use(key, buffer);
    return buffer;
  }

  private vertexBuffer(attribute: AttributeSnapshot, vertices: number,
    gather: DrawOperation['indices'] = null): GPUBuffer {
    const components = componentCount(attribute.shaderType);
    const { type, normalized, size, offset } = attribute;
    const key = attribute.bufferVersion && !gather
      ? `v/${attribute.bufferVersion}/${type}:${normalized}:${size}:${attribute.stride}:${offset}:${components}:${vertices}`
      : null;
    return this.geometryBuffer(key, GPUBufferUsage.VERTEX, () => {
      const data = attribute.data;
      const width = components * Float32Array.BYTES_PER_ELEMENT;
      const end = offset + vertices * width;
      return data && !gather && littleEndian && type === GL.FLOAT && !normalized && size === components
        && (!attribute.stride || attribute.stride === width) && vertices > 0
        && offset >= 0 && offset % Float32Array.BYTES_PER_ELEMENT === 0 && end <= data.byteLength
        ? data.subarray(offset, end)
        : this.packVertexData(attribute, vertices, components, gather);
    });
  }

  private drawGeometry(operation: DrawOperation, points: boolean, wideIndices: boolean,
    needsIndexExpansion: boolean): GeometryBuffers {
    const { indices, attributes, vertexCount } = operation;
    const indexVersion = points || wideIndices || needsIndexExpansion ? undefined : indices?.bufferVersion;
    const previous = this.residentGeometry;
    if (previous && previous.indexVersion === indexVersion && previous.indexType === indices!.type &&
        previous.vertexCount === vertexCount && sameVertexStreams(previous.streams, attributes)) return previous;

    // Only adjacent draws can reuse a set. Drop it before a miss can evict any of its buffers.
    this.residentGeometry = null;
    const repeatedIndices = !!indexVersion && indexVersion === this.previousIndexVersion;
    this.previousIndexVersion = indexVersion;
    this.geometryCache.beginDraw();
    const vertexBuffers = operation.attributes.map(attribute =>
      this.vertexBuffer(attribute, points && indices ? operation.count : operation.vertexCount, points ? indices : null));
    let indexBuffer: GPUBuffer | null = null;
    if (indices && wideIndices) {
      const view = new DataView(indices.data.buffer, indices.data.byteOffset, indices.data.byteLength);
      const widened = new Uint32Array(operation.count);
      for (let index = 0; index < widened.length; index++) {
        widened[index] = view.getUint16(indices.offset + index * 2, true);
      }
      indexBuffer = this.createBuffer(new Uint8Array(widened.buffer), GPUBufferUsage.INDEX, true);
    } else if (indices && !points && !needsIndexExpansion) {
      const key = indices.bufferVersion ? `i/${indices.bufferVersion}/${indices.type}` : null;
      indexBuffer = this.geometryBuffer(key, GPUBufferUsage.INDEX, () =>
        indices.type === GL.UNSIGNED_BYTE ? new Uint8Array(new Uint16Array(indices.data).buffer) : indices.data);
    }
    const resident = this.geometryCache.endDraw();
    // Wait for repeated geometry before retaining metadata. The streams describe packed
    // buffers by their immutable versions, without keeping the CPU upload bytes alive.
    if (repeatedIndices && resident && attributes.every(a => !!a.bufferVersion)) {
      this.residentGeometry = { vertexBuffers, indexBuffer, indexVersion, indexType: indices!.type, vertexCount,
        streams: attributes.map(({ bufferVersion, shaderType, size, type, normalized, stride, offset }) =>
          ({ bufferVersion, shaderType, size, type, normalized, stride, offset })) };
      return this.residentGeometry;
    }
    return { vertexBuffers, indexBuffer };
  }

  private packVertexData(attribute: AttributeSnapshot, vertices: number, components: number,
    gather: DrawOperation['indices']): Uint8Array {
    const { type, normalized, size, offset } = attribute;
    const values = new Float32Array(Math.max(1, vertices) * components);
    const view = attribute.data ? new DataView(attribute.data.buffer, attribute.data.byteOffset,
      attribute.data.byteLength) : null;
    const componentBytes = vertexComponentBytes(type);
    const stride = attribute.stride || size * componentBytes;
    const read = (position: number): number => {
      switch (type) {
        case GL.BYTE: {
          const value = view!.getInt8(position);
          return normalized ? Math.max(value / 127, -1) : value;
        }
        case GL.UNSIGNED_BYTE:
          return view!.getUint8(position) / (normalized ? 255 : 1);
        case GL.SHORT: {
          const value = view!.getInt16(position, true);
          return normalized ? Math.max(value / 32767, -1) : value;
        }
        case GL.UNSIGNED_SHORT:
          return view!.getUint16(position, true) / (normalized ? 65535 : 1);
        default:
          return view!.getFloat32(position, true);
      }
    };
    const elements = gather && new DataView(gather.data.buffer, gather.data.byteOffset, gather.data.byteLength);
    const indexBytes = gather ? elementIndexBytes(gather.type) : 0;
    for (let vertex = 0; vertex < Math.max(1, vertices); vertex++) {
      const sourceVertex = gather && elements
        ? readElementIndex(elements, gather.offset + vertex * indexBytes, indexBytes) : vertex;
      for (let component = 0; component < components; component++) {
        values[vertex * components + component] = view
          ? (component < size
            ? read(offset + sourceVertex * stride + component * componentBytes)
            : component === 3 ? 1 : 0)
          : attribute.constant[component] ?? (component === 3 ? 1 : 0);
      }
    }
    return new Uint8Array(values.buffer);
  }

  private sampler(parameters: TextureParameters): GPUSampler {
    const key = JSON.stringify(parameters);
    let sampler = this.samplers.get(key);
    if (!sampler) {
      const wrap = (mode: number): GPUAddressMode => mode === GL.REPEAT ? "repeat" :
        mode === GL.MIRRORED_REPEAT ? "mirror-repeat" : "clamp-to-edge";
      sampler = this.device.createSampler({
        minFilter: parameters.minFilter === GL.LINEAR || parameters.minFilter === GL.LINEAR_MIPMAP_NEAREST
          || parameters.minFilter === GL.LINEAR_MIPMAP_LINEAR ? "linear" : "nearest",
        mipmapFilter: parameters.minFilter === GL.NEAREST_MIPMAP_LINEAR
          || parameters.minFilter === GL.LINEAR_MIPMAP_LINEAR ? "linear" : "nearest",
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

  private getBlackCubeTexture(): GPUTexture {
    if (!this.blackCubeTexture) {
      this.blackCubeTexture = this.createTexture(1, 1, 'rgba8unorm', 6);
      const black = new Uint8Array([0, 0, 0, 255]);
      for (let face = 0; face < 6; face++) this.uploadTexture(this.blackCubeTexture, black, 1, 1, 0, 0, face);
    }
    return this.blackCubeTexture;
  }

  draw(operation: DrawOperation): void {
    const { program, state, indices } = operation;
    const [x, y, width, height] = state.viewport;
    if (!width || !height || x >= operation.target.width || y >= operation.target.height
      || x + width <= 0 || y + height <= 0 || !operation.target.width || !operation.target.height) return;
    const mode = operation.mode;
    const points = mode === GL.POINTS;
    const strip = mode === GL.TRIANGLE_STRIP || mode === GL.LINE_STRIP;
    const needsIndexExpansion = mode === GL.LINE_LOOP || mode === GL.TRIANGLE_FAN;
    const line = mode < GL.TRIANGLES;
    const topology: GPUPrimitiveTopology = points ? "triangle-strip" : line
      ? (strip ? 'line-strip' : 'line-list') : (strip ? 'triangle-strip' : 'triangle-list');
    // WebGL1 index 65535 remains a vertex index. WebGPU uint16 strips reserve it for restart.
    const wideIndices = strip && indices?.type === GL.UNSIGNED_SHORT && operation.vertexCount === 65536;
    const indexFormat = wideIndices || indices?.type === GL.UNSIGNED_INT ? 'uint32' : 'uint16';
    const stripIndexFormat = strip && indices ? indexFormat : undefined;
    const target = this.resolveTarget(operation.target);
    const biasEnabled = state.polygonOffsetFill && !line && !!target.depth && target.depth.format !== "stencil8";
    // WebGPU takes a signed integer constant bias and a finite GLfloat slope.
    const units = state.polygonOffsetUnits || 0;
    const depthBias = biasEnabled ? Math.max(-2147483648, Math.min(2147483647,
      Math.sign(units) * Math.round(Math.abs(units)))) : 0;
    const maxFloat = 3.4028234663852886e38;
    const depthBiasSlopeScale = biasEnabled
      ? Math.max(-maxFloat, Math.min(maxFloat, state.polygonOffsetFactor || 0)) : 0;
    const depthBiasClamp = biasEnabled
      ? Math.max(-maxFloat, Math.min(maxFloat, state.polygonOffsetClamp || 0)) : 0;
    const resources = this.programResources(program, operation.textures);
    const stencil = state.stencilTest && targetHasStencil(target) ? {
      stencilFront: stencilFace(state.stencilFront), stencilBack: stencilFace(state.stencilBack),
      stencilReadMask: state.stencilFront.valueMask & 0xff, stencilWriteMask: state.stencilFront.writeMask & 0xff,
    } : undefined;
    const layout = prepareVertexLayout(resources.lastVertexLayout, operation.attributes, points);
    resources.lastVertexLayout = layout;
    const key = JSON.stringify([mode, topology, stripIndexFormat, layout.key, target.color.format, target.depth?.format, target.opaque, state.depthTest, state.depthMask,
      state.depthFunc, state.depthClamp, depthBias, depthBiasSlopeScale, depthBiasClamp, state.colorMask,
      state.blend, state.blendSrcRGB, state.blendDstRGB,
      state.blendSrcAlpha, state.blendDstAlpha, state.blendEquationRGB, state.blendEquationAlpha,
      state.cull, state.cullFace, state.frontFace, stencil]);
    let pipeline = resources.pipelines.get(key);
    if (!pipeline) {
      const blend: GPUBlendState | undefined = state.blend ? {
        color: blendComponent(state.blendEquationRGB, state.blendSrcRGB, state.blendDstRGB),
        alpha: blendComponent(state.blendEquationAlpha, state.blendSrcAlpha, state.blendDstAlpha),
      } : undefined;
      pipeline = this.device.createRenderPipeline({ layout: resources.layout,
        vertex: { module: resources.vertex, entryPoint: points ? "refralPointMain" : program.vertexEntryPoint, buffers: layout.buffers },
        fragment: { module: resources.fragment, entryPoint: points ? "refralPointMain" : program.fragmentEntryPoint,
          targets: [{ format: target.color.format,
            writeMask: colorWriteMask(state.colorMask) & (target.opaque ? 7 : 15), blend }] },
        primitive: { topology, stripIndexFormat, unclippedDepth: state.depthClamp,
          frontFace: points || state.frontFace !== GL.CCW ? "ccw" : "cw",
          cullMode: line || !state.cull ? "none" : state.cullFace === GL.FRONT ? "front" : "back" },
        depthStencil: target.depth ? { format: target.depth.format,
          ...stencil,
          ...(target.depth.format === "stencil8" ? {} : {
            depthBias, depthBiasSlopeScale, depthBiasClamp,
            depthWriteEnabled: state.depthTest && state.depthMask,
            depthCompare: state.depthTest ? compareFunction(state.depthFunc) : "always",
          }) } : undefined,
      });
      resources.pipelines.set(key, pipeline);
      this.stats.pipelines++;
    }
    const { vertexBuffers, indexBuffer } = this.drawGeometry(operation, points, wideIndices, needsIndexExpansion);
    const uniforms = this.uniforms.stage(resources.groups[0], operation.vertexUniforms, operation.fragmentUniforms);
    const textureEntries: GPUBindGroupEntry[] = [];
    for (let i = 0; i < resources.sampledElements.length; i++) {
      const sampler = resources.sampledElements[i]!;
      const binding = operation.textures[i]!;
      const cube = sampler.type === GL.SAMPLER_CUBE;
      if (cube !== (binding.dimension === 'cube')) throw new Error('Sampler and execution texture dimensions differ.');
      const images = binding.mipImages ?? binding.cubeFaces;
      const texture = images ? this.materializeSampledImages(images, cube ? 6 : 1)
        : cube ? this.getBlackCubeTexture()
          : binding.storage ? this.materializeTexture(binding.storage) : this.getBlackTexture();
      textureEntries.push({ binding: sampler.samplerBinding, resource: this.sampler(binding.parameters) });
      textureEntries.push({ binding: sampler.textureBinding, resource: texture.createView({ dimension: cube ? 'cube' : '2d' }) });
    }
    const textureLayout = resources.groups[1];
    let textureGroup = textureEntries.length ? undefined : this.emptyTextureGroups.get(textureLayout);
    if (!textureGroup) {
      textureGroup = this.device.createBindGroup({ layout: textureLayout, entries: textureEntries });
      this.stats.bindGroups++;
      if (!textureEntries.length) this.emptyTextureGroups.set(textureLayout, textureGroup);
    }
    const driverKey = JSON.stringify([target.width, target.height, state.depthRange, points ? [width, height] : null]);
    let driverCache = this.driverGroups.get(resources.groups[2]);
    if (!driverCache) { driverCache = new Map(); this.driverGroups.set(resources.groups[2], driverCache); }
    let driverGroup = driverCache.get(driverKey);
    if (!driverGroup) {
      const data = new ArrayBuffer(Math.max(32, program.driverUniformBufferSize));
      const floats = new Float32Array(data);
      const uints = new Uint32Array(data);
      floats[0] = state.depthRange[0]; floats[1] = state.depthRange[1];
      uints[2] = ((target.height & 0xffff) << 16) | (target.width & 0xffff);
      uints[3] = 0x817f7f7f;
      uints[4] = 1 << 20;
      if (points) { uints[6] = width; uints[7] = height; }
      const buffer = this.createBuffer(new Uint8Array(data), GPUBufferUsage.UNIFORM);
      driverGroup = this.device.createBindGroup({ layout: resources.groups[2], entries: [
        { binding: 0, resource: { buffer } },
      ] });
      driverCache.set(driverKey, driverGroup);
      this.stats.bindGroups++;
    }
    const pass = this.beginPass(target);
    const bindings = this.passBindings;
    if (bindings.pipeline !== pipeline) {
      pass.setPipeline(pipeline);
      bindings.pipeline = pipeline;
    }
    const viewport = bindings.viewport;
    const depthRange = state.depthRange;
    if (!viewport || viewport[0] !== x || viewport[1] !== y || viewport[2] !== width || viewport[3] !== height ||
        bindings.depthRange![0] !== depthRange[0] || bindings.depthRange![1] !== depthRange[1]) {
      pass.setViewport(x, y, width, height, depthRange[0], depthRange[1]);
      bindings.viewport = state.viewport;
      bindings.depthRange = depthRange;
    }
    if (stencil) {
      const reference = stencilReference(state.stencilFront.reference);
      if (reference !== bindings.stencilReference) {
        pass.setStencilReference(reference);
        bindings.stencilReference = reference;
      }
    }
    this.applyScissor(pass, state, target);
    const usesConstantAlphaRGB = state.blendSrcRGB === GL.CONSTANT_ALPHA || state.blendSrcRGB === GL.ONE_MINUS_CONSTANT_ALPHA
      || state.blendDstRGB === GL.CONSTANT_ALPHA || state.blendDstRGB === GL.ONE_MINUS_CONSTANT_ALPHA;
    const blendAlpha = state.blendColor[3];
    const r = usesConstantAlphaRGB ? blendAlpha : state.blendColor[0];
    const g = usesConstantAlphaRGB ? blendAlpha : state.blendColor[1];
    const b = usesConstantAlphaRGB ? blendAlpha : state.blendColor[2];
    const color = bindings.blendColor;
    if (!color || color[0] !== r || color[1] !== g || color[2] !== b || color[3] !== blendAlpha) {
      bindings.blendColor = usesConstantAlphaRGB ? [r, g, b, blendAlpha] : state.blendColor;
      pass.setBlendConstant(bindings.blendColor);
    }
    pass.setBindGroup(0, uniforms.group, uniforms.offsets);
    if (bindings.textureGroup !== textureGroup) {
      pass.setBindGroup(1, textureGroup);
      bindings.textureGroup = textureGroup;
    }
    if (bindings.driverGroup !== driverGroup) {
      pass.setBindGroup(2, driverGroup);
      bindings.driverGroup = driverGroup;
    }
    for (let index = 0; index < vertexBuffers.length; index++) {
      const buffer = vertexBuffers[index]!;
      if (bindings.vertexBuffers[index] !== buffer) {
        pass.setVertexBuffer(index, buffer);
        bindings.vertexBuffers[index] = buffer;
      }
    }
    if (points) {
      pass.draw(4, operation.count, 0, indices ? 0 : operation.first);
    } else if (needsIndexExpansion) {
      bindings.indexBuffer = null;
      for (const batch of primitiveIndexBatches(mode, operation.first, operation.count, indices)) {
        const buffer = this.createBuffer(new Uint8Array(batch.buffer), GPUBufferUsage.INDEX, true);
        pass.setIndexBuffer(buffer, 'uint32');
        pass.drawIndexed(batch.length);
      }
    } else if (indexBuffer && indices) {
      if (bindings.indexBuffer !== indexBuffer || bindings.indexFormat !== indexFormat) {
        pass.setIndexBuffer(indexBuffer, indexFormat);
        bindings.indexBuffer = indexBuffer;
        bindings.indexFormat = indexFormat;
      }
      const size = elementIndexBytes(indices.type);
      pass.drawIndexed(operation.count, 1, wideIndices ? 0 : indices.offset / size);
    } else pass.draw(operation.count, 1, operation.first);
    this.stats.draws++;
    if (operation.target.isDefault) this.defaultDirty = true;
  }

  private applyScissor(pass: GPURenderPassEncoder, state: RasterState, target: Target): void {
    const [sx, sy, sw, sh] = state.scissor;
    const x = state.scissorTest ? Math.max(0, Math.min(target.width, sx)) : 0;
    const y = state.scissorTest ? Math.max(0, Math.min(target.height, sy)) : 0;
    const width = state.scissorTest ? Math.max(x, Math.min(target.width, sx + sw)) - x : target.width;
    const height = state.scissorTest ? Math.max(y, Math.min(target.height, sy + sh)) - y : target.height;
    const bindings = this.passBindings;
    if (x === bindings.scissorX && y === bindings.scissorY &&
        width === bindings.scissorWidth && height === bindings.scissorHeight) return;
    pass.setScissorRect(x, y, width, height);
    bindings.scissorX = x;
    bindings.scissorY = y;
    bindings.scissorWidth = width;
    bindings.scissorHeight = height;
  }

  clear(snapshot: TargetSnapshot, state: RasterState, mask: number,
    color: readonly number[], depth: number): void {
    const writesColor = !!(mask & GL.COLOR_BUFFER_BIT);
    const colorBits = writesColor ? colorWriteMask(state.colorMask) : 0;
    const depthEnabled = !!(mask & GL.DEPTH_BUFFER_BIT) && state.depthMask;
    const stencilBits = (mask & GL.STENCIL_BUFFER_BIT) ? state.stencilFront.writeMask & 0xff : 0;
    if (snapshot.isDefault && this.offscreenDiscard) {
      const channels = this.alpha ? 15 : 7;
      const writable = colorBits & channels;
      if (!writable && !(this.hasDepth && depthEnabled) && !(this.hasStencil && stencilBits)) return;
      if (!state.scissorTest && writable === channels && (!this.hasDepth || depthEnabled) &&
          (!this.hasStencil || stencilBits === 0xff)) {
        // The clear replaces the whole prior generation before any attachment can be observed.
        this.offscreenDiscard.forget();
      }
    }
    const target = this.resolveTarget(snapshot);
    const writesDepth = depthEnabled && !!target.depth && target.depth.format !== "stencil8";
    const stencilWriteMask = targetHasStencil(target) ? stencilBits : 0;
    if (!writesColor && !writesDepth && !stencilWriteMask) return;
    const writeMask = colorBits & (target.opaque ? 7 : 15);
    const key = `${target.color.format}:${target.depth?.format}:${writesDepth}:${writeMask}:${stencilWriteMask}`;
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
        fragment: { module, entryPoint: "fs", targets: [{ format: target.color.format, writeMask }] },
        primitive: { topology: "triangle-list" },
        depthStencil: target.depth ? { format: target.depth.format,
          ...(stencilWriteMask ? { stencilFront: clearStencilFace, stencilBack: clearStencilFace, stencilWriteMask } : {}),
          ...(target.depth.format === "stencil8" ? {} : { depthWriteEnabled: writesDepth, depthCompare: "always" }),
        } : undefined,
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
    this.passBindings.pipeline = pipeline;
    pass.setViewport(0, 0, target.width, target.height, 0, 1);
    this.passBindings.viewport = null;
    if (stencilWriteMask) {
      this.passBindings.stencilReference = state.stencilClear & 0xff;
      pass.setStencilReference(this.passBindings.stencilReference);
    }
    this.applyScissor(pass, state, target);
    pass.setBindGroup(0, group);
    pass.draw(3);
    this.stats.bindGroups++;
    if (snapshot.isDefault && (writeMask || this.offscreenDiscard && (writesDepth || stencilWriteMask))) this.defaultDirty = true;
  }

  private configurePresentation(): boolean {
    // WebGPU validates the requested canvas size during configure as well as getCurrentTexture.
    if (this.canvas.width !== this.surface.width || this.canvas.height !== this.surface.height) return false;
    if (this.retained) {
      const { producer } = this.retained;
      if (producer.width !== this.canvas.width) producer.width = this.canvas.width;
      if (producer.height !== this.canvas.height) producer.height = this.canvas.height;
    }
    if (!this.presentationConfigured) {
      this.context.configure({ device: this.device, format: this.format, alphaMode: this.alpha ? "premultiplied" : "opaque",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | (this.offscreenDiscard ? GPUTextureUsage.COPY_SRC : 0) });
      this.presentationConfigured = true;
    }
    return true;
  }

  private present(): boolean {
    const target = this.defaultTarget;
    if (!target || !this.defaultDirty || target.width !== this.surface.width || target.height !== this.surface.height
      || !this.configurePresentation()) return false;
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
          let color = textureSample(image, filtering, input.uv);
          return ${this.alpha && !this.premultipliedAlpha ? "vec4f(color.rgb * color.a, color.a)" : "color"};
        }` });
      this.presentationPipeline = this.device.createRenderPipeline({ layout: "auto",
        vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs",
          targets: [{ format: this.format }] }, primitive: { topology: "triangle-list" } });
      this.stats.pipelines++;
    }
    if (!target.presentationGroup) {
      target.presentationGroup = this.device.createBindGroup({ layout: this.presentationPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: this.attachmentView(target.color) },
          { binding: 1, resource: this.sampler({ magFilter: GL.NEAREST, minFilter: GL.NEAREST,
            wrapS: GL.CLAMP_TO_EDGE, wrapT: GL.CLAMP_TO_EDGE }) }] });
      this.stats.bindGroups++;
    }
    const presentationTexture = this.context.getCurrentTexture();
    if (this.offscreenDiscard) this.offscreenDiscard.published(presentationTexture);
    else if (!this.retained && 'ownerDocument' in this.canvas) {
      this.lastPresentedTexture = presentationTexture;
      this.lastPresentationTime = this.canvas.ownerDocument.timeline.currentTime;
    }
    const pass = this.getEncoder().beginRenderPass({ colorAttachments: [{
      view: this.attachmentView(presentationTexture), loadOp: "clear", storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: this.alpha ? 0 : 1 },
    }] });
    pass.setPipeline(this.presentationPipeline);
    pass.setBindGroup(0, target.presentationGroup);
    pass.draw(3);
    pass.end();
    this.stats.passes++;
    this.defaultDirty = false;
    return true;
  }

  /** Publish the current default drawing buffer before this canvas is used as a DOM source. */
  prepareCanvasSource(): void {
    if (this.disposed || !this.canvas.width || !this.canvas.height) return;
    const target = this.resolveTarget({ color: null, depth: null, depthGeneration: 0,
      width: this.surface.width, height: this.surface.height, isDefault: true });
    this.beginPass(target);
    this.defaultDirty = true;
    this.flush();
  }



  private submitEncoded(): void {
    this.endPass();
    const presented = this.present();
    if (this.encoder) {
      this.uniforms.upload((buffer, data, bytes) => {
        this.device.queue.writeBuffer(buffer, 0, data, 0, bytes);
        this.completion.markIssued();
        this.stats.uploadedBytes += bytes;
      }, buffer => { this.transientBuffers.add(buffer); });
      this.device.queue.submit([this.encoder.finish()]);
      this.completion.markIssued();
      this.encoder = null;
      this.stats.submits++;
    }
    if (presented && this.retained) {
      this.retained.destination.transferFromImageBitmap(this.retained.producer.transferToImageBitmap());
    }
  }

  /** Discard the default attachments without changing bindings, write masks or the GL viewport. */
  resetDefaultDrawingBuffer(): void {
    this.lastPresentedTexture = null;
    this.offscreenDiscard?.forget();
    const target = this.defaultTarget;
    if (!target) return;
    this.endPass();
    this.initialized.delete(target.color);
    if (target.depth) this.initialized.delete(target.depth);
  }

  flush(): void {
    if (this.disposed) return;
    this.submitEncoded();
    const fence = this.completion.observe();
    if (!this.transientBuffers.size && !this.retiredTextures.size) return;
    const completed = [...this.transientBuffers];
    this.transientBuffers.clear();
    this.driverGroups = new WeakMap();
    const retired = [...this.retiredTextures];
    this.retiredTextures.clear();
    void fence.then(() => {
      for (const buffer of completed) {
        if (this.buffers.delete(buffer)) {
          this.stats.allocatedBufferBytes -= buffer.size;
          buffer.destroy();
        }
      }
      for (const texture of retired) {
        this.stats.allocatedTextureBytes -= textureAllocationBytes(texture);
        this.textures.delete(texture);
        texture.destroy();
      }
    }).catch(() => {});
  }

  finish(): void {
    this.flush();
    if (!this.completion.isIdle) {
      throw new DOMException('finish requires synchronous completion of pending GPU queue work', 'NotSupportedError');
    }
  }

  /** Preserve canvas alpha bytes through external copy and the opaque Canvas2D readback transport. */
  captureDomCanvas(source: HTMLCanvasElement | OffscreenCanvas, width: number, height: number,
    plan: DomTextureCapturePlan): Uint8Array {
    if (this.disposed) throw new DOMException('The context has been disposed.', 'InvalidStateError');
    this.endPass();
    const texture = this.createTexture(width, height, 'rgba8unorm');
    try {
      const destination = { texture, colorSpace: plan.colorSpace, premultipliedAlpha: plan.premultiplyAlpha };
      const size = { width, height };
      try {
        this.device.queue.copyExternalImageToTexture({ source, flipY: plan.flipY }, destination, size);
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'OperationError') throw error;
        // Chrome cannot directly import a canvas that has never acquired a rendering context.
        const snapshot = new OffscreenCanvas(width, height);
        const context = snapshot.getContext('2d');
        if (!context) throw error;
        context.drawImage(source, 0, 0);
        this.device.queue.copyExternalImageToTexture({ source: snapshot, flipY: plan.flipY }, destination, size);
      }
      this.completion.markIssued();
      this.stats.copies++;
      this.stats.uploadedBytes += width * height * 4;
      this.canvasReadback ??= new CanvasReadback(this.device, this.stats, this.completion);
      return this.canvasReadback.capture(texture, width, height, () => this.getEncoder(), () => this.flush());
    } finally {
      this.textures.delete(texture);
      this.stats.allocatedTextureBytes -= width * height * 4;
      texture.destroy();
    }
  }

  /** Synchronous RGBA8 capture after public GL validation in the selected core. */
  captureCanvas(snapshot: TargetSnapshot,
    region = { x: 0, y: 0, width: snapshot.width, height: snapshot.height }): CapturedPixels {
    if (this.disposed) throw new DOMException("The context has been disposed", "InvalidStateError");
    if (!region.width || !region.height) {
      return { width: region.width, height: region.height, data: new Uint8Array(0) };
    }
    const target = this.resolveTarget(snapshot);
    this.beginPass(target);
    this.endPass();
    this.canvasReadback ??= new CanvasReadback(this.device, this.stats, this.completion);
    const data = this.canvasReadback.capture(target.color, region.width, region.height,
      () => this.getEncoder(), () => this.flush(), region.x, region.y);
    return { width: region.width, height: region.height, data };
  }

  get canvasReadbackStats(): Readonly<CanvasReadback['stats']> | null {
    return this.canvasReadback?.stats ?? null;
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
    this.sizeObserver?.disconnect();
    this.beforeCanvasResize = undefined;
    abandonedHosts.unregister(this);
    await this.device.queue.onSubmittedWorkDone().catch(() => {});
    this.offscreenDiscard?.dispose();
    this.canvasReadback?.dispose();
    this.canvasReadback = null;
    for (const buffer of this.buffers) buffer.destroy();
    for (const texture of this.textures) texture.destroy();
    this.context.unconfigure();
    this.device.removeEventListener("uncapturederror", this.handleError);
    if (this.ownsDevice) this.device.destroy();
    this.buffers.clear();
    this.transientBuffers.clear();
    this.residentGeometry = null;
    this.previousIndexVersion = undefined;
    this.geometryCache.clear();
    this.uniforms.clear();
    this.textures.clear();
    this.sampledImageCache.clear();
    this.stats.allocatedBufferBytes = 0;
    this.stats.allocatedTextureBytes = 0;
  }
}
