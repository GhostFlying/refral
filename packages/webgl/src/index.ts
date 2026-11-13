import { GL, allocateContextId } from "@refral/core-api";
import type { BufferCore, BufferSnapshot, CoreKind } from "@refral/core-api";
import { SemanticContext, createJsBufferCore } from "@refral/core-js";
import type { JsBufferCore } from "@refral/core-js";
import { createRustBufferCore } from "@refral/core-wasm";
import { BrowserHost } from "@refral/browser-host";
import type { CapturedPixels } from "@refral/browser-host";
import { createCompiler, COMPILER_LIMITS } from "@refral/compiler";
import type { Compiler } from "@refral/compiler";
import { createBufferFacade, isBufferBinding, requireArguments, toEnum } from "./buffers.js";

export interface ContextOptions extends WebGLContextAttributes {
  version: 1;
  core?: CoreKind;
  coreWasmURL?: string;
  attributes?: WebGLContextAttributes;
  contextAttributes?: WebGLContextAttributes;
  compiler?: Compiler;
  compilerBaseURL?: string;
}

export interface TestingHooks {
  readonly core: CoreKind;
  inspectBuffer(buffer: WebGLBuffer): BufferSnapshot | null;
  capture(): Promise<CapturedPixels>;
  readonly stats: BrowserHost["stats"];
  readonly environment: Record<string, unknown>;
  readonly errors: string[];
  readonly device: GPUDevice;
  dispose(): Promise<void>;
}

export interface PreparedContextFactory {
  (canvas: HTMLCanvasElement, attributes?: WebGLContextAttributes): WebGL1PrototypeContext;
  dispose(): Promise<void>;
}

const hooks = new WeakMap<object, TestingHooks>();
const defaults: WebGLContextAttributes = {
  alpha: true, depth: true, stencil: false, antialias: false,
  premultipliedAlpha: true, preserveDrawingBuffer: true,
  powerPreference: "default", failIfMajorPerformanceCaveat: false, desynchronized: false,
};

function unsupported(operation: string): never {
  throw new DOMException(`${operation} is outside the implemented WebGL1 profile`, "NotSupportedError");
}

/** Convert DOM image inputs at the facade boundary. Core input remains numeric bytes. */
function normalizeImageInput(arguments_: unknown[], subImage: boolean, alignment: number): unknown[] {
  const shortLength = subImage ? 7 : 6;
  if (arguments_.length !== shortLength) return arguments_;
  const source = arguments_[shortLength - 1];
  const image = source as { width?: number; height?: number; naturalWidth?: number;
    naturalHeight?: number; videoWidth?: number; videoHeight?: number; data?: Uint8ClampedArray };
  const width = Number(image?.naturalWidth ?? image?.videoWidth ?? image?.width);
  const height = Number(image?.naturalHeight ?? image?.videoHeight ?? image?.height);
  if (!width || !height) return arguments_;
  let rgba: Uint8ClampedArray;
  if (Object.prototype.toString.call(source) === "[object ImageData]") rgba = image.data!;
  else {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d")!;
    context.drawImage(source as CanvasImageSource, 0, 0, width, height);
    rgba = context.getImageData(0, 0, width, height).data;
  }
  const format = Number(arguments_[subImage ? 4 : 3]);
  const components = format === GL.RGBA ? 4 : format === GL.RGB ? 3 : format === GL.LUMINANCE_ALPHA ? 2 : 1;
  const stride = Math.ceil(width * components / alignment) * alignment;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = y * stride + x * components;
      if (format === GL.ALPHA) pixels[to] = rgba[from + 3]!;
      else {
        pixels[to] = rgba[from]!;
        if (format === GL.LUMINANCE_ALPHA) pixels[to + 1] = rgba[from + 3]!;
        else for (let component = 1; component < components; component++) pixels[to + component] = rgba[from + component]!;
      }
    }
  }
  if (subImage) return [arguments_[0], arguments_[1], arguments_[2], arguments_[3], width, height,
    arguments_[4], arguments_[5], pixels];
  return [arguments_[0], arguments_[1], arguments_[2], width, height, 0,
    arguments_[3], arguments_[4], pixels];
}

/** A structural WebGL API facade. Runtime identity is provided by Refral wrappers. */
export type WebGL1PrototypeContext = WebGLRenderingContext;

function actualAttributes(requested: WebGLContextAttributes): WebGLContextAttributes {
  if (requested.stencil) return unsupported("stencil context attribute");
  return { ...defaults, alpha: requested.alpha ?? true, depth: requested.depth ?? true };
}

function wrapContext(canvas: HTMLCanvasElement, host: BrowserHost,
  attributes: WebGLContextAttributes, buffers: BufferCore,
  core: SemanticContext | null, jsBuffers: JsBufferCore | null): WebGL1PrototypeContext {
  const bufferFacade = createBufferFacade(buffers);
  void host.device.lost.then(info => {
    if (buffers.markLost()) canvas.dispatchEvent(new WebGLContextEvent("webglcontextlost", {
      cancelable: true, statusMessage: info.message,
    }));
  });
  const methods = new Map<string, (...args: unknown[]) => unknown>();
  const invoke = (property: string, args: unknown[]): unknown => {
    if (property === 'getError') return buffers.getError();
    if (property === 'isContextLost') return buffers.isContextLost();
    if (Object.hasOwn(bufferFacade.methods, property)) return bufferFacade.methods[property]!(...args);
    if (property === 'getParameter') {
      requireArguments(property, args, 1);
      const parameter = toEnum(args[0]);
      if (isBufferBinding(parameter)) return bufferFacade.binding(parameter);
    }
    if (core) {
      if (property === 'texImage2D' || property === 'texSubImage2D') {
        if (core.isContextLost()) return core.invoke(property, args);
        args = normalizeImageInput(args, property === 'texSubImage2D', core.getParameter(GL.UNPACK_ALIGNMENT) as number);
      }
      const result = core.invoke(property, args);
      if (property === 'getVertexAttrib' && toEnum(args[1]) === GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING) {
        return bufferFacade.wrap(jsBuffers!.toHandle(result));
      }
      return result;
    }
    if (buffers.isContextLost()) {
      if (property === 'getAttribLocation') return -1;
      if (property === 'getVertexAttribOffset') return 0;
      if (property === 'checkFramebufferStatus') return GL.FRAMEBUFFER_UNSUPPORTED;
      if (property.startsWith('get') || property.startsWith('create')) return null;
      if (property.startsWith('is')) return false;
      return undefined;
    }
    if (property === 'getContextAttributes') return { ...attributes };
    if (property === 'getSupportedExtensions') return [];
    if (property === 'getExtension') return null;
    if (property === 'flush') return host.flush();
    return unsupported(`${property} for the Rust Buffer profile`);
  };
  const proxy = new Proxy({}, {
    get(_target, property) {
      if (typeof property === "string" && property in GL) return GL[property as keyof typeof GL];
      if (property === 'canvas') return canvas;
      if (property === 'drawingBufferWidth') return buffers.isContextLost() ? 0 : canvas.width;
      if (property === 'drawingBufferHeight') return buffers.isContextLost() ? 0 : canvas.height;
      if (property === 'drawingBufferColorSpace') return 'srgb';
      if (property === "then") return undefined;
      if (typeof property !== 'string') return undefined;
      if (!methods.has(property)) methods.set(property, (...args) => invoke(property, args));
      return methods.get(property);
    },
  });
  hooks.set(proxy, {
    core: buffers.kind,
    inspectBuffer: bufferFacade.inspect,
    capture: () => {
      if (!core) return unsupported('GPU pixel capture for the Rust Buffer profile');
      return host.capture(core.captureTarget());
    },
    stats: host.stats, environment: host.environment, errors: host.errors, device: host.device,
    dispose: async () => {
      buffers.dispose();
      bufferFacade.dispose();
      await host.dispose();
    },
  });
  return proxy as unknown as WebGL1PrototypeContext;
}

export async function createWebGLOnWebGPU(canvas: HTMLCanvasElement,
  options: ContextOptions = { version: 1 }): Promise<WebGL1PrototypeContext> {
  if (options.version !== 1) return unsupported("WebGL version");
  const kind = options.core ?? 'js';
  if (kind !== 'js' && kind !== 'rust') return unsupported('core selection');
  const attributes = actualAttributes({ ...options, ...options.contextAttributes, ...options.attributes });
  const compiler = options.compiler ?? await createCompiler(options.compilerBaseURL);
  const host = await BrowserHost.create(canvas, { alpha: attributes.alpha!, depth: attributes.depth! });
  try {
    const bufferOptions = { contextId: allocateContextId(), maxBufferBytes: host.limits.maxBufferSize };
    if (kind === 'rust') {
      const buffers = await createRustBufferCore(bufferOptions, options.coreWasmURL);
      return wrapContext(canvas, host, attributes, buffers, null, null);
    }
    const core = new SemanticContext(canvas, host, compiler, attributes, COMPILER_LIMITS);
    const buffers = createJsBufferCore(core, bufferOptions);
    return wrapContext(canvas, host, attributes, buffers, core, buffers);
  } catch (error) {
    await host.dispose();
    throw error;
  }
}

/** Harness-only synchronous construction after browser device/compiler initialization. */
export async function prepareContextFactory(): Promise<PreparedContextFactory> {
  const [compiler, makeHost] = await Promise.all([createCompiler(), BrowserHost.prepare()]);
  const contexts = new Set<WebGL1PrototypeContext>();
  const factory: PreparedContextFactory = (canvas, requested = {}) => {
    const attributes = actualAttributes(requested);
    const host = makeHost(canvas, { alpha: attributes.alpha!, depth: attributes.depth! });
    const core = new SemanticContext(canvas, host, compiler, attributes, COMPILER_LIMITS);
    const buffers = createJsBufferCore(core, { contextId: allocateContextId(), maxBufferBytes: host.limits.maxBufferSize });
    const context = wrapContext(canvas, host, attributes, buffers, core, buffers);
    contexts.add(context);
    return context;
  };
  factory.dispose = async () => {
    await Promise.all([...contexts].map(context => getTestingHooks(context).dispose()));
    contexts.clear();
    makeHost.dispose();
  };
  return factory;
}

export function getTestingHooks(context: WebGL1PrototypeContext): TestingHooks {
  const result = hooks.get(context);
  if (!result) throw new TypeError("Expected a Refral context");
  return result;
}
