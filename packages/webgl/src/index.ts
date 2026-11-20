import { createContextInterface, webglInterfaces } from './interfaces.js';
import { createVertexArrayExtension } from './vertex-arrays.js';
import { GL, SRGB, BLEND_MINMAX, SHADER_EXTENSIONS, DERIVATIVE_HINT_OES, VERTEX_ARRAY_BINDING_OES, allocateContextId, ExecutionResources } from "@refral/core-api";
import type { BufferHandle, BufferSnapshot, CoreKind, DrawingCore } from "@refral/core-api";
import { createJsDrawingCore } from "@refral/core-js";
import { prepareRustDrawingCores, prepareRustModule } from "@refral/core-wasm";
import { BrowserHost } from "@refral/browser-host";
import type { CapturedPixels } from "@refral/browser-host";
import { createCompiler, createCompilerRegistry, COMPILER_LIMITS } from "@refral/compiler";
import type { Compiler } from "@refral/compiler";
import { createBufferFacade, isBufferBinding, requireArguments, toEnum, toSize } from "./buffers.js";
import { createProgramFacade } from "./programs.js";
import { createResourceFacade, isResourceBinding } from './resources.js';
import { readPixels } from './readback.js';
import { registerCanvasSource } from './dom-upload.js';
import { createContextLoss } from './context-loss.js';

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

export interface PreparedRealm {
  realm: typeof globalThis;
  queryResult(name: string, value: unknown): unknown;
}

export interface PreparedContextFactory {
  (canvas: HTMLCanvasElement | OffscreenCanvas, attributes?: WebGLContextAttributes, binding?: PreparedRealm): WebGL1PrototypeContext;
  dispose(): Promise<void>;
}

const hooks = new WeakMap<object, TestingHooks>();
const defaults: WebGLContextAttributes = {
  alpha: true, depth: true, stencil: false, antialias: false,
  premultipliedAlpha: true, preserveDrawingBuffer: false,
  powerPreference: "default", failIfMajorPerformanceCaveat: false, desynchronized: false,
};

function unsupported(operation: string): never {
  throw new DOMException(`${operation} is outside the implemented WebGL1 profile`, "NotSupportedError");
}

/** A structural WebGL API facade. Runtime identity is provided by Refral wrappers. */
export type WebGL1PrototypeContext = WebGLRenderingContext;

function actualAttributes(requested: WebGLContextAttributes): WebGLContextAttributes {
  return { ...defaults, preserveDrawingBuffer: requested.preserveDrawingBuffer ?? false, premultipliedAlpha: requested.premultipliedAlpha ?? true, alpha: requested.alpha ?? true, depth: requested.depth ?? true, stencil: requested.stencil ?? false };
}

function trackBitmapTransfer(canvas: HTMLCanvasElement | OffscreenCanvas, currentHost: () => BrowserHost): () => void {
  if (!('transferToImageBitmap' in canvas)) return () => {};
  const previous = Object.getOwnPropertyDescriptor(canvas, 'transferToImageBitmap');
  const original = canvas.transferToImageBitmap;
  function transferToImageBitmap(this: OffscreenCanvas): ImageBitmap {
    if (this !== canvas) return original.call(this);
    const host = currentHost();
    host.prepareCanvasSource();
    const bitmap = original.call(this);
    host.resetDefaultDrawingBuffer();
    return bitmap;
  }
  Object.defineProperty(canvas, 'transferToImageBitmap', {
    value: transferToImageBitmap, configurable: true, writable: true, enumerable: previous?.enumerable ?? false,
  });
  return () => {
    if (canvas.transferToImageBitmap !== transferToImageBitmap) return;
    if (previous) Object.defineProperty(canvas, 'transferToImageBitmap', previous);
    else Reflect.deleteProperty(canvas, 'transferToImageBitmap');
  };
}

function createGeneration(realm: typeof globalThis, host: BrowserHost, core: DrawingCore, releaseResources: () => void,
  shaderExtensionMask: number) {
  const interfaces = webglInterfaces(realm);
  const bufferFacade = createBufferFacade(core, interfaces);
  const programFacade = createProgramFacade(core, interfaces);
  const resourceFacade = createResourceFacade(core,
    (source, width, height, plan) => host.captureDomCanvas(source, width, height, plan),
    realm.TypeError, interfaces);
  const supportsSrgb = core.invoke('supportsSrgbTextures', []) === true;
  let srgbExtension: object | undefined;
  const supportsFloat = core.invoke('supportsFloatTextures', []) === true;
  let floatExtension: object | undefined;
  const supportsArrays = core.invoke('supportsVertexArrayObjects', []) === true;
  let arrays: ReturnType<typeof createVertexArrayExtension> | undefined;
  const coreExtensions: Record<string, { name: string; operation?: string; enums: Record<string, number>;
    args?: number[]; methods?: Record<string, (...args: unknown[]) => unknown> }>
    = core.invoke('supportsCoreExtensions', []) === true ? {
    ext_blend_minmax: { name: 'EXT_blend_minmax', operation: 'enableBlendMinmax', enums: BLEND_MINMAX },
    oes_element_index_uint: { name: 'OES_element_index_uint', operation: 'enableElementIndexUint', enums: {} },
    oes_fbo_render_mipmap: { name: 'OES_fbo_render_mipmap', operation: 'enableFramebufferMipmaps', enums: {} },
  } : {};
  if (core.invoke('supportsPolygonOffsetClamp', []) === true) {
    coreExtensions.ext_polygon_offset_clamp = { name: 'EXT_polygon_offset_clamp',
      operation: 'enablePolygonOffsetClamp', enums: { POLYGON_OFFSET_CLAMP_EXT: 0x8e1b },
      methods: { polygonOffsetClampEXT: resourceFacade.methods.polygonOffsetClampEXT! } };
  }
  if (core.invoke('supportsDebugShaders', []) === true) {
    coreExtensions.webgl_debug_shaders = { name: 'WEBGL_debug_shaders', enums: {},
      methods: { getTranslatedShaderSource: programFacade.methods.getTranslatedShaderSource! } };
  }
  if (supportsFloat && host.device.features.has('float32-filterable')
    && core.invoke('supportsFloatLinearTextures', []) === true) {
    coreExtensions.oes_texture_float_linear = { name: 'OES_texture_float_linear',
      operation: 'enableFloatLinearTextures', enums: {} };
  }
  if (shaderExtensionMask && core.invoke('supportsShaderExtensions', []) === true) {
    for (const [name, bit, enums] of [
      ['OES_standard_derivatives', SHADER_EXTENSIONS.derivatives, { FRAGMENT_SHADER_DERIVATIVE_HINT_OES: DERIVATIVE_HINT_OES }],
      ['EXT_frag_depth', SHADER_EXTENSIONS.fragmentDepth, {}],
      ['EXT_shader_texture_lod', SHADER_EXTENSIONS.textureLod, {}],
    ] as const) {
      if (shaderExtensionMask & bit) coreExtensions[name.toLowerCase()] = {
        name, operation: 'enableShaderExtension', args: [bit], enums,
      };
    }
  }
  const enabledCoreExtensions = new Map<string, object>();
  let releasing: Promise<void> | undefined;
  let disposed = false;
  function releaseGPU() {
    if (!releasing) { releaseResources(); releasing = host.dispose(); }
    return releasing;
  }
  return { core, host, interfaces, bufferFacade, programFacade, resourceFacade, releaseGPU,
    supportsArrays, supportsFloat, supportsSrgb,
    coreExtensionNames: Object.values(coreExtensions).map(extension => extension.name),
    enableCoreExtension(name: string): object | null {
      if (!Object.hasOwn(coreExtensions, name)) return null;
      const spec = coreExtensions[name]!;
      let extension = enabledCoreExtensions.get(name);
      if (!extension) {
        if (spec.operation) core.invoke(spec.operation, spec.args ?? []);
        extension = new realm.Object();
        for (const [key, value] of Object.entries(spec.enums))
          Object.defineProperty(extension, key, { value, enumerable: true });
        for (const [key, call] of Object.entries(spec.methods ?? {})) {
          const method = function (this: unknown, ...args: unknown[]) {
            if (this !== extension) throw new realm.TypeError(`Expected a ${spec.name} receiver.`);
            return call(...args);
          };
          Object.defineProperty(extension, key, { value: method, writable: true, configurable: true });
        }
        enabledCoreExtensions.set(name, extension);
      }
      return extension;
    },
    enableSrgbTextures() {
      if (!supportsSrgb) return null;
      if (!srgbExtension) {
        core.invoke('enableSrgbTextures', []);
        srgbExtension = new realm.Object();
        for (const [key, value] of Object.entries(SRGB))
          Object.defineProperty(srgbExtension, key, { value, enumerable: true });
      }
      return srgbExtension;
    },
    enableFloatTextures() {
      if (!supportsFloat) return null;
      if (!floatExtension) {
        core.invoke('enableFloatTextures', []);
        floatExtension = new realm.Object();
      }
      return floatExtension;
    },
    enableVertexArrays() {
      if (!supportsArrays) return null;
      arrays ??= createVertexArrayExtension(core, interfaces.buffer, realm.TypeError);
      return arrays.extension;
    },
    vertexArrayBinding() { return arrays ? arrays.binding() : core.invoke('getParameter', [VERTEX_ARRAY_BINDING_OES]); },
    dispose() {
      if (!disposed) {
        disposed = true;
        core.dispose();
        bufferFacade.dispose();
        programFacade.dispose();
        resourceFacade.dispose();
      }
      return releaseGPU();
    } };
}

function observeDeviceLoss(device: GPUDevice, owner: WeakRef<ReturnType<typeof createContextLoss>>): void {
  void device.lost.then(info => owner.deref()?.deviceLoss(info.message));
}

function wrapContext(canvas: HTMLCanvasElement | OffscreenCanvas, attributes: WebGLContextAttributes,
  create: () => ReturnType<typeof createGeneration>, onDispose: () => void, binding?: PreparedRealm): WebGL1PrototypeContext {
  let current = create();
  const interfaces = current.interfaces;
  let disposed: Promise<void> | undefined;
  const lost = createContextLoss(canvas, {
    invalidOperation: () => current.core.invoke('recordContextLossError', []),
    lose() {
      if (!current.core.markLost()) return false;
      void current.releaseGPU();
      return true;
    },
    async restore() {
      const previous = current;
      try {
        await previous.releaseGPU();
        if (!lost.canRestore()) return false;
        current = create();
        current.resourceFacade.domUploads.colorSpace = previous.resourceFacade.domUploads.colorSpace;
        await previous.dispose();
        return true;
      } catch (error) {
        current.host.errors.push(`Context restoration failed: ${String(error)}`);
        return false;
      }
    },
  });
  const untrackBitmap = trackBitmapTransfer(canvas, () => current.host);
  const unregisterSource = registerCanvasSource(canvas, {
    prepare: () => current.host.prepareCanvasSource(), isLost: () => current.core.isContextLost(),
  });
  observeDeviceLoss(current.host.device, new WeakRef(lost));
  const invoke = (property: string, args: unknown[]): unknown => {
    const { core, host, bufferFacade, programFacade, resourceFacade } = current;
    if (property === 'canvas') return canvas;
    if (property === 'drawingBufferWidth') return core.isContextLost() ? 0 : host.surface.width;
    if (property === 'drawingBufferHeight') return core.isContextLost() ? 0 : host.surface.height;
    if (property === 'drawingBufferFormat') return attributes.alpha ? GL.RGBA8 : GL.RGB8;
    if (property === 'drawingBufferColorSpace') return 'srgb';
    if (property === 'unpackColorSpace') {
      if (!args.length) return resourceFacade.domUploads.colorSpace;
      return resourceFacade.setUnpackColorSpace(args[0]);
    }
    if (property === 'getError') return core.getError();
    if (property === 'isContextLost') return core.isContextLost();
    if (property === 'readPixels') return readPixels(core, host, args);
    if (Object.hasOwn(bufferFacade.methods, property)) return bufferFacade.methods[property]!(...args);
    if (property === 'getParameter') {
      requireArguments(property, args, 1);
      const parameter = toEnum(args[0]);
      if (parameter === VERTEX_ARRAY_BINDING_OES) return current.vertexArrayBinding();
      if (isBufferBinding(parameter)) return bufferFacade.binding(parameter);
      if (parameter === GL.CURRENT_PROGRAM) return programFacade.current();
      if (isResourceBinding(parameter)) return resourceFacade.binding(parameter);
      args = [parameter];
    }
    if (property === 'getContextAttributes') return core.isContextLost() ? null : { ...attributes };
    if (property === 'getSupportedExtensions') return core.isContextLost() ? null :
      [...(current.supportsSrgb ? ['EXT_sRGB'] : []), ...(current.supportsFloat ? ['OES_texture_float'] : []), ...(current.supportsArrays ? ['OES_vertex_array_object'] : []), ...current.coreExtensionNames, 'WEBGL_lose_context'];
    if (property === 'getExtension') {
      requireArguments(property, args, 1);
      const name = `${args[0]}`.toLowerCase();
      if (core.isContextLost()) return null;
      if (name === 'ext_srgb') return current.enableSrgbTextures();
      if (name === 'oes_texture_float') return current.enableFloatTextures();
      if (name === 'oes_vertex_array_object') return current.enableVertexArrays();
      return name === 'webgl_lose_context' ? lost.extension : current.enableCoreExtension(name);
    }
    if (property === 'vertexAttribPointer') {
      requireArguments(property, args, 6);
      args = [toEnum(args[0]), +(args[1] as number) | 0, toEnum(args[2]), Boolean(args[3]),
        +(args[4] as number) | 0, toSize(args[5])];
    } else if (property === 'drawArrays') {
      requireArguments(property, args, 3);
      args = [toEnum(args[0]), +(args[1] as number) | 0, +(args[2] as number) | 0];
    } else if (property === 'drawElements') {
      requireArguments(property, args, 4);
      args = [toEnum(args[0]), +(args[1] as number) | 0, toEnum(args[2]), toSize(args[3])];
    }
    const facadeMethod = programFacade.methods[property] ?? resourceFacade.methods[property];
    const result = facadeMethod ? facadeMethod(...args) : core.invoke(property, args);
    if (property === 'getVertexAttrib' && toEnum(args[1]) === GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING) {
      return bufferFacade.wrap(result as BufferHandle | null);
    }
    return result;
  };
  const proxy = createContextInterface(interfaces.context, binding
    ? (name, args) => binding.queryResult(name, invoke(name, args)) : invoke);
  hooks.set(proxy, {
    core: current.core.kind,
    inspectBuffer: buffer => current.bufferFacade.inspect(buffer),
    capture: () => current.host.capture(current.core.captureTarget()),
    get stats() { return current.host.stats; },
    get environment() { return current.host.environment; },
    get errors() { return current.host.errors; },
    get device() { return current.host.device; },
    dispose() {
      if (!disposed) {
        lost.dispose();
        untrackBitmap();
        unregisterSource();
        disposed = current.dispose().finally(onDispose);
      }
      return disposed;
    },
  });
  return proxy as unknown as WebGL1PrototypeContext;
}

export async function createWebGLOnWebGPU(canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ContextOptions = { version: 1 }): Promise<WebGL1PrototypeContext> {
  if (options.version !== 1) return unsupported("WebGL version");
  const prepared = await prepareRuntime(options);
  try {
    return prepared.create(canvas, { ...options, ...options.contextAttributes, ...options.attributes }, prepared.dispose);
  } catch (error) { prepared.dispose(); throw error; }
}

type RuntimeOptions = Pick<ContextOptions, 'core' | 'coreWasmURL' | 'compiler' | 'compilerBaseURL'>;

async function prepareRuntime(options: RuntimeOptions) {
  const kind = options.core ?? 'js';
  if (kind !== 'js' && kind !== 'rust') return unsupported('core selection');
  const prepared = await Promise.allSettled([
    options.compiler ?? createCompiler(options.compilerBaseURL), BrowserHost.prepare(),
    kind === 'rust' ? prepareRustModule(options.coreWasmURL) : null,
  ]);
  const [compilerResult, hostResult, moduleResult] = prepared;
  const failure = prepared.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') {
    if (hostResult.status === 'fulfilled') hostResult.value.dispose();
    throw failure.reason;
  }
  if (compilerResult.status !== 'fulfilled' || hostResult.status !== 'fulfilled'
    || moduleResult.status !== 'fulfilled') throw new Error('Context preparation failed.');
  const compiler = compilerResult.value;
  const makeHost = hostResult.value;
  const makeCore = moduleResult.value ? prepareRustDrawingCores(moduleResult.value) : createJsDrawingCore;
  const create = (canvas: HTMLCanvasElement | OffscreenCanvas, requested: WebGLContextAttributes, onDispose: () => void, binding?: PreparedRealm) => {
    const realm = binding?.realm ?? ('ownerDocument' in canvas ? canvas.ownerDocument.defaultView : null) ?? globalThis;
    const attributes = actualAttributes(requested);
    const errors: string[] = [];
    return wrapContext(canvas, attributes, () => {
      const host = makeHost(canvas, { alpha: attributes.alpha!, depth: attributes.depth!, stencil: attributes.stencil, premultipliedAlpha: attributes.premultipliedAlpha, preserveDrawingBuffer: attributes.preserveDrawingBuffer, errors });
      const registry = createCompilerRegistry(compiler);
      const contextId = allocateContextId();
      const resources = new ExecutionResources(contextId, host);
      const coreOptions = {
        contextId, maxBufferBytes: host.limits.maxBufferSize,
        surface: host.surface, attributes, profile: COMPILER_LIMITS,
      };
      const services = { compiler: registry, host, resources };
      try {
        const core = makeCore(coreOptions, services);
        return createGeneration(realm, host, core, () => { resources.dispose(); registry.dispose(); },
          compiler.shaderExtensionMask ?? 0);
      } catch (error) {
        registry.dispose();
        resources.dispose();
        void host.dispose();
        throw error;
      }
    }, onDispose, binding);
  };
  return { create, dispose: makeHost.dispose };
}

/** Harness-only synchronous construction after browser device/compiler initialization. */
export async function prepareContextFactory(options: RuntimeOptions = {}): Promise<PreparedContextFactory> {
  const prepared = await prepareRuntime(options);
  const contexts = new Set<WeakRef<WebGL1PrototypeContext>>();
  const factory: PreparedContextFactory = (canvas, requested = {}, binding) => {
    const context = prepared.create(canvas, requested, () => contexts.delete(reference), binding);
    const reference = new WeakRef(context);
    contexts.add(reference);
    return context;
  };
  factory.dispose = async () => {
    await Promise.all([...contexts].map(ref => {
      const context = ref.deref();
      return context && getTestingHooks(context).dispose();
    }));
    contexts.clear();
    prepared.dispose();
  };
  return factory;
}

export function getTestingHooks(context: WebGL1PrototypeContext): TestingHooks {
  const result = hooks.get(context);
  if (!result) throw new TypeError("Expected a Refral context");
  return result;
}
